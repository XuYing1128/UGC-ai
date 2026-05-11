"""LLM-assisted nodegraph planning.

This module intentionally asks the model for structured intent + graph data,
not executable genshin-ts code. The existing deterministic TS generator remains
the safety gate that turns a plan into conservative, compilable source.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx


def _extract_json(text: str) -> dict[str, Any] | None:
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    candidate = fenced.group(1) if fenced else text
    candidate = candidate.strip()

    if not candidate.startswith("{"):
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            candidate = candidate[start : end + 1]

    try:
        data = json.loads(candidate)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _node_type(value: Any) -> str:
    if value in ("event", "condition", "execution"):
        return str(value)
    return "execution"


def _clean_node(raw: dict[str, Any], idx: int) -> dict[str, Any]:
    node_type = _node_type(raw.get("type"))
    prefix = {"event": "event", "condition": "cond", "execution": "exec"}[node_type]
    node_id = str(raw.get("id") or f"{prefix}_{idx}")
    return {
        "id": node_id,
        "type": node_type,
        "name": str(raw.get("name") or raw.get("node") or "未命名节点")[:80],
        "category": str(raw.get("category") or {
            "event": "事件节点",
            "condition": "流程控制节点",
            "execution": "执行节点",
        }[node_type])[:80],
        "params": raw.get("params") if isinstance(raw.get("params"), dict) else {},
    }


def _normalize_plan(plan: dict[str, Any], fallback_queries: list[str]) -> dict[str, Any] | None:
    raw_nodes = plan.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return None

    nodes: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    type_counts = {"event": 0, "condition": 0, "execution": 0}
    for raw in raw_nodes[:24]:
        if not isinstance(raw, dict):
            continue
        node_type = _node_type(raw.get("type"))
        type_counts[node_type] += 1
        node = _clean_node(raw, type_counts[node_type])
        original_id = node["id"]
        suffix = 2
        while node["id"] in seen_ids:
            node["id"] = f"{original_id}_{suffix}"
            suffix += 1
        seen_ids.add(node["id"])
        nodes.append(node)

    if not nodes:
        return None

    node_ids = {n["id"] for n in nodes}
    connections: list[dict[str, str]] = []
    for raw in plan.get("connections", []):
        if not isinstance(raw, dict):
            continue
        src = str(raw.get("from") or "")
        dst = str(raw.get("to") or "")
        if src in node_ids and dst in node_ids and src != dst:
            connections.append({"from": src, "to": dst})

    if not connections and len(nodes) > 1:
        connections = [{"from": nodes[i]["id"], "to": nodes[i + 1]["id"]} for i in range(len(nodes) - 1)]

    source_queries = plan.get("source_queries")
    if not isinstance(source_queries, list):
        source_queries = fallback_queries

    return {
        "nodes": nodes,
        "connections": connections,
        "total_nodes": len(nodes),
        "total_connections": len(connections),
        "source_queries": [str(q) for q in source_queries[:10]],
    }


def _normalize_intent(intent: dict[str, Any], fallback: dict[str, Any], raw_request: str) -> dict[str, Any]:
    def _items(key: str) -> list[dict[str, str]]:
        values = intent.get(key)
        if not isinstance(values, list):
            return fallback.get(key, [])
        cleaned: list[dict[str, str]] = []
        for item in values[:12]:
            if isinstance(item, dict):
                cleaned.append({
                    "keyword": str(item.get("keyword") or item.get("name") or item.get("node") or "")[:50],
                    "node": str(item.get("node") or item.get("name") or item.get("keyword") or "")[:80],
                })
        return cleaned

    data_needs = intent.get("data_needs")
    if not isinstance(data_needs, list):
        data_needs = fallback.get("data_needs", [])

    return {
        "raw_request": raw_request,
        "goal": str(intent.get("goal") or fallback.get("goal") or raw_request[:80])[:160],
        "events": _items("events"),
        "conditions": _items("conditions"),
        "executions": _items("executions"),
        "data_needs": [str(x)[:60] for x in data_needs[:12]],
    }


def _build_messages(
    natural_language_request: str,
    project_context: str | None,
    fallback_intent: dict[str, Any],
    fallback_plan: dict[str, Any],
    knowledge_evidence: list[dict[str, Any]],
) -> list[dict[str, str]]:
    evidence_text = json.dumps(knowledge_evidence[:8], ensure_ascii=False, indent=2)
    fallback_text = json.dumps(
        {"intent_spec": fallback_intent, "nodegraph_plan": fallback_plan},
        ensure_ascii=False,
        indent=2,
    )
    system = (
        "You are a Miliastra/Genshin UGC node graph planner. "
        "Return strict JSON only. Do not write TypeScript."
    )
    user = f"""
