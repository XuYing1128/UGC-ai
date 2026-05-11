"""Generated TS repair helpers.

The repair layer is intentionally conservative. It only applies mechanical
fixes that make generated.ts safer for the genshin-ts compiler:

- comment out f.someUnknownApi(...) calls reported by compile errors
- add a printString placeholder when a graph compiled to an empty IR
- keep a timestamped backup before writing the repaired generated.ts
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects_data"
BEIJING_TZ = timezone(timedelta(hours=8))


def _project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def _metadata_path(project_id: str) -> Path:
    return _project_dir(project_id) / "metadata.json"


def _generated_ts_path(project_id: str) -> Path:
    return _project_dir(project_id) / "generated.ts"


def _read_project(project_id: str) -> dict:
    path = _metadata_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"项目 {project_id} 不存在")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_project(project_id: str, data: dict) -> None:
    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    _metadata_path(project_id).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _extract_unknown_f_methods(errors: list[str]) -> list[str]:
    methods: list[str] = []
    seen: set[str] = set()
    for err in errors:
        for match in re.finditer(r"f\.([A-Za-z_$][\w$]*)\s+is\s+not\s+a\s+function", err):
            name = match.group(1)
            if name not in seen:
                seen.add(name)
                methods.append(name)
    return methods


def _comment_unknown_method_lines(ts_code: str, methods: list[str]) -> tuple[str, list[str]]:
    if not methods:
        return ts_code, []

    changed: list[str] = []
    next_lines: list[str] = []
    for line in ts_code.splitlines():
        stripped = line.lstrip()
        indent = line[: len(line) - len(stripped)]
        matched = next((m for m in methods if re.search(rf"\bf\.{re.escape(m)}\s*\(", stripped)), None)
        if matched and not stripped.startswith("//"):
            next_lines.append(f"{indent}// AUTO-REPAIR: 注释未知 genshin-ts API f.{matched}(...)，请用 get_node_info 确认真实节点")
            next_lines.append(f"{indent}// {stripped}")
            changed.append(f"commented f.{matched}(...)")
        else:
            next_lines.append(line)

    return "\n".join(next_lines) + ("\n" if ts_code.endswith("\n") else ""), changed


def _ensure_placeholder_node(ts_code: str, errors: list[str]) -> tuple[str, list[str]]:
    has_empty_ir_error = any("IR document must have at least one node" in e for e in errors)
    if not has_empty_ir_error or "f.printString(" in ts_code:
        return ts_code, []
    return _insert_placeholder_node(ts_code)


def _has_active_f_call(ts_code: str) -> bool:
    for line in ts_code.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        if re.search(r"\bf\.[A-Za-z_$][\w$]*\s*\(", stripped):
            return True
    return False


def _insert_placeholder_node(ts_code: str) -> tuple[str, list[str]]:
    if "f.printString(" in ts_code:
        return ts_code, []

    lines = ts_code.splitlines()
    for idx, line in enumerate(lines):
        if "=> {" in line:
            indent = line[: len(line) - len(line.lstrip())] + "    "
            lines.insert(idx + 1, f"{indent}f.printString('AI AUTO-REPAIR: 编译占位，请补全真实节点图逻辑')")
            return "\n".join(lines) + ("\n" if ts_code.endswith("\n") else ""), ["added printString placeholder"]

    return ts_code, []


def repair_generated_ts(project_id: str, errors: list[str] | None = None) -> dict:
    project = _read_project(project_id)
    ts_path = _generated_ts_path(project_id)
    if not ts_path.exists():
        raise FileNotFoundError(f"项目 {project_id} 的 generated.ts 不存在")

    errors = errors or []
    original = ts_path.read_text(encoding="utf-8")
    repaired = original
    applied: list[str] = []

    unknown_methods = _extract_unknown_f_methods(errors)
    repaired, changes = _comment_unknown_method_lines(repaired, unknown_methods)
    applied.extend(changes)

    if changes and not _has_active_f_call(repaired):
        repaired, placeholder_changes = _insert_placeholder_node(repaired)
        applied.extend(placeholder_changes)

    repaired, changes = _ensure_placeholder_node(repaired, errors)
    applied.extend(changes)

    if not applied:
        return {
            "project_id": project_id,
            "changed": False,
            "applied_fixes": [],
            "message": "没有匹配到可自动修复的问题",
        }

    timestamp = datetime.now(BEIJING_TZ).strftime("%Y%m%d-%H%M%S")
    backup_path = _project_dir(project_id) / f"generated.before-repair-{timestamp}.ts"
    shutil.copyfile(ts_path, backup_path)
    ts_path.write_text(repaired, encoding="utf-8")

    nodegraph = project.setdefault("nodegraph", {})
    nodegraph["generated_ts"] = repaired
    artifacts = nodegraph.setdefault("artifacts", {})
    history = artifacts.setdefault("repair_history", [])
    history.append({
        "at": datetime.now(BEIJING_TZ).isoformat(timespec="seconds"),
        "backup_path": str(backup_path.relative_to(PROJECTS_DIR.parent)),
        "applied_fixes": applied,
        "source_errors": errors[:10],
    })
    artifacts["generated_ts_path"] = str(ts_path.relative_to(PROJECTS_DIR.parent))
    _write_project(project_id, project)

    return {
        "project_id": project_id,
        "changed": True,
        "applied_fixes": applied,
        "backup_path": str(backup_path.relative_to(PROJECTS_DIR.parent)),
    }
