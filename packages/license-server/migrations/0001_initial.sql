PRAGMA foreign_keys = ON;

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  email_lookup TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('lifetime', 'monthly', 'annual')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'cancelled', 'expired')),
  source TEXT NOT NULL CHECK (source IN ('legacy_reissue', 'manual', 'stripe')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  max_activations INTEGER CHECK (max_activations IS NULL OR max_activations >= 1),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  stripe_checkout_session_id TEXT,
  external_reference TEXT,
  CHECK (
    (plan = 'lifetime' AND expires_at IS NULL)
    OR (plan IN ('monthly', 'annual') AND expires_at IS NOT NULL)
  )
);

CREATE INDEX idx_licenses_email_lookup ON licenses(email_lookup);
CREATE INDEX idx_licenses_status_expires_at ON licenses(status, expires_at);
CREATE UNIQUE INDEX idx_licenses_stripe_subscription_id
  ON licenses(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX idx_licenses_stripe_checkout_session_id
  ON licenses(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX idx_licenses_stripe_customer_id
  ON licenses(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_licenses_external_reference
  ON licenses(external_reference) WHERE external_reference IS NOT NULL;
CREATE UNIQUE INDEX idx_licenses_historical_reissue_email
  ON licenses(email_lookup) WHERE source = 'legacy_reissue';

CREATE TABLE activations (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  deactivated_at TEXT,
  app_version TEXT,
  platform TEXT,
  UNIQUE (license_id, installation_hash)
);

CREATE INDEX idx_activations_license_active
  ON activations(license_id, deactivated_at);
CREATE INDEX idx_activations_last_seen_at ON activations(last_seen_at);
