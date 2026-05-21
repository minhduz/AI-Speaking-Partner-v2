import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from openai import AsyncOpenAI

from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from layers import onboarding_state as onboarding
from layers import today_challenge
from layers import session_evaluation
from layers.exercise_deck import ExerciseDeckService
from db import database, settings


def _build_deck_context(deck: dict | None) -> dict | None:
    """
    Distil the deck blob into the fields the consolidation LLM actually needs.
    Returning None means "no deck this session" — the prompt branch should skip
    deck-aware reasoning entirely.
    """
    if not deck or not deck.get("cards"):
        return None
    cards = deck["cards"]
    completed = sum(1 for c in cards if c.get("status") == "completed")
    skipped   = sum(1 for c in cards if c.get("status") == "skipped")
    card_results = [
        {
            "type":     c.get("type"),
            "result":   c.get("result"),
            "status":   c.get("status"),
            "attempts": c.get("attempts", 0),
        }
        for c in cards
    ]
    # Cards that weren't completed — useful for next-session continuation offer.
    unfinished = [
        {
            "title":            c.get("title"),
            "type":             c.get("type"),
            "task":             c.get("task"),
            "success_criteria": c.get("success_criteria"),
            "expected_duration_seconds": c.get("expected_duration_seconds", 60),
        }
        for c in cards
        if c.get("status") in ("skipped", "not_started") and c.get("title")
    ]
    return {
        "session_type":       deck.get("session_type"),
        "mission":            deck.get("mission"),
        "deck_status":        deck.get("status"),
        "end_reason":         deck.get("end_reason"),
        "completed_cards":    completed,
        "skipped_cards":      skipped,
        "total_cards":        len(cards),
        "card_results":       card_results,
        "unfinished_cards":   unfinished,
    }


# Maps onboarding motivation → a recommended challenge for the next session.
# Used by first-session consolidation only; keep neutral, never judgmental.
_MOTIVATION_TO_CHALLENGE = {
    "casual":    "Have a relaxed 5-minute conversation about something that happened this week.",
    "career":    "Practice introducing yourself confidently in a professional context.",
    "travel":    "Handle a short travel problem, such as a delayed flight or hotel check-in.",
    "education": "Explain a topic you know well as if teaching someone younger.",
    "social":    "Tell a short story about a memorable experience with another person.",
}


def _enrich_first_session_insight(insight: dict, ob_state: dict) -> dict:
    """
    Fold onboarding signals into the first session_insight. Never overwrites
    confident values already in `insight`; only fills gaps.
    """
    insight = dict(insight or {})
    insight["is_first_session_insight"] = True
    insight["source"] = "onboarding_conversation"

    insight["inferred_motivation"] = (
        insight.get("inferred_motivation") or ob_state.get("motivation")
    )
    insight["confidence_level"] = (
        insight.get("confidence_level") or ob_state.get("confidence_signal")
    )
    insight["speaking_style"] = (
        insight.get("speaking_style") or ob_state.get("speaking_style")
    )
    insight["emotional_energy"] = (
        insight.get("emotional_energy") or ob_state.get("emotional_energy")
    )

    insight.setdefault("speaking_weaknesses", [])
    for weakness in ob_state.get("notable_weakness_hints", []) or []:
        if weakness and weakness not in insight["speaking_weaknesses"]:
            insight["speaking_weaknesses"].append(weakness)

    insight.setdefault("evidence", [])
    for fact in ob_state.get("facts", []) or []:
        if fact and fact not in insight["evidence"]:
            insight["evidence"].append(fact)

    motivation = ob_state.get("motivation")
    if motivation in _MOTIVATION_TO_CHALLENGE and not insight.get("recommended_next_session"):
        insight["recommended_next_session"] = {
            "type":               motivation,
            "reason":             "Based on the user's first conversation signals.",
            "suggested_challenge": _MOTIVATION_TO_CHALLENGE[motivation],
        }

    return insight

log = logging.getLogger("consolidation")
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

MAX_FACTS = 50          # hard cap before long-term compression
SHORT_TERM_MAX_FACTS = 20  # compact cap for short-term Redis facts

