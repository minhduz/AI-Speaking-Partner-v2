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
            "career":    "career/work contexts — they want to handle professional target-language communication",
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
    "- If they switch to their native language for a word, understand it silently and redirect ONCE in the target language. Never mirror their native language.",
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
    # Enough signal collected early → transition to MINI_CHALLENGE from turn 4
    if confident >= 2 and turn_index >= 4:
        return "MINI_CHALLENGE"
    # Hard fallback: force transition at turn 6 even without enough signal
    if turn_index >= 6:
        return "MINI_CHALLENGE"
    return "DISCOVERY"


def build_onboarding_block(state: dict, turn_index: int, onboarding_state: dict | None = None) -> str:
    """
    Replaces the generic SESSION_MODE block during the user's first speaking session.
    The orchestrator's greeting set up PHASE 1; this block keeps the same arc alive
    across every subsequent turn so the AI doesn't snap back to generic-chatbot mode.
    """
    name           = state.get("user_name", "") or "the user"
    target_lang    = state.get("target_language", "English") or "English"
    level          = state.get("user_level", "beginner") or "beginner"
    goal           = state.get("learning_goal", "") or "their learning goal"
    phase          = get_onboarding_phase(turn_index, onboarding_state)

    profile_block = (
        "ONBOARDING CONTEXT (this is the user's first speaking session):\n"
        f"- Name: {name}\n"
        f"- Self-reported level: {level}\n"
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
            "ONBOARDING PHASE: TRANSITION TO PRACTICE (turn when you've learned enough)\n"
            "- You now have enough signal to move into a real practice exercise.\n"
            "- Transition naturally with ONE short sentence — something like:\n"
            "  \"Ok, I have a better sense of you now. Let's try a small real practice!\"\n"
            "  or: \"Great, I think you're ready for a quick practice — let's go!\"\n"
            "  or: \"I've got a short exercise ready for you — want to give it a go?\"\n"
            "- Keep it to 1-2 sentences MAX. Do NOT describe the exercise yourself.\n"
            "- Do NOT invent a scenario. A practice card will appear on the UI for the user to accept or decline.\n"
            "- End your response there. The card UI handles the rest.\n"
        )
    else:  # CLOSING
        phase_block = (
            "ONBOARDING PHASE: CLOSING (later turns)\n"
            "- The session is winding down. Give brief, supportive feedback on what the user "
            "did well — be concrete, not generic. No corrections.\n"
            "- Tease ONE thing you'll adapt for next time, in a single sentence.\n"
            "- Make it feel like the end of a real conversation, not a robotic sign-off.\n"
            "- When you deliver your final farewell sentence, append SESSION_END on the same line.\n"
            "  Example: \"Take care, duc! SESSION_END\"\n"
            "  The system strips SESSION_END before TTS — the user will never hear it.\n"
        )

    rules_block = (
        "ONBOARDING ABSOLUTE RULES (apply every turn):\n"
        "- Ask only ONE question per turn. Never two unrelated questions.\n"
        "- Do NOT ask \"What is your weakness?\" / \"What's your CEFR level?\" / \"A1 or B1?\".\n"
        "- Do NOT mention onboarding, profiling, memory extraction, or that you're learning about them.\n"
        f"- Speak ONLY in {target_lang} in every user-visible sentence.\n"
        f"- If the user uses their native language, understand it silently but reply in {target_lang}.\n"
        "- Never mirror, translate into, or continue in the user's native language.\n"
        "- Keep every response under 3 sentences. No emojis.\n"
        "- Never reset the conversation. You're building on what was just said.\n"
    )

    return "\n\n" + profile_block + "\n" + phase_block + "\n" + rules_block


