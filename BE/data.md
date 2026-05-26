# Database Schema

## Overview

PostgreSQL keeps the core app and memory schemas; Redis keeps short-term session state.

```
PostgreSQL
├── speaking_app   — core app data (users, sessions, turns, lessons)
└── memory         — pgvector long-term memory facts + consolidation jobs

Redis
└── session:{id}:context  — short-term in-session chat history (TTL 2h)
```

---

## Schema: `speaking_app`

### `speaking_app.users`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | gen_random_uuid() |
| `email` | text | UNIQUE NOT NULL | |
| `password_hash` | text | NOT NULL | |
| `name` | text | NOT NULL | |
| `target_language` | text | | `'english'` |
| `level` | text | | `'beginner'` |
| `timezone` | text | | `'Asia/Ho_Chi_Minh'` |
| `created_at` | timestamptz | | NOW() |
| `updated_at` | timestamptz | | NOW() |

---

### `speaking_app.sessions`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | gen_random_uuid() |
| `user_id` | uuid | FK → users.id NOT NULL | |
| `title` | text | nullable | |
| `status` | text | | `'active'` |
| `total_tokens` | int | | `0` |
| `avg_pronunciation_score` | float | | `0` |
| `is_archived` | boolean | | `false` |
| `archived_at` | timestamptz | nullable | |
| `started_at` | timestamptz | | NOW() |
| `ended_at` | timestamptz | nullable | |

---

### `speaking_app.turns`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | gen_random_uuid() |
| `session_id` | uuid | FK → sessions.id NOT NULL | |
| `user_id` | uuid | NOT NULL | |
| `turn_index` | int | NOT NULL | |
| `data` | jsonb | | `{}` |
| `tokens_used` | int | | `0` |
| `created_at` | timestamptz | | NOW() |

**`data` JSONB shape:**
```json
{
  "transcript":     "string",
  "response_text":  "string",
  "confidence":     0.92,
  "pronunciation":  { "score": 0.87, "per_word": [...] },
  "tokens_used":    312
}
```

---

## Schema: `memory`

> Requires `pgvector` extension. Embedding dimension: **1536** (OpenAI `text-embedding-3-small`).

### `memory.memory_facts`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | gen_random_uuid() |
| `user_id` | uuid | NOT NULL | |
| `content` | text | NOT NULL | |
| `embedding` | vector(1536) | NOT NULL | |
| `score` | float | | `1.0` |
| `priority` | text | | `'normal'` |
| `retrieval_count` | int | | `0` |
| `source` | text | | `'consolidation'` |
| `expires_at` | timestamptz | nullable | |
| `updated_at` | timestamptz | | NOW() |
| `created_at` | timestamptz | | NOW() |

**`priority` values:** `normal` | `high` | `urgent`

**Scoring formula (applied post-session):**
```
new_score = old_score × e^(−λ × days_since_updated) + retrieval_count × 0.05
```
Facts with `score < 0.1` (and `priority = 'normal'`) are pruned.

**Index:** HNSW or IVFFlat on `embedding` for fast cosine similarity search.

---

### `memory.consolidation_jobs`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | gen_random_uuid() |
| `user_id` | uuid | NOT NULL | |
| `session_id` | uuid | NOT NULL | |
| `status` | text | | `'processing'` |
| `facts_written` | int | nullable | |
| `facts_pruned` | int | nullable | |
| `completed_at` | timestamptz | nullable | |
| `created_at` | timestamptz | | NOW() |

**`status` values:** `processing` → `done` | `failed`

---

## Redis

### `session:{session_id}:context`

- **Type:** LIST
- **TTL:** 7200 seconds (2 hours)
- **Each element:** JSON string

```json
{ "role": "user",      "content": "I have an exam tomorrow." }
{ "role": "assistant", "content": "Let's practice for it!" }
```

Messages are appended in order (RPUSH) and read back as a full conversation window. Cleared after consolidation runs at session end.

---

## Entity Relationships

```
users ──< sessions ──< turns
  │
  └──< subscriptions >── plans
  └──< usage
  └──< payment_orders

memory.memory_facts  (user_id ref, no FK)
memory.consolidation_jobs  (user_id, session_id ref, no FK)
Redis session context  (keyed by session_id, no FK)
```
