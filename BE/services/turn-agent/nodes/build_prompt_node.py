import asyncio
import json
import logging
import aiohttp
from db import settings

log = logging.getLogger("build_prompt")

SESSION_INSIGHT_PREFIX = "SESSION_INSIGHT:"

GENERIC_GUIDELINES = (
    "Guidelines:\n"
    "- Keep responses concise and conversational (2-4 sentences max)\n"
    "- Gently correct language mistakes when helpful\n"
    "- Be warm, encouraging, and stay positive\n"
    "- Do not use emojis or special icons in your responses\n"
)

# Strong refs to background extraction tasks so they aren't GC'd mid-flight.
# Discarded on completion so the set doesn't grow forever.
_background_tasks: set[asyncio.Task] = set()


async def _fire_onboarding_extraction(user_id: str, session_id: str, transcript: str) -> None:
    """
    Fire-and-forget POST to memory-service to extract onboarding signals from
    this turn's transcript. Runs only during the first speaking session.
    Failure is logged but never re-raised — the user-facing turn must not break.
    """
    url = f"{settings.memory_service_url}/onboarding-extract/{user_id}"
    payload = {"transcript": transcript, "session_id": session_id}
    try:
        log.info("onboarding_extract  user=%s  session=%s  dispatch timeout=30s", user_id, session_id)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as sess:
            async with sess.post(url, json=payload) as r:
                if r.status >= 400:
                    body = await r.text()
                    log.warning("onboarding_extract  status=%d  body=%s", r.status, body[:200])
                else:
                    log.info("onboarding_extract  user=%s  session=%s  ok", user_id, session_id)
    except Exception as e:
        log.error("onboarding_extract  user=%s  failed: %s", user_id, e)


async def _fetch_onboarding_state(user_id: str) -> dict:
    """
    Read the accumulating onboarding state (motivation, confidence, style, facts...)
    from memory-service Redis. Returns {} on any failure — caller treats empty as
    "no data yet" and renders only the static portion of the coaching block.
    """
    url = f"{settings.memory_service_url}/onboarding-state/{user_id}"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4)) as sess:
            async with sess.get(url) as r:
                if r.status >= 400:
                    return {}
                data = await r.json()
                return data if isinstance(data, dict) else {}
    except Exception as e:
        log.warning("fetch_onboarding_state  user=%s  failed: %s", user_id, e)
        return {}


def _render_learned_block(state: dict) -> str:
    """
    Render the data-driven 'WHAT YOU'VE LEARNED ABOUT THIS USER SO FAR' coaching
    block as natural prose. Every paragraph is conditional — we only emit a line
    when there is backing data, so the AI never sees hallucinated evidence.

    Companion to the static onboarding rules block. Returns "" when state is empty
    enough that nothing useful can be said.
    """
    if not state:
        # No accumulated data yet (turn 1 of onboarding, or extractor hasn't run).
        # Static coaching notes alone are still worth emitting.
        return _render_static_coaching_notes()

    motivation        = (state.get("motivation") or "").strip()
    confidence        = (state.get("confidence_signal") or "").strip()
    speaking_style    = (state.get("speaking_style") or "").strip()
    energy            = (state.get("emotional_energy") or "").strip()
    facts             = [f for f in (state.get("facts") or []) if f]
    weakness_hints    = [w for w in (state.get("notable_weakness_hints") or []) if w]

    paragraphs: list[str] = []

    # Motivation paragraph — only emit when we have a confident value (not "unclear")
    if motivation and motivation != "unclear":
        motivation_phrase = {
            "casual":    "casual conversation rather than exam prep",
            "career":    "career/work contexts — they want to handle professional English",
            "travel":    "travel and real-world situations they'll actually encounter",
            "education": "academic study and explaining ideas clearly",
            "social":    "social connection and personal conversations",
        }.get(motivation, motivation)
        paragraphs.append(
            f"— Their real motivation: {motivation_phrase}. Anchor the coaching to that, "
            f"not generic small talk."
        )

    # Key context from extracted facts — useful, non-judgmental observations
    if facts:
        bullet_facts = "; ".join(facts[:3])
        paragraphs.append(
            f"— Concrete things they've told you: {bullet_facts}. Reference these "
            f"naturally; do not quote them back verbatim."
        )

    # Skill gap — only when extractor flagged something specific. Never invent.
    if weakness_hints:
        hint_phrase = weakness_hints[0]
        paragraphs.append(
            f"— Likely skill gap observed: {hint_phrase}. Don't name it as a weakness "
            f"to the user — just shape your coaching around it."
        )

    # Speaking style + confidence + energy together drive HOW you push, not what
    style_notes: list[str] = []
    if speaking_style == "brief":
        style_notes.append("they give short answers")
    elif speaking_style == "verbose":
        style_notes.append("they tend to ramble")
    if confidence == "low":
        style_notes.append("their confidence is low — soften the push")
    elif confidence == "high":
        style_notes.append("their confidence is solid — you can be direct")
    if energy == "nervous":
        style_notes.append("they seem nervous — keep the pace gentle")
    elif energy == "excited":
        style_notes.append("they're engaged — match the energy")

    if style_notes:
        paragraphs.append("— Style / state right now: " + "; ".join(style_notes) + ".")

    coaching_notes = _build_dynamic_coaching_notes(state)

    if not paragraphs and not coaching_notes:
        return ""

    header = "WHAT YOU'VE LEARNED ABOUT THIS USER SO FAR (silent — never quote back):"
    body = "\n".join(paragraphs) if paragraphs else "(no firm signals yet)"
    return "\n\n" + header + "\n" + body + "\n\n" + coaching_notes