# Pricing (USD per 1M tokens)
_GPT4O_MINI_IN  = 0.15
_GPT4O_MINI_OUT = 0.60
_EMBED_PRICE    = 0.020


def _usd(prompt: int = 0, completion: int = 0, embed: int = 0) -> float:
    return (prompt * _GPT4O_MINI_IN + completion * _GPT4O_MINI_OUT) / 1_000_000 \
         + embed * _EMBED_PRICE / 1_000_000


def _safe_zoneinfo(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        log.warning("invalid user timezone %r; falling back to UTC", tz_name)
        return ZoneInfo("UTC")


def _format_offset(dt: datetime) -> str:
    offset = dt.strftime("%z")
    return f"{offset[:3]}:{offset[3:]}" if offset else "+00:00"


async def run_consolidation(user_id: str, session_id: str, user_timezone: str = "UTC"):
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

        # 2. Resolve session start time. Keep UTC for storage/comparison, but
        # anchor LLM temporal extraction in the user's own timezone so phrases
        # like "this afternoon at 13:00" are not incorrectly stamped as UTC.
        session_start_utc = _parse_session_time(messages)
        user_tz = _safe_zoneinfo(user_timezone)
        session_start_local = session_start_utc.astimezone(user_tz)
        log.info("step 2 — session time: utc=%s local=%s tz=%s",
                 session_start_utc.isoformat(), session_start_local.isoformat(), user_tz.key)

        # 3. LLM extracts long-term and short-term facts in parallel — only use last 60 messages
        CONSOLIDATION_WINDOW = 60
        messages_to_extract = messages[-CONSOLIDATION_WINDOW:]
        if len(messages) > CONSOLIDATION_WINDOW:
            log.info("step 3 — truncating %d messages to last %d for fact extraction",
                     len(messages), CONSOLIDATION_WINDOW)
        conversation = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in messages_to_extract
        )

        # Phase 6 — read deck blob from Redis. session.end() already marked
        # end_reason before triggering consolidation, so the blob reflects how
        # the session ended (completed / ended_early / abandoned).
        try:
            raw_deck = await ExerciseDeckService.get_deck(session_id)
        except Exception as deck_err:
            log.warning("step 3 — deck fetch failed: %s", deck_err)
            raw_deck = None
        deck_context = _build_deck_context(raw_deck)
        if deck_context:
            log.info(
                "step 3 — deck_context  status=%s  end_reason=%s  cards=%d/%d  skipped=%d",
                deck_context["deck_status"], deck_context["end_reason"],
                deck_context["completed_cards"], deck_context["total_cards"],
                deck_context["skipped_cards"],
            )
        else:
            log.info("step 3 — no deck for this session (free-form turn flow)")

        # Start the user-facing breakdown immediately. It has its own focused
        # LLM pass and persists to sessions.breakdown independently, so the UI
        # can show coaching feedback while memory consolidation continues.
        asyncio.create_task(_build_and_persist_breakdown(
            user_id=user_id,
            session_id=session_id,
            raw_deck=raw_deck,
            messages=messages,
            session_start_utc=session_start_utc,
        ))
        log.info("step 2.5 — session breakdown task started  session=%s", session_id)

        log.info("step 3 — calling LLM (combined long-term + short-term) from %d messages",
                 len(messages_to_extract))
        extract_usage = None
        try:
            _all, extract_usage = await _extract_all_facts(
                conversation, session_start_utc,
                user_timezone=user_tz.key,
                session_start_local=session_start_local,
                user_turn_count=_count_user_turns(messages_to_extract),
                deck_context=deck_context,
            )
            raw_facts: list[dict]    = _all.get("long_term", [])
            raw_st_facts: list[dict] = _all.get("short_term", [])
            session_insight: dict | None = _all.get("session_insight")
        except Exception as exc:
            log.error("step 3 — combined extraction FAILED: %s", exc, exc_info=True)
            raw_facts, raw_st_facts, session_insight = [], [], None
        log.info("step 3 — long-term: %d raw facts, short-term: %d raw facts, session_insight=%s",
                 len(raw_facts), len(raw_st_facts), "yes" if session_insight else "no")

        # Inject unfinished deck info deterministically — no LLM needed.
        # If the deck ended early with cards still not done, store them so the
        # next session can offer to retry them (deck continuation feature).
        if deck_context and session_insight is not None:
            unfinished = deck_context.get("unfinished_cards", [])
            if unfinished and deck_context.get("deck_status") == "ended_early":
                session_insight["unfinished_deck_cards"] = unfinished
                session_insight["deck_mission"] = deck_context.get("mission")
                log.info(
                    "step 3 — injected unfinished_deck_cards=%d  mission=%r",
                    len(unfinished), deck_context.get("mission"),
                )

        # 3b. If this user has an onboarding state in Redis, this is their first
        # speaking session. Fold the extracted onboarding signals into the
        # session_insight so the next session's greeting can reference them.
        try:
            ob_state = await onboarding.get(user_id)
        except Exception as ob_err:
            log.warning("step 3b — onboarding state fetch failed user=%s: %s", user_id, ob_err)
            ob_state = {}
        is_first_session_consolidation = bool(ob_state)
        if is_first_session_consolidation:
            log.info("step 3b — first-session consolidation: merging onboarding state "
                     "(fields=%s)", sorted(ob_state.keys()))
            session_insight = _enrich_first_session_insight(session_insight or {}, ob_state)

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

        # Append a one-line session log to long-term memory for trajectory tracking.
        # Format: "Session log [YYYY-MM-DD]: struggled with X, improved on Y, energy=Z"
        if session_insight and _has_insight_content(session_insight):
            struggled  = (session_insight.get("struggled_with")     or "nothing notable").strip()
            improved   = (session_insight.get("improved_vs_before") or "nothing noted").strip()
            energy     = (session_insight.get("energy_level")       or "medium").strip()
            session_log_line = (
                f"Session log [{session_start_utc.strftime('%Y-%m-%d')}]: "
                f"struggled with {struggled}, improved on {improved}, energy={energy}"
            )
            new_facts.append({
                "content":    session_log_line,
                "priority":   "normal",
                "added_at":   now,
                "expires_at": default_expires,
            })
            log.info("  [new][session-log] %r", session_log_line[:100])

        # 5. Load existing per-fact rows, prune expired, merge with new facts
        existing_facts = await LongTermMemory.get_facts(user_id)
        log.info("step 5 — loaded %d existing facts", len(existing_facts))

        active_existing = _prune_expired(existing_facts, now)
        pruned_count = len(existing_facts) - len(active_existing)
        log.info("step 5 — pruned %d expired, %d remain", pruned_count, len(active_existing))

        merged = _merge(active_existing, new_facts)
        log.info("step 5 — merged → %d total facts", len(merged))

        # 6. Compress if above hard cap
        compress_usage = None
        if len(merged) > MAX_FACTS:
            log.info("step 6 — %d facts exceeds cap %d, compressing", len(merged), MAX_FACTS)
            merged, compress_usage = await _compress_facts(merged)
            log.info("step 6 — compressed to %d facts", len(merged))
        else:
            log.info("step 6 — skip compression (%d ≤ %d)", len(merged), MAX_FACTS)

        # 7. Batch-embed all facts in a single API call
        texts = [f["content"] for f in merged]
        embed_tokens = 0
        if texts:
            log.info("step 7 — batch-embedding %d facts", len(texts))
            embeddings, embed_tokens = await _batch_embed(texts)
        else:
            embeddings = []
        log.info("step 7 — embeddings ready")

        # 8. Atomically replace all per-fact rows
        await LongTermMemory.replace_facts(user_id, merged, embeddings)
        log.info("step 8 — replaced all per-fact rows (%d facts)", len(merged))

        # 9. Rolling buffer is NOT cleared — it's a user-scoped window that persists across sessions.
        #    The MAX_ENTRIES cap in ShortTermMemory handles pruning automatically.
        log.info("step 9 — rolling buffer preserved (user-scoped, self-pruning)")

        # 10. Short-term consolidation: stamp, merge with existing, cap, store in Redis
        #     Runs in its own try/except — a failure here must not invalidate the
        #     long-term consolidation that already completed in steps 4-8.
        try:
            log.info("step 10 — starting short-term consolidation  raw_st_facts=%d", len(raw_st_facts))
            now_st = datetime.now(timezone.utc)
            st_expires = now_st + timedelta(seconds=settings.short_term_ttl_seconds)
            new_st_facts: list[dict] = []

            # SESSION_INSIGHT is stored FIRST so it gets priority during retrieval.
            # It is identified by the "SESSION_INSIGHT:" content prefix.
            # First-session insights also carry the onboarding-enriched fields so
            # the next greeting can reference them naturally (CHANGE L).
            insight_payload_keys = (
                "struggled_with",
                "improved_vs_before",
                "next_challenge",
                "speaking_duration_estimate",
                "energy_level",
                # Phase 6 — deck-aware trajectory fields
                "code_switch_pattern",
                "code_switch_trigger",
                "deck_completion",
                "recommended_next_mode",
                # Onboarding-enriched fields (present on first-session insight only)
                "is_first_session_insight",
                "source",
                "inferred_motivation",
                "confidence_level",
                "speaking_style",
                "emotional_energy",
                "recommended_next_session",
                # Deck continuation fields (deterministically injected above)
                "unfinished_deck_cards",
                "deck_mission",
            )
            if session_insight and _has_insight_content(session_insight):
                insight_payload = {
                    k: session_insight.get(k)
                    for k in insight_payload_keys
                    if session_insight.get(k) is not None
                }
                insight_fact = {
                    "content":      "SESSION_INSIGHT:" + json.dumps(insight_payload, ensure_ascii=False),
                    "priority":     "urgent",
                    "extracted_at": now_st.isoformat(),
                    "expires_at":   st_expires.isoformat(),
                }
                new_st_facts.append(insight_fact)
                log.info("  [st-new][SESSION_INSIGHT] %r", insight_fact["content"][:120])

            for raw in raw_st_facts:
                content = raw.get("content", "").strip()
                if not content:
                    continue
                st_fact = {
                    "content":      content,
                    "priority":     raw.get("priority", "urgent"),
                    "extracted_at": now_st.isoformat(),
                    "expires_at":   st_expires.isoformat(),
                }
                new_st_facts.append(st_fact)
                log.info("  [st-new] priority=%-6s  %r", st_fact["priority"], content[:80])

            if not new_st_facts:
                log.info("step 10 — LLM found no qualifying short-term facts for this session")

            existing_st = await ShortTermMemory.get_st_facts(user_id)
            log.info("step 10 — existing st_facts in Redis: %d", len(existing_st))

            merged_st = _merge_st(existing_st, new_st_facts)
            log.info("step 10 — merged → %d short-term facts", len(merged_st))

            if len(merged_st) > SHORT_TERM_MAX_FACTS:
                _PRIORITY_ORDER = {"urgent": 0, "high": 1}
                merged_st = sorted(
                    merged_st,
                    key=lambda f: _PRIORITY_ORDER.get(f.get("priority", "high"), 2),
                )
                merged_st = merged_st[:SHORT_TERM_MAX_FACTS]
                log.info("step 10 — capped to %d short-term facts", SHORT_TERM_MAX_FACTS)

            await ShortTermMemory.replace_st_facts(user_id, merged_st)
            log.info("step 10 — ✓ stored %d short-term facts in Redis key user:%s:st_facts",
                     len(merged_st), user_id)

            if session_insight:
                next_challenge = (session_insight.get("next_challenge") or "").strip()
                if next_challenge:
                    await today_challenge.save(user_id, next_challenge)
                    log.info("step 10 — promoted next_challenge to today_challenge")
        except Exception as st_err:
            log.error("step 10 — short-term consolidation FAILED (long-term already saved): %s",
                      st_err, exc_info=True)
            merged_st = []

        extract_p  = extract_usage.prompt_tokens     if extract_usage  else 0
        extract_c  = extract_usage.completion_tokens if extract_usage  else 0
        compress_p = compress_usage.prompt_tokens     if compress_usage else 0
        compress_c = compress_usage.completion_tokens if compress_usage else 0
        total_usd  = _usd(extract_p, extract_c) + _usd(compress_p, compress_c) + _usd(embed=embed_tokens)
        log.info(
            "[token] consolidation_summary  user=%s  session=%s  "
            "extract_prompt=%d  extract_completion=%d  "
            "compress_prompt=%d  compress_completion=%d  "
            "embed_tokens=%d  total_cost=$%.6f",
            user_id, session_id,
            extract_p, extract_c,
            compress_p, compress_c,
            embed_tokens, total_usd,
        )

        await _mark_done(user_id, session_id, len(new_facts), pruned_count)
        log.info("── done  new_facts=%d  pruned=%d  total=%d  st_facts=%d",
                 len(new_facts), pruned_count, len(merged), len(merged_st))

        # 11. First-session cleanup — only delete onboarding state once consolidation
        # has committed. On failure we leave Redis alone so the 24h TTL lets a retry
        # (or a manual retrigger) still see the state.
        if is_first_session_consolidation:
            try:
                await onboarding.delete(user_id)
            except Exception as cleanup_err:
                log.warning("step 11 — onboarding cleanup failed user=%s: %s",
                            user_id, cleanup_err)

    except Exception as e:
        log.error("✖ FAILED: %s", e, exc_info=True)
        await database.execute(
            """UPDATE memory.consolidation_jobs
               SET status = 'failed', completed_at = NOW()
               WHERE user_id = $1 AND session_id = $2""",
            user_id, session_id,
        )


