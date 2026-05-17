CREATE TABLE IF NOT EXISTS billing.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sepay_transaction_id BIGINT UNIQUE,
  user_id UUID,
  event_type VARCHAR NOT NULL,
  reference_code VARCHAR,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_sepay_txn
  ON billing.billing_events(sepay_transaction_id)
  WHERE sepay_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing.addon_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  token_amount BIGINT NOT NULL,
  price_vnd INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.user_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  addon_package_id UUID REFERENCES billing.addon_packages(id),
  tokens_purchased BIGINT NOT NULL,
  tokens_remaining BIGINT NOT NULL,
  payment_order_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_addons_user_active
  ON billing.user_addons(user_id) WHERE tokens_remaining > 0;

ALTER TABLE billing.payment_orders ADD COLUMN IF NOT EXISTS order_type VARCHAR NOT NULL DEFAULT 'subscription';
ALTER TABLE billing.payment_orders ADD COLUMN IF NOT EXISTS addon_package_id UUID;
ALTER TABLE billing.payment_orders ALTER COLUMN plan_id DROP NOT NULL;

INSERT INTO billing.addon_packages (name, token_amount, price_vnd)
SELECT * FROM (VALUES
  ('Starter Pack',  500000,  49000),
  ('Value Pack',   2000000, 149000),
  ('Power Pack',   5000000, 299000)
) v(name, token_amount, price_vnd)
WHERE NOT EXISTS (SELECT 1 FROM billing.addon_packages);

GRANT ALL ON TABLE billing.billing_events TO billing_user;
GRANT ALL ON TABLE billing.addon_packages TO billing_user;
GRANT ALL ON TABLE billing.user_addons    TO billing_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA billing TO billing_user;

-- Onboarding: native language & learning goal
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS native_language VARCHAR DEFAULT 'vietnamese';
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS learning_goal VARCHAR;

-- Google OAuth
ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS google_id VARCHAR UNIQUE;

-- End-session: idle detection + reason tracking
ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS end_reason VARCHAR; -- 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close' | 'orphan'
CREATE INDEX IF NOT EXISTS idx_sessions_active_idle
  ON speaking_app.sessions(user_id, last_activity_at)
  WHERE status = 'active';
