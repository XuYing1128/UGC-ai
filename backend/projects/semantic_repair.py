"""LLM-assisted repair for generated genshin-ts code."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects_data"
BEIJING_TZ = timezone(timedelta(hours=8))


def _project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def _metadata_path(project_id: str) -> Path:
    return _project_dir(project_id) / "metadata.json"


def _generated_ts_path(project_id: str) -> Path:
    return _project_dir(project_id) / "generated.ts"


def _read_project(project_id: str) -> dict[str, Any]:
    path = _metadata_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"项目 {project_id} 不存在")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_project(project_id: str, data: dict[str, Any]) -> None:
    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    _metadata_path(project_id).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _extract_code(text: str) -> str:
    fenced = re.search(r"```(?:ts|typescript)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    code = fenced.group(1) if fenced else text
    code = code.strip()
    if "import { g }" in code:
        code = code[code.find("import { g }") :]
    return code.rstrip() + "\n"


def _build_prompt(project: dict[str, Any], ts_code: str, errors: list[str]) -> list[dict[str, str]]:
    nodegraph = project.get("nodegraph") or {}
    evidence = nodegraph.get("knowledge_evidence", [])[:6]
    plan = nodegraph.get("nodegraph_plan", {})
    intent = nodegraph.get("intent_spec", {})
    evidence_text = json.dumps(evidence, ensure_ascii=False, indent=2)
    plan_text = json.dumps(plan, ensure_ascii=False, indent=2)
    intent_text = json.dumps(intent, ensure_ascii=False, indent=2)
    errors_text = "\n".join(errors[:20]) or "(no compile errors provided)"

    system = (
        "You repair generated genshin-ts TypeScript for a Miliastra/Genshin UGC node graph tool. "
        "Return only the full TypeScript file. Do not explain."
    )
    user = f"""
请根据编译错误修复 generated.ts。约束非常严格：
1. 必须保留 `import {{ g }} from 'genshin-ts/runtime/core'`。
2. 优先使用 `g.server({{ id: 0 }}).on('whenEntityIsCreated', (_evt, f) => {{ ... }})` 这种当前项目已验证可编译的结构。
3. 不要编造未知的 `f.xxx(...)` API。无法确认的功能写成 TODO 注释。
4. 如果无法实现真实功能，至少保留一个 `f.printString('...')` 占位节点，避免空 IR。
5. 输出完整 TypeScript 文件，不要 Markdown 说明。

项目意图：
{intent_text}

节点图计划：
{plan_text}

知识库证据：
{evidence_text}

编译错误：
{errors_text}

当前 generated.ts：
```ts
{ts_code}
```
""".strip()
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _call_llm(config: dict[str, Any] | None, messages: list[dict[str, str]]) -> tuple[str | None, dict[str, Any]]:
    try:
        from common.llm_config import resolve_llm_config

        llm = resolve_llm_config(config or {})
    except Exception as exc:
        return None, {
            "available": False,
            "message": f"LLM 配置不可用：{exc}",
        }

    api_key = str(llm.get("api_key", "")).strip()
    base_url = str(llm.get("api_base_url", "")).strip().rstrip("/")
    model = str(llm.get("model", "")).strip()
    if not api_key or not base_url or not model:
        return None, {
            "available": False,
            "message": "LLM 配置缺少 api_key、api_base_url 或 model",
            "model": model,
            "channel_id": llm.get("channel_id"),
        }

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
    }
    try:
        with httpx.Client(timeout=90.0) as client:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return content, {
            "available": True,
            "model": model,
            "channel_id": llm.get("channel_id"),
        }
    except Exception as exc:
        return None, {
            "available": False,
            "message": f"LLM 调用失败：{exc}",
            "model": model,
            "channel_id": llm.get("channel_id"),
        }


def semantic_repair_generated_ts(
    project_id: str,
    errors: list[str] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    project = _read_project(project_id)
    ts_path = _generated_ts_path(project_id)
    if not ts_path.exists():
        raise FileNotFoundError(f"项目 {project_id} 的 generated.ts 不存在")

    original = ts_path.read_text(encoding="utf-8")
    messages = _build_prompt(project, original, errors or [])
    raw, meta = _call_llm(config, messages)
    if not raw:
        return {
            "project_id": project_id,
            "changed": False,
            "available": False,
            "message": meta.get("message", "LLM 不可用"),
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    repaired = _extract_code(raw)
    if "import { g } from 'genshin-ts/runtime/core'" not in repaired:
        return {
            "project_id": project_id,
            "changed": False,
            "available": True,
            "message": "LLM 输出缺少 genshin-ts runtime import，已拒绝写入",
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    if repaired.strip() == original.strip():
        return {
            "project_id": project_id,
            "changed": False,
            "available": True,
            "message": "LLM 未产生代码变更",
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    timestamp = datetime.now(BEIJING_TZ).strftime("%Y%m%d-%H%M%S")
    backup_path = _project_dir(project_id) / f"generated.before-semantic-repair-{timestamp}.ts"
    shutil.copyfile(ts_path, backup_path)
    ts_path.write_text(repaired, encoding="utf-8")

    nodegraph = project.setdefault("nodegraph", {})
    nodegraph["generated_ts"] = repaired
    artifacts = nodegraph.setdefault("artifacts", {})
    history = artifacts.setdefault("semantic_repair_history", [])
    history.append({
        "at": datetime.now(BEIJING_TZ).isoformat(timespec="seconds"),
        "backup_path": str(backup_path.relative_to(PROJECTS_DIR.parent)),
        "source_errors": (errors or [])[:10],
        "model": meta.get("model"),
        "channel_id": meta.get("channel_id"),
    })
    artifacts["generated_ts_path"] = str(ts_path.relative_to(PROJECTS_DIR.parent))
    _write_project(project_id, project)

    return {
        "project_id": project_id,
        "changed": True,
        "available": True,
        "message": "LLM 已重写 generated.ts",
        "backup_path": str(backup_path.relative_to(PROJECTS_DIR.parent)),
        "model": meta.get("model"),
        "channel_id": meta.get("channel_id"),
    }
