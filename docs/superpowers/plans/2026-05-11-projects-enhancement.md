# Projects API Enhancement — Knowledge Evidence + Artifacts + Validate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire skill.service lookups into the NL→NodeGraph pipeline, store artifacts as directory-based files, add validate/artifact API endpoints, and surface evidence + artifacts in the UI.

**Architecture:** `_ground_knowledge()` calls `get_node_info_data()` + `get_document_data()` + `rag_search_data()` from skill.service for real evidence, with deterministic keyword fallback on failure. Storage moves from flat `{id}.json` to `projects_data/{id}/metadata.json` + `projects_data/{id}/generated.ts`. Three new endpoints serve artifacts and plan validation. Frontend adds knowledge_evidence display, artifacts download, and validate-plan UI.

**Tech Stack:** FastAPI + Pydantic v2 + skill.service (ChromaDB RAG + file-based node index) / React 18 + TypeScript 5 + Tailwind CSS 3

---

### Task 1: Extend NodeGraphResult model

**Files:**
- Modify: `backend/projects/models.py:32-40`

- [ ] **Step 1: Add knowledge_evidence and artifacts fields**

```python
class NodeGraphResult(BaseModel):
    intent_spec: dict = Field(default_factory=dict, description="意图识别结果")
    knowledge_queries: list[str] = Field(default_factory=list, description="知识库查询关键词列表")
    knowledge_evidence: list[dict] = Field(default_factory=list, description="skill.service 查询到的实际证据（截取前300字）")
    nodegraph_plan: dict = Field(default_factory=dict, description="节点图方案")
    generated_ts: str = Field(default="", description="生成的 TypeScript/DSL 代码")
    artifacts: dict = Field(default_factory=lambda: {
        "generated_ts_path": "",
        "compile_status": "not_integrated",
    }, description="产物元信息")
    editor_todo: list[str] = Field(default_factory=list, description="编辑器待办步骤")
    implemented_features: list[str] = Field(default_factory=list, description="已覆盖的功能点")
    limitations: list[str] = Field(default_factory=list, description="局限性说明")
    next_steps: list[str] = Field(default_factory=list, description="后续建议")
```

- [ ] **Step 2: Verify Python syntax**

Run: `python -c "import ast; ast.parse(open('backend/projects/models.py', encoding='utf-8').read()); print('OK')"`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add backend/projects/models.py
git commit -m "feat: add knowledge_evidence and artifacts fields to NodeGraphResult"
```

---

### Task 2: Restructure storage to directory-based + integrate skill.service

**Files:**
- Modify: `backend/projects/service.py:1-546` (full rewrite of storage functions + `_ground_knowledge` + `generate_nodegraph` + `delete_project`)
- Modify: `backend/projects/service.py` — add skill.service imports

- [ ] **Step 1: Rewrite storage helpers for directory-based layout**

Replace `_project_path`, `_read_project`, `_write_project`:

```python
PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects_data"

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

def _write_generated_ts(project_id: str, ts_code: str) -> Path:
    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    path = _generated_ts_path(project_id)
    path.write_text(ts_code, encoding="utf-8")
    return path
```

- [ ] **Step 2: Rewrite `_ground_knowledge` to call skill.service**

Replace the current keyword-only implementation:

```python
from skill.service import get_node_info_data, get_document_data, rag_search_data

