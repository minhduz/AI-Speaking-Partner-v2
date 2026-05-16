import asyncio
import logging
import re
import aiohttp
from langgraph.config import get_stream_writer
from db import settings

log = logging.getLogger("llm_tts")

_GEMINI_IN  = 0.10
_GEMINI_OUT = 0.40

# Aggressive splitting so the first TTS segment is short — first audio plays
# fast — while later segments can grow up to a full sentence.
_SENTENCE_RE = re.compile(r"([\s\S]*?[.!?]+(?:\s+|$))")
_TTS_MIN_CHARS = 42
_TTS_MAX_CHARS = 80


def _split_tts_segment(buffer: str, force: bool = False) -> tuple[str | None, str]:
    m = _SENTENCE_RE.match(buffer)
    if m:
        segment = m.group(1)
        return segment.strip(), buffer[len(segment):]

    if len(buffer) >= _TTS_MAX_CHARS:
        window = buffer[:_TTS_MAX_CHARS]
        split_at = -1
        for match in re.finditer(r"[,;:]\s+", window):
            if match.end() >= _TTS_MIN_CHARS:
                split_at = match.end()
        if split_at < 0:
            for match in re.finditer(r"\s+", window):
                if match.end() >= _TTS_MIN_CHARS:
                    split_at = match.end()
        if split_at > 0:
            return buffer[:split_at].strip(), buffer[split_at:]

    if force and buffer.strip():
        return buffer.strip(), ""

    return None, buffer


async def llm_tts_node(state: dict) -> dict:
    """
    Streams the LLM response, splits it into TTS-sized segments, and synthesizes
    each segment in parallel via speech-service /tts (batch MP3). Segments are
    emitted to the FE *in order* via a producer/consumer queue, so each
    `segment` event carries both the spoken text and its complete audio.

    Event shape (single unified type):
        {type: 'segment', text: <str>, audio_b64: <mp3 base64>}
    """
    writer = get_stream_writer()
    full_response = ""

    system = state["system_prompt"]
    summary = state.get("conversation_summary", "")
    if summary:
        system += f"\n\nConversation so far in this session:\n{summary}"
    system += (
        "\n\nLive voice response style: answer naturally in 1-2 short sentences "
        "unless the user explicitly asks for a detailed explanation. Avoid long preambles."
    )

    recent = state.get("recent_messages", [])
    messages_for_llm = recent + [{"role": "user", "content": state["transcript"]}]

    # Producer puts (segment_text, synth_task) tuples onto the queue in order.
    # Consumer awaits each task and emits the segment event when audio is ready.
    seg_queue: asyncio.Queue = asyncio.Queue()

    voice_id    = state.get("voice_id") or "Adrian"
    speech_rate = state.get("speech_rate") or 1.0
    tts_payload_base = {"voice": voice_id, "speech_rate": speech_rate}

    async with aiohttp.ClientSession() as sess:

        async def synthesize(text: str) -> str:
            """POST /tts → returns MP3 base64. Empty string on failure."""
            try:
                async with sess.post(
                    f"{settings.speech_service_url}/tts",
                    json={**tts_payload_base, "text": text},
                ) as r:
                    if r.status != 200:
                        log.warning("[llm_tts] /tts HTTP %s for segment %r", r.status, text[:40])
                        return ""
                    data = await r.json()
                    return data.get("audio_b64", "")
            except Exception as e:
                log.warning("[llm_tts] /tts failed: %s", e)
                return ""

        async def produce() -> None:
            nonlocal full_response
            tts_buffer = ""
            try:
                async with sess.post(
                    f"{settings.llm_gateway_url}/stream",
                    json={"system": system, "messages": messages_for_llm},
                ) as resp:
                    resp.raise_for_status()
                    async for chunk_bytes in resp.content.iter_chunked(256):
                        text = chunk_bytes.decode("utf-8", errors="replace")
                        if not text:
                            continue
                        full_response += text
                        tts_buffer += text

                        while True:
                            segment, tts_buffer = _split_tts_segment(tts_buffer)
                            if not segment:
                                break
                            task = asyncio.create_task(synthesize(segment))
                            await seg_queue.put((segment, task))

                segment, _ = _split_tts_segment(tts_buffer, force=True)
                if segment:
                    task = asyncio.create_task(synthesize(segment))
                    await seg_queue.put((segment, task))
            finally:
                await seg_queue.put(None)

        async def consume() -> None:
            while True:
                item = await seg_queue.get()
                if item is None:
                    return
                segment, task = item
                audio_b64 = await task
                writer({"type": "segment", "text": segment, "audio_b64": audio_b64})

        await asyncio.gather(produce(), consume())

    input_tokens  = len(state["transcript"]) // 4
    output_tokens = len(full_response) // 4
    tokens_used   = input_tokens + output_tokens
    est_cost_usd  = (input_tokens * _GEMINI_IN + output_tokens * _GEMINI_OUT) / 1_000_000
    log.info(
        "[token] turn  user=%s  session=%s  input_tokens=%d  output_tokens=%d  total=%d  est_cost=$%.6f",
        state.get("user_id", "?"), state.get("session_id", "?"),
        input_tokens, output_tokens, tokens_used, est_cost_usd,
    )
    writer({"type": "tokens_counted", "tokens_used": tokens_used, "est_cost_usd": est_cost_usd})

    return {"full_response": full_response, "tokens_used": tokens_used}