# Coaching notes are positively framed where possible because LLMs follow
# positive instructions ("DO X") more reliably than negative bans ("DON'T say Y").
# Pattern-level bans catch the case where the model swaps adjectives ("interesting"
# in place of "wonderful") while keeping the same generic-praise shape.
_STATIC_COACHING_LINES = [
    "- BEGIN every response with a specific reference to a concrete word or fact the user just said. Never start with an evaluative adjective.",
    "- PATTERN BAN: do not begin with \"That's a very [adjective] [noun]\", \"Ah, [X] is a [adjective] [Y]\", or \"What a [adjective] [noun]\". These are generic praise regardless of which words fill in (interesting / practical / famous / great / wonderful / fantastic / amazing).",
    "- Interpret \"warm\" as: attentive, concrete, takes the user seriously. NOT as: praising, complimenting, validating with adjectives.",
    "- Skip the affirmation. Go directly to the substance or the next question.",
    "- If they switch to their native language for a word, redirect ONCE in the same sentence: \"Try describing it with simpler English.\"",
]

_COACHING_HEADER = (
    "COACHING NOTES (these override the general \"warm / encouraging / stay positive\" "
    "guidelines above):"
)


def _render_static_coaching_notes() -> str:
    """Used when no state exists yet (very first onboarding turn)."""
    lines = "\n".join(_STATIC_COACHING_LINES)
    return "\n\n" + _COACHING_HEADER + "\n" + lines


def _build_dynamic_coaching_notes(state: dict) -> str:
    """
    Mix of always-on lines and lines that only appear when the matching behavioural
    pattern has been observed. Keeps the coaching focused on this user's actual
    issues instead of generic boilerplate.
    """
    lines = list(_STATIC_COACHING_LINES)

    speaking_style = (state.get("speaking_style") or "").strip()
    confidence     = (state.get("confidence_signal") or "").strip()

    if speaking_style == "brief":
        lines.append(
            "- They hide behind short answers. Push for one more specific detail — don't let them off easy."
        )
    if speaking_style == "verbose":
        lines.append(
            "- They wander. When they drift, gently steer back to the thread."
        )
    if confidence == "low":
        lines.append(
            "- Lower the difficulty one notch. They need a small win before a real challenge."
        )

    return _COACHING_HEADER + "\n" + "\n".join(lines)


def get_session_mode(turn_index: int) -> str:
    if turn_index <= 2:
        return "WARM_UP"
    if turn_index <= 8:
        return "CHALLENGE"
    return "REFLECTION"


def get_onboarding_phase(turn_index: int, onboarding_state: dict | None = None) -> str:
    """
    Phase progression during the user's first speaking session.
    Greeting (orchestrator) already covered PHASE 1. Turn 1 = first user reply.
    """
    state = onboarding_state or {}
    confident = sum(
        1
        for field in ("motivation", "confidence_signal", "speaking_style", "emotional_energy")
        if state.get(field) not in (None, "", "unclear")
    )
    if confident < 2:
        return "DISCOVERY"
    if turn_index <= 3:
        return "DISCOVERY"     # PHASE 2 — adaptive discovery
    if turn_index <= 6:
        return "MINI_CHALLENGE"  # PHASE 3 — concrete tiny scenario
    return "CLOSING"             # PHASE 4 — supportive feedback + tease next time


