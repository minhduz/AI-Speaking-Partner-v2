# Speaking App — Backend

A microservices backend for an AI-powered English speaking practice application. Users speak into the app; the system transcribes audio, runs pronunciation scoring, retrieves personalized memory context, generates an AI response via an LLM, and returns synthesized speech — all streamed in real time.

---

## Architecture

| Service | Stack | Port | Responsibility |
|---|---|---|---|
| **orchestrator** | NestJS | 3000 | Auth, sessions, turns, history, billing proxy |
| **billing-service** | NestJS | 3001 | Plans, subscriptions, SePay payments, usage |
| **llm-gateway** | NestJS | 8002 | Claude / GPT-4o completions with fallback |
| **memory-service** | FastAPI (Python) | 8001 | Short-term (Redis) + long-term (pgvector) memory |
| **speech-service** | FastAPI (Python) | 8010 | Whisper STT, OpenAI TTS, pronunciation scoring |
| **postgres** | pgvector/pg15 | 5432 | Shared database (3 schemas) |
| **redis** | Redis 7 | 6379 | Short-term memory cache |

All services communicate over an internal Docker network (`speaking_net`). Only the ports listed above are exposed to the host.

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Docker | 24+ |
| Docker Compose | v2 (`docker compose`) |
| Node.js | 20+ (local dev only) |
| Python | 3.11+ (local dev only) |

---

## Quick Start (Docker — recommended)

### 1. Clone and enter the project

```bash
git clone <repo-url>
cd BE
```

### 2. Fill in the required secrets

Each service has its own `.env` file already present in the repo with placeholder values. Edit the three files below before starting:

**`apps/llm-gateway/.env`**
```env
ANTHROPIC_API_KEY=sk-ant-...      # Claude API key (primary LLM)
OPENAI_API_KEY=sk-...             # OpenAI key (LLM fallback + embeddings + speech)
```

**`apps/billing-service/.env`**
```env
SEPAY_API_KEY=your_sepay_api_key
SEPAY_WEBHOOK_SECRET=your_sepay_webhook_secret
SEPAY_BANK_NAME=VietcomBank
SEPAY_ACCOUNT_NUMBER=1234567890
SEPAY_ACCOUNT_NAME=CONG TY ABC
```

**`services/memory-service/.env`**
```env
OPENAI_API_KEY=sk-...             # Used for text-embedding-3-small
```

**`services/speech-service/.env`**
```env
OPENAI_API_KEY=sk-...             # Used for Whisper STT and TTS
```

> The database credentials and internal service URLs are pre-configured to work inside Docker and do not need to change.

### 3. Start everything

```bash
docker compose up --build
```

This will:
- Start PostgreSQL and Redis with health checks
- Run `init.sql` to create schemas, tables, indexes, and seed billing plans
- Build and start all five application services

### 4. Verify all services are healthy

```bash
curl http://localhost:3000/auth/login        # orchestrator
curl http://localhost:3001/plans             # billing-service
curl http://localhost:8002/health            # llm-gateway
curl http://localhost:8001/health            # memory-service
curl http://localhost:8010/health            # speech-service
```

---

## API Overview

All requests to user-protected endpoints require a Bearer token obtained from `/auth/login`.

### Authentication — `POST /auth/*` (orchestrator :3000)

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, name, timezone? }` | Create account |
| POST | `/auth/login` | `{ email, password }` | Get `access_token` + `refresh_token` |
| POST | `/auth/refresh` | `{ refresh_token }` | Rotate tokens |
| POST | `/auth/logout` | — | Invalidate session |

### Sessions — `Bearer required`

| Method | Path | Description |
|---|---|---|
| POST | `/session` | Start a new speaking session |
| GET | `/session` | List all sessions for current user |
| GET | `/session/:id` | Get session details |
| PATCH | `/session/:id` | Update session (title, archive) |
| DELETE | `/session/:id` | Delete session |

### Turns — `Bearer required`

| Method | Path | Body / Params | Description |
|---|---|---|---|
| POST | `/turn/:session_id` | `multipart/form-data: audio` | Full turn (STT → memory → LLM → TTS) |
| GET | `/turn/:session_id/stream?audio=<base64>` | — | SSE streaming variant (returns `transcript`, `pronunciation`, `text` chunks, `audio`, `done` events) |

### History & Progress — `Bearer required`

| Method | Path | Description |
|---|---|---|
| GET | `/history` | Paginated turn history |
| GET | `/progress` | Pronunciation scores and session stats |

### Billing (proxied through orchestrator)

| Method | Path | Description |
|---|---|---|
| GET | `/billing/plans` | List available plans |
| GET | `/billing/subscription` | Current user subscription |
| POST | `/billing/payment` | Create a SePay payment order |
| POST | `/billing/webhook` | SePay payment webhook |
| GET | `/billing/usage` | Current period token/session usage |

### LLM Gateway — `:8002` (internal, called by orchestrator)

| Method | Path | Description |
|---|---|---|
| POST | `/complete` | Single-shot completion |
| POST | `/stream` | SSE token stream |
| GET | `/health` | Health check |

### Memory Service — `:8001` (internal)

| Method | Path | Description |
|---|---|---|
| POST | `/retrieve/{user_id}` | Retrieve relevant long-term facts |
| POST | `/build-prompt/{user_id}` | Build system prompt with memory context |
| POST | `/consolidate` | Extract and store facts from a session |
| GET/DELETE | `/short-term/{user_id}` | Manage Redis short-term store |
| GET/DELETE | `/facts/{user_id}` | Manage pgvector long-term facts |

### Speech Service — `:8010` (internal)

| Method | Path | Description |
|---|---|---|
| POST | `/stt` | `multipart: audio` → transcript + pronunciation |
| POST | `/tts` | `{ text, voice? }` → base64 MP3 |
| POST | `/score/pronunciation` | Score from plain transcript text |
| GET | `/health` | Health check |

---

## Environment Variables Reference

### orchestrator (`apps/orchestrator/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_HOST` | `postgres` | Postgres host |
| `DB_USER` | `orchestrator_user` | DB user |
| `DB_PASS` | `orchestrator_pass` | DB password |
| `DB_NAME` | `speaking_app` | Database name |
| `DB_SCHEMA` | `speaking_app` | Postgres schema |
| `JWT_SECRET` | *(change this)* | Min 32 chars |
| `JWT_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token TTL |
| `BILLING_SERVICE_URL` | `http://billing-service:3001` | Internal URL |
| `MEMORY_SERVICE_URL` | `http://memory-service:8001` | Internal URL |
| `LLM_GATEWAY_URL` | `http://llm-gateway:8002` | Internal URL |
| `SPEECH_SERVICE_URL` | `http://speech-service:8010` | Internal URL |

