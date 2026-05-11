"""Projects API 路由 — /api/v1/projects/*"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from .models import (
    ProjectCreateRequest,
    AssessmentRequest,
    GenerateNodeGraphRequest,
    SemanticRepairRequest,
    CompileResult,
    ProjectResponse,
    ProjectListItem,
    ApiResponse,
)
from .service import (
    assess_nodegraph_request,
    create_project,
    generate_nodegraph,
    get_project,
    list_projects,
    delete_project,
    get_artifact_ts,
    get_artifact_metadata,
    get_artifact_ir_json,
    get_artifact_gia_path,
    validate_plan,
)

router = APIRouter()


@router.post("/projects/{project_id}/assess-nodegraph", response_model=ApiResponse)
async def api_assess_nodegraph(project_id: str, request: AssessmentRequest):
    """Assess feasibility, difficulty, and risks before generating a node graph."""
    try:
        result = assess_nodegraph_request(
            project_id=project_id,
            natural_language_request=request.natural_language_request,
            project_context=request.project_context,
            config=request.config,
        )
        return ApiResponse(success=True, data=result)
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "ASSESS_ERROR", "message": str(e)})


@router.post("/projects/create", response_model=ApiResponse)
async def api_create_project(request: ProjectCreateRequest):
    """创建新的 UGC 项目"""
    try:
        project = create_project(
            name=request.name,
            description=request.description,
        )
        return ApiResponse(success=True, data=project.model_dump())
    except Exception as e:
        return ApiResponse(success=False, error={"code": "CREATE_ERROR", "message": str(e)})


@router.post("/projects/{project_id}/generate-nodegraph", response_model=ApiResponse)
async def api_generate_nodegraph(project_id: str, request: GenerateNodeGraphRequest):
    """为指定项目生成 AI 节点图方案"""
    try:
        result = generate_nodegraph(
            project_id=project_id,
            natural_language_request=request.natural_language_request,
            project_context=request.project_context,
            config=request.config,
        )
        return ApiResponse(success=True, data=result.model_dump())
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "GENERATE_ERROR", "message": str(e)})


@router.get("/projects/{project_id}", response_model=ApiResponse)
async def api_get_project(project_id: str):
    """获取指定项目的完整信息（含节点图方案）"""
    try:
        project = get_project(project_id)
        return ApiResponse(success=True, data=project.model_dump())
    except FileNotFoundError:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": f"项目 {project_id} 不存在"})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.get("/projects", response_model=ApiResponse)
async def api_list_projects():
    """列出所有项目"""
    try:
        projects = list_projects()
        return ApiResponse(success=True, data={
            "total": len(projects),
            "items": [p.model_dump() for p in projects],
        })
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.delete("/projects/{project_id}", response_model=ApiResponse)
async def api_delete_project(project_id: str):
    """删除指定项目"""
    try:
        ok = delete_project(project_id)
        if ok:
            return ApiResponse(success=True, data={"project_id": project_id, "deleted": True})
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": f"项目 {project_id} 不存在"})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.get("/projects/{project_id}/artifacts/generated-ts")
async def api_get_generated_ts(project_id: str):
    """获取项目的 generated.ts 文件原始文本"""
    try:
        ts_code = get_artifact_ts(project_id)
        return PlainTextResponse(content=ts_code, media_type="text/plain; charset=utf-8")
    except FileNotFoundError:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": f"项目 {project_id} 的 generated.ts 不存在"})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.get("/projects/{project_id}/artifacts/metadata", response_model=ApiResponse)
async def api_get_artifact_metadata(project_id: str):
    """获取项目的 metadata.json 原始数据"""
    try:
        meta = get_artifact_metadata(project_id)
        return ApiResponse(success=True, data=meta)
    except FileNotFoundError:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": f"项目 {project_id} 不存在"})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.get("/projects/{project_id}/artifacts/compiled-json")
async def api_get_compiled_json(project_id: str):
    """获取编译生成的 IR JSON 文本"""
    try:
        ir_json = get_artifact_ir_json(project_id)
        return PlainTextResponse(content=ir_json, media_type="application/json; charset=utf-8")
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.get("/projects/{project_id}/artifacts/compiled-gia")
async def api_download_compiled_gia(project_id: str):
    """下载编译生成的 GIA 文件"""
    try:
        gia_path = get_artifact_gia_path(project_id)
        return FileResponse(
            path=str(gia_path),
            filename=gia_path.name,
            media_type="application/octet-stream",
        )
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "INTERNAL_ERROR", "message": str(e)})


@router.post("/projects/{project_id}/validate-plan", response_model=ApiResponse)
async def api_validate_plan(project_id: str):
    """验证节点图方案，返回 warnings/errors/suggestions"""
    try:
        result = validate_plan(project_id)
        return ApiResponse(success=True, data=result)
    except Exception as e:
        return ApiResponse(success=False, error={"code": "VALIDATE_ERROR", "message": str(e)})


@router.post("/projects/{project_id}/compile", response_model=ApiResponse)
async def api_compile(project_id: str):
    """编译项目的 generated.ts，运行 tsc --noEmit + gsts"""
    try:
        from .compiler import compile_generated_ts
        result = compile_generated_ts(project_id)
        return ApiResponse(success=True, data=result)
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "COMPILE_ERROR", "message": str(e)})


@router.post("/projects/{project_id}/repair-and-compile", response_model=ApiResponse)
async def api_repair_and_compile(project_id: str):
    """根据编译错误做保守修复，然后重试编译。"""
    try:
        from .compiler import compile_generated_ts
        from .repair import repair_generated_ts

        first_compile = compile_generated_ts(project_id)
        if first_compile.get("success"):
            return ApiResponse(success=True, data={
                "project_id": project_id,
                "initial_compile": first_compile,
                "repair": {
                    "changed": False,
                    "applied_fixes": [],
                    "message": "项目已可编译，无需修复",
                },
                "final_compile": first_compile,
            })

        repair = repair_generated_ts(project_id, first_compile.get("errors", []))
        if repair.get("changed"):
            final_compile = compile_generated_ts(project_id)
        else:
            final_compile = first_compile

        return ApiResponse(success=True, data={
            "project_id": project_id,
            "initial_compile": first_compile,
            "repair": repair,
            "final_compile": final_compile,
        })
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "REPAIR_ERROR", "message": str(e)})


@router.post("/projects/{project_id}/semantic-repair-and-compile", response_model=ApiResponse)
async def api_semantic_repair_and_compile(project_id: str, request: SemanticRepairRequest):
    """Use the configured LLM to repair generated.ts, then retry compilation."""
    try:
        from .compiler import compile_generated_ts
        from .semantic_repair import semantic_repair_generated_ts

        first_compile = compile_generated_ts(project_id)
        if first_compile.get("success"):
            return ApiResponse(success=True, data={
                "project_id": project_id,
                "initial_compile": first_compile,
                "semantic_repair": {
                    "changed": False,
                    "available": True,
                    "message": "项目已可编译，无需 AI 语义修复",
                },
                "final_compile": first_compile,
            })

        repair = semantic_repair_generated_ts(
            project_id,
            first_compile.get("errors", []),
            request.config,
        )
        if repair.get("changed"):
            final_compile = compile_generated_ts(project_id)
        else:
            final_compile = first_compile

        return ApiResponse(success=True, data={
            "project_id": project_id,
            "initial_compile": first_compile,
            "semantic_repair": repair,
            "final_compile": final_compile,
        })
    except FileNotFoundError as e:
        return ApiResponse(success=False, error={"code": "NOT_FOUND", "message": str(e)})
    except Exception as e:
        return ApiResponse(success=False, error={"code": "SEMANTIC_REPAIR_ERROR", "message": str(e)})
