import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  Artifacts,
  CompileResult,
  IntentSpec,
  KnowledgeEvidence,
  NodeGraphAssessment,
  NodeGraphPlan,
  NodeGraphResult,
  ProjectData,
  ProjectListItem,
  RepairAndCompileResult,
  SemanticRepairAndCompileResult,
  ValidationResult,
} from '../utils/projectsApi'
import {
  assessNodeGraph,
  compileProject,
  createProject,
  deleteProject,
  generateNodeGraph,
  getCompiledGiaUrl,
  getCompiledJson,
  getGeneratedTs,
  getProject,
  listProjects,
  repairAndCompileProject,
  semanticRepairAndCompileProject,
  validatePlan,
} from '../utils/projectsApi'
import { getConfig } from '../utils/config'

type ViewMode = 'list' | 'create' | 'detail'

const EXAMPLE_REQUESTS = [
  '玩家击败怪物后掉落奖励，并显示一条提示',
  '玩家进入区域后播放特效，3 秒后传送到指定位置',
  '实体创建时打印调试信息，方便确认触发流程',
  '玩家交互机关后，如果变量达到 3 就打开宝箱',
]

const difficultyLabel: Record<NodeGraphAssessment['difficulty'], string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  expert: '专家级',
}

const feasibilityLabel: Record<NodeGraphAssessment['feasibility'], string> = {
  ready: '可以生成',
  partial: '可生成骨架',
  needs_docs: '需核对文档',
  not_supported: '暂不建议生成',
}

