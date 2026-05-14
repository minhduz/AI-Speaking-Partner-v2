from fastapi import APIRouter
from pydantic import BaseModel
from retriever import fan_out_retrieve

router = APIRouter()

TOKEN_BUDGET    = 2000
CHARS_PER_TOKEN = 4

class BuildPromptRequest(BaseModel):
    query: str
    session_id: str = ""
    user_level: str = "beginner"
    target_language: str = "english"
    user_name: str = ""
    current_datetime: str = ""
    layers: list[str] = []

@router.post("/{user_id}")
async def build_prompt(user_id: str, body: BuildPromptRequest):
    chunks = await fan_out_retrieve(
        user_id=user_id,
        session_id=body.session_id,
        query=body.query,
        layers=body.layers if body.layers else None,
    )

    # Trim to token budget
    parts, used = [], 0
    budget = TOKEN_BUDGET * CHARS_PER_TOKEN
    for chunk in chunks:
        text = chunk["text"]
        if used + len(text) > budget:
            break
        parts.append(f"- {text}")
        used += len(text)

    context = "\n".join(parts) if parts else "No prior context available."

    datetime_line = f"RIGHT NOW it is: {body.current_datetime}." if body.current_datetime else ""
    name_line = f"The user's name is {body.user_name}." if body.user_name else ""

    system_prompt = (
        # Datetime goes first so it anchors all temporal reasoning below
        (f"{datetime_line}\n\n" if datetime_line else "")
        + f"You are a warm, friendly AI companion. "
        f"Speak in {body.target_language} or whatever language the user uses naturally. "
        f"Help with conversations, answer questions, and support language learning like a good friend.\n"
        f"The user is at {body.user_level} level.\n"
        + (f"{name_line}\n" if name_line else "")
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
    }
