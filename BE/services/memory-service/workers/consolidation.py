import json
import logging
from datetime import datetime, timedelta, timezone

from openai import AsyncOpenAI

from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from retriever import embed
from db import database, settings

log = logging.getLogger("consolidation")
_openai = AsyncOpenAI(api_key=settings.openai_api_key)


async def run_consolidation(user_id: str, session_id: str):
    """
    Runs after every session ends.
    Always rewrites the user's single context document (JSON + embedding vector).

    Steps:
      1. Read session from Redis short-term store
      2. Resolve session start time from first message timestamp
      3. LLM extracts new facts (with absolute times, no name/language/level)
      4. Stamp added_at + default expires_at (1 year) on every new fact in Python
      5. Load existing context, prune expired facts, merge with new facts
      6. Delete legacy per-fact rows (migration cleanup)
      7. Regenerate embedding from ALL current facts and upsert single context document
      8. Clear Redis session
    """
    log.info("── start  user=%s  session=%s", user_id, session_id)

    await database.execute(
        "INSERT INTO memory.consolidation_jobs (user_id, session_id, status) VALUES ($1, $2, 'processing')",
        user_id, session_id,
    )

    try:
        # 1. Read session from Redis
        messages = await ShortTermMemory.get_all(session_id)
        log.info("step 1 — %d messages from Redis", len(messages))
        if not messages:
            log.warning("step 1 — no messages (Redis already expired?), marking done")
            await _mark_done(user_id, session_id, 0, 0)
            return

        # 2. Resolve session start time
        session_start_utc = _parse_session_time(messages)
        log.info("step 2 — session time: %s", session_start_utc.isoformat())

        # 3. LLM extracts facts
        conversation = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
        log.info("step 3 — calling LLM to extract facts from %d messages", len(messages))
        raw_facts = await _extract_facts(conversation, session_start_utc)
        log.info("step 3 — LLM returned %d raw facts", len(raw_facts))

        # 4. Stamp added_at and default expires_at (1 year) in Python — never trust the LLM for these
        now = datetime.now(timezone.utc)
        default_expires = now + timedelta(days=settings.long_term_ttl_days)
        new_facts: list[dict] = []
        for raw in raw_facts:
            fact = {
                "content":    raw.get("content", "").strip(),
                "priority":   raw.get("priority", "normal"),
                "added_at":   now.isoformat(),
                "expires_at": raw.get("expires_at") or default_expires.isoformat(),
            }
            if not fact["content"]:
                continue
            new_facts.append(fact)
            log.info("  [new] priority=%-6s expires=%s  %r",
                     fact["priority"], fact["expires_at"][:10], fact["content"][:80])

        # 5. Load existing context and prune expired, then merge
        existing_facts = await LongTermMemory.get_context(user_id)
        log.info("step 5 — loaded %d existing facts from context document", len(existing_facts))

        active_existing = _prune_expired(existing_facts, now)
        pruned_count = len(existing_facts) - len(active_existing)
        log.info("step 5 — pruned %d expired facts, %d remain", pruned_count, len(active_existing))

        merged = _merge(active_existing, new_facts)
        log.info("step 5 — merged → %d total facts in context", len(merged))

        # 6. Remove legacy per-fact rows (old architecture migration)
        await database.execute(
            "DELETE FROM memory.memory_facts WHERE user_id = $1 AND source != 'user_context'",
            user_id,
        )

        # 7. Regenerate embedding from ALL current facts and upsert single document
        #    This runs every time so the vector always reflects the latest full context.
        context_text = "\n".join(f["content"] for f in merged)
        embedding = await embed(context_text) if context_text.strip() else [0.0] * 1536
        await LongTermMemory.upsert_context(user_id, merged, embedding)
        log.info("step 7 — upserted context document + fresh embedding (%d facts)", len(merged))

        # 8. Clear Redis session
        await ShortTermMemory.clear(session_id)
        log.info("step 8 — cleared Redis session %s", session_id)

        await _mark_done(user_id, session_id, len(new_facts), pruned_count)
        log.info("── done  new_facts=%d  pruned=%d  total_in_context=%d",
                 len(new_facts), pruned_count, len(merged))

    except Exception as e:
        log.error("✖ FAILED: %s", e, exc_info=True)
        await database.execute(
            """UPDATE memory.consolidation_jobs
               SET status = 'failed', completed_at = NOW()
               WHERE user_id = $1 AND session_id = $2""",
            user_id, session_id,
        )


