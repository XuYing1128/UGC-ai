"""Projects API 数据模型"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel, Field

BEIJING_TZ = timezone(timedelta(hours=8))


def _now_iso() -> str:
    return datetime.now(BEIJING_TZ).isoformat(timespec="seconds")


# ── 请求模型 ────────────────────────────────────────────

class ProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="项目名称")
    description: str = Field(default="", max_length=2000, description="项目描述")


class GenerateNodeGraphRequest(BaseModel):
    natural_language_request: str = Field(..., min_length=1, max_length=5000,
                                          description="自然语言需求描述")
    project_context: Optional[str] = Field(default=None, max_length=3000,
                                           description="项目上下文补充")
    config: Optional[dict] = Field(default=None, description="生成配置（模型、节点偏好等）")


# ── 响应模型 ────────────────────────────────────────────

class AssessmentRequest(BaseModel):
    natural_language_request: str = Field(..., min_length=1, max_length=5000,
                                          description="Natural-language UGC requirement")
    project_context: Optional[str] = Field(default=None, max_length=3000,
                                           description="Optional project context")
    config: Optional[dict] = Field(default=None, description="LLM config for feasibility assessment")


class SemanticRepairRequest(BaseModel):
    config: Optional[dict] = Field(default=None, description="LLM config for AI semantic repair")


class NodeGraphResult(BaseModel):
    intent_spec: dict = Field(default_factory=dict, description="意图识别结果")
    knowledge_queries: list[str] = Field(default_factory=list, description="知识库查询关键词列表")
    knowledge_evidence: list[dict] = Field(default_factory=list, description="skill.service 查询到的实际证据")
    nodegraph_plan: dict = Field(default_factory=dict, description="节点图方案")
    generated_ts: str = Field(default="", description="生成的 TypeScript/DSL 代码")
    artifacts: dict = Field(default_factory=lambda: {
        "generated_ts_path": "",
        "compiled_json_path": "",
        "compiled_gia_path": "",
        "compile_status": "not_integrated",
        "compile_stage": "",
        "compile_workspace_path": "",
        "last_compile_at": "",
        "compile_errors_count": 0,
    }, description="产物元信息")
    editor_todo: list[str] = Field(default_factory=list, description="编辑器待办步骤")
    implemented_features: list[str] = Field(default_factory=list, description="已覆盖的功能点")
    limitations: list[str] = Field(default_factory=list, description="局限性说明")
    next_steps: list[str] = Field(default_factory=list, description="后续建议")


class ProjectResponse(BaseModel):
    project_id: str
    name: str
    description: str
    created_at: str
    status: str
    memory_summary: str = ""
    last_assessment: Optional[dict] = None
    nodegraph: Optional[NodeGraphResult] = None


class ProjectListItem(BaseModel):
    project_id: str
    name: str
    description: str
    created_at: str
    status: str


class CompileResult(BaseModel):
    success: bool
    status: str = "failed"
    stage: str = "setup"
    stdout: str = ""
    stderr: str = ""
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    workspace_path: str = ""


class ApiResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[dict] = None