### billing-service (`apps/billing-service/.env`)

| Variable | Description |
|---|---|
| `SEPAY_API_KEY` | SePay payment gateway API key |
| `SEPAY_WEBHOOK_SECRET` | Webhook signature secret |
| `SEPAY_BANK_NAME` | Bank name shown on QR |
| `SEPAY_ACCOUNT_NUMBER` | Receiving bank account |
| `PAYMENT_EXPIRY_MINUTES` | QR code validity (default `15`) |

### llm-gateway (`apps/llm-gateway/.env`)

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (primary) |
| `ANTHROPIC_MODEL` | e.g. `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI key (fallback) |
| `OPENAI_MODEL` | e.g. `gpt-4o` |
| `MAX_TOKENS` | Max tokens per response (default `1024`) |
| `RETRY_ATTEMPTS` | Retry count on failure (default `3`) |

### memory-service (`services/memory-service/.env`)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | For `text-embedding-3-small` embeddings |
| `EMBEDDING_MODEL` | `text-embedding-3-small` |
| `EMBEDDING_DIM` | `1536` |
| `REDIS_URL` | `redis://redis:6379/0` |
| `SHORT_TERM_TTL_SECONDS` | Redis TTL (default `7200` = 2 h) |
| `RETRIEVAL_LIMIT` | Max facts returned (default `10`) |

### speech-service (`services/speech-service/.env`)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | For Whisper STT and OpenAI TTS |
| `TTS_VOICE` | OpenAI TTS voice (default `alloy`) |
| `TTS_MODEL` | `tts-1` |
| `STT_MODEL` | `whisper-1` |
| `STT_LANGUAGE` | Language hint (default `en`) |

---

## Local Development (without Docker)

Run each service in a separate terminal. You still need Docker for Postgres and Redis:

```bash
# Start only infrastructure
docker compose up postgres redis
```

### NestJS services

```bash
# Orchestrator
npm run orchestrator

# Billing service
npm run billing

# LLM Gateway
npm run llm-gateway
```

Or start all NestJS apps together:

```bash
npm run dev
```

### Python services

```bash
# Memory service
cd services/memory-service
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload

# Speech service
cd services/speech-service
pip install -r requirements.txt
uvicorn main:app --port 8010 --reload
```

> For local dev, update the `DB_HOST`, `REDIS_URL`, and internal service URLs in each `.env` to point to `localhost` instead of the Docker service names.

---

## Database

The database is a single PostgreSQL instance with three isolated schemas:

| Schema | Owner | Tables |
|---|---|---|
| `speaking_app` | `orchestrator_user` | `users`, `sessions`, `turns` |
| `billing` | `billing_user` | `plans`, `subscriptions`, `payment_orders`, `usage` |
| `memory` | `memory_user` | `memory_facts` (pgvector), `consolidation_jobs` |

`init.sql` runs automatically on first container start and seeds three billing plans:

| Plan | Price | Token limit | Session limit |
|---|---|---|---|
| `free` | 0 VND | 50,000 | 10 |
| `pro_monthly` | 199,000 VND/month | Unlimited | Unlimited |
| `pro_yearly` | 1,990,000 VND/year | Unlimited | Unlimited |

---

## Useful Commands

```bash
# View logs for a specific service
docker compose logs -f orchestrator

# Rebuild a single service after code change
docker compose up --build orchestrator

# Stop all services
docker compose down

# Stop and delete all data volumes
docker compose down -v

# Connect to the database
docker exec -it speaking_postgres psql -U postgres -d speaking_app
```

---

## Production Checklist

- [ ] Change `JWT_SECRET` to a random 32+ character string
- [ ] Set `NODE_ENV=production` in all NestJS `.env` files
- [ ] Use real SePay credentials in `billing-service/.env`
- [ ] Restrict database user permissions beyond what `init.sql` grants
- [ ] Put the orchestrator behind a reverse proxy (nginx / Traefik) with TLS
- [ ] Remove or protect the internal service ports (8001, 8002, 8010, 3001) from public access
- [ ] Set up log aggregation and monitoring
