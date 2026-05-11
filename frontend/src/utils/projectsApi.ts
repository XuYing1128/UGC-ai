export interface IntentSpec {
  raw_request: string
  goal: string
  events: { keyword: string; node: string }[]
  conditions: { keyword: string; node: string }[]
  executions: { keyword: string; node: string }[]
  data_needs: string[]
}

export interface NodeGraphNode {
  id: string
  type: 'event' | 'condition' | 'execution'
  name: string
  category: string
  params: Record<string, unknown>
}

export interface NodeGraphConnection {
  from: string
  to: string
}

export interface NodeGraphPlan {
  nodes: NodeGraphNode[]
  connections: NodeGraphConnection[]
  total_nodes: number
  total_connections: number
  source_queries: string[]
}

export interface KnowledgeEvidence {
  query: string
  source_type: 'node_info' | 'document' | 'rag' | 'fallback'
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
  compiled_json_path?: string
  compiled_gia_path?: string
  compile_status: 'not_integrated' | 'compiling' | 'success' | 'failed'
  compile_stage?: string
  compile_workspace_path?: string
  last_compile_at?: string
  compile_errors_count?: number
  generation_meta?: {
    engine?: string
    llm_available?: boolean
    llm_used?: boolean
    llm_message?: string
    llm_model?: string
    llm_channel_id?: number
  }
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

export interface ProjectData {
  project_id: string
  name: string
  description: string
  created_at: string
  status: string
  memory_summary: string
  last_assessment?: NodeGraphAssessment | null
  nodegraph: NodeGraphResult | null
}

export interface ProjectListItem {
  project_id: string
  name: string
  description: string
  created_at: string
  status: string
}

interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: { code: string; message: string } | null
}

async function apiPost<TReq, TRes>(url: string, body: TReq): Promise<ApiResponse<TRes>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  const response = await fetch(url)
  return response.json()
}

export async function createProject(name: string, description: string): Promise<ApiResponse<ProjectData>> {
  return apiPost<{ name: string; description: string }, ProjectData>(
    '/api/v1/projects/create',
    { name, description }
  )
}

export interface NodeGraphAssessment {
  project_id: string
  summary: string
  feasibility: 'ready' | 'partial' | 'needs_docs' | 'not_supported'
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  confidence: number
  can_generate: boolean
  should_generate_directly: boolean
  reasoning: string[]
  supported_features: string[]
  uncertain_features: string[]
  blocked_features: string[]
  required_official_docs: string[]
  recommended_generation_mode: string
  estimated_nodes: number
  estimated_connections: number
  knowledge_status: string
  knowledge_evidence: KnowledgeEvidence[]
  next_questions: string[]
  next_steps: string[]
  intent_spec: IntentSpec
  nodegraph_plan_preview: NodeGraphPlan
  llm_meta: {
    used: boolean
    available: boolean
    message?: string
    model?: string
    channel_id?: number
  }
}

export async function assessNodeGraph(
  projectId: string,
  naturalLanguageRequest: string,
  projectContext?: string,
  config?: Record<string, unknown>
): Promise<ApiResponse<NodeGraphAssessment>> {
  return apiPost<
    { natural_language_request: string; project_context?: string; config?: Record<string, unknown> },
    NodeGraphAssessment
  >(`/api/v1/projects/${projectId}/assess-nodegraph`, {
    natural_language_request: naturalLanguageRequest,
    project_context: projectContext,
    config,
  })
}

export async function generateNodeGraph(
  projectId: string,
  naturalLanguageRequest: string,
  projectContext?: string,
  config?: Record<string, unknown>
): Promise<ApiResponse<ProjectData>> {
  return apiPost<
    { natural_language_request: string; project_context?: string; config?: Record<string, unknown> },
    ProjectData
  >(`/api/v1/projects/${projectId}/generate-nodegraph`, {
    natural_language_request: naturalLanguageRequest,
    project_context: projectContext,
    config,
  })
}

export async function getProject(projectId: string): Promise<ApiResponse<ProjectData>> {
  return apiGet<ProjectData>(`/api/v1/projects/${projectId}`)
}

export async function listProjects(): Promise<ApiResponse<{ total: number; items: ProjectListItem[] }>> {
  return apiGet<{ total: number; items: ProjectListItem[] }>('/api/v1/projects')
}

export async function deleteProject(projectId: string): Promise<ApiResponse<{ project_id: string; deleted: boolean }>> {
  const response = await fetch(`/api/v1/projects/${projectId}`, { method: 'DELETE' })
  return response.json()
}

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

export interface CompileResult {
  success: boolean
  status: 'success' | 'failed' | 'unavailable'
  stage: 'setup' | 'install' | 'typecheck' | 'gsts_compile'
  stdout: string
  stderr: string
  errors: string[]
  warnings: string[]
  workspace_path: string
  compiled_json_path?: string
  compiled_gia_path?: string
}

export async function compileProject(projectId: string): Promise<ApiResponse<CompileResult>> {
  const response = await fetch(`/api/v1/projects/${projectId}/compile`, { method: 'POST' })
  return response.json()
}

export interface RepairResult {
  project_id: string
  changed: boolean
  applied_fixes: string[]
  backup_path?: string
  message?: string
}

export interface RepairAndCompileResult {
  project_id: string
  initial_compile: CompileResult
  repair: RepairResult
  final_compile: CompileResult
}

export interface SemanticRepairResult {
  project_id: string
  changed: boolean
  available: boolean
  message?: string
  backup_path?: string
  model?: string
  channel_id?: number
}

export interface SemanticRepairAndCompileResult {
  project_id: string
  initial_compile: CompileResult
  semantic_repair: SemanticRepairResult
  final_compile: CompileResult
}

export async function repairAndCompileProject(projectId: string): Promise<ApiResponse<RepairAndCompileResult>> {
  const response = await fetch(`/api/v1/projects/${projectId}/repair-and-compile`, { method: 'POST' })
  return response.json()
}

export async function semanticRepairAndCompileProject(
  projectId: string,
  config?: Record<string, unknown>
): Promise<ApiResponse<SemanticRepairAndCompileResult>> {
  return apiPost<{ config?: Record<string, unknown> }, SemanticRepairAndCompileResult>(
    `/api/v1/projects/${projectId}/semantic-repair-and-compile`,
    { config }
  )
}

export async function getCompiledJson(projectId: string): Promise<string> {
  const response = await fetch(`/api/v1/projects/${projectId}/artifacts/compiled-json`)
  if (!response.ok) throw new Error('Failed to fetch compiled JSON')
  return response.text()
}

export function getCompiledGiaUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/artifacts/compiled-gia`
}
