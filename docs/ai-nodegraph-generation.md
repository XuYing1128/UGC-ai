# AI Nodegraph Generation

Updated: 2026-05-12

## Goal

UGC Projects now has an optional LLM planning layer for natural-language nodegraph generation. The model improves intent understanding and graph decomposition, while the deterministic TypeScript generator remains the safety gate.

## Flow

1. Parse the user request with the existing keyword/rule parser.
2. Query knowledge evidence with `skill.service` when available.
3. Build a rule-based fallback nodegraph plan.
4. If frontend LLM config is provided, call `enhance_nodegraph_with_llm()`.
5. The LLM returns strict JSON only: `intent_spec`, `nodegraph_plan`, `implemented_features`, `editor_todo`, `limitations`, and `next_steps`.
6. The backend normalizes node ids, node types, connections, and source queries.
7. Existing `_generate_ts_code()` converts the selected plan into conservative genshin-ts code.

## Safety Boundary

The LLM is not allowed to generate executable genshin-ts API calls. It only names user-facing event, condition, and execution nodes. Unknown or unverified node APIs still become TODO comments or a safe `f.printString(...)` placeholder.

## Frontend

`ProjectWorkspace` now passes the browser LLM config from `frontend/src/utils/config.ts` when generating a nodegraph. The artifacts panel displays `generation_meta`, including:

- `engine`: `rules` or `llm+rules`
- `llm_used`
- `llm_model`
- `llm_message`

## Fallback

When LLM config, dependencies, or API calls fail, generation automatically falls back to the rule-based planner and records the reason in `generation_meta` and limitations.
