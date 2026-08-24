PRAGMA foreign_keys = ON;

ALTER TABLE licenses ADD COLUMN admin_status TEXT NOT NULL DEFAULT 'active'
  CHECK (admin_status IN ('active', 'revoked', 'cancelled', 'expired'));
ALTER TABLE licenses ADD COLUMN legacy_status_revision INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_status_revision >= 0);
UPDATE licenses SET admin_status = status;

-- Expand/contract compatibility: the deployed v1 Worker continues to use
-- status while the v2 Worker uses admin_status. Keep both columns synchronized
-- until a later deployment can safely remove the legacy status column.
CREATE TRIGGER licenses_sync_admin_status_after_insert
AFTER INSERT ON licenses
FOR EACH ROW
WHEN NEW.admin_status <> NEW.status
BEGIN
  UPDATE licenses SET admin_status = NEW.status WHERE id = NEW.id;
END;

CREATE TRIGGER licenses_sync_admin_status_after_status_update
AFTER UPDATE OF status ON licenses
FOR EACH ROW
WHEN NEW.admin_status <> NEW.status
  AND NEW.legacy_status_revision = OLD.legacy_status_revision
BEGIN
  UPDATE licenses SET admin_status = NEW.status WHERE id = NEW.id;
END;

CREATE INDEX idx_licenses_admin_status_expires_at
  ON licenses(admin_status, expires_at);

CREATE TABLE stripe_event_inbox (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  event_created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX idx_stripe_event_inbox_due
  ON stripe_event_inbox(status, next_attempt_at);

CREATE TABLE stripe_subscription_events (
  event_id TEXT PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted'
    )
  ),
  billing_status TEXT NOT NULL,
  stripe_price_id TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  event_created_at INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_subscription_events_order
  ON stripe_subscription_events(stripe_subscription_id, event_created_at, event_type);

CREATE TABLE stripe_invoices (
  stripe_invoice_id TEXT PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'annual')),
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  invoice_status TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount_paid INTEGER,
  currency TEXT,
  paid_event_created_at INTEGER,
  last_event_id TEXT NOT NULL,
  last_event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_invoices_subscription_period
  ON stripe_invoices(stripe_subscription_id, period_end, paid_event_created_at);
CREATE INDEX idx_stripe_invoices_payment_intent
  ON stripe_invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_stripe_invoices_charge
  ON stripe_invoices(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE TABLE stripe_payments (
  payment_reference TEXT PRIMARY KEY,
  payment_kind TEXT NOT NULL CHECK (payment_kind IN ('lifetime', 'subscription')),
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  stripe_subscription_id TEXT,
  license_id TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  payment_status TEXT NOT NULL,
  amount_paid INTEGER,
  currency TEXT,
  paid_event_id TEXT NOT NULL,
  paid_event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_stripe_payments_payment_intent
  ON stripe_payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_payments_charge
  ON stripe_payments(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_payments_checkout
  ON stripe_payments(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_payments_invoice
  ON stripe_payments(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX idx_stripe_payments_subscription
  ON stripe_payments(stripe_subscription_id);

CREATE TABLE stripe_refund_facts (
  fact_id TEXT PRIMARY KEY,
  stripe_refund_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  refund_status TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  payment_fully_refunded INTEGER NOT NULL DEFAULT 0 CHECK (payment_fully_refunded IN (0, 1)),
  event_id TEXT NOT NULL,
  event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_refund_facts_payment_intent
  ON stripe_refund_facts(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_stripe_refund_facts_charge
  ON stripe_refund_facts(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE TABLE stripe_entitlements (
  license_id TEXT PRIMARY KEY REFERENCES licenses(id) ON DELETE CASCADE,
  entitlement_kind TEXT NOT NULL CHECK (entitlement_kind IN ('lifetime', 'subscription')),
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  billing_state TEXT NOT NULL CHECK (
    billing_state IN ('active', 'cancelled', 'expired', 'refunded')
  ),
  plan TEXT NOT NULL CHECK (plan IN ('lifetime', 'monthly', 'annual')),
  stripe_price_id TEXT,
  paid_through TEXT,
  winning_invoice_id TEXT,
  winning_payment_reference TEXT,
  latest_paid_event_created_at INTEGER,
  latest_deletion_event_created_at INTEGER,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_stripe_entitlements_subscription
  ON stripe_entitlements(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_entitlements_checkout
  ON stripe_entitlements(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE TABLE license_delivery_outbox (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE REFERENCES licenses(id) ON DELETE CASCADE,
  encrypted_payload TEXT,
  payload_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'leased', 'authorized', 'delivered', 'cancelled', 'dead_letter', 'manual_review')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  authorized_at TEXT,
  first_provider_attempt_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX idx_license_delivery_outbox_due
  ON license_delivery_outbox(status, next_attempt_at);
