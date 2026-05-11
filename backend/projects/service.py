"""Projects 业务逻辑层

- create_project: 创建 UGC 项目，存储为 JSON
- generate_nodegraph: NL → Intent Spec → Knowledge Grounding → NodeGraph Plan → TS 生成
- get_project / list_projects: 读取项目数据
"""

import json
import uuid
import re
import shutil
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

from .models import (
    ProjectResponse,
    ProjectListItem,
    NodeGraphResult,
    _now_iso,
)

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects_data"
BEIJING_TZ = timezone(timedelta(hours=8))


def _project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def _metadata_path(project_id: str) -> Path:
    return _project_dir(project_id) / "metadata.json"


def _generated_ts_path(project_id: str) -> Path:
    return _project_dir(project_id) / "generated.ts"


def _read_project(project_id: str) -> dict:
    path = _metadata_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"项目 {project_id} 不存在")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_project(project_id: str, data: dict) -> None:
    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    _metadata_path(project_id).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_generated_ts(project_id: str, ts_code: str) -> Path:
    _project_dir(project_id).mkdir(parents=True, exist_ok=True)
    path = _generated_ts_path(project_id)
    path.write_text(ts_code, encoding="utf-8")
    return path


# ── 意图识别 ─────────────────────────────────────────────

def _parse_intent(nl_request: str, project_context: Optional[str] = None) -> dict:
    """将自然语言需求解析为结构化意图。

    使用规则 + 关键词提取，不依赖 LLM（提供确定性输出）。
    """
    text = nl_request + (" " + project_context if project_context else "")

    intent = {
        "raw_request": nl_request,
        "goal": "",
        "events": [],
        "conditions": [],
        "executions": [],
        "data_needs": [],
    }

    # 事件关键词
    event_keywords = {
        "死亡": "死亡触发器",
        "击败": "死亡触发器",
        "击杀": "死亡触发器",
        "被消灭": "死亡触发器",
        "触发": "触发器",
        "碰撞": "碰撞触发器",
        "进入区域": "区域触发器",
        "计时": "计时触发器",
        "交互": "交互触发器",
        "受到攻击": "受击触发器",
        "使用技能": "技能触发器",
        "创建": "实体创建触发器",
        "销毁": "实体销毁触发器",
    }

    # 执行关键词
    execution_keywords = {
        "播放特效": "播放特效",
        "播放音效": "播放音效",
        "创建实体": "创建实体",
        "销毁实体": "销毁实体",
        "移动": "移动实体",
        "旋转": "旋转实体",
        "修改属性": "修改属性",
        "添加buff": "添加Buff",
        "移除buff": "移除Buff",
        "发送消息": "发送消息",
        "显示提示": "打印调试信息",
        "提示": "打印调试信息",
        "打印": "打印调试信息",
        "日志": "打印调试信息",
        "调试": "打印调试信息",
        "播放动画": "播放动画",
        "显示UI": "显示UI",
        "隐藏UI": "隐藏UI",
        "传送": "传送实体",
        "攻击": "造成伤害",
        "掉落": "掉落物",
        "奖励": "奖励",
        "变量": "设置变量",
        "条件": "条件分支",
        "随机": "随机数",
    }

    # 条件关键词
    condition_keywords = {
        "数量": "数值比较",
        "距离": "距离计算",
        "属性": "属性检测",
        "状态": "状态检测",
        "生命值": "生命值检测",
        "变量值": "变量检测",
        "随机": "随机判断",
    }

    for kw, node_name in event_keywords.items():
        if kw in text:
            intent["events"].append({"keyword": kw, "node": node_name})

    for kw, node_name in execution_keywords.items():
        if kw in text:
            intent["executions"].append({"keyword": kw, "node": node_name})

    for kw, node_name in condition_keywords.items():
        if kw in text:
            intent["conditions"].append({"keyword": kw, "node": node_name})

    for key in ("events", "conditions", "executions"):
        deduped = []
        seen_nodes: set[str] = set()
        for item in intent[key]:
            node = item["node"]
            if node in seen_nodes:
                continue
            seen_nodes.add(node)
            deduped.append(item)
        intent[key] = deduped

    # 提取数据需求
    data_patterns = [
        (r"(变量|属性|血量|生命值|攻击力|防御力|速度)", "属性数据"),
        (r"(实体|怪物|角色|NPC|玩家)", "实体引用"),
        (r"(数量|个数|次数)", "计数"),
        (r"(位置|坐标|方向)", "位置数据"),
    ]
    for pattern, data_type in data_patterns:
        if re.search(pattern, text):
            if data_type not in intent["data_needs"]:
                intent["data_needs"].append(data_type)

    # 推断目标
    if intent["events"] and intent["executions"]:
        event_names = [e["node"] for e in intent["events"][:2]]
        exec_names = [e["node"] for e in intent["executions"][:3]]
        intent["goal"] = f"当 {', '.join(event_names)} 时，执行 {', '.join(exec_names)}"
    elif intent["executions"]:
        intent["goal"] = f"实现 {intent['executions'][0]['node']}"
    else:
        intent["goal"] = nl_request[:80]

    return intent


