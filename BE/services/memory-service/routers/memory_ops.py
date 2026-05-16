import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Query
from openai import AsyncOpenAI
from pydantic import BaseModel

from db import settings
from layers import onboarding_state as onboarding
from layers import today_challenge
from layers.long_term import LongTermMemory
from layers.short_term import ShortTermMemory
from workers.consolidation import run_consolidation

SESSION_INSIGHT_PREFIX = "SESSION_INSIGHT:"

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

log = logging.getLogger("memory_ops")
router = APIRouter()


class ConsolidateRequest(BaseModel):
    session_id: str


class AppendRequest(BaseModel):
    session_id: str       # tagged on each message for consolidation filtering
    user_message: str
    ai_message: str


class TodayChallengeRequest(BaseModel):
    challenge: str


# POST /consolidate/:user_id — triggered by orchestrator on session end
@router.post("/consolidate/{user_id}")
async def consolidate(user_id: str, body: ConsolidateRequest, bg: BackgroundTasks):
    log.info("[memory_ops] consolidate queued  user=%s  session=%s", user_id, body.session_id)
    bg.add_task(run_consolidation, user_id, body.session_id)
    return {"status": "queued", "user_id": user_id, "session_id": body.session_id}


# GET /short-term/:user_id — returns recent messages, optionally filtered by session_id
@router.get("/short-term/{user_id}")
async def get_short_term(
    user_id: str,
    session_id: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=500),
):
    if session_id:
        all_msgs = await ShortTermMemory.get_session_messages(user_id, session_id)
        messages = all_msgs[-limit:]
    else:
        messages = await ShortTermMemory.get_recent(user_id, n=limit)
    formatted = "\n".join(
        f"{m['role'].capitalize()}[{m.get('session_id','?')[:8]}]: {m['content']}"
        for m in messages
    )
    log.info("[memory_ops] get_short_term  user=%s  session=%s  returned=%d",
             user_id, session_id or "*", len(messages))
    return {"messages": messages, "formatted": formatted}


# GET /short-term/:user_id/facts — inspect consolidated short-term facts in Redis
@router.get("/short-term/{user_id}/facts")
async def get_st_facts(user_id: str):
    facts = await ShortTermMemory.get_st_facts(user_id)
    log.info("[memory_ops] get_st_facts  user=%s  returned=%d", user_id, len(facts))
    return {"count": len(facts), "facts": facts}


