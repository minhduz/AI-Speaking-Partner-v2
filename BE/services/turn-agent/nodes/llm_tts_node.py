import asyncio
import logging
import re
import aiohttp
from langgraph.config import get_stream_writer
from db import settings

log = logging.getLogger("llm_tts")

# Pricing (USD per 1M tokens) — Gemini 2.0 Flash (primary gateway provider)
_GEMINI_IN  = 0.10
_GEMINI_OUT = 0.40

# Prefer punctuation boundaries, but split long first sentences at a safe word
# boundary so realtime TTS can start before the full LLM sentence is complete.
_SENTENCE_RE = re.compile(r"([\s\S]*?[.!?]+(?:\s+|$))")
_TTS_MIN_CHARS = 42
_TTS_MAX_CHARS = 80


def _tts_ws_url() -> str:
    base = settings.speech_service_url.rstrip("/")
    if base.startswith("https://"):
        return f"wss://{base[len('https://'):]}/tts/ws"
    if base.startswith("http://"):
        return f"ws://{base[len('http://'):]}/tts/ws"
    return f"ws://{base}/tts/ws"


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

    async with aiohttp.ClientSession() as sess:
        async with sess.ws_connect(_tts_ws_url(), heartbeat=20) as tts_ws:

            async def send_tts_text(text: str = "", end: bool = False) -> None:
                if tts_ws.closed:
                    return
                try:
                    await tts_ws.send_json({"text": text, "end": end})
                except Exception as e:
                    log.warning("[llm_tts] TTS websocket send failed: %s", e)

            async def produce():
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
                            writer({"type": "text", "chunk": text})

                            while True:
                                segment, tts_buffer = _split_tts_segment(tts_buffer)
                                if not segment:
                                    break
                                await send_tts_text(segment)

                    segment, _ = _split_tts_segment(tts_buffer, force=True)
                    if segment:
                        await send_tts_text(segment)
                finally:
                    await send_tts_text(end=True)

            async def consume():
                audio_end_sent = False

                def emit_audio_end() -> None:
                    nonlocal audio_end_sent
                    if audio_end_sent:
                        return
                    writer({"type": "audio_end"})
                    audio_end_sent = True

                async for msg in tts_ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = msg.json()
                        if data.get("audio_b64"):
                            writer({
                                "type": "audio_chunk",
                                "audio_b64": data["audio_b64"],
                                "sample_rate": data.get("sample_rate", 24000),
                            })
                        if data.get("done"):
                            emit_audio_end()
                            return
                        if data.get("error"):
                            log.error("[llm_tts] TTS websocket error: %s", data["error"])
                            emit_audio_end()
                            return
                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        log.warning("[llm_tts] TTS websocket closed early: %s", tts_ws.exception())
                        emit_audio_end()
                        return
                emit_audio_end()

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