def _ground_knowledge(intent: dict) -> tuple[list[str], list[dict]]:
    """查询 skill.service 获取知识证据。失败时回退到关键词模式。"""
    # 提取节点名用于查询
    node_names: list[str] = []
    for ev in intent.get("events", []):
        node_names.append(ev["node"])
    for exe in intent.get("executions", []):
        node_names.append(exe["node"])
    for cond in intent.get("conditions", []):
        node_names.append(cond["node"])

    # 提取文档关键词
    doc_keywords: list[str] = []
    for ev in intent.get("events", []):
        doc_keywords.append(ev["keyword"])
    for exe in intent.get("executions", []):
        doc_keywords.append(exe["keyword"])
    for cond in intent.get("conditions", []):
        doc_keywords.append(cond["keyword"])
    for data in intent.get("data_needs", []):
        doc_keywords.append(data)

    # 去重 queries（用于前端展示）
    seen = set()
    queries = []
    for q in node_names + doc_keywords:
        if q not in seen:
            seen.add(q)
            queries.append(q)
    queries = queries[:10]

    evidence: list[dict] = []

    # 调用 skill.service 做实查
    try:
        if node_names:
            node_results = get_node_info_data(node_names[:5])
            for nr in node_results:
                for match in nr.get("matches", [])[:3]:
                    content = match.get("content", "")
                    evidence.append({
                        "query": nr["query"],
                        "source_type": "node_info",
                        "source_doc_title": match.get("source_doc_title", ""),
                        "local_path": match.get("local_path", ""),
                        "title": match.get("title", ""),
                        "content_preview": content[:300] + ("..." if len(content) > 300 else ""),
                    })
    except Exception:
        pass  # 静默 fallback

    try:
        if doc_keywords:
            doc_results = get_document_data(doc_keywords[:3])
            for dr in doc_results:
                for doc in dr.get("documents", [])[:2]:
                    content = doc.get("content", "")
                    evidence.append({
                        "query": dr["query"],
                        "source_type": "document",
                        "title": doc.get("title", ""),
                        "file": doc.get("file", ""),
                        "content_preview": content[:300] + ("..." if len(content) > 300 else ""),
                    })
    except Exception:
        pass

    try:
        if queries:
            rag_results = rag_search_data(queries, top_k=3)
            if isinstance(rag_results, list):
                for rr in rag_results:
                    for item in rr.get("results", [])[:2]:
                        evidence.append({
                            "query": rr["query"],
                            "source_type": "rag",
                            "title": item.get("title", ""),
                            "file_name": item.get("file_name", ""),
                            "similarity": item.get("similarity", 0),
                            "content_preview": item.get("text_snippet", ""),
                        })
    except Exception:
        pass

    return queries, evidence
```

Update `generate_nodegraph` to unpack the tuple:

```python
def generate_nodegraph(...) -> ProjectResponse:
    ...
    # Step 2: 知识锚定
    knowledge_queries, knowledge_evidence = _ground_knowledge(intent)
    ...
    # Step 5: 写入 artifacts
    ts_path = _write_generated_ts(project_id, ts_code)
    artifacts = {
        "generated_ts_path": str(ts_path.relative_to(PROJECTS_DIR.parent)),
        "compile_status": "not_integrated",
    }
    ...
    nodegraph = NodeGraphResult(
        ...
        knowledge_evidence=knowledge_evidence,
        artifacts=artifacts,
        ...
    )
```

- [ ] **Step 3: Update `list_projects` for directory-based storage**

```python
def list_projects() -> list[ProjectListItem]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for d in sorted(PROJECTS_DIR.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        meta_path = d / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            items.append(ProjectListItem(
                project_id=data["project_id"],
                name=data["name"],
                description=data.get("description", ""),
                created_at=data.get("created_at", ""),
                status=data.get("status", "unknown"),
            ))
        except (json.JSONDecodeError, KeyError):
            continue
    return items
```

- [ ] **Step 4: Update `delete_project` for directory removal**

```python
import shutil

def delete_project(project_id: str) -> bool:
    d = _project_dir(project_id)
    if d.exists():
        shutil.rmtree(d)
        return True
    return False
```

- [ ] **Step 5: Add `get_artifact` and `validate_plan` service functions**

```python
def get_artifact_ts(project_id: str) -> str:
    """读取 generated.ts 原始文本。"""
    path = _generated_ts_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"项目 {project_id} 的 generated.ts 不存在")
    return path.read_text(encoding="utf-8")