# GET /session-insight/:user_id — fast Redis-only read for the FE mission card and greeting.
# Reads short-term facts, finds the one prefixed "SESSION_INSIGHT:", parses it, and returns
# the structured shape the frontend expects. Never falls back to Postgres — must stay fast.
@router.get("/session-insight/{user_id}")
async def get_session_insight(user_id: str):
    active_mission = await today_challenge.get(user_id)
    active_source = "today_challenge" if active_mission else "none"

    facts = await ShortTermMemory.get_st_facts(user_id)
    raw_fact = next(
        (f for f in facts if f.get("content", "").startswith(SESSION_INSIGHT_PREFIX)),
        None,
    )
    if not raw_fact:
        log.info("[memory_ops] session_insight  user=%s  none", user_id)
        return {
            "has_insight": False,
            "active_mission": active_mission,
            "active_mission_source": active_source,
        }

    try:
        payload = json.loads(raw_fact["content"][len(SESSION_INSIGHT_PREFIX):])
    except Exception:
        log.warning("[memory_ops] session_insight  user=%s  malformed JSON", user_id)
        return {
            "has_insight": False,
            "active_mission": active_mission,
            "active_mission_source": active_source,
        }

    fallback_mission = payload.get("next_challenge")
    if not active_mission and isinstance(fallback_mission, str) and fallback_mission.strip():
        active_mission = fallback_mission.strip()
        active_source = "session_insight"

    days_ago: int | None = None
    extracted_at = raw_fact.get("extracted_at")
    if extracted_at:
        try:
            ts = datetime.fromisoformat(extracted_at)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            delta = datetime.now(timezone.utc) - ts
            days_ago = max(0, int(delta.total_seconds() // 86400))
        except Exception:
            days_ago = None

    log.info("[memory_ops] session_insight  user=%s  days_ago=%s", user_id, days_ago)
    return {
        "has_insight":             True,
        "struggled_with":          payload.get("struggled_with"),
        "improved_vs_before":      payload.get("improved_vs_before"),
        "next_challenge":          payload.get("next_challenge"),
        "active_mission":          active_mission,
        "active_mission_source":   active_source,
        "energy_level":            payload.get("energy_level"),
        "speaking_duration_estimate": payload.get("speaking_duration_estimate"),
        "last_session_days_ago":   days_ago,
        # First-session enrichment (only present when last session was the user's first).
        "is_first_session_insight": payload.get("is_first_session_insight", False),
        "inferred_motivation":     payload.get("inferred_motivation"),
        "confidence_level":        payload.get("confidence_level"),
        "speaking_style":          payload.get("speaking_style"),
        "emotional_energy":        payload.get("emotional_energy"),
        "recommended_next_session": payload.get("recommended_next_session"),
    }


# GET /today-challenge/:user_id — the active mission traffic-controller endpoint.
# Returns the Redis mission if set; otherwise falls back to SESSION_INSIGHT.next_challenge.
@router.get("/today-challenge/{user_id}")
async def get_today_challenge(user_id: str):
    insight = await get_session_insight(user_id)
    mission = insight.get("active_mission")
    return {
        "active_mission": mission,
        "source": insight.get("active_mission_source", "none"),
    }


# PUT /today-challenge/:user_id — optional explicit setter for future mission generators.
# Orchestrator should protect this route and use the authenticated user id.
@router.put("/today-challenge/{user_id}")
async def set_today_challenge(user_id: str, body: TodayChallengeRequest):
    challenge = (body.challenge or "").strip()
    if not challenge:
        await today_challenge.delete(user_id)
        return {"active_mission": None, "source": "none"}
    await today_challenge.save(user_id, challenge)
    return {"active_mission": challenge, "source": "today_challenge"}


# POST /short-term/:user_id/append — called after every turn by turn-agent
@router.post("/short-term/{user_id}/append")
async def append_short_term(user_id: str, body: AppendRequest):
    await ShortTermMemory.append(user_id, body.session_id, body.user_message, body.ai_message)
    return {"status": "ok"}


# ── Onboarding state (24h Redis, used only during the user's first speaking session) ──


_ONBOARDING_EXTRACTION_PROMPT = """\
Analyze this single user message in the context of a language-learning onboarding
conversation. Return ONLY valid JSON, no markdown, no explanation.

Schema:
{
  "motivation":          "casual" | "career" | "travel" | "education" | "social" | "unclear",
  "confidence_signal":   "high" | "medium" | "low" | "unclear",
  "speaking_style":      "verbose" | "brief" | "mixed" | "unclear",
  "emotional_energy":    "excited" | "relaxed" | "nervous" | "neutral" | "unclear",
  "notable_weakness_hint": string | null,
  "extracted_fact":      string | null
}

Rules:
- Base the analysis ONLY on this user message.
- Use "unclear" when there is not enough evidence — do not guess.
- Do not infer sensitive attributes.
- Do not diagnose mental state.
- `extracted_fact`: one plain sentence useful for personalising language practice,
  or null if nothing useful. Avoid judgmental phrasing.

User message:
{transcript}
"""


class OnboardingExtractRequest(BaseModel):
    transcript: str
    session_id: str = ""


# GET /onboarding-state/:user_id — FE/orchestrator polls this during the first session
@router.get("/onboarding-state/{user_id}")
async def get_onboarding_state(user_id: str):
    state = await onboarding.get(user_id)
    return state or {}


# POST /onboarding-extract/:user_id — fired by turn-agent as a background task on
# every onboarding-session turn. Runs the extractor LLM and merges into Redis.
# Failure is intentionally swallowed: this endpoint must never break the turn.
@router.post("/onboarding-extract/{user_id}")
async def extract_onboarding(user_id: str, body: OnboardingExtractRequest):
    transcript = (body.transcript or "").strip()
    if not transcript:
        return {"status": "skipped", "reason": "empty transcript"}

    try:
        res = await _openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _ONBOARDING_EXTRACTION_PROMPT.replace(
                    "{transcript}", transcript[:2000],
                )},
                {"role": "user", "content": transcript[:2000]},
            ],
            response_format={"type": "json_object"},
            max_tokens=400,
        )
        new_state = json.loads(res.choices[0].message.content)
    except Exception as exc:
        log.error("[onboarding-extract] LLM call failed user=%s: %s", user_id, exc)
        return {"status": "error", "reason": "extraction failed"}

    try:
        old = await onboarding.get(user_id)
        merged = onboarding.merge(old, new_state)
        await onboarding.save(user_id, merged)
        log.info("[onboarding-extract] user=%s  session=%s  merged_fields=%s",
                 user_id, body.session_id, sorted(merged.keys()))
        return {"status": "ok", "state": merged}
    except Exception as exc:
        log.error("[onboarding-extract] Redis merge failed user=%s: %s", user_id, exc)
        return {"status": "error", "reason": "merge failed"}


# DELETE /facts/:user_id — GDPR full memory wipe (long-term + short-term rolling buffer)
@router.delete("/facts/{user_id}")
async def delete_facts(user_id: str):
    await LongTermMemory.delete_all(user_id)
    await ShortTermMemory.clear(user_id)
    log.info("[memory_ops] GDPR wipe  user=%s", user_id)
    return {"status": "deleted", "user_id": user_id}


class SessionSummaryRequest(BaseModel):
    summary: str


# GET /short-term/:user_id/summary/:session_id — read rolling session summary
@router.get("/short-term/{user_id}/summary/{session_id}")
async def get_session_summary(user_id: str, session_id: str):
    summary = await ShortTermMemory.get_session_summary(user_id, session_id)
    return {"summary": summary}


# PUT /short-term/:user_id/summary/:session_id — write rolling session summary
@router.put("/short-term/{user_id}/summary/{session_id}")
async def save_session_summary(user_id: str, session_id: str, body: SessionSummaryRequest):
    await ShortTermMemory.save_session_summary(user_id, session_id, body.summary)
    return {"status": "ok"}
