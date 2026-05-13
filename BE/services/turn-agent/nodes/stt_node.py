import aiohttp
from langgraph.config import get_stream_writer
from db import settings


async def stt_node(state: dict) -> dict:
    writer = get_stream_writer()

    form = aiohttp.FormData()
    form.add_field(
        "audio",
        state["audio_bytes"],
        filename="audio.webm",
        content_type=state.get("audio_mimetype", "audio/webm"),
    )

    async with aiohttp.ClientSession() as sess:
        async with sess.post(f"{settings.speech_service_url}/stt", data=form) as r:
            r.raise_for_status()
            data = await r.json()

    writer({"type": "transcript", "text": data["transcript"]})
    writer({"type": "pronunciation", "data": data["pronunciation"]})

    return {
        "transcript": data["transcript"],
        "confidence": data["confidence"],
        "pronunciation": data["pronunciation"],
    }