# ── 知识锚定 ────────────────────────────────────────────

def _ground_knowledge(intent: dict) -> tuple[list[str], list[dict], bool]:
    """查询 skill.service 获取知识证据，失败时回退到关键词模式。

    Returns (queries, evidence, import_ok).
    当 skill.service 无法导入时，import_ok=False 且 evidence 仅含 fallback 条目。
    """
    node_names: list[str] = []
    for ev in intent.get("events", []):
        node_names.append(ev["node"])
    for exe in intent.get("executions", []):
        node_names.append(exe["node"])
    for cond in intent.get("conditions", []):
        node_names.append(cond["node"])

    doc_keywords: list[str] = []
    for ev in intent.get("events", []):
        doc_keywords.append(ev["keyword"])
    for exe in intent.get("executions", []):
        doc_keywords.append(exe["keyword"])
    for cond in intent.get("conditions", []):
        doc_keywords.append(cond["keyword"])
    for data in intent.get("data_needs", []):
        doc_keywords.append(data)

    seen: set[str] = set()
    queries: list[str] = []
    for q in node_names + doc_keywords:
        if q not in seen:
            seen.add(q)
            queries.append(q)
    queries = queries[:10]

    evidence: list[dict] = []

    # 尝试导入 skill.service — chromadb 等依赖可能缺失
    try:
        from skill.service import get_node_info_data, get_document_data, rag_search_data
    except Exception:
        evidence.append({
            "query": ", ".join(queries[:5]) if queries else "无",
            "source_type": "fallback",
            "title": "技能云不可用",
            "content_preview": "skill.service 导入失败（缺少 chromadb 等依赖），节点名称基于关键词规则匹配，未经过知识库验证。请运行 pip install chromadb 后重试以启用知识锚定。",
        })
        return queries, evidence, False

    try:
        if node_names:
            node_results = get_node_info_data(node_names[:5])
            for nr in node_results:
                for match in nr.get("matches", [])[:3]:
                    content = match.get("content", "")
                    evidence.append({
                        "query": nr["query"],
                        "source_type": "node_info",
                        "source_doc_title": match.get("source_doc_title", ""),
                        "local_path": match.get("local_path", ""),
                        "title": match.get("title", ""),
                        "content_preview": content[:300] + ("..." if len(content) > 300 else ""),
                    })
    except Exception:
        pass

    try:
        if doc_keywords:
            doc_results = get_document_data(doc_keywords[:3])
            for dr in doc_results:
                for doc in dr.get("documents", [])[:2]:
                    content = doc.get("content", "")
                    evidence.append({
                        "query": dr["query"],
                        "source_type": "document",
                        "title": doc.get("title", ""),
                        "file": doc.get("file", ""),
                        "content_preview": content[:300] + ("..." if len(content) > 300 else ""),
                    })
    except Exception:
        pass

    try:
        if queries:
            rag_results = rag_search_data(queries, top_k=3)
            if isinstance(rag_results, list):
                for rr in rag_results:
                    for item in rr.get("results", [])[:2]:
                        evidence.append({
                            "query": rr["query"],
                            "source_type": "rag",
                            "title": item.get("title", ""),
                            "file_name": item.get("file_name", ""),
                            "similarity": item.get("similarity", 0),
                            "content_preview": item.get("text_snippet", ""),
                        })
    except Exception:
        pass

    return queries, evidence, True


# ── 节点图方案 ──────────────────────────────────────────

