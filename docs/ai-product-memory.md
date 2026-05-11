# AI 产品记忆

## 产品定位

千星奇域工具箱是 AI 赋能的 UGC 编辑器效率工具。核心能力：
- 知识库问答（RAG + Agent 双模式）
- UGC 项目创建与 AI 辅助节点图生成
- 结构化知识查询（Skill API / MCP Server）

## AI 流水线

```
NL 需求 → Intent Spec → Knowledge Grounding → NodeGraph Plan → genshin-ts TS/DSL → validate-plan → user next steps
```

### 1. Intent Spec（意图识别）
将用户自然语言需求拆解为结构化意图：
- 目标效果描述
- 涉及的事件类型
- 需要的执行节点
- 数据/条件约束

### 2. Knowledge Grounding（知识锚定）
通过 Skill API 查询相关知识，结果存入 `knowledge_evidence` 字段：
- `get_node_info` — 查找节点名、参数、所属文档（source_type: node_info）
- `get_document` — 获取完整文档内容（source_type: document）
- `rag_search` — 语义检索相关教程和 FAQ（source_type: rag）
- 所有查询失败时静默 fallback，不阻塞流水线

### 3. NodeGraph Plan（节点图计划）
将锚定后的知识组装为节点图方案：
- 节点列表（名称 + 类型 + 关键参数）
- 连接关系（触发事件 → 条件判断 → 执行动作）
- 数据流（变量读写、实体引用）

### 4. genshin-ts DSL 生成
将 NodeGraph Plan 转换为千星沙箱的 TypeScript/DSL 代码：
- `g.server({...}).on(...)` 链式调用模式
- 事件名可由映射表给出初稿，仍需官方文档/编译结果校验
- 执行节点采用保守策略：只有明确确认的 `f.printString(...)` 会生成真实调用，未确认执行节点一律降级为 `// TODO` 注释
- 每个事件处理器会生成一条 `f.printString(...)` 编译占位日志，确保草稿至少能进入 genshin-ts/GIA 编译链；后续应替换为真实逻辑

### 5. Artifacts 产物
- `backend/projects_data/{project_id}/metadata.json` — 项目主数据 + nodegraph 全部字段
- `backend/projects_data/{project_id}/generated.ts` — 独立 TS 文件
- `backend/projects_data/{project_id}/compile_workspace/dist/**/*.json` — genshin-ts 生成的 IR JSON
- `backend/projects_data/{project_id}/compile_workspace/dist/**/*.gia` — 可下载的 GIA 节点图产物
- `artifacts.compile_status` — 编译状态（not_integrated → compiling → success / failed）
- `artifacts.compiled_json_path` / `artifacts.compiled_gia_path` — 编译成功后写回的产物路径
- `GET /api/v1/projects/{id}/artifacts/generated-ts` — 获取 TS 源码
- `GET /api/v1/projects/{id}/artifacts/metadata` — 获取元数据 JSON
- `GET /api/v1/projects/{id}/artifacts/compiled-json` — 获取编译 IR JSON
- `GET /api/v1/projects/{id}/artifacts/compiled-gia` — 下载 GIA 文件
- `POST /api/v1/projects/{id}/validate-plan` — 扫描 TODO，返回 warnings + suggestions
- `POST /api/v1/projects/{id}/compile` — 编译 TS，流程: npm install → tsc --noEmit → gsts
- `POST /api/v1/projects/{id}/repair-and-compile` — 对常见编译错误做保守修复并重试编译

### 6. genshin-ts 编译集成
- `backend/projects/compiler.py` — 编译适配器
- 自动检测并构建 genshin-ts-master（首次调用时 `npm install` + `npm run build`）
- 编译工作区: `projects_data/{id}/compile_workspace/`（package.json / tsconfig.json / gsts.config.ts / src/main.ts）
- `file:` 依赖链接到本地 `D:\UGC - AI\genshin-ts-master`
- 超时控制: install 5min / typecheck 2min / gsts 2min
- 结果写回 `artifacts.compile_status` 等字段
- 当前 smoke 项目已验证可跑通 `gsts_compile` 并生成 `main.json` / `main.gia`，干净结果为 `success=True`、`errors=[]`
- 自动修复目前是规则层：识别 `f.xxx is not a function`，注释未知调用；如果修复后 IR 为空，自动补 `f.printString(...)` 占位节点。未来可接入 LLM 对 `CompileResult.errors` 做语义修复。

### 7. 导出与后续步骤
生成编辑器 TODO 列表，标注已实现和待实现的功能，给出局限性说明。

## Claude/Codex 使用策略

- Claude：用于复杂的多步推理和工具调用（Agent 模式）
- Codex：用于代码生成和结构化输出
- 两者通过统一的 Skill API 复用知识查询能力
