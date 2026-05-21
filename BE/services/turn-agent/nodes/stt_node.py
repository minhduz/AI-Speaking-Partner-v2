import json
import aiohttp
from langgraph.config import get_stream_writer
from db import settings


async def stt_node(state: dict) -> dict:
    """
    Calls speech-service /stt/stream (SSE).
    Emits {type: "word", text, is_final} events for each Soniox token so the
    frontend can show words as they arrive while the user's audio is processed.
    Waits for the final done event to get the complete transcript + pronunciation.
    """
    writer = get_stream_writer()

    form = aiohttp.FormData()
    form.add_field(
        "audio",
        state["audio_bytes"],
        filename="audio.webm",
        content_type=state.get("audio_mimetype", "audio/webm"),
    )

    transcript   = ""
    confidence   = 0.9
    # Pronunciation scoring is not available (Soniox is STT-only, not a
    # pronunciation assessor). score=None means "not measured" — the FE and
    # the session evaluation must not surface a fabricated number.
    pronunciation = {"score": None, "per_word": []}

    async with aiohttp.ClientSession() as sess:
        async with sess.post(
            f"{settings.speech_service_url}/stt/stream", data=form
        ) as r:
            r.raise_for_status()
            async for raw_line in r.content.iter_lines():
                line = raw_line.decode("utf-8").strip()
                if not line.startswith("data: "):
                    continue
                try:
                    data = json.loads(line[6:])
                except Exception:
                    continue

                if data.get("error"):
                    break

                if data.get("done"):
                    transcript    = data.get("transcript", "")
                    confidence    = data.get("confidence", 0.9)
                    pronunciation = data.get("pronunciation", pronunciation)
                    break

                # Stream each word token to the frontend in real time
                writer({
                    "type":     "word",
                    "text":     data.get("text", ""),
                    "is_final": data.get("is_final", False),
                })

    writer({"type": "transcript", "text": transcript})
    writer({"type": "pronunciation", "data": pronunciation})

    return {
        "transcript":   transcript,
        "confidence":   confidence,
        "pronunciation": pronunciation,
    }