# ── helpers ──────────────────────────────────────────────────────────────────

async def _build_and_persist_breakdown(
    *,
    user_id: str,
    session_id: str,
    raw_deck: dict | None,
    messages: list[dict],
    session_start_utc: datetime,
):
    """
    Build the visible coaching report independently from memory consolidation.

    This task is intentionally started as soon as we have messages + deck data.
    Persist a useful deterministic report first so the frontend does not poll
    forever, then overwrite it with the richer LLM report when ready.
    """
    fallback_report = session_evaluation.build_report(
        session_insight=None,
        raw_deck=raw_deck,
        messages=messages,
        session_start_utc=session_start_utc,
        session_id=session_id,
    )
    await _persist_session_breakdown(
        user_id=user_id,
        session_id=session_id,
        report=fallback_report,
    )

    try:
        report = await asyncio.wait_for(
            session_evaluation.build_rich_report(
                openai_client=_openai,
                raw_deck=raw_deck,
                messages=messages,
                session_start_utc=session_start_utc,
                session_id=session_id,
            ),
            timeout=45,
        )
    except Exception as report_err:
        log.error(
            "step 2.5 — rich session breakdown FAILED, keeping fallback  user=%s  session=%s: %s",
            user_id,
            session_id,
            report_err,
            exc_info=True,
        )
        return

    try:
        await database.execute(
            "UPDATE speaking_app.sessions SET breakdown = $1::jsonb WHERE id = $2",
            json.dumps(report, ensure_ascii=False, default=str),
            session_id,
        )
        log.info(
            "step 2.5 — session breakdown persisted  session=%s  quality=%s  corrections=%d  radar=%d",
            session_id,
            report.get("quality", "unknown"),
            len(report.get("corrections", [])),
            len(report.get("skill_radar", [])),
        )
    except Exception as persist_err:
        log.error(
            "step 2.5 — session breakdown persist FAILED  user=%s  session=%s: %s",
            user_id,
            session_id,
            persist_err,
            exc_info=True,
        )