把用户自然语言需求转换为节点图规划。只输出 JSON，字段必须是：
{{
  "intent_spec": {{
    "raw_request": "...",
    "goal": "...",
    "events": [{{"keyword": "...", "node": "..."}}],
    "conditions": [{{"keyword": "...", "node": "..."}}],
    "executions": [{{"keyword": "...", "node": "..."}}],
    "data_needs": ["..."]
  }},
  "nodegraph_plan": {{
    "nodes": [
      {{"id": "event_1", "type": "event", "name": "实体创建触发器", "category": "事件节点", "params": {{}}}},
      {{"id": "exec_1", "type": "execution", "name": "打印调试信息", "category": "执行节点", "params": {{}}}}
    ],
    "connections": [{{"from": "event_1", "to": "exec_1"}}],
    "source_queries": ["..."]
  }},
  "implemented_features": ["..."],
  "editor_todo": ["..."],
  "limitations": ["..."],
  "next_steps": ["..."]
}}

要求：
1. 节点 type 只能是 event、condition、execution。
2. 先有 event，再连 condition，再连 execution。
3. 不要发明 genshin-ts 函数名，只写用户可理解的节点名。
4. 如果知识证据不足，在 limitations 中说明需要用官方文档/节点查询确认。
5. 适合普通创作者阅读，尽量把复杂需求拆成小节点。

用户需求：{natural_language_request}
项目上下文：{project_context or ""}

知识库证据：
{evidence_text}

规则 fallback 结果，可作为参考但可以改进：
{fallback_text}
""".strip()
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _call_llm(config: dict[str, Any] | None, messages: list[dict[str, str]]) -> tuple[str | None, dict[str, Any]]:
    try:
        from common.llm_config import resolve_llm_config

        llm = resolve_llm_config(config or {})
    except Exception as exc:
        return None, {"available": False, "message": f"LLM 配置不可用：{exc}"}

    api_key = str(llm.get("api_key", "")).strip()
    base_url = str(llm.get("api_base_url", "")).strip().rstrip("/")
    model = str(llm.get("model", "")).strip()
    if not api_key or not base_url or not model:
        return None, {
            "available": False,
            "message": "LLM 配置缺少 api_key、api_base_url 或 model",
            "model": model,
            "channel_id": llm.get("channel_id"),
        }

    try:
        with httpx.Client(timeout=90.0) as client:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"], {
            "available": True,
            "model": model,
            "channel_id": llm.get("channel_id"),
        }
    except Exception as exc:
        return None, {
            "available": False,
            "message": f"LLM 调用失败：{exc}",
            "model": model,
            "channel_id": llm.get("channel_id"),
        }


def enhance_nodegraph_with_llm(
    natural_language_request: str,
    project_context: str | None,
    fallback_intent: dict[str, Any],
    fallback_plan: dict[str, Any],
    knowledge_evidence: list[dict[str, Any]],
    config: dict[str, Any] | None,
) -> dict[str, Any]:
    messages = _build_messages(
        natural_language_request,
        project_context,
        fallback_intent,
        fallback_plan,
        knowledge_evidence,
    )
    raw, meta = _call_llm(config, messages)
    if not raw:
        return {
            "used": False,
            "available": False,
            "message": meta.get("message", "LLM 不可用"),
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    parsed = _extract_json(raw)
    if not parsed:
        return {
            "used": False,
            "available": True,
            "message": "LLM 输出不是有效 JSON，已回退到规则规划",
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    plan = _normalize_plan(parsed.get("nodegraph_plan") or {}, fallback_plan.get("source_queries", []))
    if not plan:
        return {
            "used": False,
            "available": True,
            "message": "LLM 输出缺少有效节点图，已回退到规则规划",
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    intent = _normalize_intent(parsed.get("intent_spec") or {}, fallback_intent, natural_language_request)
    return {
        "used": True,
        "available": True,
        "message": "LLM 已增强节点图规划",
        "model": meta.get("model"),
        "channel_id": meta.get("channel_id"),
        "intent_spec": intent,
        "nodegraph_plan": plan,
        "implemented_features": parsed.get("implemented_features") if isinstance(parsed.get("implemented_features"), list) else [],
        "editor_todo": parsed.get("editor_todo") if isinstance(parsed.get("editor_todo"), list) else [],
        "limitations": parsed.get("limitations") if isinstance(parsed.get("limitations"), list) else [],
        "next_steps": parsed.get("next_steps") if isinstance(parsed.get("next_steps"), list) else [],
    }


def _normalize_assessment(parsed: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    feasibility = parsed.get("feasibility")
    if feasibility not in ("ready", "partial", "needs_docs", "not_supported"):
        feasibility = fallback.get("feasibility", "needs_docs")

    difficulty = parsed.get("difficulty")
    if difficulty not in ("easy", "medium", "hard", "expert"):
        difficulty = fallback.get("difficulty", "medium")

    def _list(key: str) -> list[str]:
        value = parsed.get(key)
        if isinstance(value, list):
            return [str(x)[:240] for x in value[:12]]
        return [str(x)[:240] for x in fallback.get(key, [])[:12]]

    confidence = parsed.get("confidence", fallback.get("confidence", 0.35))
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = fallback.get("confidence", 0.35)

    can_generate = parsed.get("can_generate")
    if not isinstance(can_generate, bool):
        can_generate = feasibility != "not_supported"

    normalized = dict(fallback)
    normalized.update({
        "summary": str(parsed.get("summary") or fallback.get("summary", ""))[:300],
        "feasibility": feasibility,
        "difficulty": difficulty,
        "confidence": confidence,
        "can_generate": can_generate,
        "reasoning": _list("reasoning"),
        "supported_features": _list("supported_features"),
        "uncertain_features": _list("uncertain_features"),
        "blocked_features": _list("blocked_features"),
        "required_official_docs": _list("required_official_docs"),
        "next_questions": _list("next_questions"),
        "next_steps": _list("next_steps"),
        "recommended_generation_mode": str(
            parsed.get("recommended_generation_mode")
            or fallback.get("recommended_generation_mode", "生成可编译骨架，然后人工补参数")
        )[:160],
    })
    return normalized


def assess_feasibility_with_llm(
    natural_language_request: str,
    project_context: str | None,
    fallback_assessment: dict[str, Any],
    knowledge_evidence: list[dict[str, Any]],
    config: dict[str, Any] | None,
) -> dict[str, Any]:
    evidence_text = json.dumps(knowledge_evidence[:8], ensure_ascii=False, indent=2)
    fallback_text = json.dumps(fallback_assessment, ensure_ascii=False, indent=2)
    messages = [
        {
            "role": "system",
            "content": (
                "You assess whether a Miliastra/Genshin UGC node graph can be generated. "
                "Use only official-document evidence and known genshin-ts limitations. "
                "Return strict JSON only."
            ),
        },
        {
            "role": "user",
            "content": f"""