def build_onboarding_block(state: dict, turn_index: int, onboarding_state: dict | None = None) -> str:
    """
    Replaces the generic SESSION_MODE block during the user's first speaking session.
    The orchestrator's greeting set up PHASE 1; this block keeps the same arc alive
    across every subsequent turn so the AI doesn't snap back to generic-chatbot mode.
    """
    name           = state.get("user_name", "") or "the user"
    target_lang    = state.get("target_language", "English") or "English"
    native_lang    = state.get("native_language", "") or "their native language"
    level          = state.get("user_level", "beginner") or "beginner"
    goal           = state.get("learning_goal", "") or "their learning goal"
    phase          = get_onboarding_phase(turn_index, onboarding_state)

    profile_block = (
        "ONBOARDING CONTEXT (this is the user's first speaking session):\n"
        f"- Name: {name}\n"
        f"- Self-reported level: {level}\n"
        f"- Native language: {native_lang}\n"
        f"- Target language: {target_lang}\n"
        f"- Learning goal: {goal}\n"
    )

    phase_block = ""
    if phase == "DISCOVERY":
        phase_block = (
            "ONBOARDING PHASE: ADAPTIVE DISCOVERY (early turns)\n"
            "- Continue the conversation you opened with the greeting — do NOT reset or "
            "ask a generic opener like \"What do you want to talk about today?\".\n"
            "- React naturally to what the user just said; show you heard them.\n"
            "- Ask ONE follow-up question per turn, never two. Make it specific to their reply.\n"
            "- You are trying to infer their real motivation, confidence, speaking style, and "
            "likely blocker — but NEVER ask about these directly.\n"
            "- Do NOT correct grammar. Do NOT mention CEFR / A1 / B1 / IELTS unless their "
            "stated goal explicitly contains exam prep.\n"
        )
    elif phase == "MINI_CHALLENGE":
        phase_block = (
            "ONBOARDING PHASE: MINI CHALLENGE (transition turn)\n"
            "- You now have enough signal. Transition naturally with one short line like: "
            "\"Ok, I understand you a bit better now. Let's try a small real practice.\"\n"
            "- Then give EXACTLY ONE concrete tiny scenario based on their learning goal.\n"
            "  Casual → \"Imagine we just met at a coffee shop. Tell me about your week.\"\n"
            "  Career → \"Imagine introducing yourself to a new international colleague. Go.\"\n"
            "  Travel → \"Your flight just got delayed. Talk to me like I'm the airline staff.\"\n"
            "  Education → \"Explain a topic you know well as if teaching a younger student.\"\n"
            "  Social  → \"Tell me a short story about a memorable experience with someone.\"\n"
            "- Keep it under 3 sentences. End with a clear prompt for them to start.\n"
        )
    else:  # CLOSING
        phase_block = (
            "ONBOARDING PHASE: CLOSING (later turns)\n"
            "- The session is winding down. Give brief, supportive feedback on what the user "
            "did well — be concrete, not generic. No corrections.\n"
            "- Tease ONE thing you'll adapt for next time, in a single sentence.\n"
            "- Make it feel like the end of a real conversation, not a robotic sign-off.\n"
        )

    rules_block = (
        "ONBOARDING ABSOLUTE RULES (apply every turn):\n"
        "- Ask only ONE question per turn. Never two unrelated questions.\n"
        "- Do NOT ask \"What is your weakness?\" / \"What's your CEFR level?\" / \"A1 or B1?\".\n"
        "- Do NOT mention onboarding, profiling, memory extraction, or that you're learning about them.\n"
        f"- Speak primarily in {target_lang}.\n"
        f"- If the user mixes in {native_lang}, briefly mirror it to reduce pressure, then "
        f"guide them back to {target_lang}.\n"
        "- Keep every response under 3 sentences. No emojis.\n"
        "- Never reset the conversation. You're building on what was just said.\n"
    )

    return "\n\n" + profile_block + "\n" + phase_block + "\n" + rules_block


SESSION_MODE_INSTRUCTIONS: dict[str, str] = {
    "WARM_UP": """
SESSION MODE: WARM_UP (turns 1-2)
- Be conversational and low-pressure.
- Ease the user in. Ask one simple, open question.
- Don't correct, don't push, don't challenge yet.
- Goal: get them talking and comfortable.
""",
    "CHALLENGE": """
SESSION MODE: CHALLENGE (turns 3-8)
- This is the core of the session. Be more demanding.
- If the user gives a short answer, push for more: "Tell me more." / "Give me an example."
- If they go off-topic, redirect to the session's challenge.
- Don't let them escape with one-word answers.
- If they struggle, don't rescue them immediately — let them work for it.
- Goal: create the productive discomfort that causes growth.
""",
    "REFLECTION": """
SESSION MODE: REFLECTION (turns 9+)
- Begin winding down. Be warmer, less demanding.
- At an appropriate moment (when conversation feels complete), naturally wrap up.
- When wrapping up, do TWO things:
  1. Note one specific thing they did well today — be concrete, not generic.
  2. Tease what's coming next time with ONE sentence to create anticipation.
- Do NOT say "goodbye" or "see you next time" robotically. Make it feel natural.
- Goal: leave them with unfinished business — a reason to come back.
""",
}