SESSION_MODE_INSTRUCTIONS: dict[str, str] = {
    "WARM_UP": """
SESSION MODE: WARM_UP (turns 1-2)
- Be conversational and low-pressure.
- Ease the user in. Ask ONE simple, open question.
- Don't correct, don't push, don't challenge yet.
- Goal: get them talking and comfortable.
- STRICT: ask only ONE question per response. Never ask two or more questions at once.
""",
    "CHALLENGE": """
SESSION MODE: CHALLENGE (turns 3-8)
- This is the core of the session. Be more demanding.
- If the user gives a short answer, push for more: "Tell me more." / "Give me an example."
- If they go off-topic, redirect to the session's challenge.
- Don't let them escape with one-word answers.
- If they struggle, don't rescue them immediately — let them work for it.
- Goal: create the productive discomfort that causes growth.
- STRICT: ask only ONE question per response. Never ask two or more questions at once.
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
- STRICT: ask only ONE question per response. Never ask two or more questions at once.
- When you deliver your final farewell sentence, append the token SESSION_END on the same line.
  Example: "See you next time, duc! SESSION_END"
  The system will strip SESSION_END before TTS — the user will never hear it.
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


def _build_language_lock_block(target_lang: str) -> str:
    return (
        "\n\nLANGUAGE LOCK (highest priority):\n"
        f"- Every user-visible sentence you output must be in {target_lang}.\n"
        "- If any instruction or example above is written in another language, treat it as meaning only; "
        f"rewrite it naturally in {target_lang}.\n"
        f"- If the user uses their native language or mixes languages, understand it silently and answer in {target_lang}.\n"
        "- Never mirror, translate into, or continue in the user's native language.\n"
    )


def _detect_low_energy(state: dict) -> bool:
    """
    Phase 7 heuristic: flag a session as low-energy when the user's last 3 turns
    have all been short or contain explicit fatigue cues. The AI uses this to
    offer "one more quick task or end session" rather than pushing harder.

    Conservative on purpose — we only inject the low-energy block when the
    pattern is unmistakable, otherwise the AI will start coddling normal users.
    """
    recent = state.get("recent_messages") or []
    user_msgs = [m for m in recent if (m.get("role") == "user") and m.get("content")]
    if len(user_msgs) < 3:
        return False
    last_three = user_msgs[-3:]
    fatigue_cues = (
        "i don't know", "idk", "i'm tired", "im tired", "i am tired",
        "i give up", "no idea", "skip", "i can't", "i cant",
    )
    short_count = 0
    cue_count = 0
    for m in last_three:
        text = m["content"].strip().lower()
        if len(text) <= 15:
            short_count += 1
        if any(cue in text for cue in fatigue_cues):
            cue_count += 1
    # 3 short answers in a row, OR 2+ explicit fatigue cues in the last 3 turns.
    return short_count >= 3 or cue_count >= 2


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
    low_energy       = _detect_low_energy(state)
    target_lang      = state.get("target_language", "English") or "English"

    is_final_boss = card_type == "final_boss"
    # Pre-built so the f-string below stays free of escaped quotes
    # (Python 3.11 forbids backslashes inside f-string expression braces).
    final_boss_rule = (
        'Since it IS final_boss: if passed or partial, set nextAction="finish_session".'
        if is_final_boss
        else 'Since it is NOT final_boss: use "next_card" or "retry" only — never "finish_session".'
    )

    transcript = (state.get("transcript") or "").strip()
    card_intro_note = (
        # Empty transcript = user just clicked Next — AI should announce the card.
        "\nACTION REQUIRED: The user just advanced to this card (no speech yet). "
        "In 1-2 sentences, naturally introduce the task and invite them to try. "
        "Do NOT wait for them to ask — read the task aloud now.\n"
        if not transcript else ""
    )

    return (
        "\n\nCURRENT EXERCISE CARD:\n"
        f"Exercise {card_index + 1}/{card_total}\n"
        f"Type: {card_type}\n"
        f"Title: {card_title}\n"
        f"Task: {card_task}\n"
        f"Retry allowed: {'yes' if retry_allowed else 'no'}\n"
        f"Attempts so far: {card_attempts}\n"
        f"{card_intro_note}"
        "\nCARD INSTRUCTIONS:\n"
        "1. Stay focused on this card's task. Do not ask unrelated questions.\n"
        "2. Keep response under 3 sentences.\n"
        + (
            "3. After the user answers well, give short positive feedback, then "
            "add ONE warm transition sentence like: \"Want to give one more a shot? "
            "Tap Next when you're ready!\" Do NOT describe the next card.\n"
            if card_index + 1 < card_total else
            "3. After the user answers well, give short positive feedback. "
            "Do NOT say 'want to try one more' or 'tap Next' — this is the last card.\n"
        ) +
        "4. If the user has not answered yet, invite them to answer the card task directly.\n"
        "5. If the user drifts, acknowledge briefly and redirect to the card.\n"
        "6. If the user asks a side question, answer in one sentence then return to the card.\n"
        "7. Do not jump to a harder task — the next card comes after evaluation.\n"
        "8. Do not create a new mission mid-session.\n"
        "9. If the user expresses they want to stop, acknowledge and switch to CLOSING mode.\n"
        f'\nGOOD: Stay on the exact task: "{card_task}"\n'
        "BAD: open-ended questions, changing topic, general conversation.\n"
        + (
            "\nDo NOT output an EVAL block this turn — the user has not attempted the task yet.\n"
            if not transcript else
            "\nAFTER RESPONDING, append EXACTLY this JSON on a new line — no prose, no markdown fences:\n"
            'EVAL:{"passed":true,"feedback":"one coaching sentence","retryRecommended":false,"nextAction":"next_card","detectedIssues":[]}\n'
            'If the user failed: EVAL:{"passed":false,"feedback":"one coaching sentence","retryRecommended":true,"nextAction":"retry","detectedIssues":["confusion"]}\n'
            'RULES: "passed" must be true or false. "nextAction" must be exactly "retry", "next_card", or "finish_session".\n'
            'CRITICAL: the block MUST start with exactly EVAL:{ — do NOT write EVALUATION: or any other format.\n'
            + (
                "This is the LAST card. If passed=true, set nextAction=\"finish_session\".\n"
                if card_index + 1 >= card_total else
                "This is NOT the last card. If passed=true, set nextAction=\"next_card\".\n"
            )
        )
        + "\nEvaluation rules:\n"
        "1. Be forgiving — if meaning is clear, grammar imperfect → passed=true with light feedback.\n"
        '2. If the user did not attempt the task → passed=false, nextAction="retry".\n'
        f'3. If the user code-switches heavily when the card requires {target_lang} → passed=false, nextAction="retry".\n'
        f"4. Attempts so far is {card_attempts}. If after this turn attempts would reach 3, "
        'set nextAction="next_card" even if not passed (will be recorded as partial).\n'
        f'5. This card type is "{card_type}". {final_boss_rule}\n'
        "6. Never trap user in infinite retry — escalate to next_card by the third attempt.\n"
        "7. Output the EVAL block ONCE, at the very end, on its own line. Do NOT speak it aloud — "
        "it is parsed by the system and stripped before TTS.\n"
        "\nEDGE CASES:\n"
        "A. CONFUSION — if the user says \"I don't understand\" / \"what does that mean\" / "
        "\"can you explain\" / asks what the task is:\n"
        "   - Explain the task in ONE simple sentence + ONE concrete example.\n"
        "   - End by re-stating the task gently. Do NOT advance.\n"
        "   - In EVAL: set passed=false, nextAction=\"retry\", "
        "detectedIssues=[\"confusion\"]. The system will see this and the user "
        "will get to try again WITHOUT this counting as a failed attempt.\n"
        "B. CODE-SWITCH (user falls back to their native language) — if the card "
        "requires the target language:\n"
        f"   - Redirect ONCE in one short line written in {target_lang}. Meaning: "
        f"try describing it with simpler {target_lang}; no native language needed.\n"
        "   - In EVAL: passed=false, nextAction=\"retry\", "
        "detectedIssues=[\"code_switch\"] (and add \"vocabulary_gap\" or "
        "\"grammar_uncertainty\" if you can tell which).\n"
        "C. SHORT ANSWER (2+ in a row) — reduce pressure. Offer a sentence frame: "
        "\"You can say: 'My app helps ___ to ___.' Try that.\"\n"
        "D. SKIP — if user says \"skip\" / \"next\" / \"pass\" they want to skip the card.\n"
        "   - Acknowledge briefly: \"Sure, let's move on.\"\n"
        "   - In EVAL: passed=false, nextAction=\"next_card\", "
        "detectedIssues=[\"user_skip\"]. (The Skip button is the canonical "
        "path; this just makes voice-only skipping work too.)\n"
        + (
            "\nLOW ENERGY DETECTED (3+ short answers or 2+ fatigue cues in recent turns):\n"
            "- Do NOT push harder. Offer a choice in ONE sentence: "
            "\"Want to do one more quick task, or end here and pick up next time?\"\n"
            "- If user picks \"end\" / \"stop\" / \"done\" → acknowledge warmly, switch to CLOSING mode.\n"
            "- In EVAL when ending: detectedIssues=[\"low_energy\"], passed=true (so the "
            "session doesn't end on a failure note), nextAction=\"finish_session\".\n"
            if low_energy
            else ""
        )
    )


def _build_card_soft_offer_block(state: dict) -> str:
    """
    Soft challenge block — injected when deck is not_started and turn 3-4.
    The AI may offer the challenge naturally; the user can accept or decline freely.
    Critically: no forced redirect, no strict 'stay on task' rules.
    """
    card_title = (state.get("card_title") or "").strip()
    card_task  = (state.get("card_task") or "").strip()
    card_type  = (state.get("card_type") or "").strip()

    return (
        "\n\nOPTIONAL CHALLENGE AVAILABLE (not yet started):\n"
        f"Type: {card_type}\n"
        f"Title: {card_title}\n"
        f"Task: {card_task}\n"
        "\nCHALLENGE OFFER RULES — read carefully:\n"
        "1. This challenge is 100% OPTIONAL. Never force or repeat it.\n"
        "2. If the moment feels right, offer it in ONE casual sentence. "
        "Before that, you may acknowledge what the user said in ONE short sentence — "
        "but do NOT ask a follow-up question. A question would force the user to answer BEFORE the offer.\n"
        '   Example: "That sounds like solid practice. I also have a quick exercise ready if you feel like it — want to try?"\n'
        "3. If the user says YES or engages with the task → guide them and evaluate.\n"
        "4. If the user says NO, ignores it, changes topic, or seems uninterested → DROP IT.\n"
        "   Do NOT redirect, do NOT mention it again. Continue on whatever topic they prefer.\n"
        "5. If user seems tired, low-energy, or mentions being busy → skip the offer entirely.\n"
        "6. NEVER open your response by pitching the challenge. Warm up first.\n"
        "\nEVAL: Only output EVAL:{...} if the user actually attempted the card task.\n"
        "Do NOT output EVAL if the user is warming up, chatting, or declined.\n"
    )


def _build_card_hard_offer_block(state: dict) -> str:
    """
    Hard challenge block — injected when deck is not_started and turn >= 5.
    The AI has warmed up enough; it MUST offer the challenge this turn.
    """
    card_title = (state.get("card_title") or "").strip()
    card_task  = (state.get("card_task") or "").strip()
    card_type  = (state.get("card_type") or "").strip()

    return (
        "\n\nCHALLENGE TO OFFER — required this turn:\n"
        f"Type: {card_type}\n"
        f"Title: {card_title}\n"
        f"Task: {card_task}\n"
        "\nOFFER RULES:\n"
        "1. You may acknowledge what the user said in ONE short sentence — "
        "but do NOT ask a follow-up question. A question forces the user to choose between answering it "
        "or answering the challenge offer, creating confusion.\n"
        "2. Then YOU MUST offer the challenge in ONE short sentence — e.g.:\n"
        '   "I\'ve got a quick practice ready for you — want to give it a try?"\n'
        '   or: "I\'ve got a short exercise that fits perfectly — feel like trying it?"\n'
        '   or: "Let\'s try a quick real practice — ready for it?"\n'
        "3. The user can say YES or NO — both are fine. But you MUST offer it this turn.\n"
        "4. If the user says YES → guide them through the task and evaluate.\n"
        "5. If the user says NO → drop it completely and continue the conversation.\n"
        "\nEVAL: Only output EVAL:{...} if the user actually attempted the card task.\n"
        "Do NOT output EVAL if the user declined.\n"
    )


def _build_continuation_offer_block(state: dict) -> str:
    """
    Injected when a continuation deck is not_started (user skipped cards last session).
    AI offers to retry the old exercises OR do exercises based on this session's topic.
    """
    card_total = int(state.get("card_total") or 0)
    return (
        f"\n\nCONTINUATION OFFER: Last session the user left {card_total} exercise(s) unfinished. "
        "In 1-2 warm sentences, mention this and offer two options:\n"
        "Option A — retry the skipped exercises from last time.\n"
        "Option B — do exercises based on what you've been chatting about in THIS session.\n"
        "Keep it light — don't make them feel bad about skipping.\n"
        "Example: \"By the way, last time we had a couple of exercises you didn't get to — "
        "want to pick those back up, or shall I put together some practice based on what we've been talking about today?\"\n"
        "Do NOT start the exercise yet. Do NOT output an EVAL block."
    )


def _build_session_insight_block(insight: dict | None, turn_index: int) -> str:
    """
    Inject consolidated last-session insight into the turn-agent prompt.

    Used by non-onboarding sessions (session 2+). Replaces the heavy insight
    block that used to live in the greeting endpoint — now the AI carries this
    context across every turn so it can drive practice lead-in naturally once
    warmup is done.

    Turn 1-2 → WARMUP framing: AI just chats, no practice push.
    Turn 3+ → LEAD-IN framing: AI may reference the insight to nudge toward a
              specific challenge.
    """
    if not insight or not insight.get("has_insight"):
        return ""

    struggled   = (insight.get("struggled_with")     or "").strip()
    improved    = (insight.get("improved_vs_before") or "").strip()
    next_chall  = (insight.get("next_challenge")     or "").strip()
    energy      = (insight.get("energy_level")       or "medium").strip()
    days_ago    = insight.get("last_session_days_ago")
    motivation  = (insight.get("inferred_motivation") or "").strip()
    is_first    = bool(insight.get("is_first_session_insight"))

    facts = ["\n\nLAST SESSION CONTEXT (carry-over from prior conversation):"]
    if struggled:  facts.append(f"- They struggled with: {struggled}")
    if improved:   facts.append(f"- They improved on: {improved}")
    if next_chall: facts.append(f"- Recommended next challenge: {next_chall}")
    if energy:     facts.append(f"- Their energy last time: {energy}")
    if isinstance(days_ago, (int, float)) and days_ago >= 0:
        facts.append(f"- Time since last session: {int(days_ago)} day(s)")
    if is_first and motivation:
        # First-ever insight came from onboarding; treat as soft signal, not data.
        facts.append(f"- Soft motivation signal from onboarding: {motivation}")

    is_warmup = turn_index <= 2
    if is_warmup:
        facts.append(
            "\nWARMUP PHASE (turn 1-2): chat warmly. DO NOT push practice, DO NOT "
            "quote these facts back to the user, DO NOT say \"last session\" or "
            "\"based on your insight\". The above is YOUR memory only — use it "
            "implicitly to choose what to ask about."
        )
    else:
        # Lead-in phase: AI can now reference the insight to propose practice
        # naturally. Still no direct quoting of labels.
        facts.append(
            "\nLEAD-IN PHASE (turn 3+): warmup is done. You may now reference "
            "the above context naturally to propose a short practice — frame "
            "it as an invitation, not an assignment. Never quote labels like "
            "\"you struggled with X\" — weave it in conversationally."
        )

    if isinstance(days_ago, (int, float)) and days_ago >= 5:
        facts.append(
            f"NOTE: User hasn't spoken in {int(days_ago)} days — open gently, "
            "no enthusiasm, acknowledge the gap without making them feel guilty."
        )

    return "\n".join(facts)


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

        deck_active = bool(state.get("deck_active", False))
        deck_status = (state.get("deck_status") or "none").strip()

        # Suppress mission block whenever the deck owns the next AI turn — otherwise
        # the "Stay on this mission" instruction overrides deck-specific instructions.
        _suppress_mission_block = not is_onboarding and (
            deck_active                                                         # card in_progress
            or (deck_status == "not_started" and turn_index >= 3)              # offer pending
            or (deck_status in ("completed", "ended_early") and not transcript) # deck ending
        )
        # Promote SESSION_INSIGHT only when no external active mission exists.
        mission_block = None if active_mission else _build_active_mission_block(data.get("chunks_debug", []))
        if mission_block and not _suppress_mission_block:
            system_prompt += mission_block

        if is_onboarding:
            onboarding_state = await _fetch_onboarding_state(user_id)
            phase = get_onboarding_phase(turn_index, onboarding_state)
            # Only inject the generic onboarding phase guidance before the deck starts.
            # Once a card is in_progress/completed, the card/deck-specific block below
            # must own the response; otherwise MINI_CHALLENGE repeats the old
            # "I have a better sense... Let's try..." transition during card flow.
            if not deck_active and deck_status not in ("completed",):
                system_prompt += build_onboarding_block(state, turn_index, onboarding_state)

            learned_block = _render_learned_block(onboarding_state)
            if learned_block:
                system_prompt += learned_block

            # Onboarding mini-deck: strict mode only when in_progress (user accepted)
            if deck_active:  # in_progress
                system_prompt += _build_card_context_block(state)
            elif deck_status == "completed":
                # All onboarding cards done — praise user and offer continue/end.
                system_prompt += (
                    "\n\nONBOARDING EXERCISES COMPLETED:\n"
                    "The user has just finished all the practice exercises. This was their FIRST session ever.\n"
                    "Rules for your response:\n"
                    "1. Praise them warmly and specifically — mention something they did well.\n"
                    "2. Acknowledge this was their first session: \"For a first session, this is really great!\"\n"
                    "3. Then offer a choice in a natural way:\n"
                    "   \"Would you like to keep chatting about anything, or is this a good place to stop for today?\"\n"
                    "4. Keep it to 3-4 sentences MAX. Be warm, not over-the-top.\n"
                    "5. Do NOT start a new exercise. Do NOT mention cards or decks.\n"
                    "6. If the user says they want to stop / goodbye / that's all / bye:\n"
                    "   Give a warm one-sentence farewell, then append SESSION_END on the same line.\n"
                    "   Example: \"Great work today — see you next time! SESSION_END\"\n"
                    "   The system strips SESSION_END before TTS — the user will never hear it.\n"
                )
            elif deck_status in ("ended_early", "abandoned"):
                # User declined the practice card — AI closes the card and asks what they'd prefer.
                system_prompt += (
                    "\n\nONBOARDING DECK DECLINED:\n"
                    "The user just declined the practice exercise card. That's completely fine.\n"
                    "In 1-2 sentences, acknowledge it warmly — no pressure. Then ask ONE open question:\n"
                    "what topic, situation, or area they'd like to focus on or talk about today.\n"
                    "Example: \"No worries at all! Is there a particular topic or situation "
                    "you'd like to practice instead?\"\n"
                    "Do NOT re-offer the card. Do NOT mention the exercise again.\n"
                )
            elif deck_status == "not_started" and phase == "MINI_CHALLENGE":
                # In onboarding, the deck reveal is NOT optional once the phase reaches
                # MINI_CHALLENGE. The generic soft-offer block says "warm up first" and
                # "if the moment feels right", which can make the AI keep asking follow-ups
                # past the 6-turn fallback. Force the transition and stop.
                system_prompt += (
                    "\n\nONBOARDING DECK READY — STRICT TRIGGER:\n"
                    "You must transition to the practice card NOW.\n"
                    "Say only 1 short, warm transition sentence, then stop.\n"
                    "Good examples:\n"
                    "- \"Ok, I have a better sense of you now. Let's try a small real practice!\"\n"
                    "- \"I've got a short exercise ready for you — want to give it a go?\"\n"
                    "Do NOT ask another discovery question.\n"
                    "Do NOT describe the exercise yourself — the UI card is already visible.\n"
                )

            log.info(
                "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  ONBOARDING phase=%s  "
                "state_fields=%d  learned_block_chars=%d  deck_status=%s",
                chunks_used, tokens, phase,
                len([k for k in onboarding_state if onboarding_state.get(k)]),
                len(learned_block), deck_status,
            )
        else:
            if deck_active:
                # User accepted and started the deck — strict card mode
                system_prompt += _build_card_context_block(state)
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(in_progress) card=%s/%s  type=%s",
                    chunks_used, tokens,
                    state.get("card_index", 0), state.get("card_total", 0),
                    state.get("card_type", ""),
                )
            elif deck_status == "completed" and not transcript:
                # Deck session done — check in on difficulty, open free chat.
                # Do NOT inject SESSION_MODE_INSTRUCTIONS here — REFLECTION mode's
                # "note one specific thing they did well" causes the AI to over-praise
                # as if the user aced every card, even when they skipped some.
                system_prompt += (
                    "\n\nDECK FINISHED: The user has just wrapped up the exercise session "
                    "(they may have skipped some cards — do NOT assume they completed everything perfectly). "
                    "In 1-2 warm, neutral sentences: acknowledge the session without over-praising, "
                    "then ask ONE question — was there anything in those exercises they found tricky "
                    "or want to talk through? "
                    "Example: 'Nice work today! Was there anything in those exercises you found tricky, "
                    "or would you like to keep chatting about something else?' "
                    "Do NOT say things like 'you explained everything so well' or 'you absorbed so much' "
                    "— you do not know which cards they actually did. Keep it simple and open. "
                    "Do NOT list or repeat the card tasks. "
                    "If the user says they want to end → include SESSION_END at the very end of your response. "
                    "Do NOT output an EVAL block."
                )
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(completed→check_in)",
                    chunks_used, tokens,
                )
            elif deck_status == "ended_early" and not transcript:
                deck_end_reason = (state.get("deck_end_reason") or "").strip()
                if deck_end_reason == "user_chose_free_talk":
                    system_prompt += (
                        "\n\nFREE TALK: The user declined the exercise and wants to chat freely. "
                        "Start with a warm, brief acknowledgement like 'No problem at all!' or 'Of course!', "
                        "then ask ONE question about what they'd like to talk about. "
                        "If there is a clear topic in the recent conversation, ask: "
                        "'Would you like to keep talking about [that topic], or is there something else you'd like to chat about?' "
                        "If there is no clear topic yet, just ask: 'What would you like to talk about?' "
                        "Keep it to ONE or TWO short sentences total. "
                        "Do NOT mention the exercise again. Do NOT output an EVAL block."
                    )
                elif deck_end_reason == "user_wants_to_end":
                    # Do NOT add SESSION_MODE_INSTRUCTIONS — this needs a clear pivot.
                    system_prompt += (
                        "\n\nSOFT END: The user declined the exercise and may want to end the session. "
                        "In 1-2 warm sentences: acknowledge that's totally fine, then offer a clear choice — "
                        "e.g. 'Would you like to keep chatting about something else, or shall we wrap up for today?' "
                        "Do NOT continue the previous topic. Do NOT say goodbye yet. "
                        "If the user says they want to end → include SESSION_END at the very end of your response. "
                        "Do NOT output an EVAL block."
                    )
                else:
                    # User skipped through all cards — empathize, invite reflection, offer choice.
                    system_prompt += (
                        "\n\nDECK SKIPPED: The user skipped through all the exercise cards. "
                        "In 1-2 warm sentences: acknowledge that's totally fine, then ask ONE question that does two things — "
                        "invites them to share what they found difficult (if anything), AND offers the option to talk about "
                        "a different topic or wrap up. "
                        "Example: 'No problem! Was there anything in those exercises you found tricky or want to talk through? "
                        "Or would you rather chat about something else — or even call it a day?' "
                        "Do NOT list or repeat the card tasks. Do NOT mention the exercises further after this. "
                        "If the user says they want to end → include SESSION_END at the very end of your response. "
                        "Do NOT output an EVAL block."
                    )
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(ended_early→%s)",
                    chunks_used, tokens, deck_end_reason or "generic",
                )
            elif deck_status == "ended_early" and transcript:
                # User is responding after deck ended early.
                # Only user_wants_to_end needs special handling — the AI just asked
                # "continue or end?" and the user is answering. Inject guidance so
                # the AI knows to include SESSION_END if they pick end.
                deck_end_reason_resp = (state.get("deck_end_reason") or "").strip()
                mode = get_session_mode(turn_index)
                system_prompt += "\n" + SESSION_MODE_INSTRUCTIONS[mode]
                if deck_end_reason_resp == "user_wants_to_end":
                    system_prompt += (
                        "\n\nSOFT END RESPONSE: You previously asked the user whether they want "
                        "to keep chatting or end the session. They just replied. Act accordingly:\n"
                        "- If they want to CONTINUE → respond naturally and start fresh conversation. "
                        "Ask ONE open question on any topic they prefer. Do NOT mention the exercise.\n"
                        "- If they want to END → give ONE warm farewell sentence, then append SESSION_END "
                        "on the same line.\n"
                        "  Example: 'Sounds good — take care, see you next time! SESSION_END'\n"
                        "  The system strips SESSION_END before TTS — the user will never hear it.\n"
                        "Do NOT output an EVAL block."
                    )
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(ended_early→soft_end_response)",
                        chunks_used, tokens,
                    )
                else:
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(ended_early→response)  mode=%s",
                        chunks_used, tokens, mode,
                    )

            elif deck_status == "not_started" and state.get("deck_is_continuation") and turn_index >= 3:
                # Continuation deck: AI offers to retry the skipped cards or switch topics
                mode = get_session_mode(turn_index)
                system_prompt += "\n" + SESSION_MODE_INSTRUCTIONS[mode]
                if not transcript:
                    system_prompt += _build_continuation_offer_block(state)
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(continuation_offer)  mode=%s",
                        chunks_used, tokens, mode,
                    )
                else:
                    # User replied to continuation offer — handle their choice.
                    # For "new topic": AI infers topic from THIS session's conversation
                    # (recent_messages) — no need to ask the user again.
                    system_prompt += (
                        "\n\nCONTINUATION RESPONSE: You just asked the user whether they want "
                        "to retry their skipped exercises from last session or do exercises based "
                        "on this session's conversation. They just replied. Act on their choice:\n"
                        "- If they want to RETRY (e.g. 'yes', 'sure', 'let's do it', 'old ones') → "
                        "acknowledge warmly in 1 sentence and say you'll start the first exercise. "
                        "Do NOT describe the exercise — the UI will show the card.\n"
                        "- If they want exercises based on THIS session (e.g. 'no', 'new', "
                        "'today's topic', 'what we talked about') → "
                        "look at the conversation so far and identify the main topic you've been discussing. "
                        "In 1 warm sentence, confirm you'll make exercises about that topic. "
                        "Then at the very end of your response append on its own line:\n"
                        "DECK_NEW_TOPIC:{\"topic\":\"<the topic from this session's conversation>\"}\n"
                        "  The topic should be a short phrase (3-6 words) extracted from the conversation, "
                        "e.g. 'explaining your startup idea', 'job interview practice', 'traveling abroad'.\n"
                        "  Do NOT ask the user what topic — extract it yourself from the conversation.\n"
                        "- If they want to SKIP altogether (no exercises today) → "
                        "respond naturally and start free chat. Do NOT emit DECK_NEW_TOPIC.\n"
                        "Do NOT output an EVAL block."
                    )
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(continuation_response)  mode=%s",
                        chunks_used, tokens, mode,
                    )

            elif deck_status == "not_started" and turn_index >= 3:
                # Turn 3-4: soft optional offer; turn 5+: AI must offer the challenge
                mode = get_session_mode(turn_index)
                system_prompt += "\n" + SESSION_MODE_INSTRUCTIONS[mode]
                if turn_index >= 5:
                    system_prompt += _build_card_hard_offer_block(state)
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(hard_offer)  mode=%s  card=%s",
                        chunks_used, tokens, mode, state.get("card_title", ""),
                    )
                else:
                    system_prompt += _build_card_soft_offer_block(state)
                    log.info(
                        "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  DECK(soft_offer)  mode=%s  card=%s",
                        chunks_used, tokens, mode, state.get("card_title", ""),
                    )
            else:
                # Pure warm-up (not_started turn<=2) or no deck — standard session mode
                mode = get_session_mode(turn_index)
                system_prompt += "\n" + SESSION_MODE_INSTRUCTIONS[mode]
                if active_mission:
                    system_prompt += _build_external_active_mission_block(active_mission, turn_index)
                # Inject last-session insight (carried from greeting flow to here).
                # Warmup framing on turn 1-2, lead-in framing on turn 3+.
                insight_block = _build_session_insight_block(state.get("session_insight"), turn_index)
                if insight_block:
                    system_prompt += insight_block
                log.info(
                    "── build_prompt ✓  chunks_used=%d  estimated_tokens=%d  mode=%s  mission=%s  insight=%s  deck=%s",
                    chunks_used, tokens, mode,
                    "yes" if active_mission or mission_block else "no",
                    "yes" if insight_block else "no",
                    deck_status,
                )
        system_prompt += _build_language_lock_block(state.get("target_language", "English") or "English")
        return {"system_prompt": system_prompt}

    except Exception as e:
        log.error("── build_prompt ✖ memory service failed: %s", e)
        lang = state.get("target_language", "English")
        dt = state.get("current_datetime", "")
        fallback = (
            f"You are a warm, friendly AI companion. "
            f"Speak only in {lang} in every user-visible sentence. "
            "If the user uses their native language, understand it silently but do not mirror it. "
            f"Help with conversations and language learning like a good friend."
            + (f" Today is {dt}." if dt else "")
        )
        deck_active = bool(state.get("deck_active", False))
        deck_status = (state.get("deck_status") or "none").strip()
        if is_onboarding:
            onboarding_state = await _fetch_onboarding_state(user_id)
            fallback += build_onboarding_block(state, turn_index, onboarding_state)
            fallback += _render_learned_block(onboarding_state)
            if deck_active:
                fallback += _build_card_context_block(state)
            elif deck_status == "not_started" and turn_index >= 3:
                fallback += _build_card_soft_offer_block(state)
        else:
            if deck_active:
                fallback += _build_card_context_block(state)
            elif deck_status == "not_started" and turn_index >= 3:
                fallback += "\n" + SESSION_MODE_INSTRUCTIONS[get_session_mode(turn_index)]
                if turn_index >= 5:
                    fallback += _build_card_hard_offer_block(state)
                else:
                    fallback += _build_card_soft_offer_block(state)
            else:
                fallback += "\n" + SESSION_MODE_INSTRUCTIONS[get_session_mode(turn_index)]
                if active_mission:
                    fallback += _build_external_active_mission_block(active_mission, turn_index)
                fallback += _build_session_insight_block(state.get("session_insight"), turn_index)
        fallback += _build_language_lock_block(lang)
        return {"system_prompt": fallback}
