# 架构文档

## 系统分层

```
┌─────────────────────────────────────────────┐
│                   Frontend                   │
│        React 18 + TypeScript + Tailwind      │
│   Chat | ToolCall | Notes | Data | Projects  │
└──────────────────┬──────────────────────────┘
                   │ HTTP/SSE
┌──────────────────▼──────────────────────────┐
│                API Layer                     │
│           FastAPI (backend/main.py)          │
│  /rag/*  /agent/*  /skills/*  /notes/*      │
│  /data/*  /upload/*  /projects/*            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Service Layer                   │
│  rag/chatEngine  agent/agentEngine           │
│  skill/service   projects/service            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Knowledge Layer                 │
│  ChromaDB (vector)  +  derived/ (structured) │
│  Miliastra-knowledge (raw docs)              │
└─────────────────────────────────────────────┘
```

## 数据流

### RAG 问答流
```
User → API → ChatEngine → Query Rewriting → CombinedRetriever → ChromaDB → LLM Synthesis → Response
```

### Agent 问答流
```
User → API → AgentEngine → FunctionAgent
  → Tool Calls (get_node_info / get_document / rag_search)
  → Tool Results Aggregation → LLM Final Answer → Response + Tool Trace
```

### 项目生成流（新增）
```
User → API → ProjectService
  → Intent Parsing → Skill API (knowledge grounding)
  → NodeGraph Planning → TS/JSON Generation
  → Save to projects_data/ → Response
```

## 存储

| 数据类型 | 存储方式 | 路径 |
|----------|----------|------|
| 知识库文档 | Markdown 文件 | knowledge/Miliastra-knowledge/ |
| 向量索引 | ChromaDB (SQLite) | knowledge/rag_v1/db/ |
| 结构化节点 | JSON + Markdown | knowledge/Miliastra-knowledge/derived/ |
| 笔记 | PostgreSQL | public.notes |
| 数据查询 | PostgreSQL | public.ugc_* |
| 项目数据 | JSON 文件 | backend/projects_data/ |
| 前端配置 | localStorage | 浏览器 |
| LLM 用量 | PostgreSQL | public.models |

## 技术栈

- **后端**: Python 3.11+, FastAPI, LlamaIndex, ChromaDB, psycopg2
- **前端**: React 18, TypeScript 5, Tailwind CSS 3, Vite 5
- **部署**: Docker Compose (FastAPI + Nginx)
- **AI**: OpenAI-compatible API (DeepSeek, OpenRouter, etc.)

## 安全

- API Key 仅存储在浏览器 localStorage，不经过后端
- 免费模型渠道有每日限额（PostgreSQL 追踪）
- 文件上传限制 10MB
- CORS 当前为 allow_origins=["*"]（开发阶段）