def _build_nodegraph_plan(intent: dict, knowledge_queries: list[str]) -> dict:
    """基于意图和知识查询结果构建节点图方案。"""
    events = intent.get("events", [])
    executions = intent.get("executions", [])
    conditions = intent.get("conditions", [])

    nodes = []

    # 事件节点
    for i, ev in enumerate(events):
        nodes.append({
            "id": f"event_{i+1}",
            "type": "event",
            "name": ev["node"],
            "category": "事件节点",
            "params": {},
        })

    # 条件节点
    for i, cond in enumerate(conditions):
        nodes.append({
            "id": f"cond_{i+1}",
            "type": "condition",
            "name": cond["node"],
            "category": "流程控制节点",
            "params": {},
        })

    # 执行节点
    for i, exe in enumerate(executions):
        nodes.append({
            "id": f"exec_{i+1}",
            "type": "execution",
            "name": exe["node"],
            "category": "执行节点",
            "params": {},
        })

    # 连接关系
    if not nodes:
        nodes.extend([
            {
                "id": "event_1",
                "type": "event",
                "name": "实体创建触发器",
                "category": "事件节点",
                "params": {},
            },
            {
                "id": "exec_1",
                "type": "execution",
                "name": "打印调试信息",
                "category": "执行节点",
                "params": {},
            },
        ])

    connections = []
    prev_id = None
    for node in nodes:
        if prev_id:
            connections.append({"from": prev_id, "to": node["id"]})
        prev_id = node["id"]

    return {
        "nodes": nodes,
        "connections": connections,
        "total_nodes": len(nodes),
        "total_connections": len(connections),
        "source_queries": knowledge_queries,
    }


# ── TS 代码生成 ─────────────────────────────────────────

# 节点名 → genshin-ts runtime API 映射表
_EVENT_API_MAP: dict[str, str] = {
    "死亡触发器": "whenEntityIsKilled",
    "碰撞触发器": "whenEntityCollision",
    "区域触发器": "whenEntityEntersRegion",
    "计时触发器": "whenTimerExpires",
    "交互触发器": "whenEntityInteracted",
    "受击触发器": "whenEntityIsHit",
    "技能触发器": "whenEntitySkillTriggered",
    "实体创建触发器": "whenEntityIsCreated",
    "实体销毁触发器": "whenEntityIsDestroyed",
}

# 节点名 → genshin-ts runtime f API 映射表。
#
# 保守原则：只有在本项目模板/文档中明确确认可用的 f 方法才写入映射。
# 其它执行节点一律降级为 TODO 注释，避免生成 f.giveReward 这类不存在的 API。
_EXEC_API_MAP: dict[str, str] = {
    "打印": "printString",
    "调试": "printString",
    "日志": "printString",
}


def _resolve_event_api(node_name: str) -> str:
    for kw, api in _EVENT_API_MAP.items():
        if kw in node_name:
            return api
    return f"// TODO: 需要通过 get_node_info 查询「{node_name}」的事件名"


def _resolve_exec_api(node_name: str) -> str:
    for kw, api in _EXEC_API_MAP.items():
        if kw in node_name:
            return api
    return f"// TODO: 需要通过 get_node_info 查询「{node_name}」的 API 签名"


