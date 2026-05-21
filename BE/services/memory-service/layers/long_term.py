import json
import logging
from datetime import datetime, timezone
from db import database

log = logging.getLogger("long_term")


def _fact_score(fact: dict) -> float:
    """Persisted importance; retrieval still blends this with semantic similarity."""
    content = (fact.get("content") or "").strip()
    priority = fact.get("priority", "normal")
    if content.startswith("Session log ["):
        return 0.4
    if priority == "urgent":
        return 0.95
    if priority == "high":
        return 0.82
    return 0.6


def _to_utc(val) -> datetime | None:
    """
    Return a UTC-aware datetime.datetime for asyncpg's timestamptz column.
    asyncpg requires a proper datetime object — SQL casts like ::timestamptz
    do not override parameter type inference in prepared statements.
    Returns None (→ NULL in DB) when val is empty or unparseable.
    """
    if not val:
        return None
    try:
        if isinstance(val, datetime):
            dt = val
        else:
            # Normalise space-separated ISO ("2027-05-12 18:00:00" → "2027-05-12T18:00:00")
            s = str(val).strip().replace(' ', 'T', 1)
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        log.debug("_to_utc(%r) → %s", val, dt.isoformat())
        return dt
    except Exception as exc:
        log.warning("_to_utc(%r) failed (%s) — storing NULL expiry", val, exc)
        return None


class LongTermMemory:

    @staticmethod
    async def get_facts(user_id: str) -> list[dict]:
        """
        Return all active (non-expired) facts for a user.
        Handles both the new per-fact rows (source='fact') and the legacy
        single-document row (source='user_context') so existing data is not lost
        before the next consolidation rewrites it.
        """
        rows = await database.fetch(
            """SELECT content, priority, expires_at, source
               FROM memory.memory_facts
               WHERE user_id = $1
                 AND (expires_at IS NULL OR expires_at > NOW())
               ORDER BY updated_at DESC""",
            user_id,
        )
        facts = []
        now = datetime.now(timezone.utc)

        for row in rows:
            if row["source"] == "user_context":
                # Legacy single-document format — expand JSON inline
                try:
                    data = json.loads(row["content"])
                    for f in data.get("facts", []):
                        exp = f.get("expires_at")
                        if exp:
                            try:
                                exp_dt = datetime.fromisoformat(exp)
                                if exp_dt.tzinfo is None:
                                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                                if exp_dt < now:
                                    continue
                            except Exception:
                                pass
                        facts.append({
                            "content":    f["content"],
                            "priority":   f.get("priority", "normal"),
                            "added_at":   f.get("added_at"),
                            "expires_at": f.get("expires_at"),
                        })
                except Exception:
                    pass
            else:
                # New per-fact row — return expires_at as ISO string
                facts.append({
                    "content":    row["content"],
                    "priority":   row["priority"] or "normal",
                    "added_at":   None,
                    "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
                })

        log.info("[long_term] get_facts  user=%s  returned=%d active facts", user_id, len(facts))
        return facts

    @staticmethod
    async def replace_facts(user_id: str, facts: list[dict], embeddings: list[list[float]]):
        """
        Atomically replace ALL facts for a user with new per-fact rows.
        expires_at is passed as an ISO string with ::timestamptz cast so that
        PostgreSQL handles the conversion — no Python datetime encoding involved.
        """
        log.info("[long_term] replace_facts  user=%s  count=%d", user_id, len(facts))
        async with database.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM memory.memory_facts WHERE user_id = $1",
                    user_id,
                )
                for i, (fact, emb) in enumerate(zip(facts, embeddings)):
                    expires_at = _to_utc(fact.get("expires_at"))
                    log.debug("  [%d] priority=%s  expires=%s  content='%s'",
                              i, fact.get("priority", "normal"),
                              expires_at.isoformat() if expires_at else None,
                              fact["content"][:60])
                    await conn.execute(
                        """INSERT INTO memory.memory_facts
                               (user_id, content, embedding, priority, source, expires_at, score)
                           VALUES ($1, $2, $3::vector, $4, 'fact', $5, $6)""",
                        user_id,
                        fact["content"],
                        json.dumps(emb),
                        fact.get("priority", "normal"),
                        expires_at,   # UTC-aware datetime or None — asyncpg handles directly
                        _fact_score(fact),
                    )
        log.info("[long_term] replace_facts  done  user=%s", user_id)

    @staticmethod
    async def delete_all(user_id: str):
        """GDPR wipe — remove all memory rows for this user."""
        await database.execute(
            "DELETE FROM memory.memory_facts WHERE user_id = $1", user_id
        )
        log.info("[long_term] delete_all  user=%s", user_id)
