import asyncpg
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    port: int = 8003
    db_host: str = "postgres"
    db_port: int = 5432
    db_user: str = "orchestrator_user"
    db_pass: str = "orchestrator_pass"
    db_name: str = "speaking_app"
    speech_service_url: str = "http://speech-service:8010"
    memory_service_url: str = "http://memory-service:8001"
    llm_gateway_url: str = "http://llm-gateway:8002"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


class Database:
    pool: asyncpg.Pool = None

    async def connect(self):
        dsn = (
            f"postgresql://{settings.db_user}:{settings.db_pass}"
            f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
        )
        self.pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)

    async def disconnect(self):
        if self.pool:
            await self.pool.close()


database = Database()
