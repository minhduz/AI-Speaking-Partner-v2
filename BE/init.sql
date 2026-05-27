-- ─── EXTENSIONS ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
 
-- ─── SCHEMAS ─────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS speaking_app;
CREATE SCHEMA IF NOT EXISTS memory;
CREATE SCHEMA IF NOT EXISTS dictionary;
 
-- ─── SERVICE USERS ───────────────────────────────────────────
DO $$ BEGIN CREATE USER orchestrator_user WITH PASSWORD 'orchestrator_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE USER memory_user WITH PASSWORD 'memory_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE USER dictionary_user WITH PASSWORD 'dictionary_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 
GRANT ALL ON SCHEMA speaking_app TO orchestrator_user;
GRANT USAGE ON SCHEMA speaking_app TO memory_user;
GRANT ALL ON SCHEMA memory       TO memory_user;
GRANT ALL ON SCHEMA dictionary   TO dictionary_user;
 
-- ─── SPEAKING_APP SCHEMA ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS speaking_app.users (
  id                   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  email                VARCHAR   UNIQUE NOT NULL,
  password_hash        VARCHAR   NOT NULL DEFAULT '',
  name                 VARCHAR   NOT NULL,
  google_id            VARCHAR   UNIQUE,
  target_language      VARCHAR   NOT NULL DEFAULT 'english',
  level                VARCHAR   NOT NULL DEFAULT 'beginner',
  native_language      VARCHAR   NOT NULL DEFAULT 'vietnamese',
  learning_goal        VARCHAR,
  timezone             VARCHAR   NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  voice_id             VARCHAR   NOT NULL DEFAULT 'Adrian',
  speech_rate          FLOAT     NOT NULL DEFAULT 1.0,
  conversation_style   VARCHAR   NOT NULL DEFAULT 'friendly',
  role                 VARCHAR   NOT NULL DEFAULT 'student',
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);
 
-- Idempotent column additions for installs predating the voice/style settings.
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS voice_id           VARCHAR NOT NULL DEFAULT 'Adrian';
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS speech_rate        FLOAT   NOT NULL DEFAULT 1.0;
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS conversation_style VARCHAR NOT NULL DEFAULT 'friendly';
 
-- Normalize old app voice IDs to valid Soniox tts-rt-v1 voices.
UPDATE speaking_app.users
SET voice_id = CASE
  WHEN voice_id = 'Sophia' THEN 'Sofia'
  WHEN voice_id = 'Liam' THEN 'Daniel'
  WHEN voice_id = 'Olivia' THEN 'Grace'
  ELSE 'Adrian'
END
WHERE voice_id NOT IN (
  'Maya', 'Daniel', 'Noah', 'Nina', 'Emma', 'Jack', 'Adrian', 'Claire',
  'Grace', 'Owen', 'Mina', 'Kenji', 'Rafael', 'Mateo', 'Lucia', 'Sofia',
  'Oliver', 'Arthur', 'Isla', 'Victoria', 'Cooper', 'Mason', 'Ruby', 'Elise',
  'Arjun', 'Rohan', 'Priya', 'Meera'
);
 
CREATE TABLE IF NOT EXISTS speaking_app.sessions (
  id                       UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID      NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
  title                    VARCHAR,
  status                   VARCHAR   NOT NULL DEFAULT 'active',
  total_tokens             INT       DEFAULT 0,
  avg_pronunciation_score  FLOAT     DEFAULT 0,
  is_archived              BOOLEAN   DEFAULT false,
  archived_at              TIMESTAMP,
  started_at               TIMESTAMP DEFAULT NOW(),
  ended_at                 TIMESTAMP,
  breakdown                JSONB
);
 
CREATE TABLE IF NOT EXISTS speaking_app.turns (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID      NOT NULL REFERENCES speaking_app.sessions(id) ON DELETE CASCADE,
  user_id     UUID      NOT NULL REFERENCES speaking_app.users(id)    ON DELETE CASCADE,
  turn_index  INT       NOT NULL,
  data        JSONB     NOT NULL DEFAULT '{}',
  tokens_used INT       DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);
 
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON speaking_app.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON speaking_app.sessions(status);
CREATE INDEX IF NOT EXISTS idx_turns_session_id  ON speaking_app.turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_user_id     ON speaking_app.turns(user_id);
CREATE INDEX IF NOT EXISTS idx_turns_data        ON speaking_app.turns USING GIN(data);
 