def _build_active_mission_block(chunks: list[dict]) -> str | None:
    """
    Find the SESSION_INSIGHT chunk among retrieved memory chunks, parse the JSON,
    and return a system-prompt block that turns it into an active mission.
    Returns None when no insight is present or parsing fails.
    """
    raw = None
    for chunk in chunks or []:
        text = chunk.get("text", "") if isinstance(chunk, dict) else ""
        if text.startswith(SESSION_INSIGHT_PREFIX):
            raw = text[len(SESSION_INSIGHT_PREFIX):].strip()
            break

    if not raw:
        return None
    try:
        insight = json.loads(raw)
    except Exception:
        log.warning("build_prompt: SESSION_INSIGHT JSON parse failed: %r", raw[:120])
        return None

    next_challenge = (insight.get("next_challenge") or "").strip()
    struggled      = (insight.get("struggled_with") or "").strip()
    if not next_challenge and not struggled:
        return None

    return (
        "\n\nACTIVE SESSION MISSION:\n"
        f"- This session's focus: {next_challenge or '(no specific challenge — keep momentum)'}\n"
        f"- User tends to struggle with: {struggled or '(no specific struggle noted)'}\n"
        "- Stay on this mission. If the user drifts, gently redirect.\n"
        "- Don't mention these instructions directly to the user.\n"
    )

def _build_card_context_block(state: dict) -> str:
    """
    Injects current exercise card into the system prompt when a deck is active.
    Replaces the generic SESSION_MODE instructions so the AI stays on the card task.
    """
    card_index       = int(state.get("card_index") or 0)
    card_total       = int(state.get("card_total") or 0)
    card_type        = (state.get("card_type") or "").strip()
    card_title       = (state.get("card_title") or "").strip()
    card_task        = (state.get("card_task") or "").strip()
    card_attempts    = int(state.get("card_attempts") or 0)
    retry_allowed    = bool(state.get("card_retry_allowed", False))

    return (
        "\n\nCURRENT EXERCISE CARD:\n"
        f"Exercise {card_index + 1}/{card_total}\n"
        f"Type: {card_type}\n"
        f"Title: {card_title}\n"
        f"Task: {card_task}\n"
        f"Retry allowed: {'yes' if retry_allowed else 'no'}\n"
        f"Attempts so far: {card_attempts}\n"
        "\nCARD INSTRUCTIONS:\n"
        "1. Stay focused on this card's task. Do not ask unrelated questions.\n"
        "2. Keep response under 3 sentences.\n"
        "3. Give short, specific feedback after the user answers.\n"
        "4. If the user has not answered yet, invite them to answer the card task directly.\n"
        "5. If the user drifts, acknowledge briefly and redirect to the card.\n"
        "6. If the user asks a side question, answer in one sentence then return to the card.\n"
        "7. Do not jump to a harder task — the next card comes after evaluation.\n"
        "8. Do not create a new mission mid-session.\n"
        "9. If the user expresses they want to stop, acknowledge and switch to CLOSING mode.\n"
        f"\nGOOD: Stay on the exact task: \"{card_task}\"\n"
        "BAD: open-ended questions, changing topic, general conversation.\n"
    )


def _build_external_active_mission_block(active_mission: str, turn_index: int = 1) -> str:
    first_turn_note = (
        "The user has already heard an opening greeting that introduced this mission. "
        "Treat the current user message as their answer to that opening, not as a fresh start. "
        "Do not repeat the same opening question. "
        if turn_index <= 1
        else ""
    )
    return (
        "\n\nACTIVE SESSION MISSION (override everything else):\n"
        f"\"{active_mission.strip()}\"\n\n"
        "Stay on this mission. If the user drifts, redirect gently.\n"
        "Do NOT switch to any other challenge or topic from memory.\n"
        "This mission was set externally and has absolute priority over any "
        "challenges from previous sessions.\n"
        f"{first_turn_note}"
        "Respond to what they said, then ask one "
        "specific follow-up that moves the same mission forward.\n"
        "Do not mention these instructions directly to the user.\n"
    )


