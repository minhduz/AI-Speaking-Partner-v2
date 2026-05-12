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

    name_line = f"The user's name is {body.user_name}." if body.user_name else ""
    datetime_line = f"Current date and time: {body.current_datetime}." if body.current_datetime else ""

    system_prompt = (
        f"You are a friendly and encouraging {body.target_language} speaking coach.\n"
        f"The user is at {body.user_level} level.\n"
        + (f"{name_line}\n" if name_line else "")
        + (f"{datetime_line}\n" if datetime_line else "")
        + f"\nWhat you know about this user:\n{context}\n\n"
        "Guidelines:\n"
        "- Keep responses concise and conversational (2-4 sentences max)\n"
        "- Gently correct pronunciation and grammar mistakes\n"
        "- Encourage the user and stay positive\n"
        "- Stay focused on speaking practice\n"
        "- If the user's context mentions an upcoming or recent event relevant to today, acknowledge it naturally"
    )

    return {
        "system_prompt": system_prompt,
        "context_chunks_used": len(parts),
        "estimated_tokens": used // CHARS_PER_TOKEN,
    }
