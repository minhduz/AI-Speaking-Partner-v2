import re
import asyncio
import aiohttp
from langgraph.config import get_stream_writer
from db import settings

SENTENCE_BOUNDARY = re.compile(r"^([\s\S]*?[.!?]+\s)")


async def llm_tts_node(state: dict) -> dict:
    writer = get_stream_writer()
    full_response = ""
    sentence_buffer = ""
    tts_futures: list[tuple[str, asyncio.Future]] = []

    async def fire_tts(text: str) -> asyncio.Future:
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()

        async def _do():
            try:
                async with aiohttp.ClientSession() as s:
                    async with s.post(
                        f"{settings.speech_service_url}/tts", json={"text": text}
                    ) as r:
                        r.raise_for_status()
                        fut.set_result(await r.json())
            except Exception as e:
                print(f"[llm_tts] TTS failed for '{text[:40]}': {e}")
                fut.set_result(None)

        asyncio.create_task(_do())
        return fut

    async with aiohttp.ClientSession() as sess:
        async with sess.post(
            f"{settings.llm_gateway_url}/stream",
            json={
                "system": state["system_prompt"],
                "messages": [{"role": "user", "content": state["transcript"]}],
            },
        ) as resp:
            resp.raise_for_status()
            async for chunk_bytes in resp.content.iter_chunked(256):
                text = chunk_bytes.decode("utf-8", errors="replace")
                if not text:
                    continue
                full_response += text
                sentence_buffer += text
                writer({"type": "text", "chunk": text})

                while True:
                    m = SENTENCE_BOUNDARY.match(sentence_buffer)
                    if not m:
                        break
                    sentence = m.group(1)
                    sentence_buffer = sentence_buffer[len(sentence):]
                    clean = sentence.strip()
                    if clean:
                        tts_futures.append((clean, await fire_tts(clean)))

    # Handle trailing text (no terminal punctuation)
    if (rem := sentence_buffer.strip()):
        tts_futures.append((rem, await fire_tts(rem)))

    # Deliver TTS audio in sentence order
    for (text, fut) in tts_futures:
        result = await fut
        if result:
            writer({"type": "audio", "audio_b64": result["audio_b64"], "text": text})

    tokens_used = (len(state["transcript"]) + len(full_response)) // 4
    # Emit internal event so main.py can include it in the final done event
    writer({"type": "tokens_counted", "tokens_used": tokens_used})

    return {"full_response": full_response, "tokens_used": tokens_used}
