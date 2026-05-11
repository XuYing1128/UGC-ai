import { useState, useEffect, useCallback } from 'react'
import type {
  ProjectData,
  ProjectListItem,
  NodeGraphResult,
  NodeGraphPlan,
  IntentSpec,
  KnowledgeEvidence,
  Artifacts,
  ValidationResult,
  CompileResult,
  RepairAndCompileResult,
  SemanticRepairAndCompileResult,
  NodeGraphAssessment,
} from '../utils/projectsApi'
import {
  assessNodeGraph,
  createProject,
  generateNodeGraph,
  getProject,
  listProjects,
  deleteProject,
  getGeneratedTs,
  getCompiledGiaUrl,
  getCompiledJson,
  repairAndCompileProject,
  semanticRepairAndCompileProject,
  validatePlan,
  compileProject,
} from '../utils/projectsApi'
import { getConfig } from '../utils/config'

type ViewMode = 'list' | 'create' | 'detail'

export default function ProjectWorkspace() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Create form
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // Detail / Generate
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null)
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
    try {
      const res = await listProjects()
      if (res.success && res.data) {
        setProjects(res.data.items)
      }
    } catch (e) {
      setError('加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (viewMode === 'list') loadProjects()
  }, [viewMode, loadProjects])

  const handleCreate = async () => {
    if (!createName.trim()) {
      setError('请输入项目名称')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await createProject(createName.trim(), createDescription.trim())
      if (res.success && res.data) {
        setCreateName('')
        setCreateDescription('')
        setViewMode('list')
      } else {
        setError(res.error?.message || '创建失败')
      }
    } catch (e) {
      setError('创建项目失败')
    } finally {
      setCreating(false)
    }
  }

  const handleSelectProject = async (projectId: string) => {
    setLoading(true)
    setError('')
    setGeneratedResult(null)
    setValidationResult(null)
    setAssessmentResult(null)
    setAssessmentAccepted(false)
    try {
      const res = await getProject(projectId)
      if (res.success && res.data) {
        setSelectedProject(res.data)
        if (res.data.nodegraph) {
          setGeneratedResult(res.data.nodegraph)
          setNlRequest(res.data.nodegraph.intent_spec.raw_request || '')
        }
        if (res.data.last_assessment) {
          setAssessmentResult(res.data.last_assessment)
        }
        setViewMode('detail')
      } else {
        setError(res.error?.message || '加载失败')
      }
    } catch (e) {
      setError('加载项目详情失败')
    } finally {
      setLoading(false)
    }
  }

  const resetAssessment = () => {
    setAssessmentResult(null)
    setAssessmentAccepted(false)
  }

  const handleAssess = async () => {
    if (!nlRequest.trim()) {
      setError('请先用一句话描述你想做的玩法')
      return
    }
    if (!selectedProject) return

    setAssessing(true)
    setError('')
    setAssessmentResult(null)
    setAssessmentAccepted(false)
    try {
      const res = await assessNodeGraph(
        selectedProject.project_id,
        nlRequest.trim(),
        nlContext.trim() || undefined,
        getConfig() as unknown as Record<string, unknown>,
      )
      if (res.success && res.data) {
        setAssessmentResult(res.data)
        const refreshed = await getProject(selectedProject.project_id)
        if (refreshed.success && refreshed.data) {
          setSelectedProject(refreshed.data)
        }
      } else {
        setError(res.error?.message || '评估失败，请检查模型配置或稍后重试')
      }
    } catch {
      setError('评估请求失败，请检查后端服务是否运行')
    } finally {
      setAssessing(false)
    }
  }

  const handleGenerate = async () => {
    if (!nlRequest.trim()) {
      setError('请输入自然语言需求描述')
      return
    }
    if (!selectedProject) return
    if (!assessmentResult) {
      setError('请先完成 AI 可行性评估，再确认生成节点图')
      return
    }
    if (!assessmentAccepted) {
      setError('请先确认你已理解评估结果，再生成节点图')
      return
    }
    if (!assessmentResult.can_generate) {
      setError('当前评估结果不建议自动生成，请先调整需求')
      return
    }

    setGenerating(true)
    setError('')
    setGeneratedResult(null)
    try {
      const res = await generateNodeGraph(
        selectedProject.project_id,
        nlRequest.trim(),
        nlContext.trim() || undefined,
        getConfig() as unknown as Record<string, unknown>,
      )
      if (res.success && res.data) {
        setSelectedProject(res.data)
        if (res.data.nodegraph) {
          setGeneratedResult(res.data.nodegraph)
        }
      } else {
        setError(res.error?.message || '生成失败')
      }
    } catch (e) {
      setError('生成节点图失败')
    } finally {
      setGenerating(false)
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
        setError(res.error?.message || '验证失败')
      }
    } catch (e) {
      setError('验证请求失败')
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
        const refreshed = await getProject(selectedProject.project_id)
        if (refreshed.success && refreshed.data) {
          setSelectedProject(refreshed.data)
          if (refreshed.data.nodegraph) {
            setGeneratedResult(refreshed.data.nodegraph)
          }
        }
      } else {
        setError(res.error?.message || '编译失败')
      }
    } catch (e) {
      setError('编译请求失败')
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
        const refreshed = await getProject(selectedProject.project_id)
        if (refreshed.success && refreshed.data) {
          setSelectedProject(refreshed.data)
          if (refreshed.data.nodegraph) {
            setGeneratedResult(refreshed.data.nodegraph)
          }
        }
      } else {
        setError(res.error?.message || '自动修复失败')
      }
    } catch {
      setError('自动修复请求失败')
    } finally {
      setRepairing(false)
    }
  }

  const handleSemanticRepairAndCompile = async () => {
    if (!selectedProject) return
    setSemanticRepairing(true)
    setSemanticRepairResult(null)
    try {
      const res = await semanticRepairAndCompileProject(selectedProject.project_id, getConfig() as unknown as Record<string, unknown>)
      if (res.success && res.data) {
        setSemanticRepairResult(res.data)
        setCompileResult(res.data.final_compile)
        const refreshed = await getProject(selectedProject.project_id)
        if (refreshed.success && refreshed.data) {
          setSelectedProject(refreshed.data)
          if (refreshed.data.nodegraph) {
            setGeneratedResult(refreshed.data.nodegraph)
          }
        }
      } else {
        setError(res.error?.message || 'AI 语义修复失败')
      }
    } catch {
      setError('AI 语义修复请求失败')
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

  const handleDelete = async (projectId: string) => {
    if (!confirm('确定删除此项目？')) return
    try {
      const res = await deleteProject(projectId)
      if (res.success) {
        if (selectedProject?.project_id === projectId) {
          setSelectedProject(null)
          setViewMode('list')
        }
        loadProjects()
      } else {
        setError(res.error?.message || '删除失败')
      }
    } catch (e) {
      setError('删除失败')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">UGC 项目</h2>
        <div className="flex gap-2">
          {viewMode !== 'list' && (
            <button
              onClick={() => { setViewMode('list'); setSelectedProject(null); setGeneratedResult(null) }}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium"
            >
              ← 返回列表
            </button>
          )}
          {viewMode === 'list' && (
            <button
              onClick={() => setViewMode('create')}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 text-sm"
            >
              + 新建项目
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {/* ── List View ── */}
      {viewMode === 'list' && (
        <div>
          {loading ? (
            <div className="text-center text-slate-500 py-12">加载中...</div>
          ) : projects.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📁</div>
              <div className="text-slate-600 text-lg mb-2">暂无项目</div>
              <div className="text-slate-400 text-sm mb-4">创建一个 UGC 项目，让 AI 帮你生成节点图方案</div>
              <button
                onClick={() => setViewMode('create')}
                className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium"
              >
                创建第一个项目
              </button>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => (
                <div
                  key={p.project_id}
                  className="bg-white/80 rounded-2xl border border-slate-200 p-5 hover:shadow-lg transition-all cursor-pointer"
                  onClick={() => handleSelectProject(p.project_id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-slate-900 truncate">{p.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      p.status === 'nodegraph_generated'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status === 'nodegraph_generated' ? '已生成' : '待生成'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2 mb-3">
                    {p.description || '暂无描述'}
                  </p>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{p.created_at?.slice(0, 10)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p.project_id) }}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Create View ── */}
      {viewMode === 'create' && (
        <div className="max-w-xl mx-auto">
          <div className="bg-white/80 rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">创建新项目</h3>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                项目名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例如：怪物掉落奖励"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                项目描述
              </label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="描述你想要实现的 UGC 玩法..."
                rows={4}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className="w-full px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {creating ? '创建中...' : '创建项目'}
            </button>
          </div>
        </div>
      )}

      {/* ── Detail View ── */}
      {viewMode === 'detail' && selectedProject && (
        <div className="space-y-6">
          {/* Project Info Card */}
          <div className="bg-white/80 rounded-2xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{selectedProject.name}</h3>
                <p className="text-sm text-slate-500 mt-1">{selectedProject.description || '暂无描述'}</p>
              </div>
              <span className={`px-3 py-1 rounded-lg text-xs font-medium ${
                selectedProject.status === 'nodegraph_generated'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {selectedProject.status === 'nodegraph_generated' ? '已生成节点图' : '等待生成'}
              </span>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <div>ID: {selectedProject.project_id}</div>
              <div>创建时间: {selectedProject.created_at}</div>
              {selectedProject.memory_summary && (
                <div className="text-slate-600 mt-2">{selectedProject.memory_summary}</div>
              )}
            </div>
          </div>

          {/* Generate Form */}
          <div className="bg-white/80 rounded-2xl border border-slate-200 p-6 space-y-4">
            <h4 className="font-semibold text-slate-800">
              {generatedResult ? '🔄 重新生成节点图' : '🤖 AI 生成节点图'}
            </h4>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                自然语言需求描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={nlRequest}
                onChange={(e) => { setNlRequest(e.target.value); resetAssessment() }}
                placeholder="例如：当怪物死亡时播放爆炸特效，并掉落随机奖励道具"
                rows={4}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                disabled={generating || assessing}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                项目上下文（可选）
              </label>
              <textarea
                value={nlContext}
                onChange={(e) => { setNlContext(e.target.value); resetAssessment() }}
                placeholder="补充说明：怪物类型、奖励道具 ID、特效名称等"
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                disabled={generating || assessing}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={handleAssess}
                disabled={assessing || generating || !nlRequest.trim()}
                className="px-5 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {assessing ? '正在评估...' : '1. AI 评估能否完成'}
              </button>
              <button
                onClick={() => setAssessmentAccepted(true)}
                disabled={!assessmentResult || !assessmentResult.can_generate || generating || assessing}
                className="px-5 py-3 bg-slate-700 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {assessmentAccepted ? '2. 已确认评估' : '2. 确认评估结果'}
              </button>
            </div>

            {assessmentResult && (
              <AssessmentPanel assessment={assessmentResult} accepted={assessmentAccepted} />
            )}

            <button
              onClick={handleGenerate}
              disabled={generating || assessing || !assessmentAccepted || !assessmentResult?.can_generate}
              className="w-full px-6 py-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {generating ? '正在分析需求、查询知识库、生成节点图...' : '生成节点图方案'}
            </button>
          </div>

          {/* Result Display */}
          {generatedResult && (
            <GenerateResultView
              result={generatedResult}
              projectId={selectedProject.project_id}
              onValidate={handleValidate}
              validating={validating}
              validationResult={validationResult}
              onCopyTs={handleCopyTs}
              onCompile={handleCompile}
              compiling={compiling}
              compileResult={compileResult}
              onRepairAndCompile={handleRepairAndCompile}
              repairing={repairing}
              repairResult={repairResult}
              onSemanticRepairAndCompile={handleSemanticRepairAndCompile}
              semanticRepairing={semanticRepairing}
              semanticRepairResult={semanticRepairResult}
              compiledJsonPreview={compiledJsonPreview}
              onPreviewCompiledJson={handlePreviewCompiledJson}
            />
          )}
        </div>
      )}
    </div>
  )
}

function AssessmentPanel({ assessment, accepted }: { assessment: NodeGraphAssessment; accepted: boolean }) {
  const feasibilityLabel: Record<NodeGraphAssessment['feasibility'], string> = {
    ready: '可生成',
    partial: '可生成骨架',
    needs_docs: '需核对文档',
    not_supported: '暂不建议',
  }
  const difficultyLabel: Record<NodeGraphAssessment['difficulty'], string> = {
    easy: '简单',
    medium: '中等',
    hard: '困难',
    expert: '专家级',
  }
  const feasibilityClass: Record<NodeGraphAssessment['feasibility'], string> = {
    ready: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    needs_docs: 'bg-sky-100 text-sky-700',
    not_supported: 'bg-red-100 text-red-700',
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-1 rounded text-xs font-medium ${feasibilityClass[assessment.feasibility]}`}>
          {feasibilityLabel[assessment.feasibility]}
        </span>
        <span className="px-2 py-1 rounded bg-white text-xs font-medium text-slate-600">
          难度：{difficultyLabel[assessment.difficulty]}
        </span>
        <span className="px-2 py-1 rounded bg-white text-xs font-medium text-slate-600">
          置信度：{Math.round((assessment.confidence || 0) * 100)}%
        </span>
        {accepted && (
          <span className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium">已确认</span>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-800">评估结论</div>
        <p className="mt-1 text-sm text-slate-700">{assessment.summary}</p>
        <p className="mt-1 text-xs text-slate-500">建议：{assessment.recommended_generation_mode}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <MiniList title="能自动处理" items={assessment.supported_features} tone="emerald" />
        <MiniList title="需要确认" items={assessment.uncertain_features} tone="amber" />
        <MiniList title="生成前问题" items={assessment.next_questions} tone="sky" />
      </div>

      {assessment.blocked_features.length > 0 && (
        <MiniList title="暂时阻塞" items={assessment.blocked_features} tone="red" />
      )}

      <div className="rounded-lg bg-white/70 border border-slate-200 p-3">
        <div className="text-xs font-medium text-slate-500 mb-2">预估节点图</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            {assessment.estimated_nodes} 个节点
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            {assessment.estimated_connections} 条连接
          </span>
          <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">
            {assessment.llm_meta?.used ? 'LLM 已参与评估' : '规则评估兜底'}
          </span>
        </div>
      </div>
    </div>
  )
}

function MiniList({ title, items, tone }: { title: string; items: string[]; tone: 'emerald' | 'amber' | 'sky' | 'red' }) {
  const titleClass: Record<string, string> = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    sky: 'text-sky-700',
    red: 'text-red-700',
  }
  return (
    <div className="rounded-lg bg-white/70 border border-slate-200 p-3">
      <div className={`text-xs font-semibold mb-2 ${titleClass[tone]}`}>{title}</div>
      <ul className="space-y-1">
        {(items.length > 0 ? items : ['暂无']).slice(0, 5).map((item, i) => (
          <li key={i} className="text-xs text-slate-600 leading-relaxed">{item}</li>
        ))}
      </ul>
    </div>
  )
}

function GenerateResultView({ result, projectId, onValidate, validating, validationResult, onCopyTs, onCompile, compiling, compileResult, onRepairAndCompile, repairing, repairResult, onSemanticRepairAndCompile, semanticRepairing, semanticRepairResult, compiledJsonPreview, onPreviewCompiledJson }: {
  result: NodeGraphResult
  projectId: string
  onValidate: () => void
  validating: boolean
  validationResult: ValidationResult | null
  onCopyTs: () => void
  onCompile: () => void
  compiling: boolean
  compileResult: CompileResult | null
  onRepairAndCompile: () => void
  repairing: boolean
  repairResult: RepairAndCompileResult | null
  onSemanticRepairAndCompile: () => void
  semanticRepairing: boolean
  semanticRepairResult: SemanticRepairAndCompileResult | null
  compiledJsonPreview: string
  onPreviewCompiledJson: () => void
}) {
  return (
    <div className="space-y-6">
      {/* Intent Spec */}
      <SectionCard title="意图识别" badge="Intent Spec" color="blue">
        <IntentSpecView intent={result.intent_spec} />
      </SectionCard>

      {/* Knowledge Queries */}
      <SectionCard title="知识查询" badge={`${result.knowledge_queries.length} 个关键词`} color="green">
        <div className="flex flex-wrap gap-2">
          {result.knowledge_queries.map((q, i) => (
            <span key={i} className="px-3 py-1 bg-green-50 text-green-700 rounded-lg text-sm">
              {q}
            </span>
          ))}
        </div>
      </SectionCard>

      {/* Knowledge Evidence */}
      {result.knowledge_evidence.length > 0 && (
        <SectionCard title="知识证据" badge={`${result.knowledge_evidence.length} 条`} color="blue">
          <KnowledgeEvidenceCard evidence={result.knowledge_evidence} />
        </SectionCard>
      )}

      {/* NodeGraph Plan */}
      <SectionCard title="节点图方案" badge={`${result.nodegraph_plan.total_nodes} 节点, ${result.nodegraph_plan.total_connections} 连线`} color="violet">
        <NodeGraphPlanView plan={result.nodegraph_plan} />
      </SectionCard>

      {/* Generated TS */}
      <SectionCard title="生成的 TypeScript 代码" badge="genshin-ts" color="slate">
        <div className="flex justify-end mb-2">
          <button
            onClick={onCopyTs}
            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            📋 复制完整代码
          </button>
        </div>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap font-mono max-h-96">
          {result.generated_ts}
        </pre>
      </SectionCard>

      {/* Artifacts + Validation */}
      <SectionCard title="产物与验证" badge={result.artifacts.compile_status} color="orange">
        <ArtifactsCard
          artifacts={result.artifacts}
          projectId={projectId}
          onValidate={onValidate}
          validating={validating}
          validationResult={validationResult}
          onCompile={onCompile}
          compiling={compiling}
          compileResult={compileResult}
          onRepairAndCompile={onRepairAndCompile}
          repairing={repairing}
          repairResult={repairResult}
          onSemanticRepairAndCompile={onSemanticRepairAndCompile}
          semanticRepairing={semanticRepairing}
          semanticRepairResult={semanticRepairResult}
          compiledJsonPreview={compiledJsonPreview}
          onPreviewCompiledJson={onPreviewCompiledJson}
        />
      </SectionCard>

      {/* Editor TODO */}
      <SectionCard title="编辑器待办" badge={`${result.editor_todo.length} 步`} color="orange">
        <ul className="space-y-2">
          {result.editor_todo.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="text-orange-500 font-mono text-sm mt-0.5">{i + 1}.</span>
              <span className="text-sm text-slate-700">{item}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Implemented Features */}
      <SectionCard title="已覆盖功能" badge="" color="emerald">
        <ul className="space-y-1">
          {result.implemented_features.map((item, i) => (
            <li key={i} className="text-sm text-slate-700">{item}</li>
          ))}
        </ul>
      </SectionCard>

      {/* Limitations */}
      <SectionCard title="局限性说明" badge="" color="red">
        <ul className="space-y-1">
          {result.limitations.map((item, i) => (
            <li key={i} className="text-sm text-slate-600">⚠️ {item}</li>
          ))}
        </ul>
      </SectionCard>

      {/* Next Steps */}
      <SectionCard title="后续建议" badge="" color="sky">
        <ul className="space-y-1">
          {result.next_steps.map((item, i) => (
            <li key={i} className="text-sm text-slate-700">→ {item}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}

function KnowledgeEvidenceCard({ evidence }: { evidence: KnowledgeEvidence[] }) {
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
            <div className="flex items-center gap-2 mb-1 flex-wrap">
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

function ArtifactsCard({ artifacts, projectId, onValidate, validating, validationResult, onCompile, compiling, compileResult, onRepairAndCompile, repairing, repairResult, onSemanticRepairAndCompile, semanticRepairing, semanticRepairResult, compiledJsonPreview, onPreviewCompiledJson }: {
  artifacts: Artifacts
  projectId: string
  onValidate: () => void
  validating: boolean
  validationResult: ValidationResult | null
  onCompile: () => void
  compiling: boolean
  compileResult: CompileResult | null
  onRepairAndCompile: () => void
  repairing: boolean
  repairResult: RepairAndCompileResult | null
  onSemanticRepairAndCompile: () => void
  semanticRepairing: boolean
  semanticRepairResult: SemanticRepairAndCompileResult | null
  compiledJsonPreview: string
  onPreviewCompiledJson: () => void
}) {
  return (
    <div className="space-y-4">
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
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium transition-colors"
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

        {artifacts.generation_meta && (
          <div className="space-y-1 bg-white/50 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">AI 规划</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                artifacts.generation_meta.llm_used
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {artifacts.generation_meta.engine || 'rules'}
              </span>
            </div>
            {artifacts.generation_meta.llm_model && (
              <p className="text-xs text-slate-400 font-mono">{artifacts.generation_meta.llm_model}</p>
            )}
            {artifacts.generation_meta.llm_message && (
              <p className="text-xs text-slate-500">{artifacts.generation_meta.llm_message}</p>
            )}
          </div>
        )}

        {artifacts.compile_status === 'success' && (
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <div>
              <span className="text-xs font-medium text-emerald-700">编译产物</span>
              <p className="mt-1 text-xs text-slate-500 font-mono">
                {artifacts.compiled_gia_path || 'GIA 路径待刷新'}
              </p>
              {artifacts.compiled_json_path && (
                <p className="mt-1 text-xs text-slate-400 font-mono">{artifacts.compiled_json_path}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={getCompiledGiaUrl(projectId)}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors"
              >
                下载 GIA
              </a>
              <button
                onClick={onPreviewCompiledJson}
                className="px-3 py-1.5 bg-white border border-emerald-200 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors"
              >
                查看 IR JSON
              </button>
            </div>
            {compiledJsonPreview && (
              <details open className="text-xs">
                <summary className="cursor-pointer text-emerald-700">IR JSON 预览</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-slate-200 whitespace-pre-wrap font-mono">
                  {compiledJsonPreview}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      <div>
        <button
          onClick={onValidate}
          disabled={validating}
          className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50 text-sm font-medium transition-colors"
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

      {/* Compile */}
      <div className="border-t border-slate-200 pt-4 flex flex-wrap gap-2">
        <button
          onClick={onCompile}
          disabled={compiling || repairing || semanticRepairing}
          className="px-4 py-2 bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {compiling ? '编译中...' : '🔨 编译 (tsc + gsts)'}
        </button>
        <button
          onClick={onRepairAndCompile}
          disabled={compiling || repairing || semanticRepairing}
          className="px-4 py-2 bg-sky-600 text-white rounded-xl hover:bg-sky-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {repairing ? '修复中...' : '🛠 自动修复并重试'}
        </button>
        <button
          onClick={onSemanticRepairAndCompile}
          disabled={compiling || repairing || semanticRepairing}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          {semanticRepairing ? 'AI 修复中...' : 'AI 修复并重试'}
        </button>
      </div>

      {(compiling || repairing || semanticRepairing) && (
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div className="animate-spin h-4 w-4 border-2 border-violet-500 border-t-transparent rounded-full" />
          <span>{repairing ? '正在尝试保守修复并重新编译...' : '正在编译，可能需要 2-5 分钟...'}</span>
        </div>
      )}

      {repairResult && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sky-800">
              {repairResult.repair.changed ? '已应用自动修复' : '未发现可自动修复项'}
            </span>
            <span className={`rounded px-2 py-0.5 ${
              repairResult.final_compile.success ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
            }`}>
              {repairResult.final_compile.success ? '重试编译成功' : '仍需人工处理'}
            </span>
          </div>
          {repairResult.repair.applied_fixes.length > 0 && (
            <div className="space-y-1">
              {repairResult.repair.applied_fixes.map((fix, i) => (
                <div key={i} className="text-slate-600">→ {fix}</div>
              ))}
            </div>
          )}
          {repairResult.repair.backup_path && (
            <div className="text-slate-500 font-mono">backup: {repairResult.repair.backup_path}</div>
          )}
          {repairResult.repair.message && (
            <div className="text-slate-500">{repairResult.repair.message}</div>
          )}
        </div>
      )}

      {semanticRepairResult && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-emerald-800">
              {semanticRepairResult.semantic_repair.changed ? 'AI 已重写 generated.ts' : 'AI 未产生代码变更'}
            </span>
            <span className={`rounded px-2 py-0.5 ${
              semanticRepairResult.final_compile.success ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
            }`}>
              {semanticRepairResult.final_compile.success ? '重试编译成功' : '仍需人工处理'}
            </span>
          </div>
          {semanticRepairResult.semantic_repair.message && (
            <div className="text-slate-600">{semanticRepairResult.semantic_repair.message}</div>
          )}
          {semanticRepairResult.semantic_repair.model && (
            <div className="text-slate-500 font-mono">model: {semanticRepairResult.semantic_repair.model}</div>
          )}
          {semanticRepairResult.semantic_repair.backup_path && (
            <div className="text-slate-500 font-mono">backup: {semanticRepairResult.semantic_repair.backup_path}</div>
          )}
        </div>
      )}

      {compileResult && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
              compileResult.status === 'success'
                ? 'bg-green-100 text-green-700'
                : compileResult.status === 'unavailable'
                ? 'bg-red-100 text-red-700'
                : 'bg-orange-100 text-orange-700'
            }`}>
              {compileResult.status === 'success' ? '✓ 编译成功' :
               compileResult.status === 'unavailable' ? '✗ 环境不可用' : '✗ 编译失败'}
            </span>
            <span className="text-xs text-slate-400">阶段: {compileResult.stage}</span>
          </div>

          {compileResult.errors.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {compileResult.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2 text-xs">
                  <span className="text-red-500 shrink-0">✗</span>
                  <span className="text-red-800 font-mono">{e}</span>
                </div>
              ))}
            </div>
          )}

          {compileResult.stdout && (
            <details className="text-xs">
              <summary className="text-slate-500 cursor-pointer">stdout</summary>
              <pre className="mt-1 bg-slate-900 text-slate-300 p-2 rounded-lg overflow-x-auto max-h-32 whitespace-pre-wrap font-mono">
                {compileResult.stdout}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function SectionCard({
  title,
  badge,
  color,
  children,
}: {
  title: string
  badge: string
  color: 'blue' | 'green' | 'violet' | 'slate' | 'orange' | 'emerald' | 'red' | 'sky'
  children: React.ReactNode
}) {
  const borderColors: Record<string, string> = {
    blue: 'border-blue-200',
    green: 'border-green-200',
    violet: 'border-violet-200',
    slate: 'border-slate-200',
    orange: 'border-orange-200',
    emerald: 'border-emerald-200',
    red: 'border-red-200',
    sky: 'border-sky-200',
  }
  return (
    <div className={`bg-white/80 rounded-2xl border ${borderColors[color]} p-5`}>
      <div className="flex items-center gap-3 mb-4">
        <h4 className="font-semibold text-slate-800">{title}</h4>
        {badge && (
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">{badge}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function IntentSpecView({ intent }: { intent: IntentSpec }) {
  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-medium text-slate-500">目标</span>
        <p className="text-sm text-slate-800 mt-1">{intent.goal || '（未识别）'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <span className="text-xs font-medium text-slate-500">事件</span>
          {intent.events.length === 0 ? (
            <p className="text-xs text-slate-400 mt-1">未识别</p>
          ) : (
            <div className="flex flex-wrap gap-1 mt-1">
              {intent.events.map((e, i) => (
                <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                  {e.node}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <span className="text-xs font-medium text-slate-500">条件</span>
          {intent.conditions.length === 0 ? (
            <p className="text-xs text-slate-400 mt-1">未识别</p>
          ) : (
            <div className="flex flex-wrap gap-1 mt-1">
              {intent.conditions.map((c, i) => (
                <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs">
                  {c.node}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <span className="text-xs font-medium text-slate-500">执行动作</span>
        {intent.executions.length === 0 ? (
          <p className="text-xs text-slate-400 mt-1">未识别</p>
        ) : (
          <div className="flex flex-wrap gap-1 mt-1">
            {intent.executions.map((ex, i) => (
              <span key={i} className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded text-xs">
                {ex.node}
              </span>
            ))}
          </div>
        )}
      </div>

      {intent.data_needs.length > 0 && (
        <div>
          <span className="text-xs font-medium text-slate-500">数据需求</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {intent.data_needs.map((d, i) => (
              <span key={i} className="px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-xs">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NodeGraphPlanView({ plan }: { plan: NodeGraphPlan }) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 font-medium text-slate-600">ID</th>
              <th className="text-left py-2 px-3 font-medium text-slate-600">类型</th>
              <th className="text-left py-2 px-3 font-medium text-slate-600">节点名</th>
              <th className="text-left py-2 px-3 font-medium text-slate-600">分类</th>
            </tr>
          </thead>
          <tbody>
            {plan.nodes.map((node) => (
              <tr key={node.id} className="border-b border-slate-100">
                <td className="py-2 px-3 font-mono text-xs">{node.id}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    node.type === 'event' ? 'bg-blue-100 text-blue-700' :
                    node.type === 'condition' ? 'bg-amber-100 text-amber-700' :
                    'bg-violet-100 text-violet-700'
                  }`}>
                    {node.type}
                  </span>
                </td>
                <td className="py-2 px-3 font-medium">{node.name}</td>
                <td className="py-2 px-3 text-slate-500 text-xs">{node.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.connections.length > 0 && (
        <div>
          <span className="text-xs font-medium text-slate-500">连接关系</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {plan.connections.map((conn, i) => (
              <span key={i} className="px-2 py-1 bg-slate-50 rounded text-xs font-mono text-slate-600">
                {conn.from} → {conn.to}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
