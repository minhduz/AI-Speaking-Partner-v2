import asyncio
import base64
import io
import json
import logging
import queue
import threading
import uuid
import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from soniox.client import SonioxClient
from soniox.types import RealtimeSTTConfig, RealtimeTTSConfig


class Settings(BaseSettings):
    port: int = 8010
    soniox_api_key: str = ""
    stt_language: str = "en"
    soniox_stt_model: str = "stt-rt-v4"
    soniox_tts_model: str = "tts-rt-v1"
    soniox_tts_voice: str = "Adrian"
    soniox_tts_sample_rate: int = 24000
    soniox_temp_key_expires_seconds: int = 60

    class Config:
        env_file = ".env"


settings = Settings()
soniox_client = SonioxClient(api_key=settings.soniox_api_key)
app = FastAPI(title="Speech Service")
_tts_semaphore = asyncio.Semaphore(2)  # max 2 concurrent Soniox TTS connections
log = logging.getLogger("speech-service")

SONIOX_TTS_VOICES = {
    "Maya",
    "Daniel",
    "Noah",
    "Nina",
    "Emma",
    "Jack",
    "Adrian",
    "Claire",
    "Grace",
    "Owen",
    "Mina",
    "Kenji",
    "Rafael",
    "Mateo",
    "Lucia",
    "Sofia",
    "Oliver",
    "Arthur",
    "Isla",
    "Victoria",
    "Cooper",
    "Mason",
    "Ruby",
    "Elise",
    "Arjun",
    "Rohan",
    "Priya",
    "Meera",
}

LEGACY_TTS_VOICE_ALIASES = {
    "Sophia": "Sofia",
    "Liam": "Daniel",
    "Olivia": "Grace",
}


def _normalize_tts_voice(voice: str | None) -> str:
    requested = (voice or settings.soniox_tts_voice or "Adrian").strip()
    canonical = LEGACY_TTS_VOICE_ALIASES.get(requested, requested)
    if canonical in SONIOX_TTS_VOICES:
        return canonical

    default_voice = (settings.soniox_tts_voice or "Adrian").strip()
    default_voice = LEGACY_TTS_VOICE_ALIASES.get(default_voice, default_voice)
    if default_voice in SONIOX_TTS_VOICES:
        log.warning("[tts] Unsupported voice %r; using configured default %r", requested, default_voice)
        return default_voice

    log.warning("[tts] Unsupported voice %r and invalid default %r; using Adrian", requested, default_voice)
    return "Adrian"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Temporary API key for Soniox browser-direct STT.
@app.get("/temporary-api-key")
@app.get("/stt/temporary-api-key")
async def get_temporary_api_key():
    """
    Short-lived Soniox key for browser-direct STT, matching Soniox's
    RecordTranscribe web-library flow without exposing SONIOX_API_KEY.
    """
    if not settings.soniox_api_key:
        raise HTTPException(status_code=500, detail="SONIOX_API_KEY is not configured")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.soniox.com/v1/auth/temporary-api-key",
                headers={
                    "Authorization": f"Bearer {settings.soniox_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "usage_type": "transcribe_websocket",
                    "expires_in_seconds": settings.soniox_temp_key_expires_seconds,
                },
            )
    except Exception as exc:
        log.exception("Soniox temporary key request failed")
        raise HTTPException(
            status_code=502,
            detail=f"Server failed to obtain temporary Soniox API key: {exc}",
        ) from exc

    if not response.is_success:
        log.warning("Soniox temporary key HTTP %s: %s", response.status_code, response.text[:300])
        raise HTTPException(
            status_code=502,
            detail="Soniox temporary API key request failed",
        )

    return response.json()