async def _persist_session_breakdown(*, user_id: str, session_id: str, report: dict):
    try:
        await database.execute(
            "UPDATE speaking_app.sessions SET breakdown = $1::jsonb WHERE id = $2",
            json.dumps(report, ensure_ascii=False, default=str),
            session_id,
        )
        log.info(
            "step 2.5 - session breakdown persisted  session=%s  quality=%s  corrections=%d  radar=%d",
            session_id,
            report.get("quality", "unknown"),
            len(report.get("corrections", [])),
            len(report.get("skill_radar", [])),
        )
    except Exception as persist_err:
        log.error(
            "step 2.5 - session breakdown persist FAILED  user=%s  session=%s: %s",
            user_id,
            session_id,
            persist_err,
            exc_info=True,
        )


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


async def _compress_facts(facts: list[dict]) -> tuple[list[dict], object]:
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
    usage = res.usage
    log.info("[token] compress_facts  prompt=%d  completion=%d  total=%d  cost=$%.6f",
             usage.prompt_tokens, usage.completion_tokens, usage.total_tokens,
             _usd(usage.prompt_tokens, usage.completion_tokens))
    try:
        compressed = json.loads(res.choices[0].message.content).get("facts", [])
    except Exception:
        log.warning("_compress_facts: LLM parse failed, returning original")
        return facts, usage

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
    return result, usage


