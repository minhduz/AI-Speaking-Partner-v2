import json
import logging
from contextlib import asynccontextmanager
from urllib.parse import unquote
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from db import database
from agent import graph, graph_text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    yield
    await database.disconnect()


app = FastAPI(title="Turn Agent", lifespan=lifespan)


def _decode_header(value: str | None) -> str:
    if not value:
        return ""
    try:
        return unquote(value).strip()
    except Exception:
        return value.strip()


@app.post("/turn/stream")
async def turn_stream(request: Request):
    form = await request.form()
    audio = form.get("audio")
    if audio is None:
        raise HTTPException(status_code=400, detail="audio field missing")

    audio_bytes = await audio.read()
    h = request.headers

    initial_state = {
        "session_id":       h.get("x-session-id", ""),
        "user_id":          h.get("x-user-id", ""),
        "audio_bytes":      audio_bytes,
        "audio_mimetype":   audio.content_type or "audio/webm",
        "user_name":        h.get("x-user-name", ""),
        "user_level":       h.get("x-user-level", "beginner"),
        "target_language":  h.get("x-target-language", "english"),
        "native_language":  h.get("x-native-language", ""),
        "learning_goal":    h.get("x-learning-goal", ""),
        "current_datetime": h.get("x-current-datetime", ""),
        "turn_index":       int(h.get("x-turn-index", "1")),
        "is_onboarding":    h.get("x-is-onboarding", "false").lower() == "true",
        "active_mission":   _decode_header(h.get("x-active-mission")),
        # Intermediates — empty until nodes populate them
        "transcript":            "",
        "confidence":            0.0,
        "pronunciation":         {},
        "system_prompt":         "",
        "recent_messages":       [],
        "conversation_summary":  "",
        "full_response":         "",
        "tokens_used":           0,
    }

    async def event_generator():
        tokens_used = 0
        try:
            async for event in graph.astream(initial_state, stream_mode="custom"):
                if event.get("type") == "tokens_counted":
                    tokens_used = event["tokens_used"]
                    continue  # internal signal, don't forward to client
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done', 'tokens_used': tokens_used})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/turn/stream-text")
async def turn_stream_text(request: Request):
    """Turn endpoint when FE has already done STT — skips stt_node, runs LLM+TTS only."""
    body = await request.json()
    transcript = body.get("transcript", "")
    h = request.headers

    initial_state = {
        "session_id":           h.get("x-session-id", ""),
        "user_id":              h.get("x-user-id", ""),
        "audio_bytes":          b"",
        "audio_mimetype":       "",
        "user_name":            h.get("x-user-name", ""),
        "user_level":           h.get("x-user-level", "beginner"),
        "target_language":      h.get("x-target-language", "english"),
        "native_language":      h.get("x-native-language", ""),
        "learning_goal":        h.get("x-learning-goal", ""),
        "current_datetime":     h.get("x-current-datetime", ""),
        "turn_index":           int(h.get("x-turn-index", "1")),
        "is_onboarding":        h.get("x-is-onboarding", "false").lower() == "true",
        "active_mission":       _decode_header(h.get("x-active-mission")),
        "transcript":           transcript,
        "confidence":           1.0,
        "pronunciation":        {"score": None, "per_word": []},
        "system_prompt":        "",
        "recent_messages":      [],
        "conversation_summary": "",
        "full_response":        "",
        "tokens_used":          0,
    }

    async def event_generator():
        tokens_used = 0
        try:
            async for event in graph_text.astream(initial_state, stream_mode="custom"):
                if event.get("type") == "tokens_counted":
                    tokens_used = event["tokens_used"]
                    continue
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done', 'tokens_used': tokens_used})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "turn-agent"}
