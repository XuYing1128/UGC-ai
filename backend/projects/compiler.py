"""genshin-ts 编译适配器

- _ensure_genshin_ts_built: 确保 genshin-ts-master dist/ 已构建
- setup_compile_workspace: 创建工作区目录
- compile_generated_ts: 完整编译流程
"""

import json
import shutil
import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta

BEIJING_TZ = timezone(timedelta(hours=8))
PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects_data"
GST_MASTER = Path(r"D:\UGC - AI\genshin-ts-master").resolve()
GST_DIST = GST_MASTER / "dist"


def _find_cmd(name: str) -> str | None:
    """在 PATH 中查找可执行命令。Windows 上自动回退到 .cmd 后缀。"""
    resolved = shutil.which(name)
    if resolved:
        return resolved
    resolved = shutil.which(name + ".cmd")
    if resolved:
        return resolved
    return None


def _run(cmd_parts: list[str], *, cwd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """subprocess.run 的封装：先解析命令路径，Windows 上自动补 .cmd。

    如果命令不在 PATH 中，返回一个 exit code 为 127 的伪结果，
    不会抛出 FileNotFoundError。
    """
    exe = _find_cmd(cmd_parts[0])
    if exe is None:
        # 构造一个伪 CompletedProcess 表示命令未找到
        return subprocess.CompletedProcess(
            args=cmd_parts,
            returncode=127,
            stdout="",
            stderr=f"命令不可用: {cmd_parts[0]} 不在 PATH 中",
        )
    args = [exe] + cmd_parts[1:]
    return subprocess.run(
        args, cwd=cwd, capture_output=True, text=True, timeout=timeout,
    )


def _project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def _metadata_path(project_id: str) -> Path:
    return _project_dir(project_id) / "metadata.json"


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


def _ensure_genshin_ts_built() -> tuple[bool, str]:
    if GST_DIST.exists() and any(GST_DIST.iterdir()):
        return True, ""

    try:
        if not (GST_MASTER / "node_modules").exists():
            r = _run(
                ["npm", "install", "--silent"],
                cwd=str(GST_MASTER), timeout=300,
            )
            if r.returncode != 0:
                return False, f"genshin-ts npm install 失败: {(r.stderr or '')[-500:]}"

        r = _run(
            ["npm", "run", "build"],
            cwd=str(GST_MASTER), timeout=300,
        )
        if r.returncode != 0:
            return False, f"genshin-ts npm run build 失败: {(r.stderr or '')[-500:]}"

        return True, ""
    except subprocess.TimeoutExpired:
        return False, "genshin-ts 构建超时（npm install 最长 5 分钟 / build 最长 5 分钟）"
    except Exception as e:
        return False, f"genshin-ts 构建异常: {e}"


def setup_compile_workspace(project_id: str) -> Path:
    ws = _project_dir(project_id) / "compile_workspace"
    ws.mkdir(parents=True, exist_ok=True)
    return ws


def _write_workspace_files(ws: Path, ts_code: str) -> None:
    (ws / "src").mkdir(exist_ok=True)

    pkg = {
        "name": "genshin-compile-workspace",
        "private": True,
        "type": "module",
        "scripts": {
            "typecheck": "tsc -p tsconfig.json --noEmit",
            "build": "gsts",
        },
        "dependencies": {
            "genshin-ts": f"file:{GST_MASTER.as_posix()}",
            "typescript": "^5.9.3",
        },
    }
    (ws / "package.json").write_text(
        json.dumps(pkg, indent=2), encoding="utf-8",
    )

    tsconfig = {
        "extends": "genshin-ts/tsconfig/base.json",
        "compilerOptions": {
            "rootDir": ".",
            "outDir": "dist",
            "typeRoots": ["./node_modules/genshin-ts/types", "./node_modules/@types"],
            "types": ["gsts"],
        },
        "include": ["src", "gsts.config.ts"],
    }
    (ws / "tsconfig.json").write_text(
        json.dumps(tsconfig, indent=2), encoding="utf-8",
    )

    gsts_config = (
        "import type { GstsConfig } from 'genshin-ts'\n\n"
        "const config: GstsConfig = {\n"
        "  compileRoot: '.',\n"
        "  entries: ['./src'],\n"
        "  outDir: './dist',\n"
        "}\n\n"
        "export default config\n"
    )
    (ws / "gsts.config.ts").write_text(gsts_config, encoding="utf-8")

    (ws / "src" / "main.ts").write_text(ts_code, encoding="utf-8")


def _new_result() -> dict:
    return {
        "success": False,
        "status": "failed",
        "stage": "setup",
        "stdout": "",
        "stderr": "",
        "errors": [],
        "warnings": [],
        "workspace_path": "",
    }


def compile_generated_ts(project_id: str) -> dict:
    result = _new_result()
    project = _read_project(project_id)

    # Step 0: 确保 genshin-ts 已构建
    ok, err = _ensure_genshin_ts_built()
    if not ok:
        result["status"] = "unavailable"
        result["errors"].append(err)
        _update_compile_status(project_id, project, result)
        return result

    # Step 1: 读取 generated.ts
    ts_code = (project.get("nodegraph") or {}).get("generated_ts", "")
    if not ts_code:
        result["errors"].append("项目没有 generated.ts，请先生成节点图")
        _update_compile_status(project_id, project, result)
        return result

    ws = setup_compile_workspace(project_id)
    result["workspace_path"] = str(ws.relative_to(PROJECTS_DIR.parent))
    _write_workspace_files(ws, ts_code)

    # Step 2: npm install
    result["stage"] = "install"
    try:
        r = _run(
            ["npm", "install", "--silent"],
            cwd=str(ws), timeout=300,
        )
    except subprocess.TimeoutExpired:
        result["errors"].append("npm install 超时（5 分钟）")
        result["status"] = "failed"
        _update_compile_status(project_id, project, result)
        return result

    if r.returncode != 0:
        result["errors"].append(f"npm install 失败: {(r.stderr or '')[-500:]}")
        result["stderr"] = (r.stderr or "")[-1000:]
        _update_compile_status(project_id, project, result)
        return result

    # Step 3: tsc typecheck
    result["stage"] = "typecheck"
    try:
        r = _run(
            ["npx", "tsc", "-p", "tsconfig.json", "--noEmit"],
            cwd=str(ws), timeout=120,
        )
    except subprocess.TimeoutExpired:
        result["errors"].append("tsc typecheck 超时（2 分钟）")
        _update_compile_status(project_id, project, result)
        return result

    if r.returncode != 0:
        type_errors = [
            line.strip() for line in (r.stdout or "").split("\n")
            if line.strip() and "error TS" in line
        ]
        result["errors"].extend(type_errors[:20])
        result["stderr"] = (r.stdout or r.stderr or "")[-2000:]

    # Step 4: gsts compile
    result["stage"] = "gsts_compile"
    try:
        r = _run(
            ["npx", "gsts"],
            cwd=str(ws), timeout=120,
        )
    except subprocess.TimeoutExpired:
        result["errors"].append("gsts 编译超时（2 分钟）")
        _update_compile_status(project_id, project, result)
        return result

    result["stdout"] = (r.stdout or "")[-2000:]
    result["stderr"] = result.get("stderr", "") + ((r.stderr or "")[-2000:])

    if r.returncode != 0:
        result["errors"].append(f"gsts 编译失败 (exit {r.returncode})")
        for line in (r.stderr or "").split("\n"):
            stripped = line.strip()
            if stripped and ("error" in stripped.lower() or "Error" in stripped):
                result["errors"].append(stripped)
    else:
        result["success"] = True
        result["status"] = "success"
        _attach_compiled_artifacts(ws, result)

    _update_compile_status(project_id, project, result)
    return result


def _attach_compiled_artifacts(ws: Path, result: dict) -> None:
    """Locate generated IR JSON and GIA artifacts under compile_workspace/dist."""
    dist_dir = ws / "dist"
    if not dist_dir.exists():
        return

    json_files = sorted(dist_dir.rglob("*.json"))
    gia_files = sorted(dist_dir.rglob("*.gia"))
    if json_files:
        result["compiled_json_path"] = str(json_files[0].relative_to(PROJECTS_DIR.parent))
    if gia_files:
        result["compiled_gia_path"] = str(gia_files[0].relative_to(PROJECTS_DIR.parent))


def _update_compile_status(project_id: str, project: dict, result: dict) -> None:
    """将编译结果写回 metadata.json。status 支持 success / failed / unavailable。"""
    ng = project.setdefault("nodegraph", {})
    artifacts = ng.setdefault("artifacts", {})
    artifacts["compile_status"] = result["status"]
    artifacts["compile_stage"] = result["stage"]
    artifacts["compile_workspace_path"] = result.get("workspace_path", "")
    artifacts["compiled_json_path"] = result.get("compiled_json_path", artifacts.get("compiled_json_path", ""))
    artifacts["compiled_gia_path"] = result.get("compiled_gia_path", artifacts.get("compiled_gia_path", ""))
    artifacts["last_compile_at"] = datetime.now(BEIJING_TZ).isoformat(timespec="seconds")
    artifacts["compile_errors_count"] = len(result.get("errors", []))
    _write_project(project_id, project)