async def _batch_embed(texts: list[str]) -> tuple[list[list[float]], int]:
    """Single OpenAI API call for all fact texts."""
    res = await _openai.embeddings.create(
        model=settings.embedding_model,
        input=texts,
    )
    embed_tokens = res.usage.total_tokens
    log.info("[token] batch_embed  tokens=%d  cost=$%.6f",
             embed_tokens, _usd(embed=embed_tokens))
    # API returns embeddings in the same order as input
    ordered = sorted(res.data, key=lambda e: e.index)
    return [e.embedding for e in ordered], embed_tokens


async def _extract_all_facts(
    conversation: str,
    session_start_utc: datetime,
    user_timezone: str = "UTC",
    session_start_local: datetime | None = None,
    user_turn_count: int = 0,
    deck_context: dict | None = None,
) -> tuple[dict, object]:
    """
    Single LLM call that extracts long-term facts, short-term facts, AND
    a structured `session_insight` block used to drive trajectory.
    Returns {"long_term": [...], "short_term": [...], "session_insight": {...} | None}.
    """
    local_start = session_start_local or session_start_utc
    tz_offset = _format_offset(local_start)
    fmt_time = (
        f"{local_start.strftime('%A, %B %d, %Y at %I:%M %p')} "
        f"{user_timezone} (UTC{tz_offset})"
    )
    week_end  = (local_start + timedelta(days=7)).strftime("%A, %B %d, %Y")
    example_dt = local_start + timedelta(minutes=10)
    example_abs = (
        f"{example_dt.strftime('%I:%M %p on %A, %B %d, %Y')} "
        f"{user_timezone} (UTC{_format_offset(example_dt)})"
    )
    # Sessions shorter than 4 user turns can't reliably be judged for trajectory.
    insight_too_short = user_turn_count < 4

    insight_instructions = (
        "── session_insight ──\n"
        "A structured snapshot of THIS session's trajectory, extracted from USER turns only.\n"
        "Return as an object (NOT an array) with these exact keys:\n"
        "  {\n"
        '    "struggled_with":              string | null,\n'
        '    "improved_vs_before":          string | null,\n'
        '    "next_challenge":              string | null,\n'
        '    "speaking_duration_estimate":  "short" | "medium" | "long" | null,\n'
        '    "energy_level":                "low" | "medium" | "high" | null,\n'
        '    "code_switch_pattern":         "none" | "low" | "medium" | "high" | null,\n'
        '    "code_switch_trigger":         "vocabulary_gap" | "grammar_uncertainty" | "both" | "unknown" | null,\n'
        '    "deck_completion":             object | null,\n'
        '    "recommended_next_mode":       "new_deck" | "resume_deck" | "lighter_deck" | "quick_practice" | null\n'
        "  }\n"
        "Rules:\n"
        "- `struggled_with` MUST be specific and behavioral, never vague.\n"
        "  BAD: \"fluency\"  GOOD: \"stopped mid-sentence when asked follow-up questions\".\n"
        "- `improved_vs_before` is null if not clearly noticeable.\n"
        "- `next_challenge` MUST be a concrete, actionable instruction the AI can use in the next greeting.\n"
        "  GOOD: \"Ask the user to tell a 2-minute story without stopping\".\n"
        "- `speaking_duration_estimate`: rough estimate of how much the user spoke overall.\n"
        "- `energy_level`: based on engagement and response depth.\n"
        "- `code_switch_pattern` / `code_switch_trigger`: did the user fall back to their native language?\n"
        "  If yes, was it because they didn't know the word (vocabulary_gap), didn't know how to phrase it (grammar_uncertainty), or both?\n"
        "  Use \"none\" + null trigger if the user stayed in the target language throughout.\n"
        "- Extract from USER turns only, never from the AI coach's turns.\n"
    )
    if insight_too_short:
        insight_instructions += (
            "- THIS SESSION HAD FEWER THAN 4 USER TURNS — set ALL fields to null.\n"
        )

    # Phase 6 — deck-aware instructions. Only injected when a deck exists for
    # this session; otherwise the prompt stays unchanged so consolidation of
    # free-form turn sessions isn't affected.
    deck_block = ""
    if deck_context and not insight_too_short:
        deck_json = json.dumps(deck_context, ensure_ascii=False)
        deck_block = (
            "\n── deck context for THIS session ──\n"
            f"{deck_json}\n"
            "Use this when populating `deck_completion` and `recommended_next_mode`:\n"
            "- `deck_completion` MUST be an object: "
            '{"status": "completed"|"ended_early"|"abandoned", '
            '"completed_cards": int, "total_cards": int, '
            '"end_reason": string}. Copy directly from the deck context above.\n'
            "- This session may be PARTIALLY completed. Do NOT treat early ending as failure.\n"
            "- Extract useful progress from completed/attempted cards only — ignore cards that were never attempted.\n"
            "- If `end_reason == \"low_energy_detected\"` or the user signalled tiredness → set "
            '`recommended_next_mode = "lighter_deck"`.\n'
            "- If `deck_status == \"ended_early\"` and several cards remain → "
            '`recommended_next_mode = "resume_deck"`.\n'
            "- If `deck_status == \"completed\"` → `recommended_next_mode = \"new_deck\"` "
            "and `next_challenge` should advance to the next skill.\n"
            "- If `end_reason == \"idle_timeout\"` → do NOT assume motivation or emotion. "
            "Set `energy_level = null` and `recommended_next_mode = \"quick_practice\"`.\n"
            "- `next_challenge` MUST be coherent with the deck mission, not invent a new one.\n"
        )
    insight_instructions += deck_block

    res = await _openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"The conversation took place on {fmt_time}.\n"
                    f"All relative times in the user's words are relative to {user_timezone}, not UTC.\n\n"
                    "Extract facts about the USER from this conversation.\n"
                    "Return ONLY valid JSON with this exact structure:\n"
                    "{\n"
                    '  "long_term": [...],\n'
                    '  "short_term": [...],\n'
                    '  "session_insight": {...}\n'
                    "}\n\n"
                    "── long_term ──\n"
                    "Durable facts about the user — extract even from brief or casual mentions.\n"
                    "Each object: {\"content\": string, \"priority\": \"urgent\"|\"high\"|\"normal\"}\n"
                    "  urgent = time-sensitive within 7 days (exam, appointment, deadline)\n"
                    "  high   = important personal goal, job, study plan, family situation\n"
                    "  normal = preferences, hobbies, pets, family members, relationships, background\n"
                    "Extract facts even when stated as corrections or clarifications:\n"
                    "  'I mean my dog named Kiki'  → {\"content\": \"User has a dog named Kiki\", \"priority\": \"normal\"}\n"
                    "  'Actually I have two cats'  → {\"content\": \"User has two cats\", \"priority\": \"normal\"}\n"
                    "For time-sensitive facts embed the absolute local date/time in content with timezone:\n"
                    f"  Bad:  'User has an exam in 10 minutes'\n"
                    f"  Good: 'User has an exam at {example_abs}'\n\n"
                    "── short_term ──\n"
                    f"ONLY USER facts relevant within the next 7 days (by {week_end}).\n"
                    "Each object: {\"content\": string, \"priority\": \"urgent\"|\"high\"}\n"
                    "Content MUST describe the event AND its absolute local date/time with timezone:\n"
                    f"  BAD:  '{example_abs}'\n"
                    f"  GOOD: 'User has a meeting at {example_abs}'\n"
                    "Include only: upcoming meetings, appointments, deadlines, exams within 7 days, "
                    "active urgent situations.\n"
                    "Never use relative terms — always absolute date/time in the user's timezone.\n"
                    "Return empty array if no qualifying facts.\n\n"
                    + insight_instructions +
                    "\nDO NOT extract (for long_term / short_term):\n"
                    "  - The user's name, language being studied, or proficiency level (stored in profile)\n"
                    "  - Anything said by the AI coach\n"
                    "  - Pure greetings or filler with zero personal information"
                ),
            },
            {"role": "user", "content": conversation},
        ],
        response_format={"type": "json_object"},
        max_tokens=1100,
    )
    usage = res.usage
    log.info("[token] extract_facts  prompt=%d  completion=%d  total=%d  cost=$%.6f",
             usage.prompt_tokens, usage.completion_tokens, usage.total_tokens,
             _usd(usage.prompt_tokens, usage.completion_tokens))
    try:
        data = json.loads(res.choices[0].message.content)
        insight = data.get("session_insight")
        # Normalize: if LLM returned an empty/invalid object or this session was too short,
        # treat as no insight.
        if insight_too_short or not isinstance(insight, dict):
            insight = None
        return {
            "long_term":      data.get("long_term", []),
            "short_term":     data.get("short_term", []),
            "session_insight": insight,
        }, usage
    except Exception:
        return {"long_term": [], "short_term": [], "session_insight": None}, usage


