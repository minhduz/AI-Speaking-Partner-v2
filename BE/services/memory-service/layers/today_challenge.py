"""
Today's challenge / active mission.

Short-lived Redis key that acts as the single source of truth for the next
session mission. `SESSION_INSIGHT.next_challenge` remains the fallback source,
but once a mission is promoted here, greeting, mission card, and turn prompt all
read the same value.
"""

import logging
from db import redis_client

log = logging.getLogger("today_challenge")

TTL_SECONDS = 259200  # 72h — survives overnight / next-morning return flows


def _key(user_id: str) -> str:
    return f"user:{user_id}:today_challenge"


async def get(user_id: str) -> str | None:
    value = await redis_client.client.get(_key(user_id))
    return value.strip() if isinstance(value, str) and value.strip() else None


async def save(user_id: str, challenge: str) -> None:
    clean = (challenge or "").strip()
    if not clean:
        return
    await redis_client.client.set(_key(user_id), clean, ex=TTL_SECONDS)
    log.info("today_challenge.save  user=%s  challenge=%r", user_id, clean[:120])


async def delete(user_id: str) -> None:
    await redis_client.client.delete(_key(user_id))
    log.info("today_challenge.delete  user=%s", user_id)
