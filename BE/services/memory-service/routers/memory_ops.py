from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from workers.consolidation import run_consolidation
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory

router = APIRouter()

class ConsolidateRequest(BaseModel):
    session_id: str

class AppendRequest(BaseModel):
    user_message: str
    ai_message: str

# POST /consolidate/:user_id — triggered by orchestrator on session end
@router.post("/consolidate/{user_id}")
async def consolidate(user_id: str, body: ConsolidateRequest, bg: BackgroundTasks):
    bg.add_task(run_consolidation, user_id, body.session_id)
    return {"status": "queued", "user_id": user_id, "session_id": body.session_id}

# GET /short-term/:session_id — returns recent messages without embedding (for parallel prefetch)
@router.get("/short-term/{session_id}")
async def get_short_term(session_id: str):
    messages = await ShortTermMemory.get_recent(session_id, n=10)
    formatted = "\n".join(
        f"{m['role'].capitalize()}: {m['content']}" for m in messages
    )
    return {"messages": messages, "formatted": formatted}

# POST /short-term/:session_id/append — called after every turn
@router.post("/short-term/{session_id}/append")
async def append_short_term(session_id: str, body: AppendRequest):
    await ShortTermMemory.append(session_id, body.user_message, body.ai_message)
    return {"status": "ok"}

# DELETE /facts/:user_id — GDPR full memory wipe
@router.delete("/facts/{user_id}")
async def delete_facts(user_id: str):
    await LongTermMemory.delete_all(user_id)
    return {"status": "deleted", "user_id": user_id}
