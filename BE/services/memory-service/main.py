from contextlib import asynccontextmanager
from fastapi import FastAPI
from db import database, redis_client
from routers.retrieve import router as retrieve_router
from routers.prompt_builder import router as prompt_router
from routers.memory_ops import router as ops_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    await redis_client.connect()
    yield
    await database.disconnect()
    await redis_client.disconnect()

app = FastAPI(title="Memory Service", lifespan=lifespan)

app.include_router(retrieve_router,  prefix="/retrieve")
app.include_router(prompt_router,    prefix="/build-prompt")
app.include_router(ops_router)       # /consolidate, /short-term, /facts

@app.get("/health")
async def health():
    return {"status": "ok", "service": "memory"}
