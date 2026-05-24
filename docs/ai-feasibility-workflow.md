# AI Feasibility Workflow

Updated: 2026-05-12

## Product Rule

Natural-language nodegraph generation must not jump directly into generation. The product flow is:

1. User describes the desired UGC gameplay.
2. AI evaluates feasibility against official-doc evidence and known genshin-ts/project limitations.
3. User confirms they understand the result.
4. Only then does the system generate the nodegraph plan and conservative TypeScript skeleton.

## Backend

- Endpoint: `POST /api/v1/projects/{project_id}/assess-nodegraph`
- Service: `assess_nodegraph_request()` in `backend/projects/service.py`
- Request fields:
  - `natural_language_request`
  - `project_context`
  - `config`
- The result is saved to project metadata as `last_assessment`.

## Assessment Result

The response includes:

- `feasibility`: `ready`, `partial`, `needs_docs`, or `not_supported`
- `difficulty`: `easy`, `medium`, `hard`, or `expert`
- `confidence`
- `can_generate`
- `should_generate_directly`: always `false`
- supported, uncertain, and blocked features
- required official docs / node names to verify
- next questions for the user
- preview nodegraph plan
- knowledge evidence
- LLM metadata

## Safety

The assessment layer may use the configured LLM, but it always has a rule-based fallback. If official docs or `skill.service` are unavailable, feasibility should be no stronger than `needs_docs`, and the UI must tell the user that the generated result is only a safe skeleton.

## Frontend

`ProjectWorkspace` now presents a three-step workflow:

1. `AI 评估能否完成`
2. `确认评估结果`
3. `生成节点图`

The final generation button is disabled until assessment exists, `can_generate` is true, and the user has confirmed the assessment.

## 2026-05-24 UI Pass

- Rebuilt `ProjectWorkspace` as a beginner-friendly workspace with clean Chinese copy, project cards, guided examples, assessment summary, node preview, evidence cards, and compile/export actions.
- Kept the core safety flow: assess first, user confirms second, generate third.
- Added clearer artifact actions: check TODO, compile GIA, rule repair, AI repair, download GIA, and preview IR JSON.
- Tightened compile safety for event nodes: only verified event APIs are emitted directly. Unverified events use a compilable placeholder event and a TODO comment that tells the user to confirm the real official node.
