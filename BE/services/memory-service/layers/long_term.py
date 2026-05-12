import json
from datetime import datetime, timezone
from db import database


class LongTermMemory:

    @staticmethod
    async def get_context(user_id: str) -> list[dict]:
        """Return all active (non-expired) facts from the user's single context document."""
        row = await database.fetchrow(
            "SELECT content FROM memory.memory_facts WHERE user_id = $1 AND source = 'user_context' LIMIT 1",
            user_id,
        )
        if not row:
            return []
        try:
            data = json.loads(row["content"])
            now = datetime.now(timezone.utc)
            active = []
            for fact in data.get("facts", []):
                exp = fact.get("expires_at")
                if exp:
                    try:
                        exp_dt = datetime.fromisoformat(exp)
                        if exp_dt.tzinfo is None:
                            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                        if exp_dt < now:
                            continue  # expired — skip
                    except Exception:
                        pass
                active.append(fact)
            return active
        except Exception:
            return []

    @staticmethod
    async def upsert_context(user_id: str, facts: list[dict], embedding: list[float]):
        """Store or replace the user's single context document."""
        content_json = json.dumps({
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "facts": facts,
        })
        existing = await database.fetchrow(
            "SELECT id FROM memory.memory_facts WHERE user_id = $1 AND source = 'user_context'",
            user_id,
        )
        if existing:
            await database.execute(
                """UPDATE memory.memory_facts
                   SET content = $2, embedding = $3::vector, updated_at = NOW()
                   WHERE id = $1""",
                existing["id"], content_json, json.dumps(embedding),
            )
        else:
            await database.execute(
                """INSERT INTO memory.memory_facts (user_id, content, embedding, priority, source)
                   VALUES ($1, $2, $3::vector, 'normal', 'user_context')""",
                user_id, content_json, json.dumps(embedding),
            )

    @staticmethod
    async def delete_all(user_id: str):
        """GDPR wipe — remove all memory rows for this user."""
        await database.execute("DELETE FROM memory.memory_facts WHERE user_id = $1", user_id)