def _build_single_event_handler(event: dict, subsequent_nodes: list[dict]) -> list[str]:
    """为一个事件节点生成 .on() handler 代码块。

    所有执行/条件调用均生成为 // TODO 注释骨架，不生成可执行代码。
    原因：genshin-ts f API 参数复杂（通常 5-9 个），空 {} 调用必然类型错误，
    注释骨架 + 正确 API 名比虚假的可执行代码更有价值。
    """
    api_name = _resolve_event_api(event["name"])
    lines: list[str] = []
    lines.append(f"  // 事件: {event['name']}")
    lines.append(f".on('{api_name}', (_evt, f) => {{")
    emitted_executable_node = False

    for node in subsequent_nodes:
        node_name = node["name"]
        node_type = node["type"]

        if node_type == "condition":
            cond_api = _resolve_exec_api(node_name)
            lines.append(f"    // 条件: {node_name}")
            lines.append(f"    // TODO: 通过 get_document / get_node_info 查询条件参数后替换为:")
            if cond_api.startswith("// TODO"):
                lines.append(f"    {cond_api}")
            else:
                lines.append(f"    // f.{cond_api}(")
                lines.append(f"    //   /* conditionExpression */,")
                lines.append(f"    //   () => {{ /* 条件为真时的执行分支 */ }}")
                lines.append(f"    // )(() => {{")
                lines.append(f"    //   /* 条件为假时的执行分支 */")
                lines.append(f"    // }})")

        elif node_type == "execution":
            exec_api = _resolve_exec_api(node_name)
            lines.append(f"    // 执行: {node_name}")
            if exec_api.startswith("// TODO"):
                lines.append(f"    {exec_api}")
            elif exec_api == "printString":
                lines.append(f"    f.printString('AI TODO: {node_name} 触发，请补全真实节点参数')")
                emitted_executable_node = True
            else:
                lines.append(f"    // TODO: 通过 get_node_info(['{node_name}']) 查询参数表后补全并取消注释")
                lines.append(f"    // f.{exec_api}({{")
                lines.append(f"    //   /* 参数请参考 get_node_info(['{node_name}']) 的返回结果 */")
                lines.append(f"    // }})")

    if not emitted_executable_node:
        lines.append("    // 编译占位：确保 generated.ts 能生成至少一个节点，后续请替换为真实逻辑")
        lines.append(f"    f.printString('AI TODO: {event['name']} 已触发，请补全节点图逻辑')")

    lines.append("})")
    return lines


def _generate_ts_code(plan: dict) -> str:
    """将节点图方案转换为 genshin-ts runtime DSL 代码。

    生成的代码使用 g.server({...}).on(...).on(...) 链式调用模式，
    所有不确定的参数和 API 签名均以 // TODO 标注。
    """
    nodes = plan.get("nodes", [])
    connections = plan.get("connections", [])

    # 构建邻接表: node_id → [target_node]
    graph: dict[str, list[str]] = {}
    for conn in connections:
        src = conn["from"]
        dst = conn["to"]
        graph.setdefault(src, []).append(dst)

    # 建立 id → node 索引
    node_by_id: dict[str, dict] = {n["id"]: n for n in nodes}

    lines = [
        "// ═══════════════════════════════════════════════════",
        "//  千星沙箱节点图 - AI 生成方案",
        "//  运行时: genshin-ts/runtime/core",
        "// ═══════════════════════════════════════════════════",
        "",
        "import { g } from 'genshin-ts/runtime/core'",
        "",
        "g.server({",
        "  id: 0,  // TODO: 替换为实际图 ID",
        "})",
    ]

    # 收集事件节点及其后续节点链
    event_nodes = [n for n in nodes if n["type"] == "event"]

    if not event_nodes:
        exec_nodes = [n for n in nodes if n["type"] == "execution"]
        lines.append("")
        lines.append("// ── 无事件触发（直接执行）───────────────────────────")
        lines.append("// 注意：以下节点缺少事件触发源，请补充事件节点")
        for node in exec_nodes:
            exec_api = _resolve_exec_api(node["name"])
            if exec_api.startswith("// TODO"):
                lines.append(f"{exec_api}")
            else:
                lines.append(f"// f.{exec_api}({{ /* TODO: 参数 */ }})")
        return "\n".join(lines)

    # 遍历事件节点，生成 .on() handler
    for ev in event_nodes:
        # BFS/DFS 收集事件后的所有可达节点
        visited: set[str] = set()
        queue: list[str] = [ev["id"]]
        ordered_nodes: list[dict] = []

        while queue:
            nid = queue.pop(0)
            if nid in visited:
                continue
            visited.add(nid)
            node = node_by_id.get(nid)
            if node and node["id"] != ev["id"]:
                ordered_nodes.append(node)
            for next_id in graph.get(nid, []):
                if next_id not in visited:
                    queue.append(next_id)

        handler_lines = _build_single_event_handler(ev, ordered_nodes)
        # 在最后一个 .on() 之前插入
        lines.append("")
        lines.extend(handler_lines)

    lines.append("")
    return "\n".join(lines)


# ── 服务入口 ────────────────────────────────────────────