# ── helpers ──────────────────────────────────────────────────────────────────

def _parse_session_time(messages: list[dict]) -> datetime:
    try:
        ts = messages[0].get("timestamp")
        if ts:
            dt = datetime.fromisoformat(ts)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    return datetime.now(timezone.utc)


def _prune_expired(facts: list[dict], now: datetime) -> list[dict]:
    """Remove any fact whose expires_at is in the past."""
    active = []
    for fact in facts:
        exp = fact.get("expires_at")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(exp)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                if exp_dt < now:
                    log.info("  [pruned-expired] %r", fact.get("content", "")[:60])
                    continue
            except Exception:
                pass
        active.append(fact)
    return active


def _merge(existing: list[dict], new_facts: list[dict]) -> list[dict]:
    """
    Add new facts to existing, replacing any fact whose first 60 chars of
    content match (handles re-stated facts with better absolute times).
    """
    result = list(existing)
    for new in new_facts:
        key = new["content"].lower().strip()[:60]
        replaced = False
        for i, ef in enumerate(result):
            if ef["content"].lower().strip()[:60] == key:
                result[i] = new
                replaced = True
                log.info("  [updated] %r", new["content"][:60])
                break
        if not replaced:
            result.append(new)
    return result


async def _extract_facts(conversation: str, session_start_utc: datetime) -> list[dict]:
    fmt_time = session_start_utc.strftime("%A, %B %d, %Y at %I:%M %p UTC")
    example_abs = (session_start_utc + timedelta(minutes=10)).strftime("%I:%M %p on %A, %B %d, %Y UTC")

    res = await _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"The conversation took place on {fmt_time}.\n\n"
                    "Extract important facts about the USER from this conversation.\n"
                    "Return ONLY valid JSON: {\"facts\": [...]}\n\n"
                    "Each fact object:\n"
                    "  content   : string — the fact in plain English\n"
                    "  priority  : 'urgent' | 'high' | 'normal'\n"
                    "  expires_at: ISO-8601 UTC string for time-sensitive facts, null otherwise\n\n"
                    "Priority rules:\n"
                    "  urgent = time-sensitive within 7 days (exam, appointment, deadline)\n"
                    "  high   = important personal goal, job, study plan, family situation\n"
                    "  normal = preferences, hobbies, background\n\n"
                    "CRITICAL — convert relative times to absolute:\n"
                    f"  Bad:  'User has an exam in 10 minutes'\n"
                    f"  Good: 'User has an exam at {example_abs}'\n"
                    "  Apply the same conversion for 'tomorrow', 'next Friday', 'in 2 days', etc.\n"
                    "  For urgent facts, set expires_at to the event date/time so it auto-clears.\n\n"
                    "DO NOT extract:\n"
                    "  - The user's name (stored in profile)\n"
                    "  - The language being studied (stored in profile)\n"
                    "  - The user's proficiency level (stored in profile)\n"
                    "  - Anything said by the AI coach\n"
                    "  - Trivial small talk"
                ),
            },
            {"role": "user", "content": conversation},
        ],
        response_format={"type": "json_object"},
        max_tokens=600,
    )
    try:
        return json.loads(res.choices[0].message.content).get("facts", [])
    except Exception:
        return []


async def _mark_done(user_id: str, session_id: str, written: int, pruned: int):
    await database.execute(
        """UPDATE memory.consolidation_jobs
           SET status = 'done', facts_written = $3, facts_pruned = $4, completed_at = NOW()
           WHERE user_id = $1 AND session_id = $2 AND status = 'processing'""",
        user_id, session_id, written, pruned,
    )
