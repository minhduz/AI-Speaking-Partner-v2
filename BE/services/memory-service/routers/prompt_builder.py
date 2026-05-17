from fastapi import APIRouter
from pydantic import BaseModel
from retriever import fan_out_retrieve

router = APIRouter()

TOKEN_BUDGET    = 2500   # ~2500 tokens of context headroom
CHARS_PER_TOKEN = 4
# Per-source caps — prevents one layer from monopolising the context window
_MAX_SHORT_TERM = 5
_MAX_LONG_TERM  = 8

class BuildPromptRequest(BaseModel):
    query: str
    session_id: str = ""
    user_level: str = "beginner"
    target_language: str = "english"
    native_language: str = ""
    learning_goal: str = ""
    user_name: str = ""
    current_datetime: str = ""
    conversation_style: str = "friendly"
    layers: list[str] = []


# Must stay in sync with STYLE_HINTS in orchestrator session.controller.ts so the
# greeting persona matches the turn persona for the same user.
STYLE_HINTS = {
    "friendly":     "Tone: warm and casual, like a supportive friend. Use contractions and natural phrasing.",
    "formal":       "Tone: polite and respectful, with complete sentences and no slang.",
    "casual":       "Tone: relaxed and brief, like texting a buddy.",
    "playful":      "Tone: light and witty, gentle humor when it fits naturally.",
    "professional": "Tone: clear, focused, and expert — like a tutor on the clock.",
}

@router.post("/{user_id}")
async def build_prompt(user_id: str, body: BuildPromptRequest):
    chunks = await fan_out_retrieve(
        user_id=user_id,
        session_id=body.session_id,
        query=body.query,
        layers=body.layers if body.layers else None,
    )

    # Trim to token budget with per-source caps to prevent any layer flooding context
    parts, used = [], 0
    budget = TOKEN_BUDGET * CHARS_PER_TOKEN
    source_counts: dict[str, int] = {}
    _SOURCE_CAPS = {"short_term": _MAX_SHORT_TERM, "long_term": _MAX_LONG_TERM, "urgent": _MAX_LONG_TERM}
    for chunk in chunks:
        source = chunk.get("source", "long_term")
        cap = _SOURCE_CAPS.get(source, _MAX_LONG_TERM)
        if source_counts.get(source, 0) >= cap:
            continue
        text = chunk["text"]
        if used + len(text) > budget:
            break
        # Label the source so LLM can weigh recency vs long-term knowledge
        label = {"short_term": "[recent]", "urgent": "[urgent]", "long_term": "[memory]"}.get(source, "[memory]")
        parts.append(f"{label} {text}")
        used += len(text)
        source_counts[source] = source_counts.get(source, 0) + 1

    context = "\n".join(parts) if parts else "No prior context available."

    datetime_line = f"RIGHT NOW it is: {body.current_datetime}." if body.current_datetime else ""
    # Orchestrator already sends just the given name (first whitespace-separated
    # word), so this instruction reinforces that the LLM should address the user
    # by that single name rather than echoing a longer form.
    name_line = (
        f"The user's given name is {body.user_name}. Always address them as {body.user_name} — never by a longer or full name."
        if body.user_name else ""
    )
    native_line = f"Their native language is {body.native_language}." if body.native_language else ""
    goal_line = f"Their learning goal is: {body.learning_goal}." if body.learning_goal else ""

    style_line = STYLE_HINTS.get(body.conversation_style, STYLE_HINTS["friendly"])

    system_prompt = (
        # Datetime goes first so it anchors all temporal reasoning below
        (f"{datetime_line}\n\n" if datetime_line else "")
        + f"You are a warm, friendly AI companion. "
        f"Speak in {body.target_language} or whatever language the user uses naturally. "
        f"Help with conversations, answer questions, and support language learning like a good friend.\n"
        f"{style_line}\n"
        f"The user is at {body.user_level} level.\n"
        + (f"{name_line}\n" if name_line else "")
        + (f"{native_line}\n" if native_line else "")
        + (f"{goal_line}\n" if goal_line else "")
        + f"\nWhat you know about this user:\n{context}\n\n"
        "Guidelines:\n"
        "- Keep responses concise and conversational (2-4 sentences max)\n"
        "- Gently correct language mistakes when helpful\n"
        "- Be warm, encouraging, and stay positive\n"
        "- Do not use emojis or special icons in your responses\n"
        "- TEMPORAL REASONING: facts may mention specific dates/times. "
        "Compare them to RIGHT NOW (above). "
        "If an event has already passed, treat it as past and ask how it went if relevant. "
        "If it is still upcoming, treat it as future. Never confuse the two."
    )

    return {
        "system_prompt": system_prompt,
        "context_chunks_used": len(parts),
        "estimated_tokens": used // CHARS_PER_TOKEN,
        # Expose retrieved chunks so the turn-agent can spot SESSION_INSIGHT and
        # promote it to an active mission block in the system prompt.
        "chunks_debug": chunks,
    }
