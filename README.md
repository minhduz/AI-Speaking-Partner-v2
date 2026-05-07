# SpeakUp — AI English Speaking Partner

A full-stack app for AI-powered English conversation practice.

- **FE** — Next.js (App Router)
- **BE** — NestJS microservices + FastAPI Python services
- **Infra** — PostgreSQL (pgvector), Redis, Docker Compose

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with Compose v2)
- Node.js 20+ and npm (for FE local dev)
- API keys: **Gemini** (primary LLM), **OpenAI** (STT/TTS/embeddings)

---

## 1. Configure environment files

Each service reads its own `.env` file. Fill in your real keys before starting Docker.

### `BE/apps/orchestrator/.env`
```env
PORT=3000
NODE_ENV=development

DB_HOST=postgres
DB_PORT=5432
DB_USER=orchestrator_user
DB_PASS=orchestrator_pass
DB_NAME=speaking_app
DB_SCHEMA=speaking_app

JWT_SECRET=change_this_in_production_min_32_chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

BILLING_SERVICE_URL=http://billing-service:3001
MEMORY_SERVICE_URL=http://memory-service:8001
LLM_GATEWAY_URL=http://llm-gateway:8002
SPEECH_SERVICE_URL=http://speech-service:8010
```

### `BE/apps/billing-service/.env`
```env
PORT=3001
NODE_ENV=development

DB_HOST=postgres
DB_PORT=5432
DB_USER=billing_user
DB_PASS=billing_pass
DB_NAME=speaking_app
DB_SCHEMA=billing

SEPAY_API_KEY=your_sepay_api_key
SEPAY_WEBHOOK_SECRET=your_sepay_webhook_secret
SEPAY_BANK_NAME=VietcomBank
SEPAY_ACCOUNT_NUMBER=1234567890
SEPAY_ACCOUNT_NAME=CONG TY ABC
PAYMENT_EXPIRY_MINUTES=15
```

### `BE/apps/llm-gateway/.env`
```env
PORT=8002
NODE_ENV=development

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o

MAX_TOKENS=1024
RETRY_ATTEMPTS=3
```

### `BE/services/memory-service/.env`
```env
PORT=8001

DB_HOST=postgres
DB_PORT=5432
DB_USER=memory_user
DB_PASS=memory_pass
DB_NAME=speaking_app

REDIS_URL=redis://redis:6379/0

OPENAI_API_KEY=your_openai_api_key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536

SHORT_TERM_TTL_SECONDS=7200
RETRIEVAL_LIMIT=10
```

### `BE/services/speech-service/.env`
```env
PORT=8010
OPENAI_API_KEY=your_openai_api_key
TTS_VOICE=alloy
TTS_MODEL=tts-1
STT_MODEL=whisper-1
STT_LANGUAGE=en
```

---

## 2. Start the backend with Docker Compose

Run this from the **project root** (where `docker-compose.yml` lives):

```bash
docker compose up --build
```

This starts:

| Container | Port | Description |
|---|---|---|
| `speaking_postgres` | 5432 | PostgreSQL + pgvector |
| `speaking_redis` | 6379 | Redis (short-term memory) |
| `speaking_orchestrator` | 3000 | Main API gateway (NestJS) |
| `speaking_billing` | 3001 | Billing & subscriptions |
| `speaking_llm_gateway` | 8002 | LLM router (Gemini / OpenAI) |
| `speaking_memory` | 8001 | Memory service (FastAPI) |
| `speaking_speech` | 8010 | STT / TTS service (FastAPI) |

Wait until you see all services print a ready/listening message before moving to the FE step.

To run in the background:
```bash
docker compose up --build -d
```

To stop:
```bash
docker compose down
```

To stop and wipe the database volumes:
```bash
docker compose down -v
```

---

## 3. Start the frontend

### Configure FE environment

Create `FE/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
BACKEND_URL=http://localhost:3000
```

### Install dependencies and run

```bash
cd FE
npm install
npm run dev
```

The app will be available at **http://localhost:3002**.

---

## Service ports at a glance

| Service | URL |
|---|---|
| Frontend | http://localhost:3002 |
| Orchestrator API | http://localhost:3000 |
| Billing service | http://localhost:3001 |
| LLM gateway | http://localhost:8002 |
| Memory service | http://localhost:8001 |
| Speech service | http://localhost:8010 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Health checks

```bash
curl http://localhost:3000/health       # orchestrator
curl http://localhost:8001/health       # memory-service
curl http://localhost:8010/health       # speech-service
```
