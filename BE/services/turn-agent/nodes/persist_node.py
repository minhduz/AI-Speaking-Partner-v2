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
    raw_score = pronunciation.get("score") if isinstance(pronunciation, dict) else None
    pron_score = float(raw_score) if raw_score is not None else 0.0

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
        existing_avg = float(row["avg_pronunciation_score"]) if row["avg_pronunciation_score"] is not None else 0.0
        existing_tokens = int(row["total_tokens"]) if row["total_tokens"] is not None else 0
        if turn_count > 0:
            new_avg = ((existing_avg * (turn_count - 1)) + pron_score) / turn_count
        else:
            new_avg = pron_score
        await database.pool.execute(
            """
            UPDATE speaking_app.sessions
            SET total_tokens = $1, avg_pronunciation_score = $2
            WHERE id = $3
            """,
            existing_tokens + tokens_used,
            round(new_avg, 3),
            session_id,
        )

    # Turn 1 + greeting present: record the AI's greeting as a standalone entry
    # BEFORE the turn pair, so future turns see it in recent_messages. Memory
    # service skips empty user_message — only the greeting is pushed.
    # Ordering matters: greeting must hit Redis before the turn pair so the
    # final buffer order is [greeting, user transcript, ai response].
    greeting_text = (state.get("greeting_text") or "").strip()
    if turn_index == 1 and greeting_text:
        await _append_short_term(user_id, session_id, "", greeting_text)

    asyncio.create_task(_append_short_term(user_id, session_id, transcript, full_response))
    if turn_index == 1:
        writer = get_stream_writer()
        lesson_title = (state.get("lesson_title") or "").strip()
        if state.get("is_lesson_session"):
            # Lesson sessions are already titled by the curriculum. Do not send
            # the first exercise transcript to the generic title generator; it
            # can overwrite the lesson title with prompt-ish text like
            # "Title Generation Request".
            if lesson_title:
                await database.pool.execute(
                    "UPDATE speaking_app.sessions SET title = $1 WHERE id = $2",
                    lesson_title,
                    session_id,
                )
                writer({"type": "title", "text": lesson_title})
        else:
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
