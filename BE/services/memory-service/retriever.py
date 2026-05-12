import asyncio
from openai import AsyncOpenAI
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from db import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

VALID_LAYERS = {"short_term", "long_term", "urgent"}

# Priority score used for ordering chunks returned to the prompt builder
_PRIORITY_SCORE = {"urgent": 0.95, "high": 0.85, "normal": 0.75}


async def embed(text: str) -> list[float]:
    res = await _openai.embeddings.create(model=settings.embedding_model, input=text)
    return res.data[0].embedding


async def fan_out_retrieve(
    user_id: str,
    session_id: str,
    query: str,
    layers: list[str] | None = None,
) -> list[dict]:
    active = set(layers) & VALID_LAYERS if layers else VALID_LAYERS

    if not active:
        return []

    coros = []
    labels = []
    if "short_term" in active:
        coros.append(_short_term_as_chunks(session_id))
        labels.append("short_term")
    if "long_term" in active or "urgent" in active:
        # One DB call covers both long_term and urgent (they live in the same JSON document)
        coros.append(_context_as_chunks(user_id, active))
        labels.append("context")

    results = await asyncio.gather(*coros)
    layer_results = dict(zip(labels, results))

    # Merge: urgent facts first, then short-term recency, then the rest
    context_chunks = layer_results.get("context", [])
    urgent_chunks  = [c for c in context_chunks if c["source"] == "urgent"]
    lt_chunks      = [c for c in context_chunks if c["source"] == "long_term"]

    all_chunks = urgent_chunks + layer_results.get("short_term", []) + lt_chunks

    # Deduplicate by text fingerprint
    seen, deduped = set(), []
    for chunk in all_chunks:
        key = chunk["text"][:80]
        if key not in seen:
            seen.add(key)
            deduped.append(chunk)

    return sorted(deduped, key=lambda x: x["score"], reverse=True)


async def _context_as_chunks(user_id: str, active_layers: set) -> list[dict]:
    """Fetch the user's single context document and split into chunks by priority."""
    facts = await LongTermMemory.get_context(user_id)
    chunks = []
    for fact in facts:
        priority = fact.get("priority", "normal")
        if priority == "urgent" and "urgent" not in active_layers:
            continue
        if priority != "urgent" and "long_term" not in active_layers:
            continue
        source = "urgent" if priority == "urgent" else "long_term"
        score = _PRIORITY_SCORE.get(priority, 0.75)
        chunks.append({"text": fact["content"], "score": score, "source": source})
    return chunks


async def _short_term_as_chunks(session_id: str) -> list[dict]:
    if not session_id:
        return []
    messages = await ShortTermMemory.get_recent(session_id, n=10)
    return [{"text": m["content"], "score": 0.85, "source": "short_term"} for m in messages]
