import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from db import database
from agent import graph

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
        "current_datetime": h.get("x-current-datetime", ""),
        "turn_index":       int(h.get("x-turn-index", "1")),
        # Intermediates — empty until nodes populate them
        "transcript":    "",
        "confidence":    0.0,
        "pronunciation": {},
        "system_prompt": "",
        "full_response": "",
        "tokens_used":   0,
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "turn-agent"}
