"""
Onboarding state — a short-lived (24h TTL) Redis object that captures behavioral
signals from the user's FIRST speaking session.

This is intentionally separate from `short_term` / `long_term` because:
- It is single-use (consumed by first-session consolidation, then deleted).
- It is not retrieved for general turn context.
- Its lifecycle is bounded by the first session only.

Schema is asymmetric on the way in vs out:
- The extractor LLM returns scalar fields plus optional `notable_weakness_hint` and
  `extracted_fact` (singular).
- The stored object keeps `notable_weakness_hints` and `facts` as growing lists.
"""

import json
import logging
from datetime import datetime, timezone
from db import redis_client

log = logging.getLogger("onboarding_state")

TTL_SECONDS = 86400  # 24h — long enough for the first session to complete

_SCALAR_FIELDS = (
    "motivation",
    "confidence_signal",
    "speaking_style",
    "emotional_energy",
)


def _key(user_id: str) -> str:
    return f"user:{user_id}:onboarding_state"


async def get(user_id: str) -> dict:
    """Return the merged onboarding state, or {} if none exists / parse fails."""
    raw = await redis_client.client.get(_key(user_id))
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        log.warning("onboarding_state.get: malformed JSON for user=%s", user_id)
        return {}


def merge(old: dict, new: dict) -> dict:
    """
    Merge an extractor result into the existing onboarding state.

    Rules:
    - Scalar fields are "sticky": once we have a confident value, don't overwrite
      it with a later "unclear". Only upgrade None/"unclear" → a confident value.
    - `notable_weakness_hints` and `facts` are append-only deduped lists.
    """
    merged = dict(old or {})

    for field in _SCALAR_FIELDS:
        old_value = merged.get(field)
        new_value = new.get(field)
        if old_value in (None, "unclear") and new_value not in (None, "unclear"):
            merged[field] = new_value
        elif field not in merged:
            merged[field] = new_value or "unclear"

    weakness = new.get("notable_weakness_hint")
    if weakness:
        merged.setdefault("notable_weakness_hints", [])
        if weakness not in merged["notable_weakness_hints"]:
            merged["notable_weakness_hints"].append(weakness)

    fact = new.get("extracted_fact")
    if fact:
        merged.setdefault("facts", [])
        if fact not in merged["facts"]:
            merged["facts"].append(fact)

    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    return merged


async def save(user_id: str, state: dict) -> None:
    await redis_client.client.set(
        _key(user_id), json.dumps(state, ensure_ascii=False), ex=TTL_SECONDS,
    )
    log.info("onboarding_state.save  user=%s  fields=%s", user_id, sorted(state.keys()))


async def delete(user_id: str) -> None:
    await redis_client.client.delete(_key(user_id))
    log.info("onboarding_state.delete  user=%s", user_id)