export default function ProjectWorkspace() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [nlRequest, setNlRequest] = useState('')
  const [nlContext, setNlContext] = useState('')
  const [assessing, setAssessing] = useState(false)
  const [assessmentResult, setAssessmentResult] = useState<NodeGraphAssessment | null>(null)
  const [assessmentAccepted, setAssessmentAccepted] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedResult, setGeneratedResult] = useState<NodeGraphResult | null>(null)

  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [compiling, setCompiling] = useState(false)
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairAndCompileResult | null>(null)
  const [semanticRepairing, setSemanticRepairing] = useState(false)
  const [semanticRepairResult, setSemanticRepairResult] = useState<SemanticRepairAndCompileResult | null>(null)
  const [compiledJsonPreview, setCompiledJsonPreview] = useState('')

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listProjects()
      if (res.success && res.data) {
        setProjects(res.data.items)
      } else {
        setError(res.error?.message || '项目列表加载失败')
      }
    } catch {
      setError('项目列表加载失败，请确认后端服务正在运行')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (viewMode === 'list') {
      loadProjects()
    }
  }, [viewMode, loadProjects])

  const resetAssessment = () => {
    setAssessmentResult(null)
    setAssessmentAccepted(false)
  }

  const resetRunResults = () => {
    setValidationResult(null)
    setCompileResult(null)
    setRepairResult(null)
    setSemanticRepairResult(null)
    setCompiledJsonPreview('')
  }

  const openProject = async (projectId: string) => {
    setLoading(true)
    setError('')
    resetRunResults()
    try {
      const res = await getProject(projectId)
      if (!res.success || !res.data) {
        setError(res.error?.message || '项目详情加载失败')
        return
      }
      setSelectedProject(res.data)
      setGeneratedResult(res.data.nodegraph)
      setAssessmentResult(res.data.last_assessment || null)
      setAssessmentAccepted(false)
      if (res.data.nodegraph?.intent_spec?.raw_request) {
        setNlRequest(res.data.nodegraph.intent_spec.raw_request)
      }
      setViewMode('detail')
    } catch {
      setError('项目详情加载失败，请确认后端服务正在运行')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!createName.trim()) {
      setError('请输入项目名称')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await createProject(createName.trim(), createDescription.trim())
      if (!res.success || !res.data) {
        setError(res.error?.message || '创建项目失败')
        return
      }
      setCreateName('')
      setCreateDescription('')
      setSelectedProject(res.data)
      setGeneratedResult(null)
      setAssessmentResult(null)
      setAssessmentAccepted(false)
      setNlRequest(res.data.description || '')
      setNlContext('')
      setViewMode('detail')
    } catch {
      setError('创建项目失败，请确认后端服务正在运行')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (projectId: string) => {
    if (!confirm('确定删除这个项目吗？本地生成文件也会一起删除。')) return
    try {
      const res = await deleteProject(projectId)
      if (!res.success) {
        setError(res.error?.message || '删除项目失败')
        return
      }
      if (selectedProject?.project_id === projectId) {
        setSelectedProject(null)
        setGeneratedResult(null)
        setViewMode('list')
      }
      loadProjects()
    } catch {
      setError('删除项目失败，请确认后端服务正在运行')
    }
  }

  const handleAssess = async () => {
    if (!selectedProject) return
    if (!nlRequest.trim()) {
      setError('请先描述你想做的玩法')
      return
    }
    setAssessing(true)
    setError('')
    setAssessmentResult(null)
    setAssessmentAccepted(false)
    resetRunResults()
    try {
      const res = await assessNodeGraph(
        selectedProject.project_id,
        nlRequest.trim(),
        nlContext.trim() || undefined,
        getConfig() as unknown as Record<string, unknown>,
      )
      if (!res.success || !res.data) {
        setError(res.error?.message || 'AI 评估失败，请检查模型配置或稍后重试')
        return
      }
      setAssessmentResult(res.data)
      const refreshed = await getProject(selectedProject.project_id)
      if (refreshed.success && refreshed.data) {
        setSelectedProject(refreshed.data)
      }
    } catch {
      setError('AI 评估请求失败，请确认后端服务正在运行')
    } finally {
      setAssessing(false)
    }
  }

  const handleGenerate = async () => {
    if (!selectedProject) return
    if (!nlRequest.trim()) {
      setError('请输入自然语言需求')
      return
    }
    if (!assessmentResult) {
      setError('请先完成 AI 可行性评估')
      return
    }
    if (!assessmentAccepted) {
      setError('请先确认你已理解评估结果')
      return
    }
    if (!assessmentResult.can_generate) {
      setError('当前评估结果不建议自动生成，请先调整需求')
      return
    }

    setGenerating(true)
    setError('')
    setGeneratedResult(null)
    resetRunResults()
    try {
      const res = await generateNodeGraph(
        selectedProject.project_id,
        nlRequest.trim(),
        nlContext.trim() || undefined,
        getConfig() as unknown as Record<string, unknown>,
      )
      if (!res.success || !res.data) {
        setError(res.error?.message || '节点图生成失败')
        return
      }
      setSelectedProject(res.data)
      setGeneratedResult(res.data.nodegraph)
    } catch {
      setError('节点图生成失败，请确认后端服务正在运行')
    } finally {
      setGenerating(false)
    }
  }

  const refreshSelectedProject = async () => {
    if (!selectedProject) return
    const refreshed = await getProject(selectedProject.project_id)
    if (refreshed.success && refreshed.data) {
      setSelectedProject(refreshed.data)
      setGeneratedResult(refreshed.data.nodegraph)
      setAssessmentResult(refreshed.data.last_assessment || assessmentResult)
    }
  }

  const handleValidate = async () => {
    if (!selectedProject) return
    setValidating(true)
    setValidationResult(null)
    try {
      const res = await validatePlan(selectedProject.project_id)
      if (res.success && res.data) {
        setValidationResult(res.data)
      } else {
        setError(res.error?.message || '方案检查失败')
      }
    } catch {
      setError('方案检查失败，请确认后端服务正在运行')
    } finally {
      setValidating(false)
    }
  }

  const handleCompile = async () => {
    if (!selectedProject) return
    setCompiling(true)
    setCompileResult(null)
    try {
      const res = await compileProject(selectedProject.project_id)
      if (res.success && res.data) {
        setCompileResult(res.data)
        await refreshSelectedProject()
      } else {
        setError(res.error?.message || '编译失败')
      }
    } catch {
      setError('编译请求失败，请确认本机 Node/npm 环境可用')
    } finally {
      setCompiling(false)
    }
  }

  const handleRepairAndCompile = async () => {
    if (!selectedProject) return
    setRepairing(true)
    setRepairResult(null)
    try {
      const res = await repairAndCompileProject(selectedProject.project_id)
      if (res.success && res.data) {
        setRepairResult(res.data)
        setCompileResult(res.data.final_compile)
        await refreshSelectedProject()
      } else {
        setError(res.error?.message || '规则修复失败')
      }
    } catch {
      setError('规则修复请求失败，请确认后端服务正在运行')
    } finally {
      setRepairing(false)
    }
  }

  const handleSemanticRepairAndCompile = async () => {
    if (!selectedProject) return
    setSemanticRepairing(true)
    setSemanticRepairResult(null)
    try {
      const res = await semanticRepairAndCompileProject(
        selectedProject.project_id,
        getConfig() as unknown as Record<string, unknown>,
      )
      if (res.success && res.data) {
        setSemanticRepairResult(res.data)
        setCompileResult(res.data.final_compile)
        await refreshSelectedProject()
      } else {
        setError(res.error?.message || 'AI 修复失败')
      }
    } catch {
      setError('AI 修复请求失败，请确认模型配置和后端服务')
    } finally {
      setSemanticRepairing(false)
    }
  }

  const handlePreviewCompiledJson = async () => {
    if (!selectedProject) return
    try {
      const text = await getCompiledJson(selectedProject.project_id)
      setCompiledJsonPreview(text.slice(0, 6000))
    } catch {
      setError('读取编译 JSON 失败，请先确认编译成功')
    }
  }

  const handleCopyTs = async () => {
    if (!selectedProject) return
    try {
      const ts = await getGeneratedTs(selectedProject.project_id)
      await navigator.clipboard.writeText(ts)
    } catch {
      if (generatedResult?.generated_ts) {
        await navigator.clipboard.writeText(generatedResult.generated_ts)
      }
    }
  }

  const fillExample = (text: string) => {
    setNlRequest(text)
    resetAssessment()
    resetRunResults()
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <Header
          viewMode={viewMode}
          onBack={() => {
            setViewMode('list')
            setSelectedProject(null)
            setGeneratedResult(null)
            resetRunResults()
          }}
          onCreate={() => setViewMode('create')}
        />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {viewMode === 'list' && (
          <ProjectList
            projects={projects}
            loading={loading}
            onOpen={openProject}
            onDelete={handleDelete}
            onCreate={() => setViewMode('create')}
          />
        )}

        {viewMode === 'create' && (
          <CreateProjectForm
            name={createName}
            description={createDescription}
            creating={creating}
            onNameChange={setCreateName}
            onDescriptionChange={setCreateDescription}
            onSubmit={handleCreate}
          />
        )}

        {viewMode === 'detail' && selectedProject && (
          <div className="space-y-5">
            <ProjectSummary project={selectedProject} />

            <WorkflowPanel
              request={nlRequest}
              context={nlContext}
              assessing={assessing}
              generating={generating}
              assessment={assessmentResult}
              accepted={assessmentAccepted}
              onRequestChange={(value) => {
                setNlRequest(value)
                resetAssessment()
                resetRunResults()
              }}
              onContextChange={(value) => {
                setNlContext(value)
                resetAssessment()
                resetRunResults()
              }}
              onAssess={handleAssess}
              onAccept={() => setAssessmentAccepted(true)}
              onGenerate={handleGenerate}
              onUseExample={fillExample}
            />

            {generatedResult && (
              <GenerateResultView
                result={generatedResult}
                projectId={selectedProject.project_id}
                validating={validating}
                validationResult={validationResult}
                compiling={compiling}
                compileResult={compileResult}
                repairing={repairing}
                repairResult={repairResult}
                semanticRepairing={semanticRepairing}
                semanticRepairResult={semanticRepairResult}
                compiledJsonPreview={compiledJsonPreview}
                onValidate={handleValidate}
                onCopyTs={handleCopyTs}
                onCompile={handleCompile}
                onRepairAndCompile={handleRepairAndCompile}
                onSemanticRepairAndCompile={handleSemanticRepairAndCompile}
                onPreviewCompiledJson={handlePreviewCompiledJson}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Header({
  viewMode,
  onBack,
  onCreate,
}: {
  viewMode: ViewMode
  onBack: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">UGC 项目工作台</h2>
        <p className="mt-1 text-sm text-slate-500">
          先评估可行性，再生成节点图骨架，最后编译验证。
        </p>
      </div>
      <div className="flex gap-2">
        {viewMode !== 'list' && (
          <button onClick={onBack} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
            返回项目列表
          </button>
        )}
        {viewMode === 'list' && (
          <button onClick={onCreate} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
            新建项目
          </button>
        )}
      </div>
    </div>
  )
}

function ProjectList({
  projects,
  loading,
  onOpen,
  onDelete,
  onCreate,
}: {
  projects: ProjectListItem[]
  loading: boolean
  onOpen: (projectId: string) => void
  onDelete: (projectId: string) => void
  onCreate: () => void
}) {
  if (loading) {
    return <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">正在加载项目...</div>
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <h3 className="text-lg font-semibold text-slate-900">还没有项目</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
          新建一个项目后，用一句话描述玩法。系统会先告诉你能不能做、难度有多高、哪些地方需要官方文档确认。
        </p>
        <button onClick={onCreate} className="mt-5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
          创建第一个项目
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <button
          key={project.project_id}
          onClick={() => onOpen(project.project_id)}
          className="group rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-emerald-200 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-slate-900">{project.name}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{project.description || '暂无描述'}</p>
            </div>
            <StatusPill status={project.status === 'nodegraph_generated' ? 'success' : 'pending'}>
              {project.status === 'nodegraph_generated' ? '已生成' : '待生成'}
            </StatusPill>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <span>{project.created_at?.slice(0, 10) || '未知时间'}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(project.project_id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation()
                  onDelete(project.project_id)
                }
              }}
              className="rounded px-2 py-1 text-red-500 opacity-0 transition hover:bg-red-50 group-hover:opacity-100"
            >
              删除
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function CreateProjectForm({
  name,
  description,
  creating,
  onNameChange,
  onDescriptionChange,
  onSubmit,
}: {
  name: string
  description: string
  creating: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">创建 UGC 项目</h3>
      <p className="mt-1 text-sm text-slate-500">项目名只用于管理，真正的玩法需求可以进入项目后再写。</p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">项目名称</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onSubmit()}
            placeholder="例如：怪物掉落奖励"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">项目描述</span>
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="例如：玩家击败怪物后获得奖励，并显示提示。"
            rows={4}
            className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <button
          onClick={onSubmit}
          disabled={creating || !name.trim()}
          className="w-full rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? '正在创建...' : '创建并进入项目'}
        </button>
      </div>
    </div>
  )
}

function ProjectSummary({ project }: { project: ProjectData }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-slate-900">{project.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{project.description || '暂无描述'}</p>
        </div>
        <StatusPill status={project.status === 'nodegraph_generated' ? 'success' : 'pending'}>
          {project.status === 'nodegraph_generated' ? '已生成节点图' : '等待生成'}
        </StatusPill>
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
        <div>ID：{project.project_id}</div>
        <div>创建时间：{project.created_at}</div>
      </div>
      {project.memory_summary && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {project.memory_summary}
        </div>
      )}
    </div>
  )
}

function WorkflowPanel({
  request,
  context,
  assessing,
  generating,
  assessment,
  accepted,
  onRequestChange,
  onContextChange,
  onAssess,
  onAccept,
  onGenerate,
  onUseExample,
}: {
  request: string
  context: string
  assessing: boolean
  generating: boolean
  assessment: NodeGraphAssessment | null
  accepted: boolean
  onRequestChange: (value: string) => void
  onContextChange: (value: string) => void
  onAssess: () => void
  onAccept: () => void
  onGenerate: () => void
  onUseExample: (value: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">自然语言生成节点图</h3>
          <p className="mt-1 text-sm text-slate-500">
            先让 AI 判断可行性和风险，确认后再生成节点图，避免盲目生成。
          </p>
        </div>
        <WorkflowSteps assessment={assessment} accepted={accepted} generated={false} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">你想做什么玩法？</span>
            <textarea
              value={request}
              onChange={(event) => onRequestChange(event.target.value)}
              placeholder="例如：玩家击败怪物后掉落奖励，并显示一条提示。"
              rows={5}
              disabled={assessing || generating}
              className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">补充信息</span>
            <textarea
              value={context}
              onChange={(event) => onContextChange(event.target.value)}
              placeholder="可写资源 ID、怪物类型、触发对象、奖励规则、失败条件等。"
              rows={3}
              disabled={assessing || generating}
              className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50"
            />
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800">不会写可以点示例</div>
          <div className="mt-3 space-y-2">
            {EXAMPLE_REQUESTS.map((item) => (
              <button
                key={item}
                onClick={() => onUseExample(item)}
                disabled={assessing || generating}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <button
          onClick={onAssess}
          disabled={assessing || generating || !request.trim()}
          className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {assessing ? '正在评估...' : '1. AI 评估能否完成'}
        </button>
        <button
          onClick={onAccept}
          disabled={!assessment || !assessment.can_generate || assessing || generating}
          className="rounded-lg bg-slate-700 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {accepted ? '2. 已确认评估' : '2. 确认评估结果'}
        </button>
        <button
          onClick={onGenerate}
          disabled={!assessment || !accepted || !assessment.can_generate || assessing || generating}
          className="rounded-lg bg-violet-600 px-5 py-3 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? '正在生成...' : '3. 生成节点图'}
        </button>
      </div>

      {assessment && <AssessmentPanel assessment={assessment} accepted={accepted} />}
    </div>
  )
}

function WorkflowSteps({
  assessment,
  accepted,
  generated,
}: {
  assessment: NodeGraphAssessment | null
  accepted: boolean
  generated: boolean
}) {
  const steps = [
    { label: '评估', done: Boolean(assessment) },
    { label: '确认', done: accepted },
    { label: '生成', done: generated },
  ]
  return (
    <div className="flex gap-2">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {index + 1}. {step.label}
        </div>
      ))}
    </div>
  )
}

function AssessmentPanel({ assessment, accepted }: { assessment: NodeGraphAssessment; accepted: boolean }) {
  return (
    <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={assessment.feasibility === 'not_supported' ? 'danger' : assessment.feasibility === 'ready' ? 'success' : 'warning'}>
          {feasibilityLabel[assessment.feasibility]}
        </StatusPill>
        <StatusPill status="neutral">难度：{difficultyLabel[assessment.difficulty]}</StatusPill>
        <StatusPill status="neutral">置信度：{Math.round((assessment.confidence || 0) * 100)}%</StatusPill>
        {accepted && <StatusPill status="success">用户已确认</StatusPill>}
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-slate-900">评估结论</div>
        <p className="mt-1 text-sm text-slate-700">{assessment.summary}</p>
        <p className="mt-1 text-xs text-slate-500">建议生成方式：{assessment.recommended_generation_mode}</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <InfoList title="可以自动处理" items={assessment.supported_features} tone="success" />
        <InfoList title="需要你确认" items={assessment.uncertain_features} tone="warning" />
        <InfoList title="生成前建议回答" items={assessment.next_questions} tone="neutral" />
      </div>

      {assessment.blocked_features.length > 0 && (
        <div className="mt-3">
          <InfoList title="暂时阻塞" items={assessment.blocked_features} tone="danger" />
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="预估节点" value={`${assessment.estimated_nodes}`} />
        <Metric label="预估连接" value={`${assessment.estimated_connections}`} />
        <Metric label="文档状态" value={assessment.knowledge_status === 'official_docs_available' ? '已连接' : '需核对'} />
      </div>

      {assessment.required_official_docs.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-600">需要核对的官方节点/文档</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {assessment.required_official_docs.slice(0, 10).map((item) => (
              <span key={item} className="rounded bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {assessment.llm_meta?.message && (
        <p className="mt-3 text-xs text-slate-500">
          AI 状态：{assessment.llm_meta.message}
        </p>
      )}
    </div>
  )
}

function GenerateResultView({
  result,
  projectId,
  validating,
  validationResult,
  compiling,
  compileResult,
  repairing,
  repairResult,
  semanticRepairing,
  semanticRepairResult,
  compiledJsonPreview,
  onValidate,
  onCopyTs,
  onCompile,
  onRepairAndCompile,
  onSemanticRepairAndCompile,
  onPreviewCompiledJson,
}: {
  result: NodeGraphResult
  projectId: string
  validating: boolean
  validationResult: ValidationResult | null
  compiling: boolean
  compileResult: CompileResult | null
  repairing: boolean
  repairResult: RepairAndCompileResult | null
  semanticRepairing: boolean
  semanticRepairResult: SemanticRepairAndCompileResult | null
  compiledJsonPreview: string
  onValidate: () => void
  onCopyTs: () => void
  onCompile: () => void
  onRepairAndCompile: () => void
  onSemanticRepairAndCompile: () => void
  onPreviewCompiledJson: () => void
}) {
  return (
    <div className="space-y-5">
      <Section title="生成结果" badge={`${result.nodegraph_plan.total_nodes} 个节点`}>
        <div className="grid gap-4 lg:grid-cols-3">
          <IntentSummary intent={result.intent_spec} />
          <NodeGraphPlanView plan={result.nodegraph_plan} />
          <InfoList title="下一步" items={result.next_steps} tone="neutral" />
        </div>
      </Section>

      <Section title="官方文档证据" badge={`${result.knowledge_evidence.length} 条`}>
        <KnowledgeEvidenceList evidence={result.knowledge_evidence} />
      </Section>

      <Section title="功能覆盖与限制">
        <div className="grid gap-4 md:grid-cols-2">
          <InfoList title="已覆盖" items={result.implemented_features} tone="success" />
          <InfoList title="仍需确认" items={result.limitations} tone="warning" />
        </div>
      </Section>

      <Section title="生成的 TypeScript" badge="generated.ts">
        <div className="mb-3 flex justify-end">
          <button onClick={onCopyTs} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
            复制代码
          </button>
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
          {result.generated_ts}
        </pre>
      </Section>

      <Section title="检查、编译与导出" badge={compileStatusText(result.artifacts.compile_status)}>
        <ArtifactsCard
          artifacts={result.artifacts}
          projectId={projectId}
          validating={validating}
          validationResult={validationResult}
          compiling={compiling}
          compileResult={compileResult}
          repairing={repairing}
          repairResult={repairResult}
          semanticRepairing={semanticRepairing}
          semanticRepairResult={semanticRepairResult}
          compiledJsonPreview={compiledJsonPreview}
          onValidate={onValidate}
          onCompile={onCompile}
          onRepairAndCompile={onRepairAndCompile}
          onSemanticRepairAndCompile={onSemanticRepairAndCompile}
          onPreviewCompiledJson={onPreviewCompiledJson}
        />
      </Section>
    </div>
  )
}

function IntentSummary({ intent }: { intent: IntentSpec }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-900">AI 理解的目标</div>
      <p className="mt-2 text-sm text-slate-700">{intent.goal || '尚未识别目标'}</p>
      <div className="mt-3 space-y-2">
        <TagRow label="事件" items={intent.events.map((item) => item.node)} empty="未识别事件" />
        <TagRow label="条件" items={intent.conditions.map((item) => item.node)} empty="无条件" />
        <TagRow label="执行" items={intent.executions.map((item) => item.node)} empty="未识别执行动作" />
      </div>
    </div>
  )
}

function NodeGraphPlanView({ plan }: { plan: NodeGraphPlan }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">节点图预览</div>
        <span className="text-xs text-slate-500">{plan.total_connections} 条连接</span>
      </div>
      <div className="mt-3 max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 pr-2 font-medium">类型</th>
              <th className="py-2 pr-2 font-medium">节点</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {plan.nodes.map((node) => (
              <tr key={node.id}>
                <td className="py-2 pr-2">
                  <StatusPill status={node.type === 'event' ? 'neutral' : node.type === 'condition' ? 'warning' : 'success'}>
                    {node.type === 'event' ? '事件' : node.type === 'condition' ? '条件' : '执行'}
                  </StatusPill>
                </td>
                <td className="py-2 pr-2">
                  <div className="font-medium text-slate-700">{node.name}</div>
                  <div className="font-mono text-[11px] text-slate-400">{node.id}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KnowledgeEvidenceList({ evidence }: { evidence: KnowledgeEvidence[] }) {
  if (evidence.length === 0) {
    return <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">暂未找到可展示的文档证据。</div>
  }

  const labelByType: Record<string, string> = {
    node_info: '节点信息',
    document: '文档匹配',
    rag: '语义检索',
    fallback: '规则兜底',
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {evidence.slice(0, 8).map((item, index) => (
        <div key={`${item.query}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.source_type === 'fallback' ? 'warning' : 'neutral'}>
              {labelByType[item.source_type] || item.source_type}
            </StatusPill>
            <span className="text-xs font-medium text-slate-600">{item.query}</span>
            {item.similarity !== undefined && (
              <span className="text-xs text-slate-400">{Math.round(item.similarity * 100)}%</span>
            )}
          </div>
          {(item.title || item.source_doc_title || item.file_name) && (
            <div className="mt-2 text-xs font-medium text-slate-600">
              {item.title || item.source_doc_title || item.file_name}
            </div>
          )}
          {item.content_preview && (
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
              {item.content_preview}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ArtifactsCard({
  artifacts,
  projectId,
  validating,
  validationResult,
  compiling,
  compileResult,
  repairing,
  repairResult,
  semanticRepairing,
  semanticRepairResult,
  compiledJsonPreview,
  onValidate,
  onCompile,
  onRepairAndCompile,
  onSemanticRepairAndCompile,
  onPreviewCompiledJson,
}: {
  artifacts: Artifacts
  projectId: string
  validating: boolean
  validationResult: ValidationResult | null
  compiling: boolean
  compileResult: CompileResult | null
  repairing: boolean
  repairResult: RepairAndCompileResult | null
  semanticRepairing: boolean
  semanticRepairResult: SemanticRepairAndCompileResult | null
  compiledJsonPreview: string
  onValidate: () => void
  onCompile: () => void
  onRepairAndCompile: () => void
  onSemanticRepairAndCompile: () => void
  onPreviewCompiledJson: () => void
}) {
  const busy = validating || compiling || repairing || semanticRepairing

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="TS 文件" value={artifacts.generated_ts_path || '已生成'} />
        <Metric label="编译状态" value={compileStatusText(artifacts.compile_status)} />
        <Metric label="生成方式" value={artifacts.generation_meta?.engine || 'rules'} />
      </div>

      {artifacts.generation_meta?.llm_message && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          AI 规划状态：{artifacts.generation_meta.llm_message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={onValidate} disabled={busy} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
          {validating ? '检查中...' : '检查 TODO'}
        </button>
        <button onClick={onCompile} disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {compiling ? '编译中...' : '编译生成 GIA'}
        </button>
        <button onClick={onRepairAndCompile} disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          {repairing ? '修复中...' : '规则修复并重试'}
        </button>
        <button onClick={onSemanticRepairAndCompile} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {semanticRepairing ? 'AI 修复中...' : 'AI 修复并重试'}
        </button>
      </div>

      {busy && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          正在处理，请稍候。编译可能需要 1 到 3 分钟。
        </div>
      )}

      {validationResult && <ValidationPanel result={validationResult} />}
      {repairResult && <RepairPanel result={repairResult} />}
      {semanticRepairResult && <SemanticRepairPanel result={semanticRepairResult} />}
      {compileResult && <CompilePanel result={compileResult} />}

      {artifacts.compile_status === 'success' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-800">编译产物已生成</div>
          <div className="mt-2 break-all font-mono text-xs text-slate-500">
            {artifacts.compiled_gia_path || 'GIA 路径等待刷新'}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={getCompiledGiaUrl(projectId)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
              下载 GIA
            </a>
            <button onClick={onPreviewCompiledJson} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
              预览 IR JSON
            </button>
          </div>
          {compiledJsonPreview && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {compiledJsonPreview}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function ValidationPanel({ result }: { result: ValidationResult }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm font-semibold text-amber-800">
        检查结果：{result.total_warnings} 个待处理项
      </div>
      {result.warnings.length > 0 && (
        <div className="mt-3 max-h-48 space-y-2 overflow-auto">
          {result.warnings.map((warning, index) => (
            <div key={index} className="rounded bg-white px-3 py-2 text-xs text-amber-800">
              L{warning.line}: {warning.message}
            </div>
          ))}
        </div>
      )}
      <InfoList title="建议" items={result.suggestions} tone="warning" />
    </div>
  )
}

function CompilePanel({ result }: { result: CompileResult }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={result.success ? 'success' : result.status === 'unavailable' ? 'danger' : 'warning'}>
          {result.success ? '编译成功' : result.status === 'unavailable' ? '环境不可用' : '编译失败'}
        </StatusPill>
        <span className="text-xs text-slate-500">阶段：{result.stage}</span>
      </div>
      {result.errors.length > 0 && (
        <div className="mt-3 max-h-48 space-y-2 overflow-auto">
          {result.errors.map((item, index) => (
            <div key={index} className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RepairPanel({ result }: { result: RepairAndCompileResult }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm">
      <div className="font-semibold text-sky-800">
        {result.repair.changed ? '规则修复已应用' : '没有匹配到可自动修复的问题'}
      </div>
      {result.repair.applied_fixes.length > 0 && (
        <InfoList title="修复动作" items={result.repair.applied_fixes} tone="neutral" />
      )}
      {result.repair.backup_path && <p className="mt-2 font-mono text-xs text-slate-500">备份：{result.repair.backup_path}</p>}
      <p className="mt-2 text-xs text-slate-600">
        重试结果：{result.final_compile.success ? '编译成功' : '仍需人工处理'}
      </p>
    </div>
  )
}

function SemanticRepairPanel({ result }: { result: SemanticRepairAndCompileResult }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
      <div className="font-semibold text-emerald-800">
        {result.semantic_repair.changed ? 'AI 已重写 generated.ts' : 'AI 未产生代码变更'}
      </div>
      {result.semantic_repair.message && <p className="mt-2 text-xs text-slate-600">{result.semantic_repair.message}</p>}
      {result.semantic_repair.model && <p className="mt-2 font-mono text-xs text-slate-500">模型：{result.semantic_repair.model}</p>}
      {result.semantic_repair.backup_path && <p className="mt-2 font-mono text-xs text-slate-500">备份：{result.semantic_repair.backup_path}</p>}
      <p className="mt-2 text-xs text-slate-600">
        重试结果：{result.final_compile.success ? '编译成功' : '仍需人工处理'}
      </p>
    </div>
  )
}

function Section({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {badge && <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{badge}</span>}
      </div>
      {children}
    </section>
  )
}

function InfoList({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  const toneClass = {
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
    neutral: 'text-slate-700',
  }[tone]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className={`text-xs font-semibold ${toneClass}`}>{title}</div>
      <ul className="mt-2 space-y-1.5">
        {(items.length > 0 ? items : ['暂无']).slice(0, 8).map((item, index) => (
          <li key={index} className="text-xs leading-relaxed text-slate-600">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800" title={value}>
        {value}
      </div>
    </div>
  )
}

function TagRow({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(items.length > 0 ? items : [empty]).map((item, index) => (
          <span key={`${item}-${index}`} className="rounded bg-white px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatusPill({
  status,
  children,
}: {
  status: 'success' | 'warning' | 'danger' | 'pending' | 'neutral'
  children: ReactNode
}) {
  const cls = {
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
    pending: 'bg-yellow-100 text-yellow-700',
    neutral: 'bg-slate-100 text-slate-600',
  }[status]
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

function compileStatusText(status: Artifacts['compile_status']) {
  if (status === 'success') return '编译成功'
  if (status === 'failed') return '编译失败'
  if (status === 'compiling') return '编译中'
  return '未编译'
}
