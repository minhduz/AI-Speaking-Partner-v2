import asyncio
import hashlib
import logging
from openai import AsyncOpenAI
from layers.short_term import ShortTermMemory
from layers.long_term import LongTermMemory
from db import settings, database

log = logging.getLogger("retriever")
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

VALID_LAYERS = {"short_term", "long_term", "urgent"}

_PRIORITY_SCORE = {"urgent": 0.95, "high": 0.85, "normal": 0.75}
_MIN_LONG_TERM_SCORE = 0.45

# In-memory embedding cache keyed by "session_id:md5(text)".
# Avoids a round-trip to the embeddings API on repeated/similar queries within a session.
# Capped at 500 entries with simple FIFO eviction.
_embed_cache: dict[str, list[float]] = {}
_EMBED_CACHE_MAX = 500


async def embed(text: str, session_id: str = "") -> list[float]:
    key = f"{session_id}:{hashlib.md5(text.encode()).hexdigest()}"
    if key in _embed_cache:
        log.debug("embed cache hit  session=%s  key=%s", session_id, key[:24])
        return _embed_cache[key]
    res = await _openai.embeddings.create(model=settings.embedding_model, input=text)
    vec = res.data[0].embedding
    if len(_embed_cache) >= _EMBED_CACHE_MAX:
        del _embed_cache[next(iter(_embed_cache))]
    _embed_cache[key] = vec
    return vec


async def fan_out_retrieve(
    user_id: str,
    session_id: str,
    query: str,
    layers: list[str] | None = None,
) -> list[dict]:
    active = set(layers) & VALID_LAYERS if layers else VALID_LAYERS

    log.info("retrieve  user=%s  session=%s  active_layers=%s  query='%s'",
             user_id, session_id, sorted(active), query[:80])

    if not active:
        return []

    coros = []
    labels = []
    if "short_term" in active:
        coros.append(_short_term_as_chunks(user_id))  # user-scoped rolling buffer
        labels.append("short_term")
    if "long_term" in active or "urgent" in active:
        coros.append(_context_as_chunks(user_id, query, active, session_id))
        labels.append("context")

    results = await asyncio.gather(*coros)
    layer_results = dict(zip(labels, results))

    st_chunks      = layer_results.get("short_term", [])
    context_chunks = layer_results.get("context", [])
    urgent_chunks  = [c for c in context_chunks if c["source"] == "urgent"]
    lt_chunks      = [c for c in context_chunks if c["source"] == "long_term"]

    log.info("retrieve  short_term=%d  urgent=%d  long_term=%d",
             len(st_chunks), len(urgent_chunks), len(lt_chunks))
    for i, c in enumerate(context_chunks):
        log.info("  [lt/urgent %d] score=%.3f source=%s  '%s'",
                 i, c["score"], c["source"], c["text"][:80])

    all_chunks = urgent_chunks + st_chunks + lt_chunks

    seen, deduped = set(), []
    for chunk in all_chunks:
        key = chunk["text"][:80]
        if key not in seen:
            seen.add(key)
            deduped.append(chunk)

    final = sorted(deduped, key=lambda x: x["score"], reverse=True)
    log.info("retrieve  → %d deduped chunks returned", len(final))
    return final


async def _context_as_chunks(user_id: str, query: str, active_layers: set, session_id: str = "") -> list[dict]:
    """
    Vector similarity search over per-fact rows.
    Falls back to returning all active facts if the table has no embeddings yet
    (e.g. legacy user_context rows that haven't been reconsolidated).
    """
    query_vec = await embed(query, session_id=session_id)
    vec_literal = f"[{','.join(str(v) for v in query_vec)}]"

    rows = await database.fetch(
        """SELECT content, priority, expires_at, score AS memory_score,
                  1 - (embedding <=> $2::vector) AS similarity
           FROM memory.memory_facts
           WHERE user_id = $1
             AND (expires_at IS NULL OR expires_at > NOW())
             AND source = 'fact'
           ORDER BY embedding <=> $2::vector
           LIMIT 15""",
        user_id,
        vec_literal,
    )

    chunks = []
    for row in rows:
        priority = row["priority"] or "normal"
        if priority == "urgent" and "urgent" not in active_layers:
            continue
        if priority != "urgent" and "long_term" not in active_layers:
            continue
        source = "urgent" if priority == "urgent" else "long_term"
        # Blend vector similarity with priority weight so urgent facts always surface
        base_score  = float(row["similarity"]) if row["similarity"] is not None else 0.5
        memory_score = float(row["memory_score"]) if row["memory_score"] is not None else _PRIORITY_SCORE.get(priority, 0.75)
        score       = 0.75 * base_score + 0.25 * memory_score
        if source == "long_term" and score < _MIN_LONG_TERM_SCORE:
            continue
        chunks.append({"text": row["content"], "score": score, "source": source})

    # If no per-fact rows exist yet (legacy data), fall back to get_facts().
    # Do not fallback just because relevance filtering removed all chunks.
    if not rows:
        facts = await LongTermMemory.get_facts(user_id)
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


_ST_FACT_SCORE = {"urgent": 0.92, "high": 0.88}
_MAX_ST_FACTS = 10  # guard against large cross-session fact bleed


async def _short_term_as_chunks(user_id: str) -> list[dict]:
    """Return consolidated short-term facts only — raw rolling buffer excluded from retrieval."""
    if not user_id:
        return []
    st_facts = await ShortTermMemory.get_st_facts(user_id)
    if len(st_facts) > _MAX_ST_FACTS:
        log.warning("[short_term] user=%s  %d st_facts exceeds cap %d — truncating to most recent",
                    user_id, len(st_facts), _MAX_ST_FACTS)
        st_facts = st_facts[-_MAX_ST_FACTS:]
    log.info("[short_term] loaded %d consolidated st_facts for user=%s", len(st_facts), user_id)
    return [
        {
            "text":   f["content"],
            "score":  _ST_FACT_SCORE.get(f.get("priority", "urgent"), 0.88),
            "source": "short_term",
        }
        for f in st_facts
    ]