def _st_merge_key(content: str) -> str:
    key = content.lower().strip()
    key = re.sub(r"\b0(\d:\d{2}\s*[ap]m)\b", r"\1", key)
    key = re.sub(r"\s+\(?utc[+-]?\d{0,2}:?\d{0,2}\)?$", "", key)
    key = re.sub(r"\s+[a-z_]+/[a-z_]+(?:\s+\(utc[+-]\d{2}:\d{2}\))?$", "", key)
    return key[:90]


def _merge_st(existing: list[dict], new_facts: list[dict]) -> list[dict]:
    """
    Merge new short-term facts into existing.

    Special case: SESSION_INSIGHT facts are matched by their "SESSION_INSIGHT:" prefix
    (only one is allowed at a time — the newest session always replaces the older).
    Other facts merge by first-60-char content key.
    """
    SESSION_INSIGHT_PREFIX = "SESSION_INSIGHT:"
    result: list[dict] = []
    # Drop any pre-existing SESSION_INSIGHT — the new one in new_facts (if any) replaces it.
    new_has_insight = any(f.get("content", "").startswith(SESSION_INSIGHT_PREFIX) for f in new_facts)
    for ef in existing:
        if new_has_insight and ef.get("content", "").startswith(SESSION_INSIGHT_PREFIX):
            continue
        result.append(ef)

    for new in new_facts:
        if new.get("content", "").startswith(SESSION_INSIGHT_PREFIX):
            # Always insert SESSION_INSIGHT first (highest retrieval priority).
            result.insert(0, new)
            continue
        key = _st_merge_key(new["content"])
        replaced = False
        for i, ef in enumerate(result):
            if _st_merge_key(ef["content"]) == key:
                result[i] = new
                replaced = True
                break
        if not replaced:
            result.append(new)

    deduped: list[dict] = []
    seen: set[str] = set()
    for fact in result:
        content = fact.get("content", "")
        key = SESSION_INSIGHT_PREFIX if content.startswith(SESSION_INSIGHT_PREFIX) else _st_merge_key(content)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(fact)
    return deduped



def _count_user_turns(messages: list[dict]) -> int:
    return sum(1 for m in messages if m.get("role") == "user")


def _has_insight_content(insight: dict | None) -> bool:
    if not insight:
        return False
    return any(
        insight.get(k)
        for k in (
            "struggled_with",
            "improved_vs_before",
            "next_challenge",
            # First-session enrichment may carry only these from the onboarding state
            "inferred_motivation",
            "confidence_level",
            "speaking_style",
            "emotional_energy",
        )
    )


async def _mark_done(user_id: str, session_id: str, written: int, pruned: int):
    await database.execute(
        """UPDATE memory.consolidation_jobs
           SET status = 'done', facts_written = $3, facts_pruned = $4, completed_at = NOW()
           WHERE user_id = $1 AND session_id = $2 AND status = 'processing'""",
        user_id, session_id, written, pruned,
    )
