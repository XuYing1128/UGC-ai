# 开发进度

## 已完成

- [x] 知识问答系统：RAG + Agent 双模式
- [x] Skill + API 能力层：MCP Server + HTTP Skill API
- [x] 笔记系统：CRUD + 点赞 + 版本控制
- [x] Data 数据查询：物件/特效/音乐
- [x] 图床上传：腾讯云 COS
- [x] 前端：React + Tailwind + SSE 流式对话
- [x] Docker 部署支持

## 进行中

- [x] UGC 项目创建与 AI 节点图生成（Projects API） ✅ 2026-05-11
  - [x] 项目 CRUD（目录化存储: projects_data/{id}/metadata.json + generated.ts）
  - [x] NL → NodeGraph 生成流水线（意图识别 + skill.service 知识锚定 + 节点图方案 + TS 代码生成）
  - [x] TS 代码生成重写为 genshin-ts runtime DSL（`g.server({...}).on(...)` 模式）
  - [x] knowledge_evidence 字段（node_info / document / rag 三类来源，skill.service 实查）
  - [x] artifacts 字段 + artifact API（GET generated-ts / GET metadata）
  - [x] validate-plan API（TODO 扫描 → warnings + suggestions）
  - [x] 前端 ProjectWorkspace 组件（知识证据卡片 + 产物区 + 验证结果 UI）
  - [x] genshin-ts 编译集成（compiler.py + POST /compile + 前端编译按钮/结果）
  - [x] skill.service import fallback（chromadb 缺失时不崩溃，生成 fallback 证据 + 写入 limitations）
  - [x] Windows 兼容：`_find_cmd(name)` → shutil.which + .cmd 回退；`_run()` 封装 FileNotFoundError + TimeoutExpired 处理
  - [x] 生成代码保守化：未确认执行节点降级为 TODO 注释，避免生成不存在的 genshin-ts API
  - [x] 编译占位节点：事件处理器自动生成 `f.printString(...)` 占位，确保草稿可进入 GIA 编译链
  - [x] GIA artifact API：编译成功后记录 `compiled_json_path` / `compiled_gia_path`
  - [x] 前端 GIA 下载与 IR JSON 预览
  - [x] 自动修复并重试：编译失败后可注释未知 `f.xxx(...)` 调用、补 `printString` 占位并重新编译

## 待开始

- [ ] 素材寻找系统：多模态 RAG
- [ ] 数据问答系统：参数聚合 + AI 对话
- [ ] UI 重构：Chat.tsx 拆分为 hooks
- [ ] 错误处理格式统一（P0 修复）
- [ ] Pydantic v2 迁移完善（.dict() → .model_dump()）
- [ ] 用户认证系统
- [ ] 多语言支持

## 构建验证 ✅

- **前端构建**: `npm run build` (tsc + vite build) 通过，0 error —— 2026-05-11
- **Python 语法验证**: `ast.parse()` 验证 `backend/projects/` 全部 6 个文件通过 —— 2026-05-11
- **编译 smoke**: `compile_generated_ts` 已在 smoke 项目上跑通 `gsts_compile`，成功生成 `main.json` 和 `main.gia`，最终干净结果为 `success=True`、`errors=[]` —— 2026-05-11
- **GIA artifact smoke**: 新项目编译后 `get_artifact_gia_path()` 返回 `main.gia`，`get_artifact_ir_json()` 可读取 IR JSON —— 2026-05-11
- **自动修复 smoke**: 人为注入 `f.giveReward({})` 后，repair 注释未知 API、补占位节点，第二次 `compile_generated_ts` 成功 —— 2026-05-11
- **开发工具链**:
  - Claude CLI 通过 oh-my-claude MCP 管理记忆/偏好
  - 模型路由: DeepSeek provider (DEEPSEEK_API_KEY) via OmniCode proxy
  - OmniCode 支持多 provider 切换: deepseek, zhipu, minimax, kimi, aliyun, openrouter, openai, ollama

## 已知问题

1. 错误处理格式不一致：notes/data router 直接抛 HTTPException，与前端期望的 {success, data, error} 不匹配
2. Chat.tsx 中 SSE 超时检查 interval 未清理
3. Conversation.messages 类型为 any[]
4. Pydantic v1 API（.dict()）在 `rag/chat.py` 4 处残留（L98, L99, L157, L158）

## worker 机制

当前无独立 worker。工具调用由 LlamaIndex FunctionAgent 在请求线程内同步/异步完成。
后续如需异步生成节点图，可引入 Celery + Redis 或 FastAPI BackgroundTasks。

## 2026-05-24 UI 实测补充
- [x] 应用默认首屏调整为 UGC 项目工作台，让新用户打开后直接进入“创建项目 -> AI 评估 -> 确认 -> 生成节点图”的核心流程。
- [x] HTTP 主链路实测通过：项目创建、可行性评估、节点图生成、genshin-ts/GIA 编译、临时项目删除。
- [x] 前端生产构建通过：`npm run build`。
- [x] 后端开发服务已可在 `http://127.0.0.1:8000` 启动，前端开发服务在 `http://127.0.0.1:5173`。
