import json
import logging
from datetime import datetime, timedelta, timezone

from openai import AsyncOpenAI

from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from db import database, settings

log = logging.getLogger("consolidation")
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

MAX_FACTS = 50  # hard cap before compression


async def run_consolidation(user_id: str, session_id: str):
    """
    Runs after every session ends.

    Steps:
      1. Read session from Redis short-term store
      2. Resolve session start time from first message timestamp
      3. LLM extracts new facts (absolute times, no name/language/level)
      4. Stamp added_at + default expires_at (1 year) in Python
      5. Load existing per-fact rows, prune expired, merge with new facts
      6. If total facts > MAX_FACTS, compress with LLM (merge related facts)
      7. Batch-embed all facts in a single OpenAI call
      8. Atomically replace all per-fact rows (delete + re-insert in transaction)
      9. Clear Redis session
    """
    log.info("── start  user=%s  session=%s", user_id, session_id)

    await database.execute(
        "INSERT INTO memory.consolidation_jobs (user_id, session_id, status) VALUES ($1, $2, 'processing')",
        user_id, session_id,
    )

    try:
        # 1. Read only this session's messages from the user's rolling buffer
        messages = await ShortTermMemory.get_session_messages(user_id, session_id)
        log.info("step 1 — %d messages for session %s in user buffer", len(messages), session_id)
        if not messages:
            log.warning("step 1 — no messages found for this session (already consolidated or session was empty)")
            await _mark_done(user_id, session_id, 0, 0)
            return

        # 2. Resolve session start time
        session_start_utc = _parse_session_time(messages)
        log.info("step 2 — session time: %s", session_start_utc.isoformat())

        # 3. LLM extracts facts — only use last 60 messages to bound token cost
        CONSOLIDATION_WINDOW = 60
        messages_to_extract = messages[-CONSOLIDATION_WINDOW:]
        if len(messages) > CONSOLIDATION_WINDOW:
            log.info("step 3 — truncating %d messages to last %d for fact extraction",
                     len(messages), CONSOLIDATION_WINDOW)
        conversation = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in messages_to_extract
        )
        log.info("step 3 — calling LLM to extract facts from %d messages", len(messages_to_extract))
        raw_facts = await _extract_facts(conversation, session_start_utc)
        log.info("step 3 — LLM returned %d raw facts", len(raw_facts))

        # 4. Stamp added_at and expires_at entirely in Python — never trust the LLM for dates.
        #    expires_at = consolidation time + long_term_ttl_days (default 365 days).
        #    Stored as a UTC-aware datetime to match the TIMESTAMPTZ column in Postgres.
        now = datetime.now(timezone.utc)
        default_expires = now + timedelta(days=settings.long_term_ttl_days)
        new_facts: list[dict] = []
        for raw in raw_facts:
            content = raw.get("content", "").strip()
            if not content:
                continue
            fact = {
                "content":    content,
                "priority":   raw.get("priority", "normal"),
                "added_at":   now,
                "expires_at": default_expires,   # UTC-aware datetime, computed here
            }
            new_facts.append(fact)
            log.info("  [new] priority=%-6s expires=%s  %r",
                     fact["priority"], default_expires.strftime("%Y-%m-%d"), fact["content"][:80])

        # 5. Load existing per-fact rows, prune expired, merge with new facts
        existing_facts = await LongTermMemory.get_facts(user_id)
        log.info("step 5 — loaded %d existing facts", len(existing_facts))

        active_existing = _prune_expired(existing_facts, now)
        pruned_count = len(existing_facts) - len(active_existing)
        log.info("step 5 — pruned %d expired, %d remain", pruned_count, len(active_existing))

        merged = _merge(active_existing, new_facts)
        log.info("step 5 — merged → %d total facts", len(merged))

        # 6. Compress if above hard cap
        if len(merged) > MAX_FACTS:
            log.info("step 6 — %d facts exceeds cap %d, compressing", len(merged), MAX_FACTS)
            merged = await _compress_facts(merged)
            log.info("step 6 — compressed to %d facts", len(merged))
        else:
            log.info("step 6 — skip compression (%d ≤ %d)", len(merged), MAX_FACTS)

        # 7. Batch-embed all facts in a single API call
        texts = [f["content"] for f in merged]
        if texts:
            log.info("step 7 — batch-embedding %d facts", len(texts))
            embeddings = await _batch_embed(texts)
        else:
            embeddings = []
        log.info("step 7 — embeddings ready")

        # 8. Atomically replace all per-fact rows
        await LongTermMemory.replace_facts(user_id, merged, embeddings)
        log.info("step 8 — replaced all per-fact rows (%d facts)", len(merged))

        # 9. Rolling buffer is NOT cleared — it's a user-scoped window that persists across sessions.
        #    The MAX_ENTRIES cap in ShortTermMemory handles pruning automatically.
        log.info("step 9 — rolling buffer preserved (user-scoped, self-pruning)")

        await _mark_done(user_id, session_id, len(new_facts), pruned_count)
        log.info("── done  new_facts=%d  pruned=%d  total=%d",
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
    Add new facts to existing, replacing any fact whose first 60 chars match
    (handles re-stated facts with better absolute times).
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


async def _compress_facts(facts: list[dict]) -> list[dict]:
    """
    Ask the LLM to merge semantically related facts into fewer, denser facts.
    expires_at is NOT passed to or returned from the LLM — it is always
    re-stamped in Python after compression (now + long_term_ttl_days).
    """
    facts_json = json.dumps(
        [{"id": i, "content": f["content"], "priority": f["priority"]}
         for i, f in enumerate(facts)],
        ensure_ascii=False,
    )
    res = await _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are compressing a user memory store. "
                    f"The store currently has {len(facts)} facts and must be reduced to at most {MAX_FACTS}.\n\n"
                    "Rules:\n"
                    "1. Merge semantically duplicate or closely related facts into a single, comprehensive fact.\n"
                    "2. Never discard unique facts — only merge truly related ones.\n"
                    "3. For merged facts: keep the highest priority among the sources.\n"
                    "4. Return ONLY valid JSON: {\"facts\": [{\"content\": ..., \"priority\": ...}]}\n"
                    "5. Each content must be a single plain English sentence.\n"
                    "6. Do NOT invent new information."
                ),
            },
            {"role": "user", "content": facts_json},
        ],
        response_format={"type": "json_object"},
        max_tokens=1200,
    )
    try:
        compressed = json.loads(res.choices[0].message.content).get("facts", [])
    except Exception:
        log.warning("_compress_facts: LLM parse failed, returning original")
        return facts

    now = datetime.now(timezone.utc)
    default_expires = now + timedelta(days=settings.long_term_ttl_days)
    result = []
    for f in compressed:
        content = f.get("content", "").strip()
        if not content:
            continue
        result.append({
            "content":    content,
            "priority":   f.get("priority", "normal"),
            "added_at":   now,
            "expires_at": default_expires,   # always Python-computed, never from LLM
        })
    return result


