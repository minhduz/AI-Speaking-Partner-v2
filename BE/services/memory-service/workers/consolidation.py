import math, json
from datetime import datetime, timedelta
from openai import AsyncOpenAI
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from retriever import embed
from db import database, settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

async def run_consolidation(user_id: str, session_id: str):
    """
    Post-session background job — runs fully async after session ends.
    1. Read full session from Redis
    2. LLM extracts facts
    3. Write facts to pgvector with embeddings
    4. Apply decay to existing facts
    5. Prune low-score facts
    6. Clear Redis session context
    """
    print(f"[Consolidation] start user={user_id} session={session_id}")

    await database.execute(
        "INSERT INTO memory.consolidation_jobs (user_id, session_id, status) VALUES ($1, $2, 'processing')",
        user_id, session_id,
    )

    try:
        messages = await ShortTermMemory.get_all(session_id)
        if not messages:
            await _mark_done(user_id, session_id, 0, 0)
            return

        conversation = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
        facts = await _extract_facts(conversation)
        facts_written = 0

        for fact in facts:
            try:
                vec = await embed(fact["content"])
                expires_at = None
                if fact.get("expires_days"):
                    expires_at = datetime.utcnow() + timedelta(days=int(fact["expires_days"]))
                await LongTermMemory.upsert(
                    user_id=user_id,
                    content=fact["content"],
                    embedding=vec,
                    priority=fact.get("priority", "normal"),
                    expires_at=expires_at,
                    source="consolidation",
                )
                facts_written += 1
            except Exception as e:
                print(f"[Consolidation] fact write error: {e}")

        facts_pruned = await _apply_decay_and_prune(user_id)
        await ShortTermMemory.clear(session_id)
        await _mark_done(user_id, session_id, facts_written, facts_pruned)
        print(f"[Consolidation] done written={facts_written} pruned={facts_pruned}")

    except Exception as e:
        print(f"[Consolidation] failed: {e}")
        await database.execute(
            """UPDATE memory.consolidation_jobs
               SET status = 'failed', completed_at = NOW()
               WHERE user_id = $1 AND session_id = $2""",
            user_id, session_id,
        )


async def _extract_facts(conversation: str) -> list[dict]:
    res = await _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "Extract important facts about the USER from this conversation.\n"
                    "Return ONLY valid JSON: {\"facts\": [...]}\n"
                    "Each fact object:\n"
                    "  content: string — the fact itself\n"
                    "  priority: 'normal' | 'high' | 'urgent'\n"
                    "  expires_days: null or integer\n\n"
                    "Rules:\n"
                    "- urgent = time-sensitive within 7 days (exam, appointment)\n"
                    "- high = important personal info (job, goal, family)\n"
                    "- normal = preferences, background, interests\n"
                    "- Set expires_days for time-sensitive facts (exam tomorrow = 2)\n"
                    "- Only facts about the USER, not the AI\n"
                    "- Skip trivial small talk"
                ),
            },
            {"role": "user", "content": conversation},
        ],
        response_format={"type": "json_object"},
        max_tokens=500,
    )
    try:
        data = json.loads(res.choices[0].message.content)
        return data.get("facts", [])
    except Exception:
        return []


async def _apply_decay_and_prune(user_id: str) -> int:
    rows = await database.fetch(
        """
        SELECT id, score, retrieval_count,
               EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400.0 AS days_since
        FROM memory.memory_facts
        WHERE user_id = $1 AND priority = 'normal'
        """,
        user_id,
    )

    lam   = settings.decay_lambda
    boost = 0.05
    pruned = 0

    for row in rows:
        delta   = float(row["days_since"] or 0)
        new_score = (
            float(row["score"]) * math.exp(-lam * delta)
            + int(row["retrieval_count"]) * boost
        )
        if new_score < settings.score_prune_threshold:
            await database.execute("DELETE FROM memory.memory_facts WHERE id = $1", row["id"])
            pruned += 1
        else:
            await database.execute(
                "UPDATE memory.memory_facts SET score = $2, updated_at = NOW() WHERE id = $1",
                row["id"], round(new_score, 4),
            )

    return pruned


async def _mark_done(user_id: str, session_id: str, written: int, pruned: int):
    await database.execute(
        """UPDATE memory.consolidation_jobs
           SET status = 'done', facts_written = $3, facts_pruned = $4, completed_at = NOW()
           WHERE user_id = $1 AND session_id = $2 AND status = 'processing'""",
        user_id, session_id, written, pruned,
    )
