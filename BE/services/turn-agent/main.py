import json
import logging
from contextlib import asynccontextmanager
from urllib.parse import unquote

# Load .env into os.environ before anything else so LangSmith picks up
# LANGSMITH_* vars when running locally (uvicorn). In docker these are already
# injected via compose `env_file`, so this is a no-op there.
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from db import database
from agent import graph, graph_text


# Orchestrator URL-encodes name / goal headers so Vietnamese diacritics survive
# the ISO-8859-1 default of HTTP/1.1 headers. Decode here before they reach
# downstream prompt-builders.
def _h(headers, key: str, default: str = "") -> str:
    return unquote(headers.get(key, default))

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


def _parse_json_header(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(unquote(value).strip())
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _parse_json_object_header(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(unquote(value).strip())
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


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
        "user_name":        _h(h, "x-user-name"),
        "user_level":       h.get("x-user-level", "beginner"),
        "target_language":  h.get("x-target-language", "english"),
        "native_language":  h.get("x-native-language", ""),
        "learning_goal":    _h(h, "x-learning-goal"),
        "current_datetime": h.get("x-current-datetime", ""),
        "turn_index":       int(h.get("x-turn-index", "1")),
        "is_onboarding":    h.get("x-is-onboarding", "false").lower() == "true",
        "session_mode":     h.get("x-session-mode", "guided_learning"),
        "active_mission":   _decode_header(h.get("x-active-mission")),
        "voice_id":         h.get("x-voice-id", "Adrian"),
        "speech_rate":      float(h.get("x-speech-rate", "1.0")),
        "conversation_style": h.get("x-conversation-style", "friendly"),
        "deck_active":        h.get("x-deck-active", "false").lower() == "true",
        "deck_status":        h.get("x-deck-status", "none"),
        "deck_end_reason":    h.get("x-deck-end-reason", ""),
        "deck_is_continuation": h.get("x-deck-is-continuation", "false").lower() == "true",
        "card_index":         int(h.get("x-card-index", "0")),
        "card_total":         int(h.get("x-card-total", "0")),
        "card_type":          h.get("x-card-type", ""),
        "card_title":         _decode_header(h.get("x-card-title")),
        "card_task":          _decode_header(h.get("x-card-task")),
        "card_attempts":      int(h.get("x-card-attempts", "0")),
        "card_retry_allowed": h.get("x-card-retry-allowed", "false").lower() == "true",
        "card_success_criteria": _parse_json_header(h.get("x-card-success-criteria")),
        # Audio route doesn't carry greeting context; only the text route uses
        # the greeting payload (FE STT happens before this call so the user's
        # transcript is already known and they use /stream-text).
        "greeting_text":         _decode_header(h.get("x-greeting-text")),
        "session_insight":       _parse_json_object_header(h.get("x-session-insight")),
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
        "user_name":            _h(h, "x-user-name"),
        "user_level":           h.get("x-user-level", "beginner"),
        "target_language":      h.get("x-target-language", "english"),
        "native_language":      h.get("x-native-language", ""),
        "learning_goal":        _h(h, "x-learning-goal"),
        "current_datetime":     h.get("x-current-datetime", ""),
        "turn_index":           int(h.get("x-turn-index", "1")),
        "is_onboarding":        h.get("x-is-onboarding", "false").lower() == "true",
        "session_mode":         h.get("x-session-mode", "guided_learning"),
        "active_mission":       _decode_header(h.get("x-active-mission")),
        "voice_id":             h.get("x-voice-id", "Adrian"),
        "speech_rate":          float(h.get("x-speech-rate", "1.0")),
        "conversation_style":   h.get("x-conversation-style", "friendly"),
        "deck_active":           h.get("x-deck-active", "false").lower() == "true",
        "deck_status":           h.get("x-deck-status", "none"),
        "deck_end_reason":       h.get("x-deck-end-reason", ""),
        "deck_is_continuation":  h.get("x-deck-is-continuation", "false").lower() == "true",
        "card_index":            int(h.get("x-card-index", "0")),
        "card_total":            int(h.get("x-card-total", "0")),
        "card_type":             h.get("x-card-type", ""),
        "card_title":            _decode_header(h.get("x-card-title")),
        "card_task":             _decode_header(h.get("x-card-task")),
        "card_attempts":         int(h.get("x-card-attempts", "0")),
        "card_retry_allowed":    h.get("x-card-retry-allowed", "false").lower() == "true",
        "card_success_criteria": _parse_json_header(h.get("x-card-success-criteria")),
        # Greeting text — present only on turn 1 of a freshly-started session.
        # Used by llm_tts_node (prepend to LLM messages) and persist_node
        # (write to short-term as turn 0) so a short user reply to the
        # greeting's question doesn't arrive context-less.
        "greeting_text":         _decode_header(h.get("x-greeting-text")),
        # Session insight (consolidated facts from prior sessions: struggled_with,
        # energy, recommended_next_session, etc.). Moved here from the greeting
        # endpoint so the AI can reference it from turn 1 onwards. The
        # build_prompt_node decides whether to inject warmup-only or lead-in
        # framing based on turn_index.
        "session_insight":       _parse_json_object_header(h.get("x-session-insight")),
        "transcript":            transcript,
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
