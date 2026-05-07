import asyncpg
import redis.asyncio as aioredis
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    port: int = 8001
    db_host: str = "postgres"
    db_port: int = 5432
    db_user: str = "memory_user"
    db_pass: str = "memory_pass"
    db_name: str = "speaking_app"
    redis_url: str = "redis://redis:6379/0"
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    short_term_ttl_seconds: int = 7200
    retrieval_limit: int = 10
    urgent_limit: int = 5
    decay_lambda: float = 0.1
    score_prune_threshold: float = 0.1

    class Config:
        env_file = ".env"

settings = Settings()

class Database:
    pool: asyncpg.Pool = None

    async def connect(self):
        dsn = f"postgresql://{settings.db_user}:{settings.db_pass}@{settings.db_host}:{settings.db_port}/{settings.db_name}"
        self.pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def fetch(self, q, *args):
        async with self.pool.acquire() as c: return await c.fetch(q, *args)

    async def fetchrow(self, q, *args):
        async with self.pool.acquire() as c: return await c.fetchrow(q, *args)

    async def execute(self, q, *args):
        async with self.pool.acquire() as c: return await c.execute(q, *args)

class RedisClient:
    client: aioredis.Redis = None

    async def connect(self):
        self.client = aioredis.from_url(settings.redis_url, decode_responses=True)

    async def disconnect(self):
        if self.client: await self.client.aclose()

database = Database()
redis_client = RedisClient()
