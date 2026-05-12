import asyncio
from openai import AsyncOpenAI
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from db import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

VALID_LAYERS = {"short_term", "long_term", "urgent"}

async def embed(text: str) -> list[float]:
    res = await _openai.embeddings.create(model=settings.embedding_model, input=text)
    return res.data[0].embedding

async def fan_out_retrieve(
    user_id: str,
    session_id: str,
    query: str,
    layers: list[str] | None = None,
) -> list[dict]:
    # Determine which layers to query — default to all three
    active = set(layers) & VALID_LAYERS if layers else VALID_LAYERS

    if not active:
        return []

    # Embed only when at least one vector-based layer is requested
    needs_vector = "long_term" in active or "urgent" in active
    query_vector = await embed(query) if needs_vector else []

    # Fire selected layers simultaneously
    coros = []
    labels = []
    if "short_term" in active:
        coros.append(_short_term_as_chunks(session_id))
        labels.append("short_term")
    if "long_term" in active:
        coros.append(LongTermMemory.search(user_id, query_vector, settings.retrieval_limit))
        labels.append("long_term")
    if "urgent" in active:
        coros.append(LongTermMemory.search_urgent(user_id, settings.urgent_limit))
        labels.append("urgent")

    results = await asyncio.gather(*coros)
    layer_results = dict(zip(labels, results))

    # Merge — urgent first, then short-term recency, then long-term semantic
    all_chunks = (
        layer_results.get("urgent", [])
        + layer_results.get("short_term", [])
        + layer_results.get("long_term", [])
    )

    # Deduplicate by text fingerprint
    seen, deduped = set(), []
    for chunk in all_chunks:
        key = chunk["text"][:80]
        if key not in seen:
            seen.add(key)
            deduped.append(chunk)

    return sorted(deduped, key=lambda x: x["score"], reverse=True)

async def _short_term_as_chunks(session_id: str) -> list[dict]:
    if not session_id:
        return []
    messages = await ShortTermMemory.get_recent(session_id, n=10)
    return [{"text": m["content"], "score": 0.85, "source": "short_term"} for m in messages]
