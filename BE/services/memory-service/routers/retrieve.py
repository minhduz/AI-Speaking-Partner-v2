from fastapi import APIRouter
from pydantic import BaseModel
from retriever import fan_out_retrieve

router = APIRouter()

class RetrieveRequest(BaseModel):
    query: str
    session_id: str = ""
    limit: int = 10

@router.post("/{user_id}")
async def retrieve(user_id: str, body: RetrieveRequest):
    chunks = await fan_out_retrieve(
        user_id=user_id,
        session_id=body.session_id,
        query=body.query,
    )
    return {"user_id": user_id, "chunks": chunks[:body.limit], "total": len(chunks)}