-- Per-turn user speech audio (private R2 storage; DB holds only metadata).
-- lesson_attempt_id is a plain UUID here (lesson_attempts is created later by a
-- TypeORM migration, not init.sql); migration 1716000000007 adds the FK once
-- lesson_attempts exists.
CREATE TABLE IF NOT EXISTS speaking_app.turn_audio (
  id                 UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID      NOT NULL REFERENCES speaking_app.sessions(id) ON DELETE CASCADE,
  user_id            UUID      NOT NULL REFERENCES speaking_app.users(id)    ON DELETE CASCADE,
  turn_id            UUID      REFERENCES speaking_app.turns(id) ON DELETE SET NULL,
  turn_index         INT,
  lesson_attempt_id  UUID,
  bucket             VARCHAR   NOT NULL,
  object_key         TEXT      NOT NULL UNIQUE,
  content_type       VARCHAR   NOT NULL,
  byte_size          INT       NOT NULL,
  duration_ms        INT,
  transcript         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turn_audio_session  ON speaking_app.turn_audio(session_id);
CREATE INDEX IF NOT EXISTS idx_turn_audio_attempt  ON speaking_app.turn_audio(lesson_attempt_id);
CREATE INDEX IF NOT EXISTS idx_turn_audio_user     ON speaking_app.turn_audio(user_id);
 
-- ─── MIGRATIONS for existing databases ───────────────────────
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS is idempotent)
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS google_id       VARCHAR UNIQUE;
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS native_language  VARCHAR NOT NULL DEFAULT 'vietnamese';
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS learning_goal    VARCHAR;
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS role             VARCHAR NOT NULL DEFAULT 'student';
ALTER TABLE speaking_app.users ALTER COLUMN password_hash SET DEFAULT '';
 
ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS end_reason VARCHAR;
ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS breakdown JSONB;
 
-- ─── MEMORY SCHEMA ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory.memory_facts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL,
  content           TEXT        NOT NULL,
  embedding         vector(1536),
  score             FLOAT       DEFAULT 1.0,
  retrieval_count   INT         DEFAULT 0,
  priority          VARCHAR     DEFAULT 'normal',
  source            VARCHAR     DEFAULT 'consolidation',
  expires_at        TIMESTAMPTZ,
  last_retrieved_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
 
CREATE TABLE IF NOT EXISTS memory.consolidation_jobs (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID      NOT NULL,
  session_id    UUID      NOT NULL,
  status        VARCHAR   NOT NULL DEFAULT 'queued',
  facts_written INT       DEFAULT 0,
  facts_pruned  INT       DEFAULT 0,
  queued_at     TIMESTAMP DEFAULT NOW(),
  completed_at  TIMESTAMP
);
 
CREATE INDEX IF NOT EXISTS idx_memory_user_id   ON memory.memory_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_priority  ON memory.memory_facts(priority);
CREATE INDEX IF NOT EXISTS idx_memory_expires   ON memory.memory_facts(expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_score     ON memory.memory_facts(score DESC);
CREATE INDEX IF NOT EXISTS idx_memory_embedding ON memory.memory_facts
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
 
-- ─── DICTIONARY SCHEMA ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS dictionary.cache (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  word              VARCHAR   NOT NULL,
  language          VARCHAR   NOT NULL DEFAULT 'en',
  data              JSONB     NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(word, language)
);
 
CREATE TABLE IF NOT EXISTS dictionary.user_history (
  id                UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID      NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
  word_id           UUID      NOT NULL REFERENCES dictionary.cache(id) ON DELETE CASCADE,
  context_sentence  TEXT,
  status            VARCHAR   NOT NULL DEFAULT 'new',
  review_count      INT       NOT NULL DEFAULT 0,
  mastery_score     FLOAT     NOT NULL DEFAULT 0,
  interval_days     FLOAT     NOT NULL DEFAULT 1,
  last_reviewed_at  TIMESTAMP,
  next_review_at    TIMESTAMP,
  is_archived        BOOLEAN   NOT NULL DEFAULT false,
  archived_at        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);
 
-- Idempotent dictionary flashcard migrations for existing databases.
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS context_sentence TEXT;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS status           VARCHAR NOT NULL DEFAULT 'new';
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS review_count     INT     NOT NULL DEFAULT 0;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS mastery_score    FLOAT   NOT NULL DEFAULT 0;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS interval_days    FLOAT   NOT NULL DEFAULT 1;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS next_review_at   TIMESTAMP;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS is_archived      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE dictionary.user_history ADD COLUMN IF NOT EXISTS archived_at      TIMESTAMP;
 
CREATE INDEX IF NOT EXISTS idx_dictionary_cache_word ON dictionary.cache(word);
CREATE INDEX IF NOT EXISTS idx_dictionary_history_user ON dictionary.user_history(user_id);
CREATE INDEX IF NOT EXISTS idx_dictionary_history_user_status ON dictionary.user_history(user_id, status);
CREATE INDEX IF NOT EXISTS idx_dictionary_history_next_review ON dictionary.user_history(next_review_at);
CREATE INDEX IF NOT EXISTS idx_dictionary_history_archived ON dictionary.user_history(user_id, is_archived);
 
-- Transfer ownership so orchestrator_user can run ALTER TABLE migrations
ALTER TABLE speaking_app.users      OWNER TO orchestrator_user;
ALTER TABLE speaking_app.sessions   OWNER TO orchestrator_user;
ALTER TABLE speaking_app.turns      OWNER TO orchestrator_user;
ALTER TABLE speaking_app.turn_audio OWNER TO orchestrator_user;
 
-- Grant table-level permissions
GRANT ALL ON ALL TABLES IN SCHEMA speaking_app TO orchestrator_user;
GRANT ALL ON ALL TABLES IN SCHEMA memory       TO memory_user;
GRANT ALL ON ALL TABLES IN SCHEMA dictionary   TO dictionary_user;
GRANT SELECT (id) ON speaking_app.sessions TO memory_user;
GRANT UPDATE (breakdown) ON speaking_app.sessions TO memory_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA speaking_app TO orchestrator_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA memory       TO memory_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dictionary   TO dictionary_user;