def _build_rule_assessment(
    project_id: str,
    natural_language_request: str,
    intent: dict,
    plan: dict,
    knowledge_evidence: list[dict],
    skill_import_ok: bool,
) -> dict:
    text = natural_language_request.lower()
    risky_keywords = {
        "联机": "联机/多人同步能力需要官方运行时确认",
        "多人": "多人同步能力需要官方运行时确认",
        "背包": "背包或物品系统通常涉及受限接口",
        "奖励": "奖励发放需要确认真实节点和参数",
        "掉落": "掉落物生成需要确认资源 ID 和节点参数",
        "ui": "复杂 UI 需要确认 UGC 编辑器暴露的 UI 节点",
        "寻路": "复杂寻路/AI 行为通常难以一次自动生成",
        "ai": "复杂 AI 行为需要拆成多轮节点验证",
        "数据库": "持久化/数据库能力通常不属于节点图自动生成范围",
    }
    uncertain_features = [msg for kw, msg in risky_keywords.items() if kw in text or kw.upper() in natural_language_request]

    nodes = plan.get("nodes", [])
    events = [n["name"] for n in nodes if n.get("type") == "event"]
    conditions = [n["name"] for n in nodes if n.get("type") == "condition"]
    executions = [n["name"] for n in nodes if n.get("type") == "execution"]
    supported_features = []
    if events:
        supported_features.append(f"可先生成事件入口：{', '.join(events[:4])}")
    if conditions:
        supported_features.append(f"可拆出条件判断：{', '.join(conditions[:4])}")
    if executions:
        supported_features.append(f"可生成执行动作骨架：{', '.join(executions[:4])}")
    if not supported_features:
        supported_features.append("可生成一个安全的事件触发 + 调试输出骨架，作为继续编辑的起点")

    blocked_features: list[str] = []
    if "真实货币" in natural_language_request or "充值" in natural_language_request:
        blocked_features.append("涉及真实货币/充值的能力不应由 UGC 节点图自动生成")

    node_count = int(plan.get("total_nodes", len(nodes)))
    complexity = node_count + len(conditions) * 2 + len(intent.get("data_needs", [])) + len(uncertain_features) * 2
    if complexity <= 3:
        difficulty = "easy"
    elif complexity <= 7:
        difficulty = "medium"
    elif complexity <= 12:
        difficulty = "hard"
    else:
        difficulty = "expert"

    if blocked_features:
        feasibility = "not_supported"
        confidence = 0.2
    elif not skill_import_ok or any(e.get("source_type") == "fallback" for e in knowledge_evidence):
        feasibility = "needs_docs"
        confidence = 0.35
    elif uncertain_features:
        feasibility = "partial"
        confidence = 0.55
    else:
        feasibility = "ready"
        confidence = 0.72

    required_docs = list(dict.fromkeys(
        [q for q in plan.get("source_queries", []) if q]
        + [n["name"] for n in nodes[:8]]
    ))[:10]
    if not required_docs:
        required_docs = ["事件触发器", "执行节点参数", "genshin-ts runtime 示例"]

    reasoning = [
        "已先按规则识别事件、条件和执行节点，并查询可用知识证据。",
        "生成阶段只会产出保守 TypeScript 骨架，未确认的官方节点 API 会保留 TODO。",
    ]
    if not skill_import_ok:
        reasoning.append("当前官方文档/节点知识库未成功加载，所以不能把结果标记为完全可完成。")
    if uncertain_features:
        reasoning.append("需求中包含需要官方参数或编辑器能力确认的部分，建议先生成骨架再逐项补全。")

    can_generate = feasibility in ("ready", "partial", "needs_docs")
    return {
        "project_id": project_id,
        "summary": {
            "ready": "可以生成初版节点图，仍建议编译验证。",
            "partial": "可以生成核心骨架，但部分功能需要查官方文档补参数。",
            "needs_docs": "可以生成安全骨架，但当前证据不足，必须后续核对官方文档。",
            "not_supported": "当前不建议自动生成，需要先调整需求范围。",
        }[feasibility],
        "feasibility": feasibility,
        "difficulty": difficulty,
        "confidence": confidence,
        "can_generate": can_generate,
        "should_generate_directly": False,
        "reasoning": reasoning,
        "supported_features": supported_features,
        "uncertain_features": uncertain_features or ["具体节点参数、资源 ID、触发对象需要用户确认"],
        "blocked_features": blocked_features,
        "required_official_docs": required_docs,
        "recommended_generation_mode": "先生成可编译骨架，再用编译/AI 修复/官方文档逐项补全",
        "estimated_nodes": node_count,
        "estimated_connections": int(plan.get("total_connections", 0)),
        "knowledge_status": "official_docs_available" if skill_import_ok else "docs_unavailable_fallback",
        "knowledge_evidence": knowledge_evidence[:8],
        "next_questions": [
            "触发对象是谁：玩家、怪物、区域，还是指定实体？",
            "需要用到哪些资源 ID：奖励、特效、音效、实体或 UI？",
            "失败或条件不满足时要不要有备用流程？",
        ],
        "next_steps": [
            "确认评估结果和风险后再生成节点图。",
            "生成后先编译，能编译再逐项补真实参数。",
            "对不确定节点使用官方文档或 get_node_info 继续确认。",
        ],
        "intent_spec": intent,
        "nodegraph_plan_preview": plan,
        "llm_meta": {
            "used": False,
            "available": False,
            "message": "规则评估",
        },
    }