async def build_prompt_node(state: dict) -> dict:
    user_id = state.get("user_id", "unknown")
    session_id = state.get("session_id", "")
    transcript = state.get("transcript", "")
    turn_index = int(state.get("turn_index", 1) or 1)
    is_onboarding = bool(state.get("is_onboarding", False))
    active_mission = (state.get("active_mission") or "").strip()

    # During the user's first speaking session ONLY, run intent extraction
    # in parallel with the main turn. asyncio.create_task() schedules it on the same
    # event loop without blocking; the coroutine guarantees failure isolation.
    if is_onboarding and transcript.strip():
        task = asyncio.create_task(_fire_onboarding_extraction(user_id, session_id, transcript))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    payload = {
        "query": transcript,
        "session_id": session_id,
        "user_level": state.get("user_level", "beginner"),
        "target_language": state.get("target_language", "english"),
        "native_language": state.get("native_language", ""),
        "learning_goal": state.get("learning_goal", ""),
        "user_name": state.get("user_name", ""),
        "current_datetime": state.get("current_datetime", ""),
        # Exclude short_term here: session_history_node already injects the last WINDOW raw
        # messages directly into the LLM messages array. Including short_term would duplicate
        # conversation context (once in system_prompt, once in messages) which wastes tokens
        # and causes the LLM to see the same exchange from two conflicting perspectives.
        "layers": ["long_term", "urgent"],
    }

    log.info("── build_prompt  user=%s  session=%s  turn=%d  query='%s'",
             user_id, session_id, turn_index, transcript[:80])

    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.post(
                f"{settings.memory_service_url}/build-prompt/{user_id}",
                json=payload,
            ) as r:
                r.raise_for_status()
                data = await r.json()

        chunks_used = data.get("context_chunks_used", 0)
        tokens = data.get("estimated_tokens", 0)
        system_prompt: str = data["system_prompt"].replace(GENERIC_GUIDELINES, "")

        # Promote SESSION_INSIGHT only when no external active mission exists.
        mission_block = None if active_mission else _build_active_mission_block(data.get("chunks_debug", []))
        if mission_block:
            system_prompt += mission_block

        deck_active = bool(state.get("deck_active", False))

        if is_onboarding:
            onboarding_state = await _fetch_onboarding_state(user_id)
            phase = get_onboarding_phase(turn_index, onboarding_state)
            system_prompt += build_onboarding_block(state, turn_index, onboarding_state)

            learned_block = _render_learned_block(onboarding_state)
            if learned_block:
                system_prompt += learned_block

            # Inject card context for onboarding mini-deck (after onboarding block)
            if deck_active:
                system_prompt += _build_card_context_block(state)

            log.info(
                "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  ONBOARDING phase=%s  "
                "state_fields=%d  learned_block_chars=%d  deck_active=%s",
                chunks_used, tokens, phase,
                len([k for k in onboarding_state if onboarding_state.get(k)]),
                len(learned_block), deck_active,
            )
        else:
            if deck_active:
                # Card context replaces generic session mode when a deck is active
                system_prompt += _build_card_context_block(state)
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK card=%s/%s  type=%s",
                    chunks_used, tokens,
                    state.get("card_index", 0), state.get("card_total", 0),
                    state.get("card_type", ""),
                )
            else:
                mode = get_session_mode(turn_index)
                system_prompt += "\n" + SESSION_MODE_INSTRUCTIONS[mode]
                if active_mission:
                    system_prompt += _build_external_active_mission_block(active_mission, turn_index)
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  mode=%s  mission=%s",
                    chunks_used, tokens, mode, "yes" if active_mission or mission_block else "no",
                )
        return {"system_prompt": system_prompt}

    except Exception as e:
        log.error("── build_prompt ✖ memory service failed: %s", e)
        lang = state.get("target_language", "English")
        dt = state.get("current_datetime", "")
        fallback = (
            f"You are a warm, friendly AI companion. "
            f"Speak in {lang} or whatever language the user uses naturally. "
            f"Help with conversations and language learning like a good friend."
            + (f" Today is {dt}." if dt else "")
        )
        deck_active = bool(state.get("deck_active", False))
        if is_onboarding:
            onboarding_state = await _fetch_onboarding_state(user_id)
            fallback += build_onboarding_block(state, turn_index, onboarding_state)
            fallback += _render_learned_block(onboarding_state)
            if deck_active:
                fallback += _build_card_context_block(state)
        else:
            if deck_active:
                fallback += _build_card_context_block(state)
            else:
                fallback += "\n" + SESSION_MODE_INSTRUCTIONS[get_session_mode(turn_index)]
                if active_mission:
                    fallback += _build_external_active_mission_block(active_mission, turn_index)
        return {"system_prompt": fallback}
