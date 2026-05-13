import logging
import aiohttp
from db import settings

log = logging.getLogger("build_prompt")


async def build_prompt_node(state: dict) -> dict:
    user_id = state.get("user_id", "unknown")
    session_id = state.get("session_id", "")
    transcript = state.get("transcript", "")

    payload = {
        "query": transcript,
        "session_id": session_id,
        "user_level": state.get("user_level", "beginner"),
        "target_language": state.get("target_language", "english"),
        "user_name": state.get("user_name", ""),
        "current_datetime": state.get("current_datetime", ""),
        "layers": ["short_term", "long_term", "urgent"],
    }

    log.info("── build_prompt  user=%s  session=%s  query='%s'", user_id, session_id, transcript[:80])

    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.post(
                f"{settings.memory_service_url}/build-prompt/{user_id}",
                json=payload,
            ) as r:
                r.raise_for_status()
                data = await r.json()

        chunks_used = data.get("context_chunks_used", 0)
        tokens = data.get("estimated_tokens", 0)
        log.info("── build_prompt ✓  chunks_used=%d  estimated_tokens=%d", chunks_used, tokens)
        return {"system_prompt": data["system_prompt"]}

    except Exception as e:
        log.error("── build_prompt ✖ memory service failed: %s", e)
        lang = state.get("target_language", "English")
        dt = state.get("current_datetime", "")
        fallback = (
            f"You are a warm, friendly AI companion. "
            f"Speak in {lang} or whatever language the user uses naturally. "
            f"Help with conversations and language learning like a good friend."
            + (f" Today is {dt}." if dt else "")
        )
        return {"system_prompt": fallback}