def assess_nodegraph_request(
    project_id: str,
    natural_language_request: str,
    project_context: Optional[str] = None,
    config: Optional[dict] = None,
) -> dict:
    project = _read_project(project_id)
    intent = _parse_intent(natural_language_request, project_context)
    knowledge_queries, knowledge_evidence, skill_import_ok = _ground_knowledge(intent)
    plan = _build_nodegraph_plan(intent, knowledge_queries)
    assessment = _build_rule_assessment(
        project_id,
        natural_language_request,
        intent,
        plan,
        knowledge_evidence,
        skill_import_ok,
    )

    if config:
        try:
            from .llm_generate import assess_feasibility_with_llm

            llm_result = assess_feasibility_with_llm(
                natural_language_request=natural_language_request,
                project_context=project_context,
                fallback_assessment=assessment,
                knowledge_evidence=knowledge_evidence,
                config=config,
            )
            assessment["llm_meta"] = {
                "used": bool(llm_result.get("used")),
                "available": bool(llm_result.get("available")),
                "message": llm_result.get("message", ""),
                "model": llm_result.get("model"),
                "channel_id": llm_result.get("channel_id"),
            }
            if llm_result.get("used") and isinstance(llm_result.get("assessment"), dict):
                llm_assessment = llm_result["assessment"]
                llm_assessment["project_id"] = project_id
                llm_assessment["knowledge_evidence"] = knowledge_evidence[:8]
                llm_assessment["intent_spec"] = intent
                llm_assessment["nodegraph_plan_preview"] = plan
                llm_assessment["should_generate_directly"] = False
                llm_assessment["llm_meta"] = assessment["llm_meta"]
                assessment = llm_assessment
        except Exception as exc:
            assessment["llm_meta"] = {
                "used": False,
                "available": False,
                "message": f"LLM 评估失败，已使用规则评估：{exc}",
            }
            assessment["reasoning"] = [assessment["llm_meta"]["message"]] + assessment.get("reasoning", [])

    project["last_assessment"] = assessment
    project["memory_summary"] = (
        f"最近一次需求评估：{assessment['summary']} "
        f"难度={assessment['difficulty']}，可行性={assessment['feasibility']}。"
    )
    _write_project(project_id, project)
    return assessment


def create_project(name: str, description: str) -> ProjectResponse:
    project_id = uuid.uuid4().hex[:12]
    now = _now_iso()

    data = {
        "project_id": project_id,
        "name": name,
        "description": description,
        "created_at": now,
        "status": "created",
        "memory_summary": f"项目「{name}」已创建，等待生成节点图。",
        "last_assessment": None,
        "nodegraph": None,
    }
    _write_project(project_id, data)

    return ProjectResponse(**data)