# STT websocket proxy, kept as a fallback when the browser library is not used.
@app.websocket("/stt/ws")
async def stt_ws(websocket: WebSocket):
    """
    Real-time STT. Browser streams binary audio chunks while recording,
    then sends {"end": true} when done.

    Server → browser:
      {"type": "word",  "text": "<full current text>", "is_final": bool}
      {"type": "done",  "transcript": "<final>", "confidence": 0.9}
      {"type": "error", "message": "..."}
    """
    await websocket.accept()

    loop     = asyncio.get_running_loop()
    audio_q: queue.Queue   = queue.Queue()
    result_q: asyncio.Queue = asyncio.Queue()

    def soniox_thread():
        def put_result(item):
            try:
                asyncio.run_coroutine_threadsafe(result_q.put(item), loop).result()
            except RuntimeError:
                pass

        final_text = ""
        hypothesis = ""
        stop_feeder = threading.Event()
        config = RealtimeSTTConfig(
            model=settings.soniox_stt_model,
            language_hints=[settings.stt_language],
            enable_endpoint_detection=True,
            audio_format="auto",
        )
        try:
            with soniox_client.realtime.stt.connect(config=config) as session:
                def audio_feeder():
                    try:
                        while True:
                            chunk = audio_q.get()
                            if stop_feeder.is_set():
                                return
                            if chunk is None:
                                try:
                                    session.finish()
                                except Exception as exc:
                                    if not _is_normal_ws_close(exc):
                                        log.warning("Soniox STT finish failed: %s", exc)
                                return
                            try:
                                session.send_byte_chunk(chunk)
                            except Exception as exc:
                                if not _is_normal_ws_close(exc):
                                    log.warning("Soniox STT send_byte_chunk failed: %s", exc)
                                    put_result({"type": "error", "message": str(exc)})
                                return
                    finally:
                        stop_feeder.set()

                feeder = threading.Thread(target=audio_feeder, daemon=True)
                feeder.start()

                try:
                    for event in session.receive_events():
                        # Soniox emits special control tokens like "<end>" when endpoint
                        # detection fires. Strip anything wrapped in angle brackets so
                        # they never reach the transcript shown to the user.
                        finals    = [t.text for t in event.tokens if t.is_final     and not _is_control_token(t.text)]
                        nonfinals = [t.text for t in event.tokens if not t.is_final and not _is_control_token(t.text)]
                        if finals:
                            final_text += "".join(finals)
                            hypothesis = ""
                        if nonfinals:
                            hypothesis = "".join(nonfinals)
                        current = final_text + hypothesis
                        if current.strip():
                            is_stable = bool(finals) and not bool(nonfinals)
                            put_result({"type": "word", "text": current, "is_final": is_stable})
                finally:
                    stop_feeder.set()
                    audio_q.put(None)
                    feeder.join(timeout=1.0)
        except Exception as e:
            if not _is_normal_ws_close(e):
                put_result({"type": "error", "message": str(e)})
        finally:
            transcript = (final_text + hypothesis).strip()
            put_result({"type": "done", "transcript": transcript, "confidence": 0.9})
            put_result(None)

    threading.Thread(target=soniox_thread, daemon=True).start()

    async def receive_audio():
        try:
            while True:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"]:
                    audio_q.put(msg["bytes"])
                elif "text" in msg and msg["text"]:
                    data = json.loads(msg["text"])
                    if data.get("end"):
                        audio_q.put(None)
                        return
        except (WebSocketDisconnect, Exception):
            audio_q.put(None)

    async def send_results():
        try:
            while True:
                item = await result_q.get()
                if item is None:
                    return
                await websocket.send_json(item)
        except (WebSocketDisconnect, Exception):
            pass

    receive_task = asyncio.create_task(receive_audio())
    send_task = asyncio.create_task(send_results())
    done, _ = await asyncio.wait(
        {receive_task, send_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    if send_task in done and not receive_task.done():
        audio_q.put(None)
        receive_task.cancel()
    await asyncio.gather(receive_task, send_task, return_exceptions=True)


# ─── STT (batch, backward-compat) ────────────────────────────────────────────
@app.post("/stt")
async def stt(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    result = await _run_soniox_stt_batch(audio_bytes)
    return {
        "transcript":    result["text"],
        "confidence":    result["confidence"],
        # Soniox is STT-only — it does not assess pronunciation. score=None
        # means "not measured"; never fabricate a number here.
        "pronunciation": {"score": None, "per_word": []},
    }


# ─── STT STREAMING (SSE, backward-compat) ────────────────────────────────────
@app.post("/stt/stream")
async def stt_stream(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()

    async def generate():
        loop = asyncio.get_running_loop()
        token_queue: asyncio.Queue = asyncio.Queue()

        def run_soniox():
            final_text = ""
            hypothesis = ""
            config = RealtimeSTTConfig(
                model=settings.soniox_stt_model,
                language_hints=[settings.stt_language],
                enable_endpoint_detection=True,
                audio_format="auto",
            )
            try:
                with soniox_client.realtime.stt.connect(config=config) as session:
                    chunk_size = 4096
                    for i in range(0, len(audio_bytes), chunk_size):
                        session.send_byte_chunk(audio_bytes[i:i + chunk_size])
                    session.finish()
                    for event in session.receive_events():
                        finals    = [t.text for t in event.tokens if t.is_final     and not _is_control_token(t.text)]
                        nonfinals = [t.text for t in event.tokens if not t.is_final and not _is_control_token(t.text)]
                        if finals:
                            final_text += "".join(finals)
                            hypothesis = ""
                        if nonfinals:
                            hypothesis = "".join(nonfinals)
                        current = final_text + hypothesis
                        if current.strip():
                            is_stable = bool(finals) and not bool(nonfinals)
                            asyncio.run_coroutine_threadsafe(
                                token_queue.put({"text": current, "is_final": is_stable}),
                                loop,
                            ).result()
            except Exception as e:
                asyncio.run_coroutine_threadsafe(
                    token_queue.put({"error": str(e)}), loop
                ).result()
            finally:
                asyncio.run_coroutine_threadsafe(token_queue.put(None), loop).result()

        threading.Thread(target=run_soniox, daemon=True).start()

        last_text = ""
        while True:
            item = await token_queue.get()
            if item is None:
                break
            if "error" in item:
                break
            last_text = item["text"]
            yield f"data: {json.dumps({'text': item['text'], 'is_final': item['is_final']})}\n\n"

        transcript = last_text.strip()
        # Pronunciation is not assessed (Soniox is STT-only). score=None.
        yield f"data: {json.dumps({'done': True, 'transcript': transcript, 'confidence': 0.92, 'pronunciation': {'score': None, 'per_word': []}})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── TTS (batch) ──────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    speech_rate: float | None = None  # 0.75–1.5, clamped server-side


@app.post("/tts")
async def tts(body: TTSRequest):
    """Batch TTS via Soniox — mp3 output for AudioContext.decodeAudioData compat."""
    audio_bytes = await _run_soniox_tts_batch(body.text, body.voice, body.speech_rate)
    return {
        "audio_b64": base64.b64encode(audio_bytes).decode(),
        "format":    "mp3",
    }


# Soniox real-time STT emits control tokens like "<end>", "<fin>", etc. when
# endpoint detection is enabled. They're meant for downstream logic, not for
# display, so we strip anything wrapped in angle brackets before concatenating
# the transcript.
def _is_control_token(text: str) -> bool:
    if not text:
        return False
    stripped = text.strip()
    return stripped.startswith("<") and stripped.endswith(">")


def _is_normal_ws_close(exc: Exception) -> bool:
    current = exc
    while current:
        exc_name = current.__class__.__name__
        message = str(current)
        if "ConnectionClosedOK" in exc_name or "1000 (OK)" in message:
            return True
        current = current.__cause__ or current.__context__
    return False


# ─── TTS WEBSOCKET (streaming) ───────────────────────────────────────────────
@app.websocket("/tts/ws")
async def tts_ws(websocket: WebSocket):
    """
    One Soniox TTS session per connection — streams text in, PCM audio out.

    Client sends:  {"text": "chunk", "end": false}  or  {"text": "", "end": true}
    Server sends:  {"audio_b64": "<base64 pcm_s16le>", "sample_rate": 24000, "done": false}
                   {"done": true}
    """
    await websocket.accept()

    loop     = asyncio.get_running_loop()
    text_q:  queue.Queue   = queue.Queue()
    audio_q: asyncio.Queue = asyncio.Queue()

    def soniox_tts_thread():
        def put_audio(item):
            try:
                asyncio.run_coroutine_threadsafe(audio_q.put(item), loop).result()
            except RuntimeError:
                pass

        config = RealtimeTTSConfig(
            stream_id=str(uuid.uuid4()),
            model=settings.soniox_tts_model,
            language=settings.stt_language,
            voice=_normalize_tts_voice(settings.soniox_tts_voice),
            audio_format="pcm_s16le",
            sample_rate=settings.soniox_tts_sample_rate,
        )
        stop_feeder = threading.Event()
        try:
            with soniox_client.realtime.tts.connect(config=config) as session:
                def text_feeder():
                    try:
                        while True:
                            chunk = text_q.get()
                            if stop_feeder.is_set():
                                return
                            if chunk is None:
                                try:
                                    session.finish()
                                except Exception as exc:
                                    if not _is_normal_ws_close(exc):
                                        log.warning("Soniox TTS finish failed: %s", exc)
                                return
                            try:
                                session.send_text_chunk(chunk, text_end=False)
                            except Exception as exc:
                                if not _is_normal_ws_close(exc):
                                    log.warning("Soniox TTS send_text_chunk failed: %s", exc)
                                    put_audio(exc)
                                return
                    finally:
                        stop_feeder.set()

                feeder = threading.Thread(target=text_feeder, daemon=True)
                feeder.start()

                try:
                    for audio_chunk in session.receive_audio_chunks():
                        put_audio(audio_chunk)
                finally:
                    stop_feeder.set()
                    text_q.put(None)
                    feeder.join(timeout=1.0)
        except Exception as e:
            if not _is_normal_ws_close(e):
                put_audio(e)
        finally:
            put_audio(None)

    threading.Thread(target=soniox_tts_thread, daemon=True).start()

    async def receive_text():
        try:
            while True:
                data = await websocket.receive_json()
                text = data.get("text", "")
                if text:
                    text_q.put(text)
                if data.get("end"):
                    text_q.put(None)
                    return
        except (WebSocketDisconnect, Exception):
            text_q.put(None)

    async def send_audio():
        try:
            while True:
                item = await audio_q.get()
                if item is None:
                    await websocket.send_json({"done": True})
                    return
                if isinstance(item, Exception):
                    await websocket.send_json({"error": str(item)})
                    return
                await websocket.send_json({
                    "audio_b64":   base64.b64encode(item).decode(),
                    "sample_rate": settings.soniox_tts_sample_rate,
                    "done":        False,
                })
        except (WebSocketDisconnect, RuntimeError):
            return

    receive_task = asyncio.create_task(receive_text())
    send_task = asyncio.create_task(send_audio())
    done, _ = await asyncio.wait(
        {receive_task, send_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    if send_task in done and not receive_task.done():
        text_q.put(None)
        receive_task.cancel()
    await asyncio.gather(receive_task, send_task, return_exceptions=True)


# ─── HEALTH ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "speech"}


# ─── INTERNAL HELPERS ────────────────────────────────────────────────────────
async def _run_soniox_stt_batch(audio_bytes: bytes) -> dict:
    loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()

    def run():
        final_text = ""
        hypothesis = ""
        config = RealtimeSTTConfig(
            model=settings.soniox_stt_model,
            language_hints=[settings.stt_language],
            enable_endpoint_detection=True,
            audio_format="auto",
        )
        try:
            with soniox_client.realtime.stt.connect(config=config) as session:
                chunk_size = 4096
                for i in range(0, len(audio_bytes), chunk_size):
                    session.send_byte_chunk(audio_bytes[i:i + chunk_size])
                session.finish()
                for event in session.receive_events():
                    finals    = [t.text for t in event.tokens if t.is_final]
                    nonfinals = [t.text for t in event.tokens if not t.is_final]
                    if finals:
                        final_text += "".join(finals)
                        hypothesis = ""
                    if nonfinals:
                        hypothesis = "".join(nonfinals)
            text = (final_text + hypothesis).strip()
            loop.call_soon_threadsafe(fut.set_result, {"text": text, "confidence": 0.92})
        except Exception as e:
            loop.call_soon_threadsafe(fut.set_exception, e)

    threading.Thread(target=run, daemon=True).start()
    return await fut


def _build_tts_config(
    voice: str | None,
    speech_rate: float | None,
    audio_format: str,
) -> RealtimeTTSConfig:
    """Try to attach speech_rate to the Soniox config; fall back gracefully if
    the installed SDK version doesn't expose that field. Soniox's parameter
    name has shifted across versions (speed/speech_rate), so we attempt both."""
    base_kwargs = dict(
        stream_id=str(uuid.uuid4()),
        model=settings.soniox_tts_model,
        language=settings.stt_language,
        voice=_normalize_tts_voice(voice),
        audio_format=audio_format,
    )
    if audio_format == "pcm_s16le":
        base_kwargs["sample_rate"] = settings.soniox_tts_sample_rate

    if speech_rate is not None:
        clamped = max(0.75, min(1.5, float(speech_rate)))
        for kw in ("speech_rate", "speed"):
            try:
                return RealtimeTTSConfig(**base_kwargs, **{kw: clamped})
            except TypeError:
                continue
        log.warning("[tts] Soniox SDK rejected both speech_rate/speed kwargs — ignoring")
    return RealtimeTTSConfig(**base_kwargs)


async def _run_soniox_tts_batch(
    text: str,
    voice: str | None = None,
    speech_rate: float | None = None,
) -> bytes:
    async with _tts_semaphore:
        loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()

        def run():
            config = _build_tts_config(voice, speech_rate, audio_format="mp3")
            try:
                with soniox_client.realtime.tts.connect(config=config) as session:
                    session.send_text_chunk(text, text_end=False)
                    session.finish()
                    chunks = list(session.receive_audio_chunks())
                    loop.call_soon_threadsafe(fut.set_result, b"".join(chunks))
            except Exception as e:
                loop.call_soon_threadsafe(fut.set_exception, e)

        threading.Thread(target=run, daemon=True).start()
        return await fut
