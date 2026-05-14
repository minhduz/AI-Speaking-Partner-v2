import json
import logging
from datetime import datetime, timezone
from db import redis_client, settings

log = logging.getLogger("short_term")


class ShortTermMemory:

    MAX_ENTRIES = 200  # 100 turns (user+assistant pairs) per user in rolling window

    @staticmethod
    def _key(user_id: str) -> str:
        # Rolling buffer per USER — not per session — so context persists across sessions
        return f"user:{user_id}:context"

    @staticmethod
    async def append(user_id: str, session_id: str, user_message: str, ai_message: str):
        key = ShortTermMemory._key(user_id)
        now = datetime.now(timezone.utc).isoformat()
        for role, content in [("user", user_message), ("assistant", ai_message)]:
            await redis_client.client.rpush(key, json.dumps({
                "role": role,
                "content": content,
                "timestamp": now,
                "session_id": session_id,
            }))
        # Cap at MAX_ENTRIES — drops oldest entries from the left
        await redis_client.client.ltrim(key, -ShortTermMemory.MAX_ENTRIES, -1)
        await redis_client.client.expire(key, settings.short_term_ttl_seconds)
        log.info("[short_term] appended  user=%s  session=%s  role=user+assistant", user_id, session_id)

    @staticmethod
    async def get_all(user_id: str) -> list[dict]:
        key = ShortTermMemory._key(user_id)
        entries = await redis_client.client.lrange(key, 0, -1)
        messages = [json.loads(e) for e in entries]
        log.debug("[short_term] get_all  user=%s  total=%d", user_id, len(messages))
        return messages

    @staticmethod
    async def get_session_messages(user_id: str, session_id: str) -> list[dict]:
        """Return only messages that belong to a specific session (for consolidation)."""
        all_messages = await ShortTermMemory.get_all(user_id)
        session_msgs = [m for m in all_messages if m.get("session_id") == session_id]
        log.info("[short_term] get_session_messages  user=%s  session=%s  found=%d / total=%d",
                 user_id, session_id, len(session_msgs), len(all_messages))
        return session_msgs

    @staticmethod
    async def get_recent(user_id: str, n: int = 10) -> list[dict]:
        messages = await ShortTermMemory.get_all(user_id)
        recent = messages[-n:]
        log.debug("[short_term] get_recent  user=%s  n=%d  returned=%d", user_id, n, len(recent))
        return recent

    @staticmethod
    async def clear(user_id: str):
        """GDPR / manual wipe — removes the user's entire rolling buffer and consolidated facts."""
        await redis_client.client.delete(ShortTermMemory._key(user_id))
        await ShortTermMemory.clear_st_facts(user_id)
        log.info("[short_term] cleared rolling buffer  user=%s", user_id)

    # ── Consolidated short-term facts (schedules + urgent facts, 7-day TTL) ──

    @staticmethod
    def _facts_key(user_id: str) -> str:
        return f"user:{user_id}:st_facts"

    @staticmethod
    async def get_st_facts(user_id: str) -> list[dict]:
        """Return non-expired short-term consolidated facts from Redis."""
        key = ShortTermMemory._facts_key(user_id)
        raw = await redis_client.client.get(key)
        if not raw:
            return []
        try:
            now = datetime.now(timezone.utc).isoformat()
            facts = json.loads(raw)
            return [f for f in facts if f.get("expires_at", "9999") > now]
        except Exception:
            return []

    @staticmethod
    async def replace_st_facts(user_id: str, facts: list[dict]):
        """Atomically replace consolidated facts; TTL = short_term_ttl_seconds (7 days)."""
        key = ShortTermMemory._facts_key(user_id)
        await redis_client.client.set(
            key, json.dumps(facts, default=str), ex=settings.short_term_ttl_seconds
        )
        log.info("[short_term] replace_st_facts  user=%s  count=%d", user_id, len(facts))

    @staticmethod
    async def clear_st_facts(user_id: str):
        """GDPR wipe of consolidated short-term facts."""
        await redis_client.client.delete(ShortTermMemory._facts_key(user_id))
        log.info("[short_term] cleared st_facts  user=%s", user_id)

    # ── Session-scoped rolling summary (for within-session LLM context) ──────

    @staticmethod
    def _summary_key(user_id: str, session_id: str) -> str:
        return f"user:{user_id}:session:{session_id}:summary"

    @staticmethod
    async def get_session_summary(user_id: str, session_id: str) -> str:
        key = ShortTermMemory._summary_key(user_id, session_id)
        val = await redis_client.client.get(key)
        return val or ""

    @staticmethod
    async def save_session_summary(user_id: str, session_id: str, summary: str):
        key = ShortTermMemory._summary_key(user_id, session_id)
        await redis_client.client.set(key, summary, ex=settings.short_term_ttl_seconds)
        log.info("[short_term] saved session_summary  user=%s  session=%s  len=%d",
                 user_id, session_id, len(summary))