请先评估，不要生成节点图代码。输出 JSON：
{{
  "summary": "一句话说明能否做",
  "feasibility": "ready | partial | needs_docs | not_supported",
  "difficulty": "easy | medium | hard | expert",
  "confidence": 0.0,
  "can_generate": true,
  "reasoning": ["为什么这样判断"],
  "supported_features": ["官方文档/现有技术能支持的部分"],
  "uncertain_features": ["需要查官方文档或参数的部分"],
  "blocked_features": ["当前技术无法自动完成的部分"],
  "required_official_docs": ["需要继续核对的官方文档/节点"],
  "next_questions": ["生成前最好问用户的问题"],
  "next_steps": ["建议用户下一步做什么"],
  "recommended_generation_mode": "建议生成方式"
}}

判断规则：
1. 不能只说能做，必须指出证据不足和技术风险。
2. 如果知识证据是 fallback 或缺少官方文档，feasibility 至少应为 needs_docs。
3. 如果只能生成骨架，feasibility 用 partial 或 needs_docs。
4. 如果涉及无法确认的奖励、背包、联机同步、复杂 UI、复杂 AI 行为，要标为风险或阻塞。
5. 面向普通创作者，用直白中文。

用户需求：{natural_language_request}
项目上下文：{project_context or ""}

知识证据：
{evidence_text}

规则评估参考：
{fallback_text}
""".strip(),
        },
    ]
    raw, meta = _call_llm(config, messages)
    if not raw:
        return {
            "used": False,
            "available": False,
            "message": meta.get("message", "LLM 不可用"),
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    parsed = _extract_json(raw)
    if not parsed:
        return {
            "used": False,
            "available": True,
            "message": "LLM 评估输出不是有效 JSON，已使用规则评估",
            "model": meta.get("model"),
            "channel_id": meta.get("channel_id"),
        }

    return {
        "used": True,
        "available": True,
        "message": "LLM 已完成可行性评估",
        "model": meta.get("model"),
        "channel_id": meta.get("channel_id"),
        "assessment": _normalize_assessment(parsed, fallback_assessment),
    }