def generate_nodegraph(
    project_id: str,
    natural_language_request: str,
    project_context: Optional[str] = None,
    config: Optional[dict] = None,
) -> ProjectResponse:
    project = _read_project(project_id)

    # Step 1: 意图识别
    intent = _parse_intent(natural_language_request, project_context)

    # Step 2: 知识锚定
    knowledge_queries, knowledge_evidence, skill_import_ok = _ground_knowledge(intent)

    # Step 3: 节点图方案
    plan = _build_nodegraph_plan(intent, knowledge_queries)

    # Step 4: TS 代码生成
    llm_generation_result: dict = {}
    generation_meta = {
        "engine": "rules",
        "llm_available": False,
        "llm_used": False,
        "llm_message": "",
    }
    if config:
        try:
            from .llm_generate import enhance_nodegraph_with_llm

            llm_generation_result = enhance_nodegraph_with_llm(
                natural_language_request=natural_language_request,
                project_context=project_context,
                fallback_intent=intent,
                fallback_plan=plan,
                knowledge_evidence=knowledge_evidence,
                config=config,
            )
            generation_meta = {
                "engine": "llm+rules" if llm_generation_result.get("used") else "rules",
                "llm_available": bool(llm_generation_result.get("available")),
                "llm_used": bool(llm_generation_result.get("used")),
                "llm_message": llm_generation_result.get("message", ""),
                "llm_model": llm_generation_result.get("model"),
                "llm_channel_id": llm_generation_result.get("channel_id"),
            }
            if llm_generation_result.get("used"):
                intent = llm_generation_result.get("intent_spec", intent)
                plan = llm_generation_result.get("nodegraph_plan", plan)
        except Exception as exc:
            generation_meta["llm_message"] = f"LLM 增强失败，已回退到规则规划：{exc}"

    ts_code = _generate_ts_code(plan)

    # Step 5: 写入 artifacts
    ts_path = _write_generated_ts(project_id, ts_code)
    artifacts = {
        "generated_ts_path": str(ts_path.relative_to(PROJECTS_DIR.parent)),
        "compile_status": "not_integrated",
        "generation_meta": generation_meta,
    }

    # Step 6: 整理输出
    nodegraph = NodeGraphResult(
        intent_spec=intent,
        knowledge_queries=knowledge_queries,
        knowledge_evidence=knowledge_evidence,
        nodegraph_plan=plan,
        generated_ts=ts_code,
        artifacts=artifacts,
        editor_todo=[
            f"在编辑器中创建事件节点: {n['name']}" for n in plan["nodes"] if n["type"] == "event"
        ] + [
            f"添加执行节点: {n['name']}" for n in plan["nodes"] if n["type"] == "execution"
        ] + [
            f"配置条件节点: {n['name']}" for n in plan["nodes"] if n["type"] == "condition"
        ] + [
            "按 connections 连线所有节点",
            "配置各节点的参数（参考官方文档）",
            "测试触发流程是否按预期执行",
        ],
        implemented_features=[
            f"✓ 事件监听: {', '.join(n['name'] for n in plan['nodes'] if n['type'] == 'event') or '待补充'}",
            f"✓ 执行动作: {', '.join(n['name'] for n in plan['nodes'] if n['type'] == 'execution') or '待补充'}",
            f"✓ 条件判断: {', '.join(n['name'] for n in plan['nodes'] if n['type'] == 'condition') or '无需条件'}",
            f"✓ 节点图结构: {plan['total_nodes']} 个节点, {plan['total_connections']} 条连线",
        ],
        limitations=([
            "生成的 TS 代码为骨架，参数需根据实际需求手动填写",
            "未确认执行节点已保守降级为 TODO 注释，避免生成不存在的 genshin-ts API",
            "事件处理器会生成一条 printString 编译占位日志，后续应替换为真实节点逻辑",
            "节点名称基于规则匹配，可能有偏差，请以 get_node_info 查询结果为准",
            "复杂逻辑（循环、嵌套条件、动态变量）需人工补充",
        ] + ([
            "skill.service 未成功加载（缺少 chromadb 等依赖），知识证据仅基于关键词匹配，节点名和 API 签名未经知识库校验",
        ] if not skill_import_ok else [])),
        next_steps=[
            "使用「工具调用」页面通过 get_node_info 验证节点名和参数",
            "参考知识库问答获取各节点的详细配置说明",
            "将生成的 TS 代码导入千星沙箱编辑器测试",
            "根据实际测试结果迭代调整节点图方案",
        ],
    )

    if llm_generation_result.get("used"):
        if llm_generation_result.get("editor_todo"):
            nodegraph.editor_todo = [str(x) for x in llm_generation_result.get("editor_todo", [])[:12]]
        if llm_generation_result.get("implemented_features"):
            nodegraph.implemented_features = [str(x) for x in llm_generation_result.get("implemented_features", [])[:12]]
        if llm_generation_result.get("limitations"):
            nodegraph.limitations = [str(x) for x in llm_generation_result.get("limitations", [])[:12]] + nodegraph.limitations
        if llm_generation_result.get("next_steps"):
            nodegraph.next_steps = [str(x) for x in llm_generation_result.get("next_steps", [])[:12]]
    elif generation_meta.get("llm_message"):
        nodegraph.limitations = [generation_meta["llm_message"]] + nodegraph.limitations

    project["status"] = "nodegraph_generated"
    project["memory_summary"] = (
        f"已为项目「{project['name']}」生成节点图方案: "
        f"{plan['total_nodes']} 个节点, {plan['total_connections']} 条连线。"
        f"涉及事件: {', '.join(n['name'] for n in plan['nodes'] if n['type'] == 'event') or '无'}。"
        f"涉及执行: {', '.join(n['name'] for n in plan['nodes'] if n['type'] == 'execution') or '无'}。"
    )
    project["nodegraph"] = nodegraph.model_dump()
    _write_project(project_id, project)

    return ProjectResponse(**project)


