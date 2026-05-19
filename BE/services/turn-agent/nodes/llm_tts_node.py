import asyncio
import json
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

# Sentinel marking the start of the deck-eval JSON block emitted by the LLM at the
# end of its response when a deck is active. Held back from TTS so the user never
# hears "EVAL passed true ...".
_EVAL_MARKER = "EVAL:"

# Sentinel the LLM emits after its farewell when it decides the session should end.
# Stripped from TTS and converted to a session_ended SSE event.
_SESSION_END_MARKER = "SESSION_END"


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
    eval_buffer = ""
    eval_started = False

    system = state["system_prompt"]
    summary = state.get("conversation_summary", "")
    if summary:
        system += f"\n\nConversation so far in this session:\n{summary}"
    system += (
        "\n\nLive voice response style: answer naturally in 1-2 short sentences "
        "unless the user explicitly asks for a detailed explanation. Avoid long preambles."
    )

    # Strip Redis-specific metadata — LLM gateway only accepts {role, content}
    recent = [
        {"role": m["role"], "content": m["content"]}
        for m in state.get("recent_messages", [])
        if m.get("role") and m.get("content")
    ]
    # Empty transcript means an internal UI-driven turn (e.g. user clicked
    # "Let's go", Next card, or deck completed). Some LLM providers return an
    # empty stream for an empty user message, so send a harmless synthetic
    # instruction to let the system prompt drive the response. Keep
    # state['transcript'] unchanged so card intro/eval logic still sees it empty.
    llm_user_content = state["transcript"].strip() or "Continue."
    messages_for_llm = recent + [{"role": "user", "content": llm_user_content}]

    # Producer puts (segment_text, synth_task) tuples onto the queue in order.
    # Consumer awaits each task and emits the segment event when audio is ready.
    seg_queue: asyncio.Queue = asyncio.Queue()

    voice_id    = state.get("voice_id") or "Adrian"
    speech_rate = state.get("speech_rate") or 1.0
    tts_payload_base = {"voice": voice_id, "speech_rate": speech_rate}

    session_end_seen = False

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
            """
            Streams the LLM response into two destinations:
              - tts_buffer: spoken text that gets segmented + synthesized.
              - eval_buffer: everything from the EVAL: marker onward, held back
                from TTS and parsed after the stream completes.

            Boundary safety: the marker "EVAL:" can land split across chunks
            (e.g. "EV" + "AL:"). To avoid flushing a partial prefix into TTS,
            we keep the last (len(marker) - 1) chars of tts_buffer pinned in a
            holdback whenever no marker has been seen yet.
            """
            nonlocal full_response, eval_buffer, eval_started, session_end_seen
            tts_buffer = ""
            # Retain enough chars to catch either marker split across chunks.
            holdback = max(len(_EVAL_MARKER), len(_SESSION_END_MARKER)) - 1
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

                        if eval_started:
                            # Stream is past the marker — everything goes to the eval buffer.
                            eval_buffer += text
                            continue

                        tts_buffer += text

                        # SESSION_END is a control marker, not spoken content. It can
                        # appear before or after EVAL; strip it before any TTS split.
                        session_idx = tts_buffer.find(_SESSION_END_MARKER)
                        if session_idx >= 0:
                            session_end_seen = True
                            tts_buffer = (
                                tts_buffer[:session_idx].rstrip()
                                + " "
                                + tts_buffer[session_idx + len(_SESSION_END_MARKER):].lstrip()
                            ).strip()

                        marker_idx = tts_buffer.find(_EVAL_MARKER)
                        if marker_idx >= 0:
                            # Split at the marker: prefix → TTS (flush all), rest → eval.
                            eval_buffer = tts_buffer[marker_idx + len(_EVAL_MARKER):]
                            tts_buffer = tts_buffer[:marker_idx].rstrip()
                            eval_started = True

                            # Flush remaining TTS-eligible text now that the boundary is known.
                            while True:
                                segment, tts_buffer = _split_tts_segment(tts_buffer)
                                if not segment:
                                    break
                                task = asyncio.create_task(synthesize(segment))
                                await seg_queue.put((segment, task))
                            segment, tts_buffer = _split_tts_segment(tts_buffer, force=True)
                            if segment:
                                task = asyncio.create_task(synthesize(segment))
                                await seg_queue.put((segment, task))
                            continue

                        # No marker yet — only segment from the safe portion, keeping a
                        # holdback at the tail in case the marker spans the next chunk.
                        if len(tts_buffer) > holdback:
                            safe = tts_buffer[:-holdback] if holdback else tts_buffer
                            pinned = tts_buffer[-holdback:] if holdback else ""
                            while True:
                                segment, safe = _split_tts_segment(safe)
                                if not segment:
                                    break
                                task = asyncio.create_task(synthesize(segment))
                                await seg_queue.put((segment, task))
                            tts_buffer = safe + pinned

                # Stream ended. Flush whatever is left in tts_buffer (no marker found,
                # or the pinned holdback after the marker was already handled).
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

        # Diagnostic for the "AI sometimes cuts off mid-sentence" report.
        # ends_clean false on the spoken portion (slice before EVAL:) means the
        # LLM truncated or the holdback/flush dropped tail bytes — either way,
        # this tells us where to look on the next reproduction.
        marker_pos = full_response.find(_EVAL_MARKER)
        spoken_portion = full_response if marker_pos < 0 else full_response[:marker_pos]
        spoken_clean = spoken_portion.rstrip()
        spoken_ends_clean = spoken_clean.endswith((".", "!", "?", '"', "'", "”", "’"))
        tail_repr = full_response[-80:].replace("\n", "\\n")
        log.info(
            "[llm_tts] stream end  full_len=%d  spoken_len=%d  eval_started=%s  session_end_seen=%s  spoken_ends_clean=%s  tail=%r",
            len(full_response), len(spoken_portion), eval_started, session_end_seen, spoken_ends_clean, tail_repr,
        )

        if session_end_seen:
            writer({"type": "session_ended"})
            log.info("[llm_tts] session_ended signal emitted  session=%s", state.get("session_id"))

        # ── Phase 5 — Deck evaluation handling ────────────────────────────
        # When a deck is active, the LLM appends `EVAL:{...json...}` at the very end
        # of its response. produce() already split that block off from TTS so the
        # user never hears it. Now: parse it, push an `eval` SSE event for instant
        # FE button updates, and PUT the merged card_update to memory-service so the
        # poll-based reconciliation (and Phase 6 consolidation) sees the result too.
        if eval_started and state.get("deck_active") and state.get("session_id"):
            parsed_eval = _parse_eval_block(eval_buffer)
            if parsed_eval is not None:
                card_index = int(state.get("card_index", 0))
                prior_attempts = int(state.get("card_attempts", 0))
                passed = bool(parsed_eval.get("passed"))

                # Phase 7 — `confusion` retries don't count as attempts. The
                # user asked for clarification, not failed the task. Without
                # this, "what does that mean?" would burn 1 of 3 attempts and
                # auto-advance prematurely.
                detected = parsed_eval.get("detectedIssues") or []
                detected_lower = [str(d).lower() for d in detected]
                is_confusion_retry = (
                    not passed and "confusion" in detected_lower
                )
                attempts = prior_attempts if is_confusion_retry else prior_attempts + 1

                if passed:
                    result = "passed"
                elif attempts >= 3:
                    result = "partial"
                else:
                    result = "not_passed"

                card_update = {
                    "status": "completed" if passed else "in_progress",
                    "attempts": attempts,
                    "result": result,
                    "feedback": parsed_eval.get("feedback", ""),
                    "next_action": parsed_eval.get("nextAction", "next_card"),
                }

                writer({
                    "type": "eval",
                    "data": parsed_eval,
                    "card_index": card_index,
                })

                log.info(
                    "[llm_tts] eval parsed  session=%s  card=%d  passed=%s  nextAction=%s  attempts=%d",
                    state.get("session_id"), card_index, passed,
                    parsed_eval.get("nextAction"), attempts,
                )

                try:
                    async with sess.put(
                        f"{settings.memory_service_url}/exercise-deck/{state['session_id']}/card",
                        json=card_update,
                    ) as r:
                        if r.status != 200:
                            log.warning(
                                "[llm_tts] card update HTTP %s  session=%s",
                                r.status, state.get("session_id"),
                            )
                        else:
                            log.info(
                                "[llm_tts] card updated via memory-service  session=%s  idx=%d",
                                state.get("session_id"), card_index,
                            )
                except Exception as e:
                    log.warning("[llm_tts] memory-service card update failed: %s", e)
            else:
                log.warning(
                    "[llm_tts] EVAL block present but failed to parse  session=%s  raw=%r",
                    state.get("session_id"), eval_buffer[:200],
                )

    input_tokens  = len(state["transcript"]) // 4
    # Count only the spoken portion against the user's quota — the EVAL block is
    # a system artifact, not user-facing content.
    output_tokens = len(full_response) // 4
    tokens_used   = input_tokens + output_tokens
    est_cost_usd  = (input_tokens * _GEMINI_IN + output_tokens * _GEMINI_OUT) / 1_000_000
    log.info(
        "[token] turn  user=%s  session=%s  input_tokens=%d  output_tokens=%d  total=%d  est_cost=$%.6f",
        state.get("user_id", "?"), state.get("session_id", "?"),
        input_tokens, output_tokens, tokens_used, est_cost_usd,
    )
    writer({"type": "tokens_counted", "tokens_used": tokens_used, "est_cost_usd": est_cost_usd})

    # Strip the EVAL block from full_response before returning so downstream nodes
    # (e.g. session-history persistence) don't store it in conversation logs.
    spoken_response = full_response
    marker_idx = spoken_response.find(_EVAL_MARKER)
    if marker_idx >= 0:
        spoken_response = spoken_response[:marker_idx].rstrip()

    # Strip SESSION_END from persisted text. The SSE event is emitted during
    # stream processing before TTS segmentation so the marker is never spoken.
    if _SESSION_END_MARKER in spoken_response:
        spoken_response = spoken_response.replace(_SESSION_END_MARKER, "").rstrip()

    return {"full_response": spoken_response, "tokens_used": tokens_used}


def _parse_eval_block(raw: str) -> dict | None:
    """
    Parse the JSON object the LLM emits after `EVAL:`. The LLM can be sloppy —
    extra whitespace, trailing prose, or a stray ```json fence — so we extract
    the first balanced {...} from the buffer and ignore anything else.
    """
    if not raw:
        return None
    text = raw.strip()
    # Strip a leading code fence if the model emitted one.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    end = -1
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        return None
    try:
        parsed = json.loads(text[start:end])
    except Exception:
        return None
    if not isinstance(parsed, dict) or "passed" not in parsed:
        return None
    return parsed