def get_artifact_metadata(project_id: str) -> dict:
    """读取 metadata.json 原始数据。"""
    return _read_project(project_id)

def validate_plan(project_id: str) -> dict:
    """扫描 generated.ts 中的 TODO/未完成项，生成 warnings 和 suggestions。"""
    try:
        ts_code = get_artifact_ts(project_id)
    except FileNotFoundError:
        return {"project_id": project_id, "compile_status": "not_integrated", "warnings": [], "suggestions": ["请先生成节点图"]}

    warnings: list[dict] = []
    suggestions: list[str] = []

    lines = ts_code.split("\n")
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("// TODO"):
            warnings.append({
                "line": i,
                "message": stripped.lstrip("// ").strip(),
                "severity": "warning",
            })

    todo_count = len(warnings)
    if todo_count == 0:
        suggestions.append("所有 TODO 已处理，可以尝试编译")
    elif todo_count <= 5:
        suggestions.append(f"还有 {todo_count} 个 TODO 待处理，建议逐个完善参数后重新验证")
    else:
        suggestions.append(f"还有 {todo_count} 个 TODO 待处理，建议优先处理事件名和 API 签名相关的 TODO")

    suggestions.append("在「工具调用」页面使用 get_node_info 查询节点参数")
    suggestions.append("将 TS 代码导入千星沙箱编辑器测试实际运行效果")

    return {
        "project_id": project_id,
        "compile_status": "not_integrated",
        "total_warnings": todo_count,
        "warnings": warnings,
        "suggestions": suggestions,
    }
```

- [ ] **Step 6: Verify Python syntax**

Run: `python -c "import ast; ast.parse(open('backend/projects/service.py', encoding='utf-8').read()); print('OK')"`
Expected: OK

- [ ] **Step 7: Commit**

```bash
git add backend/projects/service.py
git commit -m "feat: directory-based storage, skill.service integration, artifact + validate functions"
```

---

### Task 3: Add 3 new API endpoints to router

**Files:**
- Modify: `backend/projects/router.py`

- [ ] **Step 1: Add imports and new endpoints**

Add to imports:
```python
from .service import (
    create_project,
    generate_nodegraph,
    get_project,
    list_projects,
    delete_project,
    get_artifact_ts,
    get_artifact_metadata,
    validate_plan,
)
```

Add three new endpoints before the last one:

```python
@router.get("/projects/{project_id}/artifacts/generated-ts")
async def api_get_generated_ts(project_id: str):
    """获取项目的 generated.ts 文件原始文本"""
    try:
        ts_code = get_artifact_ts(project_id)
        from fastapi.responses import PlainTextResponse
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


@router.post("/projects/{project_id}/validate-plan", response_model=ApiResponse)
async def api_validate_plan(project_id: str):
    """验证节点图方案，返回 warnings/errors/suggestions"""
    try:
        result = validate_plan(project_id)
        return ApiResponse(success=True, data=result)
    except Exception as e:
        return ApiResponse(success=False, error={"code": "VALIDATE_ERROR", "message": str(e)})
```

- [ ] **Step 2: Verify Python syntax**

Run: `python -c "import ast; ast.parse(open('backend/projects/router.py', encoding='utf-8').read()); print('OK')"`
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add backend/projects/router.py
git commit -m "feat: add artifact get and validate-plan API endpoints"
```

---

### Task 4: Update frontend TypeScript types and API client

**Files:**
- Modify: `frontend/src/utils/projectsApi.ts`

- [ ] **Step 1: Extend NodeGraphResult interface and add new types**