def get_project(project_id: str) -> ProjectResponse:
    project = _read_project(project_id)
    return ProjectResponse(**project)


def list_projects() -> list[ProjectListItem]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for d in sorted(PROJECTS_DIR.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        meta_path = d / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            items.append(ProjectListItem(
                project_id=data["project_id"],
                name=data["name"],
                description=data.get("description", ""),
                created_at=data.get("created_at", ""),
                status=data.get("status", "unknown"),
            ))
        except (json.JSONDecodeError, KeyError):
            continue
    return items


def delete_project(project_id: str) -> bool:
    d = _project_dir(project_id)
    if d.exists() and d.is_dir():
        shutil.rmtree(d)
        return True
    return False


def get_artifact_ts(project_id: str) -> str:
    path = _generated_ts_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"项目 {project_id} 的 generated.ts 不存在")
    return path.read_text(encoding="utf-8")


def get_artifact_metadata(project_id: str) -> dict:
    return _read_project(project_id)


def _resolve_project_artifact_path(project_id: str, artifact_key: str) -> Path:
    project = _read_project(project_id)
    artifacts = (project.get("nodegraph") or {}).get("artifacts") or {}
    rel_path = artifacts.get(artifact_key, "")
    if not rel_path:
        raise FileNotFoundError(f"项目 {project_id} 缺少 {artifact_key}")

    backend_dir = PROJECTS_DIR.parent.resolve()
    path = (backend_dir / rel_path).resolve()
    if backend_dir not in path.parents and path != backend_dir:
        raise FileNotFoundError(f"项目 {project_id} 的 {artifact_key} 路径非法")
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"项目 {project_id} 的 {artifact_key} 文件不存在")
    return path


def get_artifact_ir_json(project_id: str) -> str:
    path = _resolve_project_artifact_path(project_id, "compiled_json_path")
    return path.read_text(encoding="utf-8")


def get_artifact_gia_path(project_id: str) -> Path:
    return _resolve_project_artifact_path(project_id, "compiled_gia_path")


def validate_plan(project_id: str) -> dict:
    try:
        ts_code = get_artifact_ts(project_id)
    except FileNotFoundError:
        return {
            "project_id": project_id,
            "compile_status": "not_integrated",
            "total_warnings": 0,
            "warnings": [],
            "suggestions": ["请先生成节点图"],
        }

    warnings: list[dict] = []
    suggestions: list[str] = []

    lines = ts_code.split("\n")
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("// TODO"):
            warnings.append({
                "line": i,
                "message": stripped.lstrip("/ ").strip(),
                "severity": "warning",
            })

    todo_count = len(warnings)
    if todo_count == 0:
        suggestions.append("所有 TODO 已处理，可以尝试编译")
    elif todo_count <= 5:
        suggestions.append(f"还有 {todo_count} 个 TODO 待处理，建议逐个完善参数后重新验证")
    else:
        suggestions.append(f"还有 {todo_count} 个 TODO 待处理，建议优先处理事件名和 API 签名相关的 TODO")

    suggestions.append("在「工具调用」页面使用 get_node_info 查询节点参数")
    suggestions.append("将 TS 代码导入千星沙箱编辑器测试实际运行效果")

    return {
        "project_id": project_id,
        "compile_status": "not_integrated",
        "total_warnings": todo_count,
        "warnings": warnings,
        "suggestions": suggestions,
    }
