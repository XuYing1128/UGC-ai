# AI Semantic Repair

Updated: 2026-05-12

## Purpose

`semantic-repair-and-compile` is the optional LLM-based repair layer for UGC Projects. It complements the deterministic rule repair path by letting the configured OpenAI-compatible model inspect compile errors and rewrite `generated.ts`.

## Backend

- Endpoint: `POST /api/v1/projects/{project_id}/semantic-repair-and-compile`
- Request body: `{ "config": { ...llmConfig } }`
- Flow:
  1. Run `compile_generated_ts(project_id)`.
  2. If compilation already succeeds, return without rewriting.
  3. Send current `generated.ts`, compile errors, intent, nodegraph plan, and knowledge evidence to the LLM.
  4. Extract a full TypeScript file from the LLM response.
  5. Reject output that does not include `import { g } from 'genshin-ts/runtime/core'`.
  6. Backup the old file as `generated.before-semantic-repair-{timestamp}.ts`.
  7. Write repaired code, update `metadata.json`, append `artifacts.semantic_repair_history`, then retry compile.

## Frontend

- `ProjectWorkspace` exposes an `AI 修复并重试` button in the artifacts section.
- It reuses browser LLM settings from `frontend/src/utils/config.ts`.
- It displays whether the LLM rewrote code, final compile status, model, message, and backup path.

## Safety

The semantic repair module lazily imports `common.llm_config`. If LLM config or optional backend dependencies are unavailable, the endpoint returns `available: false` in `semantic_repair` instead of crashing the project workflow.