```typescript
export interface KnowledgeEvidence {
  query: string
  source_type: 'node_info' | 'document' | 'rag'
  source_doc_title?: string
  local_path?: string
  title?: string
  file?: string
  file_name?: string
  similarity?: number
  content_preview: string
}

export interface Artifacts {
  generated_ts_path: string
  compile_status: 'not_integrated' | 'compiling' | 'success' | 'failed'
}

export interface NodeGraphResult {
  intent_spec: IntentSpec
  knowledge_queries: string[]
  knowledge_evidence: KnowledgeEvidence[]
  nodegraph_plan: NodeGraphPlan
  generated_ts: string
  artifacts: Artifacts
  editor_todo: string[]
  implemented_features: string[]
  limitations: string[]
  next_steps: string[]
}

export interface ValidationWarning {
  line: number
  message: string
  severity: 'warning' | 'error'
}

export interface ValidationResult {
  project_id: string
  compile_status: string
  total_warnings: number
  warnings: ValidationWarning[]
  suggestions: string[]
}
```

- [ ] **Step 2: Add new API functions**

```typescript
export async function getGeneratedTs(projectId: string): Promise<string> {
  const response = await fetch(`/api/v1/projects/${projectId}/artifacts/generated-ts`)
  if (!response.ok) throw new Error('Failed to fetch generated TS')
  return response.text()
}

export async function getArtifactMetadata(projectId: string): Promise<ApiResponse<ProjectData>> {
  return apiGet<ProjectData>(`/api/v1/projects/${projectId}/artifacts/metadata`)
}

export async function validatePlan(projectId: string): Promise<ApiResponse<ValidationResult>> {
  const response = await fetch(`/api/v1/projects/${projectId}/validate-plan`, { method: 'POST' })
  return response.json()
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/projectsApi.ts
git commit -m "feat: add KnowledgeEvidence, ValidationResult types and artifact/validate API functions"
```

---

### Task 5: Update ProjectWorkspace UI

**Files:**
- Modify: `frontend/src/components/ProjectWorkspace.tsx`

- [ ] **Step 1: Add imports for new types and API functions**

Update import block to include:
```typescript
import type {
  ProjectData,
  ProjectListItem,
  NodeGraphResult,
  NodeGraphPlan,
  IntentSpec,
  KnowledgeEvidence,
  Artifacts,
  ValidationResult,
} from '../utils/projectsApi'
import {
  createProject,
  generateNodeGraph,
  getProject,
  listProjects,
  deleteProject,
  getGeneratedTs,
  validatePlan,
} from '../utils/projectsApi'
```

- [ ] **Step 2: Add state variables in ProjectWorkspace**

Add after existing state declarations:
```typescript
const [validating, setValidating] = useState(false)
const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
const [showFullTs, setShowFullTs] = useState(false)
```

- [ ] **Step 3: Add validate handler**

```typescript
const handleValidate = async () => {
  if (!selectedProject) return
  setValidating(true)
  setValidationResult(null)
  try {
    const res = await validatePlan(selectedProject.project_id)
    if (res.success && res.data) {
      setValidationResult(res.data)
    } else {
      setError(res.error?.message || '验证失败')
    }
  } catch (e) {
    setError('验证请求失败')
  } finally {
    setValidating(false)
  }
}
```

- [ ] **Step 4: Add download/copy handler**

```typescript
const handleCopyTs = async () => {
  if (!selectedProject) return
  try {
    const ts = await getGeneratedTs(selectedProject.project_id)
    await navigator.clipboard.writeText(ts)
  } catch {
    // fallback: use the generated_ts from result
    if (generatedResult?.generated_ts) {
      await navigator.clipboard.writeText(generatedResult.generated_ts)
    }
  }
}
```

- [ ] **Step 5: Insert KnowledgeEvidenceCard component**

