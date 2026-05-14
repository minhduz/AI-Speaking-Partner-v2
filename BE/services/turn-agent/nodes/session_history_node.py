import logging
import aiohttp
from db import settings

log = logging.getLogger("session_history")

WINDOW = 6  # keep last 6 messages (3 turn-pairs) raw; summarise everything older


async def session_history_node(state: dict) -> dict:
    user_id    = state.get("user_id", "")
    session_id = state.get("session_id", "")
    turn_index = state.get("turn_index", 1)

    if not user_id or not session_id:
        return {"recent_messages": [], "conversation_summary": ""}

    messages = await _get_session_messages(user_id, session_id)
    log.info("session_history  user=%s  session=%s  msgs=%d  turn=%d",
             user_id, session_id, len(messages), turn_index)

    if len(messages) <= WINDOW:
        return {"recent_messages": messages, "conversation_summary": ""}

    recent = messages[-WINDOW:]
    older  = messages[:-WINDOW]

    existing_summary = await _get_session_summary(user_id, session_id)

    # Re-summarise only at each WINDOW boundary (turns 7, 13, 19…) to avoid
    # calling the LLM on every single turn.
    if turn_index > WINDOW and turn_index % WINDOW == 1:
        log.info("session_history  summarising %d older messages", len(older))
        new_summary = await _llm_summarize(
            existing_summary, older, state.get("target_language", "english")
        )
        await _save_session_summary(user_id, session_id, new_summary)
    else:
        new_summary = existing_summary

    return {"recent_messages": recent, "conversation_summary": new_summary}


# ── memory-service helpers ────────────────────────────────────────────────────

async def _get_session_messages(user_id: str, session_id: str) -> list[dict]:
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(
                f"{settings.memory_service_url}/short-term/{user_id}",
                params={"session_id": session_id, "limit": 200},
            ) as r:
                r.raise_for_status()
                data = await r.json()
        return [{"role": m["role"], "content": m["content"]}
                for m in data.get("messages", [])]
    except Exception as e:
        log.warning("session_history  _get_session_messages failed: %s", e)
        return []


async def _get_session_summary(user_id: str, session_id: str) -> str:
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.get(
                f"{settings.memory_service_url}/short-term/{user_id}/summary/{session_id}",
            ) as r:
                r.raise_for_status()
                data = await r.json()
        return data.get("summary", "")
    except Exception as e:
        log.warning("session_history  _get_session_summary failed: %s", e)
        return ""


async def _save_session_summary(user_id: str, session_id: str, summary: str):
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.put(
                f"{settings.memory_service_url}/short-term/{user_id}/summary/{session_id}",
                json={"summary": summary},
            ) as r:
                r.raise_for_status()
    except Exception as e:
        log.warning("session_history  _save_session_summary failed: %s", e)


# ── LLM summarisation ────────────────────────────────────────────────────────

def _format_messages(messages: list[dict]) -> str:
    return "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages
    )


async def _llm_summarize(existing_summary: str, older: list[dict], language: str) -> str:
    prior = f"Previous summary:\n{existing_summary}" if existing_summary else "No previous summary."
    conversation_text = _format_messages(older)

    payload = {
        "system": (
            "You are summarising a language-learning conversation. "
            "Write a concise 3-5 sentence summary in English that captures the key topics, "
            "facts mentioned, and any decisions or questions raised. "
            "Incorporate the previous summary if one exists."
        ),
        "messages": [
            {"role": "user", "content": f"{prior}\n\nNew messages to include:\n{conversation_text}"},
        ],
    }

    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.post(
                f"{settings.llm_gateway_url}/complete", json=payload
            ) as r:
                r.raise_for_status()
                data = await r.json()
        summary = (data.get("response_text") or "").strip()
        log.info("session_history  new summary len=%d", len(summary))
        return summary
    except Exception as e:
        log.warning("session_history  _llm_summarize failed: %s — reusing old summary", e)
        return existing_summary
