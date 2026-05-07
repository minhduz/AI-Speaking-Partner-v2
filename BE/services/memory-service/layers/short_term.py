import json
from db import redis_client, settings

class ShortTermMemory:

    @staticmethod
    def _key(session_id: str) -> str:
        return f"session:{session_id}:context"

    @staticmethod
    async def append(session_id: str, user_message: str, ai_message: str):
        key = ShortTermMemory._key(session_id)
        for role, content in [("user", user_message), ("assistant", ai_message)]:
            await redis_client.client.rpush(key, json.dumps({"role": role, "content": content}))
        await redis_client.client.expire(key, settings.short_term_ttl_seconds)

    @staticmethod
    async def get_all(session_id: str) -> list[dict]:
        key = ShortTermMemory._key(session_id)
        entries = await redis_client.client.lrange(key, 0, -1)
        return [json.loads(e) for e in entries]

    @staticmethod
    async def get_recent(session_id: str, n: int = 10) -> list[dict]:
        messages = await ShortTermMemory.get_all(session_id)
        return messages[-n:]

    @staticmethod
    async def clear(session_id: str):
        await redis_client.client.delete(ShortTermMemory._key(session_id))