```typescript
function KnowledgeEvidenceCard({ evidence }: { evidence: KnowledgeEvidence[] }) {
  if (evidence.length === 0) return null

  const typeBadge: Record<string, { label: string; color: string }> = {
    node_info: { label: '节点查询', color: 'bg-blue-50 text-blue-700' },
    document: { label: '文档匹配', color: 'bg-green-50 text-green-700' },
    rag: { label: '语义检索', color: 'bg-purple-50 text-purple-700' },
  }

  return (
    <div className="space-y-3">
      {evidence.map((item, i) => {
        const badge = typeBadge[item.source_type] || { label: item.source_type, color: 'bg-slate-50 text-slate-600' }
        return (
          <div key={i} className="bg-white/50 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
                {badge.label}
              </span>
              <span className="text-xs text-slate-500 font-mono">{item.query}</span>
              {item.similarity !== undefined && (
                <span className="text-xs text-slate-400">{(item.similarity * 100).toFixed(1)}%</span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {item.title || item.source_doc_title || item.file_name || ''}
            </p>
            {item.content_preview && (
              <pre className="text-xs text-slate-500 mt-2 whitespace-pre-wrap line-clamp-4">
                {item.content_preview}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Insert ArtifactsCard component**

```typescript
function ArtifactsCard({ artifacts, projectId, onValidate, validating, validationResult }: {
  artifacts: Artifacts
  projectId: string
  onValidate: () => void
  validating: boolean
  validationResult: ValidationResult | null
}) {
  return (
    <div className="space-y-4">
      {/* File paths + status */}
      <div className="grid grid-cols-1 gap-3">
        <div className="flex items-center justify-between bg-white/50 rounded-xl border border-slate-200 p-3">
          <div>
            <span className="text-xs font-medium text-slate-500">generated.ts</span>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{artifacts.generated_ts_path}</p>
          </div>
          <button
            onClick={async () => {
              try {
                const ts = await getGeneratedTs(projectId)
                await navigator.clipboard.writeText(ts)
              } catch {}
            }}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium"
          >
            📋 复制
          </button>
        </div>

        <div className="flex items-center gap-2 bg-white/50 rounded-xl border border-slate-200 p-3">
          <span className="text-xs font-medium text-slate-500">编译状态:</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            artifacts.compile_status === 'not_integrated'
              ? 'bg-yellow-100 text-yellow-700'
              : artifacts.compile_status === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {artifacts.compile_status === 'not_integrated' ? '未接入编译器' : artifacts.compile_status}
          </span>
        </div>
      </div>

      {/* Validate button + result */}
      <div>
        <button
          onClick={onValidate}
          disabled={validating}
          className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50 text-sm font-medium"
        >
          {validating ? '验证中...' : '🔍 验证方案'}
        </button>
      </div>

      {validationResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">
              共 {validationResult.total_warnings} 个待处理项
            </span>
          </div>

          {validationResult.warnings.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {validationResult.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs">
                  <span className="text-amber-500 font-mono shrink-0">L{w.line}</span>
                  <span className="text-amber-800">{w.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            {validationResult.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                <span className="text-sky-500">→</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Add new sections in GenerateResultView**

After the Knowledge Queries section card, add:

```tsx
{/* Knowledge Evidence */}
{result.knowledge_evidence.length > 0 && (
  <SectionCard title="知识证据" badge={`${result.knowledge_evidence.length} 条`} color="blue">
    <KnowledgeEvidenceCard evidence={result.knowledge_evidence} />
  </SectionCard>
)}
```

After the Generated TS section card, add:

```tsx
{/* Artifacts + Validation */}
<SectionCard title="产物与验证" badge={result.artifacts.compile_status} color="orange">
  <ArtifactsCard
    artifacts={result.artifacts}
    projectId={selectedProject!.project_id}
    onValidate={handleValidate}
    validating={validating}
    validationResult={validationResult}
  />
</SectionCard>
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ProjectWorkspace.tsx
git commit -m "feat: knowledge evidence, artifacts, and validate-plan UI in ProjectWorkspace"
```

---

### Task 6: Build verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run frontend build**

Run: `cd frontend ; npm run build 2>&1`
Expected: tsc + vite build pass, 0 errors

- [ ] **Step 2: Verify all Python files with ast.parse**

Run:
```
python -c "import ast; ast.parse(open('backend/projects/models.py', encoding='utf-8').read()); print('models.py OK')"
python -c "import ast; ast.parse(open('backend/projects/service.py', encoding='utf-8').read()); print('service.py OK')"
python -c "import ast; ast.parse(open('backend/projects/router.py', encoding='utf-8').read()); print('router.py OK')"
python -c "import ast; ast.parse(open('backend/projects/__init__.py', encoding='utf-8').read()); print('__init__.py OK')"
```
Expected: All OK

- [ ] **Step 3: Commit if any fixes were needed**

---

### Task 7: Update documentation

**Files:**
- Modify: `docs/progress.md`
- Modify: `docs/ai-product-memory.md`

- [ ] **Step 1: Update docs/progress.md — add completed items**

Replace the projects section:
```markdown
- [x] UGC 项目创建与 AI 节点图生成（Projects API） ✅ 2026-05-11
  - [x] 项目 CRUD（目录化存储: projects_data/{id}/metadata.json + generated.ts）
  - [x] NL → NodeGraph 生成流水线（意图识别 + skill.service 知识锚定 + 节点图方案 + TS 代码生成）
  - [x] TS 代码生成重写为 genshin-ts runtime DSL（`g.server({...}).on(...)` 模式）
  - [x] knowledge_evidence 字段（node_info / document / rag 三类来源）
  - [x] artifacts 字段 + artifact API（GET generated-ts / GET metadata）
  - [x] validate-plan API（TODO 扫描 + warnings + suggestions）
  - [x] 前端 ProjectWorkspace 组件（知识证据卡片 + 产物区 + 验证结果 UI）
  - [ ] genshin-ts 真实编译集成
  - [ ] GIA 导出功能
```

- [ ] **Step 2: Update docs/ai-product-memory.md — complete TS compile section and add artifacts**

Replace the pipeline diagram and step 2/4:
```markdown
## AI 流水线

```
NL 需求 → Intent Spec → Knowledge Grounding → NodeGraph Plan → genshin-ts TS/DSL → validate-plan → user next steps
```

### 2. Knowledge Grounding（知识锚定）
通过 Skill API 查询相关知识，结果存入 `knowledge_evidence` 字段：
- `get_node_info` — 查找节点名、参数、所属文档（source_type: node_info）
- `get_document` — 获取完整文档内容（source_type: document）
- `rag_search` — 语义检索相关教程和 FAQ（source_type: rag）
- 所有查询失败时静默 fallback，不阻塞流水线

### 4. Artifacts 产物
- `backend/projects_data/{project_id}/metadata.json` — 项目主数据 + nodegraph 全部字段
- `backend/projects_data/{project_id}/generated.ts` — 独立 TS 文件，可通过 artifact API 获取
- `artifacts.compile_status` — 编译状态（not_integrated → compiling → success / failed）
- `POST /api/v1/projects/{id}/validate-plan` — 扫描 TODO，返回 warnings + suggestions
```

- [ ] **Step 3: Commit**

```bash
git add docs/progress.md docs/ai-product-memory.md
git commit -m "docs: update progress and ai-product-memory for projects enhancement"
```

---

### Task 8: Final verification and cleanup

**Files:**
- None (verification only)

- [ ] **Step 1: Full frontend build**

Run: `cd frontend ; npm run build 2>&1`
Expected: PASS, 0 errors

- [ ] **Step 2: Full Python ast verification**

Run ast.parse on all 4 projects files + main.py
Expected: All OK

- [ ] **Step 3: FastAPI route check**

Verify all 8 endpoints are registered:
1. POST /api/v1/projects/create
2. POST /api/v1/projects/{id}/generate-nodegraph
3. GET /api/v1/projects/{id}
4. GET /api/v1/projects
5. DELETE /api/v1/projects/{id}
6. GET /api/v1/projects/{id}/artifacts/generated-ts
7. GET /api/v1/projects/{id}/artifacts/metadata
8. POST /api/v1/projects/{id}/validate-plan