async def _batch_embed(texts: list[str]) -> list[list[float]]:
    """Single OpenAI API call for all fact texts."""
    res = await _openai.embeddings.create(
        model=settings.embedding_model,
        input=texts,
    )
    # API returns embeddings in the same order as input
    ordered = sorted(res.data, key=lambda e: e.index)
    return [e.embedding for e in ordered]


async def _extract_facts(conversation: str, session_start_utc: datetime) -> list[dict]:
    fmt_time = session_start_utc.strftime("%A, %B %d, %Y at %I:%M %p UTC")
    example_abs = (session_start_utc + timedelta(minutes=10)).strftime(
        "%I:%M %p on %A, %B %d, %Y UTC"
    )

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
                    "  content  : string — the fact in plain English; for time-sensitive facts\n"
                    "             embed the absolute date/time in the content itself\n"
                    "  priority : 'urgent' | 'high' | 'normal'\n\n"
                    "Priority rules:\n"
                    "  urgent = time-sensitive within 7 days (exam, appointment, deadline)\n"
                    "  high   = important personal goal, job, study plan, family situation\n"
                    "  normal = preferences, hobbies, background\n\n"
                    "For time-sensitive facts, embed the absolute time in content:\n"
                    f"  Bad:  'User has an exam in 10 minutes'\n"
                    f"  Good: 'User has an exam at {example_abs}'\n\n"
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
