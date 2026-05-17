import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from db import database, redis_client
from routers.retrieve import router as retrieve_router
from routers.prompt_builder import router as prompt_router
from routers.memory_ops import router as ops_router
from routers.exercise_deck_ops import router as deck_router
from workers.consolidation import run_consolidation

log = logging.getLogger("main")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)

_ORPHAN_SWEEP_INTERVAL = 1800  # 30 minutes


async def _orphan_sweep():
    """Consolidate sessions that ended without an explicit /session/end call."""
    while True:
        await asyncio.sleep(_ORPHAN_SWEEP_INTERVAL)
        try:
            rows = await database.fetch(
                """SELECT DISTINCT user_id, session_id
                   FROM memory.consolidation_jobs
                   WHERE status = 'processing'
                     AND created_at < NOW() - INTERVAL '30 minutes'"""
            )
            if rows:
                log.info("[orphan_sweep] found %d stalled jobs — re-queuing", len(rows))
            for row in rows:
                asyncio.create_task(run_consolidation(row["user_id"], row["session_id"]))
        except Exception as exc:
            log.warning("[orphan_sweep] failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    await redis_client.connect()
    asyncio.create_task(_orphan_sweep())
    yield
    await database.disconnect()
    await redis_client.disconnect()

app = FastAPI(title="Memory Service", lifespan=lifespan)

app.include_router(retrieve_router,  prefix="/retrieve")
app.include_router(prompt_router,    prefix="/build-prompt")
app.include_router(ops_router)       # /consolidate, /short-term, /facts
app.include_router(deck_router)      # /exercise-deck

@app.get("/health")
async def health():
    return {"status": "ok", "service": "memory"}
