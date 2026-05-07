import asyncio
from openai import AsyncOpenAI
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from db import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

async def embed(text: str) -> list[float]:
    res = await _openai.embeddings.create(model=settings.embedding_model, input=text)
    return res.data[0].embedding

async def fan_out_retrieve(user_id: str, session_id: str, query: str) -> list[dict]:
    # 1. Embed ONCE — reused across all three layers
    query_vector = await embed(query)

    # 2. Fire all three SIMULTANEOUSLY
    short_results, long_results, urgent_results = await asyncio.gather(
        _short_term_as_chunks(session_id),
        LongTermMemory.search(user_id, query_vector, settings.retrieval_limit),
        LongTermMemory.search_urgent(user_id, settings.urgent_limit),
    )

    # 3. Merge — urgent first, then short-term recency, then long-term semantic
    all_chunks = urgent_results + short_results + long_results

    # 4. Deduplicate by text fingerprint
    seen, deduped = set(), []
    for chunk in all_chunks:
        key = chunk["text"][:80]
        if key not in seen:
            seen.add(key)
            deduped.append(chunk)

    # 5. Sort by score descending
    return sorted(deduped, key=lambda x: x["score"], reverse=True)

async def _short_term_as_chunks(session_id: str) -> list[dict]:
    if not session_id:
        return []
    messages = await ShortTermMemory.get_recent(session_id, n=10)
    return [{"text": m["content"], "score": 0.85, "source": "short_term"} for m in messages]
