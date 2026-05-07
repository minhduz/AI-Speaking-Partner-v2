import json
from datetime import datetime
from db import database

class LongTermMemory:

    @staticmethod
    async def search(user_id: str, query_vector: list[float], limit: int = 10) -> list[dict]:
        rows = await database.fetch(
            """
            SELECT id, content, score, priority,
                   1 - (embedding <=> $2::vector) AS similarity
            FROM memory.memory_facts
            WHERE user_id = $1
              AND priority != 'urgent'
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY embedding <=> $2::vector
            LIMIT $3
            """,
            user_id, json.dumps(query_vector), limit,
        )
        return [
            {"id": str(r["id"]), "text": r["content"],
             "score": round(float(r["similarity"]) * float(r["score"]), 4),
             "source": "long_term"}
            for r in rows
        ]

    @staticmethod
    async def search_urgent(user_id: str, limit: int = 5) -> list[dict]:
        rows = await database.fetch(
            """
            SELECT id, content, score
            FROM memory.memory_facts
            WHERE user_id = $1
              AND priority = 'urgent'
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY score DESC
            LIMIT $2
            """,
            user_id, limit,
        )
        return [{"id": str(r["id"]), "text": r["content"], "score": float(r["score"]), "source": "urgent"}
                for r in rows]

    @staticmethod
    async def upsert(user_id: str, content: str, embedding: list[float],
                     priority: str = "normal", expires_at: datetime = None,
                     source: str = "consolidation"):
        await database.execute(
            """
            INSERT INTO memory.memory_facts (user_id, content, embedding, priority, expires_at, source)
            VALUES ($1, $2, $3::vector, $4, $5, $6)
            """,
            user_id, content, json.dumps(embedding), priority, expires_at, source,
        )

    @staticmethod
    async def delete_all(user_id: str):
        await database.execute("DELETE FROM memory.memory_facts WHERE user_id = $1", user_id)

    @staticmethod
    async def prune_low_score(user_id: str, threshold: float):
        result = await database.execute(
            """
            DELETE FROM memory.memory_facts
            WHERE user_id = $1 AND score < $2 AND priority = 'normal'
            """,
            user_id, threshold,
        )
        return int(result.split()[-1]) if result else 0
