from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from nodes.stt_node import stt_node
from nodes.build_prompt_node import build_prompt_node
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
    current_datetime: str
    turn_index: int
    # Intermediates (populated by nodes)
    transcript: str
    confidence: float
    pronunciation: dict
    system_prompt: str
    full_response: str
    tokens_used: int


def build_graph():
    g = StateGraph(TurnState)
    g.add_node("stt",          stt_node)
    g.add_node("build_prompt", build_prompt_node)
    g.add_node("llm_tts",      llm_tts_node)
    g.add_node("persist",      persist_node)
    g.add_edge(START,          "stt")
    g.add_edge("stt",          "build_prompt")
    g.add_edge("build_prompt", "llm_tts")
    g.add_edge("llm_tts",      "persist")
    g.add_edge("persist",      END)
    return g.compile()


graph = build_graph()
