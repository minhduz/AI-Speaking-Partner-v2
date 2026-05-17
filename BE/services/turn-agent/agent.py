from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from nodes.stt_node import stt_node
from nodes.build_prompt_node import build_prompt_node
from nodes.session_history_node import session_history_node
from nodes.llm_tts_node import llm_tts_node
from nodes.persist_node import persist_node


class TurnState(TypedDict):
    # Inputs (set before graph runs)
    session_id: str
    user_id: str
    audio_bytes: bytes
    audio_mimetype: str
    user_name: str
    user_level: str
    target_language: str
    native_language: str
    learning_goal: str
    current_datetime: str
    turn_index: int
    is_onboarding: bool
    active_mission: str
    voice_id: str
    speech_rate: float
    conversation_style: str
    # Intermediates (populated by nodes)
    transcript: str
    confidence: float
    pronunciation: dict
    system_prompt: str
    # Session context (populated by session_history_node)
    recent_messages: list        # last WINDOW raw messages for this session
    conversation_summary: str    # rolling summary of older messages
    full_response: str
    tokens_used: int


def build_graph():
    g = StateGraph(TurnState)
    g.add_node("stt",             stt_node)
    g.add_node("build_prompt",    build_prompt_node)
    g.add_node("session_history", session_history_node)
    g.add_node("llm_tts",         llm_tts_node)
    g.add_node("persist",         persist_node)
    g.add_edge(START,             "stt")
    g.add_edge("stt",             "build_prompt")
    g.add_edge("build_prompt",    "session_history")
    g.add_edge("session_history", "llm_tts")
    g.add_edge("llm_tts",         "persist")
    g.add_edge("persist",         END)
    return g.compile()


def build_text_graph():
    """Graph for when transcript is already known (STT done by FE) — skips stt_node."""
    g = StateGraph(TurnState)
    g.add_node("build_prompt",    build_prompt_node)
    g.add_node("session_history", session_history_node)
    g.add_node("llm_tts",         llm_tts_node)
    g.add_node("persist",         persist_node)
    g.add_edge(START,             "build_prompt")
    g.add_edge("build_prompt",    "session_history")
    g.add_edge("session_history", "llm_tts")
    g.add_edge("llm_tts",         "persist")
    g.add_edge("persist",         END)
    return g.compile()


graph      = build_graph()
graph_text = build_text_graph()
