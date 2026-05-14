import logging
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from workers.consolidation import run_consolidation
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory

log = logging.getLogger("memory_ops")
router = APIRouter()


class ConsolidateRequest(BaseModel):
    session_id: str


class AppendRequest(BaseModel):
    session_id: str       # tagged on each message for consolidation filtering
    user_message: str
    ai_message: str


# POST /consolidate/:user_id — triggered by orchestrator on session end
@router.post("/consolidate/{user_id}")
async def consolidate(user_id: str, body: ConsolidateRequest, bg: BackgroundTasks):
    log.info("[memory_ops] consolidate queued  user=%s  session=%s", user_id, body.session_id)
    bg.add_task(run_consolidation, user_id, body.session_id)
    return {"status": "queued", "user_id": user_id, "session_id": body.session_id}


# GET /short-term/:user_id — returns recent messages for the user's rolling buffer
@router.get("/short-term/{user_id}")
async def get_short_term(user_id: str):
    messages = await ShortTermMemory.get_recent(user_id, n=10)
    formatted = "\n".join(
        f"{m['role'].capitalize()}[{m.get('session_id','?')[:8]}]: {m['content']}"
        for m in messages
    )
    log.info("[memory_ops] get_short_term  user=%s  returned=%d", user_id, len(messages))
    return {"messages": messages, "formatted": formatted}


# GET /short-term/:user_id/facts — inspect consolidated short-term facts in Redis
@router.get("/short-term/{user_id}/facts")
async def get_st_facts(user_id: str):
    facts = await ShortTermMemory.get_st_facts(user_id)
    log.info("[memory_ops] get_st_facts  user=%s  returned=%d", user_id, len(facts))
    return {"count": len(facts), "facts": facts}


# POST /short-term/:user_id/append — called after every turn by turn-agent
@router.post("/short-term/{user_id}/append")
async def append_short_term(user_id: str, body: AppendRequest):
    await ShortTermMemory.append(user_id, body.session_id, body.user_message, body.ai_message)
    return {"status": "ok"}


# DELETE /facts/:user_id — GDPR full memory wipe (long-term + short-term rolling buffer)
@router.delete("/facts/{user_id}")
async def delete_facts(user_id: str):
    await LongTermMemory.delete_all(user_id)
    await ShortTermMemory.clear(user_id)
    log.info("[memory_ops] GDPR wipe  user=%s", user_id)
    return {"status": "deleted", "user_id": user_id}
