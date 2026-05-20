"""
User-facing session evaluation reports.

The consolidation worker starts this report early in a separate async task and
persists it to speaking_app.sessions.breakdown. The report is independent from
memory consolidation so the UI can show coaching feedback while embeddings and
long-term memory updates continue in the background.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("session_evaluation")

SKILLS = [
    "Fluency",
    "Grammar",
    "Vocabulary",
    "Pronunciation",
    "Conversation confidence",
]
LEVELS = {"Strong", "Okay", "Needs work"}


def build_report(
    *,
    session_insight: dict | None = None,
    raw_deck: dict | None,
    messages: list[dict],
    session_start_utc: datetime,
    session_id: str | None = None,
) -> dict:
    """
    Build a deterministic fallback report from data already available.

    This intentionally does not call an LLM. The richer report below adds
    corrections, skill radar, recurring pattern, and next drill.
    """
    insight = session_insight or {}
    struggled = (insight.get("struggled_with") or "").strip()
    improved = (insight.get("improved_vs_before") or "").strip()
    next_chall = (insight.get("next_challenge") or "").strip()
    energy = (insight.get("energy_level") or "").strip()

    cards_out, cards_completed, cards_total, cards_skipped, deck_status = _card_stats(raw_deck)
    user_msgs = _user_messages(messages)
    spoken_samples = [s for s in sorted(set(user_msgs), key=len, reverse=True)[:3]]
    duration_minutes = _duration_minutes(messages, session_start_utc)

    highlights: list[str] = []
    if improved:
        highlights.append(improved)
    if cards_total and cards_completed:
        highlights.append(f"Completed {cards_completed} of {cards_total} exercises")

    growth_areas: list[str] = []
    if struggled:
        growth_areas.append(struggled)

    if cards_total and deck_status == "completed":
        summary = f"You finished all {cards_total} exercises today. Keep the momentum going."
    elif cards_total:
        summary = f"You worked through {cards_completed} of {cards_total} exercises today."
    elif user_msgs:
        summary = f"You spoke across {len(user_msgs)} turns today. Every bit of practice counts."
    else:
        summary = "Session complete."

    report = {
        "status": "ready",
        "quality": "basic",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "highlights": highlights,
        "growth_areas": growth_areas,
        "next_focus": next_chall,
        "energy": energy,
        "cards": cards_out,
        "spoken_samples": spoken_samples,
        "corrections": [],
        "skill_radar": [],
        "recurring_pattern": None,
        "next_drill": None,
        "stats": {
            "user_turns": len(user_msgs),
            "cards_completed": cards_completed,
            "cards_total": cards_total,
            "cards_skipped": cards_skipped,
            "duration_minutes": duration_minutes,
        },
    }
    if session_id:
        report["session_id"] = session_id
    return report


async def build_rich_report(
    *,
    openai_client: Any,
    raw_deck: dict | None,
    messages: list[dict],
    session_start_utc: datetime,
    session_id: str,
    model: str = "gpt-4o-mini",
) -> dict:
    """
    Build a coaching-grade report with one focused LLM pass.

    The output schema is kept backward-compatible with the existing UI fields
    and adds:
      - corrections: [{you_said, try_this, why}]
      - skill_radar: [{skill, level, evidence}]
      - recurring_pattern: {title, evidence, practice_tip} | null
      - next_drill: {title, steps, success_criteria} | null
    """
    base = build_report(
        session_insight=None,
        raw_deck=raw_deck,
        messages=messages,
        session_start_utc=session_start_utc,
        session_id=session_id,
    )
    user_msgs = _user_messages(messages)
    if not user_msgs:
        return base

    prompt_payload = {
        "transcript": _conversation_for_prompt(messages),
        "deck": _deck_for_prompt(raw_deck),
        "session_stats": base["stats"],
    }

    res = await openai_client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a practical English speaking coach. Build a concise, "
                    "specific session report for the learner.\n\n"
                    "Return ONLY valid JSON with this exact shape:\n"
                    "{\n"
                    '  "summary": string,\n'
                    '  "highlights": string[],\n'
                    '  "growth_areas": string[],\n'
                    '  "next_focus": string,\n'
                    '  "corrections": [\n'
                    '    {"you_said": string, "try_this": string, "why": string}\n'
                    "  ],\n"
                    '  "skill_radar": [\n'
                    '    {"skill": string, "level": "Strong"|"Okay"|"Needs work", "evidence": string}\n'
                    "  ],\n"
                    '  "recurring_pattern": {"title": string, "evidence": string, "practice_tip": string} | null,\n'
                    '  "next_drill": {"title": string, "steps": string[], "success_criteria": string} | null\n'
                    "}\n\n"
                    "Rules:\n"
                    "- Make corrections from the learner's real utterances only. Do not invent mistakes.\n"
                    "- Include at most 3 corrections. Prefer high-impact grammar, word choice, or naturalness fixes.\n"
                    "- `you_said` should quote or lightly clean the learner's original words.\n"
                    "- `try_this` should be a natural corrected sentence.\n"
                    "- `why` should explain the rule in one short learner-friendly sentence.\n"
                    "- `skill_radar` must contain exactly these 5 skills in this order: "
                    "Fluency, Grammar, Vocabulary, Pronunciation, Conversation confidence.\n"
                    "- For Pronunciation, be honest: if only transcript text is available, say that the evidence is transcript-only.\n"
                    "- `recurring_pattern` should name one repeated habit, not a one-off mistake.\n"
                    "- `next_drill` should be a small exercise the learner can do in the next session.\n"
                    "- Keep every string short and concrete. No generic praise like 'Good job'."
                ),
            },
            {"role": "user", "content": json.dumps(prompt_payload, ensure_ascii=False)},
        ],
        response_format={"type": "json_object"},
        max_tokens=1100,
    )

    usage = getattr(res, "usage", None)
    if usage:
        log.info(
            "[token] session_evaluation prompt=%d completion=%d total=%d",
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.total_tokens,
        )

    data = json.loads(res.choices[0].message.content)
    enriched = dict(base)
    enriched.update({
        "quality": "rich",
        "summary": _text(data.get("summary")) or base["summary"],
        "highlights": _string_list(data.get("highlights"), limit=3) or base["highlights"],
        "growth_areas": _string_list(data.get("growth_areas"), limit=3) or base["growth_areas"],
        "next_focus": _text(data.get("next_focus")) or base["next_focus"],
        "corrections": _corrections(data.get("corrections")),
        "skill_radar": _skill_radar(data.get("skill_radar")),
        "recurring_pattern": _recurring_pattern(data.get("recurring_pattern")),
        "next_drill": _next_drill(data.get("next_drill")),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })
    return enriched


def _card_stats(raw_deck: dict | None) -> tuple[list[dict], int, int, int, str | None]:
    cards_out: list[dict] = []
    cards_completed = cards_total = cards_skipped = 0
    deck_status = None
    if raw_deck and raw_deck.get("cards"):
        deck_status = raw_deck.get("status")
        for c in raw_deck["cards"]:
            status = c.get("status")
            if status == "completed":
                cards_completed += 1
            elif status == "skipped":
                cards_skipped += 1
            cards_out.append({
                "title": c.get("title") or c.get("type") or "Exercise",
                "type": c.get("type"),
                "result": c.get("result"),
                "attempts": c.get("attempts", 0),
                "feedback": c.get("feedback") or "",
            })
        cards_total = len(raw_deck["cards"])
    return cards_out, cards_completed, cards_total, cards_skipped, deck_status


def _user_messages(messages: list[dict]) -> list[str]:
    return [
        (m.get("content") or "").strip()
        for m in messages
        if m.get("role") == "user" and (m.get("content") or "").strip()
    ]


def _duration_minutes(messages: list[dict], session_start_utc: datetime) -> int | None:
    try:
        last_ts = messages[-1].get("timestamp") if messages else None
        if not last_ts:
            return None
        end_dt = datetime.fromisoformat(last_ts)
        if end_dt.tzinfo is None and session_start_utc.tzinfo is not None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        return max(0, round((end_dt - session_start_utc).total_seconds() / 60))
    except Exception:
        return None


def _conversation_for_prompt(messages: list[dict], max_messages: int = 80, max_chars: int = 9000) -> str:
    lines = []
    for m in messages[-max_messages:]:
        role = "USER" if m.get("role") == "user" else "COACH"
        content = " ".join((m.get("content") or "").split())
        if content:
            lines.append(f"{role}: {content}")
    text = "\n".join(lines)
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


def _deck_for_prompt(raw_deck: dict | None) -> dict | None:
    if not raw_deck:
        return None
    return {
        "mission": raw_deck.get("mission"),
        "status": raw_deck.get("status"),
        "end_reason": raw_deck.get("end_reason"),
        "cards": [
            {
                "title": c.get("title"),
                "type": c.get("type"),
                "task": c.get("task"),
                "result": c.get("result"),
                "attempts": c.get("attempts", 0),
                "feedback": c.get("feedback"),
            }
            for c in (raw_deck.get("cards") or [])[:12]
        ],
    }


def _text(value: Any, max_len: int = 280) -> str:
    if not isinstance(value, str):
        return ""
    value = " ".join(value.split()).strip()
    return value[:max_len]


def _string_list(value: Any, *, limit: int, max_len: int = 180) -> list[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = _text(item, max_len=max_len)
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _corrections(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if not isinstance(item, dict):
            continue
        you_said = _text(item.get("you_said"), max_len=220)
        try_this = _text(item.get("try_this"), max_len=220)
        why = _text(item.get("why"), max_len=220)
        if you_said and try_this and why:
            out.append({"you_said": you_said, "try_this": try_this, "why": why})
        if len(out) >= 3:
            break
    return out


def _skill_radar(value: Any) -> list[dict]:
    by_skill: dict[str, dict] = {}
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            skill = _text(item.get("skill"), max_len=80)
            skill_key = next((s for s in SKILLS if s.lower() == skill.lower()), "")
            level_raw = _text(item.get("level"), max_len=40)
            level = next((lvl for lvl in LEVELS if lvl.lower() == level_raw.lower()), "")
            evidence = _text(item.get("evidence"), max_len=220)
            if skill_key and level and evidence:
                by_skill[skill_key] = {"skill": skill_key, "level": level, "evidence": evidence}

    radar = []
    for skill in SKILLS:
        radar.append(by_skill.get(skill) or {
            "skill": skill,
            "level": "Okay",
            "evidence": "Not enough specific evidence was available for this skill.",
        })
    return radar


def _recurring_pattern(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    title = _text(value.get("title"), max_len=120)
    evidence = _text(value.get("evidence"), max_len=240)
    practice_tip = _text(value.get("practice_tip"), max_len=240)
    if title and evidence and practice_tip:
        return {"title": title, "evidence": evidence, "practice_tip": practice_tip}
    return None


def _next_drill(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    title = _text(value.get("title"), max_len=120)
    steps = _string_list(value.get("steps"), limit=4, max_len=180)
    success_criteria = _text(value.get("success_criteria"), max_len=220)
    if title and steps:
        return {
            "title": title,
            "steps": steps,
            "success_criteria": success_criteria,
        }
    return None
