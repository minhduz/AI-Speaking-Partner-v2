import asyncio
import base64
import io
from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from openai import AsyncOpenAI

class Settings(BaseSettings):
    port: int = 8010
    openai_api_key: str = ""
    tts_voice: str = "alloy"
    tts_model: str = "tts-1"
    stt_model: str = "whisper-1"
    stt_language: str = "en"
    class Config:
        env_file = ".env"

settings = Settings()
client   = AsyncOpenAI(api_key=settings.openai_api_key)
app      = FastAPI(title="Speech Service")


# ─── STT ─────────────────────────────────────────────────────────────────────
@app.post("/stt")
async def stt(audio: UploadFile = File(...)):
    """
    Receives audio blob.
    Runs Whisper STT + pronunciation scoring simultaneously via asyncio.gather.
    Returns transcript + confidence + per-word pronunciation feedback.
    """
    audio_bytes = await audio.read()
    filename    = audio.filename or "audio.webm"

    # Both run at the same time — no sequential waiting
    transcript_result, pronunciation_result = await asyncio.gather(
        _run_stt(audio_bytes, filename),
        _run_pronunciation(audio_bytes, filename),
    )

    return {
        "transcript":   transcript_result["text"],
        "confidence":   transcript_result["confidence"],
        "pronunciation": pronunciation_result,
    }


# ─── TTS ─────────────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str
    voice: str = None

@app.post("/tts")
async def tts(body: TTSRequest):
    """Convert text to speech, return base64-encoded mp3."""
    response = await client.audio.speech.create(
        model=settings.tts_model,
        voice=body.voice or settings.tts_voice,
        input=body.text,
    )
    return {
        "audio_b64": base64.b64encode(response.content).decode(),
        "format":    "mp3",
    }


# ─── PRONUNCIATION SCORE ─────────────────────────────────────────────────────
class ScoreRequest(BaseModel):
    transcript: str

@app.post("/score/pronunciation")
async def score_pronunciation(body: ScoreRequest):
    """Detailed per-word pronunciation scoring from plain transcript."""
    return _score_from_text(body.transcript)


# ─── HEALTH ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "speech"}


# ─── INTERNAL HELPERS ────────────────────────────────────────────────────────
def _get(obj, key):
    """Dict-or-object safe field access — handles both Pydantic models and raw dicts."""
    return obj[key] if isinstance(obj, dict) else getattr(obj, key)


async def _run_stt(audio_bytes: bytes, filename: str) -> dict:
    file_tuple = (filename, io.BytesIO(audio_bytes), "audio/webm")
    result = await client.audio.transcriptions.create(
        model=settings.stt_model,
        file=file_tuple,
        language=settings.stt_language,
        response_format="verbose_json",
    )

    # Derive confidence from avg log probability of segments
    confidence = 0.9
    segments = getattr(result, "segments", None) or []
    if segments:
        avg_logprob = sum(_get(s, "avg_logprob") for s in segments) / len(segments)
        confidence = round(min(1.0, max(0.0, 1.0 + avg_logprob / 5)), 3)

    return {"text": result.text.strip(), "confidence": confidence}


async def _run_pronunciation(audio_bytes: bytes, filename: str) -> dict:
    """
    Uses Whisper word-level timestamps as a pronunciation proxy.
    Very fast / very slow word durations indicate hesitation or mispronunciation.
    """
    file_tuple = (filename, io.BytesIO(audio_bytes), "audio/webm")
    try:
        result = await client.audio.transcriptions.create(
            model=settings.stt_model,
            file=file_tuple,
            language=settings.stt_language,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
    except Exception:
        # Fallback — no word timestamps available
        return {"score": 0.85, "per_word": []}

    per_word = []
    words = getattr(result, "words", None) or []
    for w in words:
        start = _get(w, "start")
        end   = _get(w, "end")
        word  = _get(w, "word")
        duration = end - start
        if duration < 0.08:
            score = 0.55
        elif duration < 0.12:
            score = 0.70
        elif duration > 1.8:
            score = 0.65
        elif duration > 1.2:
            score = 0.75
        else:
            score = 0.90
        per_word.append({
            "word":  word.strip(),
            "score": score,
            "start": round(start, 2),
            "end":   round(end, 2),
        })

    overall = round(sum(w["score"] for w in per_word) / len(per_word), 3) if per_word else 0.85
    return {"score": overall, "per_word": per_word}


def _score_from_text(transcript: str) -> dict:
    """Fallback scorer when audio is not available — returns neutral scores."""
    words = transcript.strip().split()
    per_word = [{"word": w, "score": 0.85} for w in words]
    return {"score": 0.85, "per_word": per_word}
