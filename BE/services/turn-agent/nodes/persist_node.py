import asyncio
import json
import aiohttp
from langgraph.config import get_stream_writer
from db import database, settings


async def persist_node(state: dict) -> dict:
    session_id = state["session_id"]
    user_id = state["user_id"]
    turn_index = state["turn_index"]
    transcript = state["transcript"]
    full_response = state["full_response"]
    tokens_used = state["tokens_used"]
    pronunciation = state.get("pronunciation", {})
    confidence = state.get("confidence", 0.9)
    pron_score = pronunciation.get("score", 0.0) if isinstance(pronunciation, dict) else 0.0

    await database.pool.execute(
        """
        INSERT INTO speaking_app.turns (session_id, user_id, turn_index, tokens_used, data)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        """,
        session_id,
        user_id,
        turn_index,
        tokens_used,
        json.dumps({
            "transcript": transcript,
            "response_text": full_response,
            "confidence": confidence,
            "pronunciation": pronunciation,
            "tokens_used": tokens_used,
        }),
    )

    row = await database.pool.fetchrow(
        "SELECT total_tokens, avg_pronunciation_score FROM speaking_app.sessions WHERE id = $1",
        session_id,
    )
    if row:
        turn_count = await database.pool.fetchval(
            "SELECT COUNT(*) FROM speaking_app.turns WHERE session_id = $1",
            session_id,
        )
        if turn_count > 0:
            new_avg = ((row["avg_pronunciation_score"] * (turn_count - 1)) + pron_score) / turn_count
        else:
            new_avg = pron_score
        await database.pool.execute(
            """
            UPDATE speaking_app.sessions
            SET total_tokens = $1, avg_pronunciation_score = $2
            WHERE id = $3
            """,
            row["total_tokens"] + tokens_used,
            round(new_avg, 3),
            session_id,
        )

    asyncio.create_task(_append_short_term(user_id, session_id, transcript, full_response))
    asyncio.create_task(_increment_billing(user_id, tokens_used))
    if turn_index == 1:
        writer = get_stream_writer()
        title = await _generate_title(session_id, transcript)
        if title:
            writer({"type": "title", "text": title})

    return {}


async def _append_short_term(user_id: str, session_id: str, user_msg: str, ai_msg: str):
    try:
        async with aiohttp.ClientSession() as s:
            r = await s.post(
                f"{settings.memory_service_url}/short-term/{user_id}/append",
                json={"session_id": session_id, "user_message": user_msg, "ai_message": ai_msg},
            )
            if not r.ok:
                body = await r.text()
                print(f"[persist] short-term append HTTP {r.status}: {body[:200]}")
            else:
                print(f"[persist] short-term append OK  user={user_id}  session={session_id[:8]}")
    except Exception as e:
        print(f"[persist] short-term append failed: {e}")


async def _increment_billing(user_id: str, tokens_used: int):
    try:
        async with aiohttp.ClientSession() as s:
            await s.post(
                f"{settings.billing_service_url}/internal/usage/increment",
                json={"user_id": user_id, "tokens_used": tokens_used},
            )
    except Exception as e:
        print(f"[persist] billing increment failed: {e}")


async def _generate_title(session_id: str, first_transcript: str) -> str | None:
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(
                f"{settings.llm_gateway_url}/complete",
                json={
                    "system": "Generate a 5-word max title for this conversation. Return only the title, nothing else.",
                    "messages": [{"role": "user", "content": first_transcript}],
                },
            ) as r:
                data = await r.json()
                title = (data.get("response_text") or "").strip()
        if title:
            await database.pool.execute(
                "UPDATE speaking_app.sessions SET title = $1 WHERE id = $2",
                title,
                session_id,
            )
        return title or None
    except Exception as e:
        print(f"[persist] title generation failed: {e}")
        return None
