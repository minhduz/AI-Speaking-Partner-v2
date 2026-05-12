-- ─── EXTENSIONS ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── SCHEMAS ─────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS speaking_app;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS memory;
CREATE SCHEMA IF NOT EXISTS dictionary;

-- ─── SERVICE USERS ───────────────────────────────────────────
DO $$ BEGIN CREATE USER orchestrator_user WITH PASSWORD 'orchestrator_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE USER billing_user WITH PASSWORD 'billing_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE USER memory_user WITH PASSWORD 'memory_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE USER dictionary_user WITH PASSWORD 'dictionary_pass';
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON SCHEMA speaking_app TO orchestrator_user;
GRANT ALL ON SCHEMA billing      TO billing_user;
GRANT ALL ON SCHEMA memory       TO memory_user;
GRANT ALL ON SCHEMA dictionary   TO dictionary_user;

-- ─── SPEAKING_APP SCHEMA ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS speaking_app.users (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR   UNIQUE NOT NULL,
  password_hash    VARCHAR   NOT NULL,
  name             VARCHAR   NOT NULL,
  target_language  VARCHAR   NOT NULL DEFAULT 'english',
  level            VARCHAR   NOT NULL DEFAULT 'beginner',
  timezone         VARCHAR   NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
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
  ended_at                 TIMESTAMP
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

-- ─── BILLING SCHEMA ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing.plans (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR   NOT NULL,
  interval      VARCHAR   NOT NULL,
  price_vnd     INT       DEFAULT 0,
  token_limit   INT       DEFAULT 50000,
  session_limit INT       DEFAULT 10,
  is_active     BOOLEAN   DEFAULT true,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.subscriptions (
  id                   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID      NOT NULL,
  plan_id              UUID      NOT NULL REFERENCES billing.plans(id),
  status               VARCHAR   NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMP NOT NULL,
  auto_renew           BOOLEAN   DEFAULT true,
  cancelled_at         TIMESTAMP,
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.payment_orders (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID      NOT NULL,
  plan_id          UUID      REFERENCES billing.plans(id),
  order_type       VARCHAR   NOT NULL DEFAULT 'subscription',
  addon_package_id UUID,
  status           VARCHAR   NOT NULL DEFAULT 'pending',
  amount_vnd       INT       NOT NULL,
  content_code     VARCHAR   UNIQUE NOT NULL,
  transaction_id   VARCHAR   UNIQUE,
  qr_url           VARCHAR,
  expires_at       TIMESTAMP NOT NULL,
  paid_at          TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.usage (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID      NOT NULL,
  tokens_used    INT       DEFAULT 0,
  sessions_used  INT       DEFAULT 0,
  period_start   TIMESTAMP NOT NULL DEFAULT DATE_TRUNC('month', NOW()),
  period_end     TIMESTAMP NOT NULL DEFAULT DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
  updated_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id   ON billing.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status    ON billing.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id  ON billing.payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_content_code    ON billing.payment_orders(content_code);
CREATE INDEX IF NOT EXISTS idx_usage_user_period       ON billing.usage(user_id, period_start);

CREATE TABLE IF NOT EXISTS billing.billing_events (
  id                   UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  sepay_transaction_id BIGINT    UNIQUE,
  user_id              UUID,
  event_type           VARCHAR   NOT NULL,
  reference_code       VARCHAR,
  payload              JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_sepay_txn
  ON billing.billing_events(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing.addon_packages (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR NOT NULL,
  token_amount BIGINT  NOT NULL,
  price_vnd    INT     NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.user_addons (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    NOT NULL,
  addon_package_id UUID    REFERENCES billing.addon_packages(id),
  tokens_purchased BIGINT  NOT NULL,
  tokens_remaining BIGINT  NOT NULL,
  payment_order_id UUID,
  expires_at       TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_addons_user_active
  ON billing.user_addons(user_id) WHERE tokens_remaining > 0;

-- Seed plans
INSERT INTO billing.plans (name, interval, price_vnd, token_limit, session_limit)
VALUES
  ('free',        'forever', 0,       50000, 10),
  ('pro_monthly', 'month',   199000,  5000000, -1),
  ('pro_yearly',  'year',    1990000, 5000000, -1)
ON CONFLICT DO NOTHING;

-- Seed add-on packages
INSERT INTO billing.addon_packages (name, token_amount, price_vnd)
VALUES
  ('Starter Pack',  500000,  49000),
  ('Value Pack',   2000000, 149000),
  ('Power Pack',   5000000, 299000)
ON CONFLICT DO NOTHING;

-- ─── MIGRATIONS for existing databases ───────────────────────
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS is idempotent)
ALTER TABLE billing.payment_orders ADD COLUMN IF NOT EXISTS order_type       VARCHAR NOT NULL DEFAULT 'subscription';
ALTER TABLE billing.payment_orders ADD COLUMN IF NOT EXISTS addon_package_id UUID;
ALTER TABLE billing.payment_orders ALTER COLUMN plan_id DROP NOT NULL;

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
  expires_at        TIMESTAMP,
  last_retrieved_at TIMESTAMP,
  created_at        TIMESTAMP   DEFAULT NOW(),
  updated_at        TIMESTAMP   DEFAULT NOW()
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
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dictionary_cache_word ON dictionary.cache(word);
CREATE INDEX IF NOT EXISTS idx_dictionary_history_user ON dictionary.user_history(user_id);

-- Grant table-level permissions
GRANT ALL ON ALL TABLES IN SCHEMA speaking_app TO orchestrator_user;
GRANT ALL ON ALL TABLES IN SCHEMA billing      TO billing_user;
GRANT ALL ON ALL TABLES IN SCHEMA memory       TO memory_user;
GRANT ALL ON ALL TABLES IN SCHEMA dictionary   TO dictionary_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA speaking_app TO orchestrator_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA billing      TO billing_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA memory       TO memory_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dictionary   TO dictionary_user;
