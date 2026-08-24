PRAGMA foreign_keys = ON;

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
CREATE INDEX idx_stripe_event_inbox_object
  ON stripe_event_inbox(event_type, object_id);

CREATE TABLE stripe_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_checkout_session_id TEXT,
  license_id TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  billing_status TEXT NOT NULL,
  stripe_price_id TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  paid_through TEXT,
  latest_paid_event_created_at INTEGER,
  ended_at TEXT,
  last_event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_subscriptions_customer
  ON stripe_subscriptions(stripe_customer_id);
CREATE UNIQUE INDEX idx_stripe_subscriptions_checkout
  ON stripe_subscriptions(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_subscriptions_license
  ON stripe_subscriptions(license_id)
  WHERE license_id IS NOT NULL;

CREATE TABLE stripe_invoices (
  stripe_invoice_id TEXT PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL,
  license_id TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  stripe_price_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  invoice_status TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  amount_paid INTEGER,
  currency TEXT,
  paid_event_created_at INTEGER,
  last_event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_invoices_subscription
  ON stripe_invoices(stripe_subscription_id, period_end);
CREATE INDEX idx_stripe_invoices_license
  ON stripe_invoices(license_id, period_end);
CREATE UNIQUE INDEX idx_stripe_invoices_payment_intent
  ON stripe_invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stripe_invoices_charge
  ON stripe_invoices(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE TABLE stripe_payments (
  payment_reference TEXT PRIMARY KEY,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_invoice_id TEXT,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  amount_paid INTEGER,
  currency TEXT,
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

CREATE TABLE stripe_refunds (
  stripe_refund_id TEXT PRIMARY KEY,
  payment_reference TEXT,
  license_id TEXT REFERENCES licenses(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  refund_status TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT,
  is_full_refund INTEGER NOT NULL DEFAULT 0 CHECK (is_full_refund IN (0, 1)),
  event_created_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_refunds_payment
  ON stripe_refunds(payment_reference);
CREATE INDEX idx_stripe_refunds_license
  ON stripe_refunds(license_id);

CREATE TABLE license_delivery_outbox (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE REFERENCES licenses(id) ON DELETE CASCADE,
  encrypted_payload TEXT,
  payload_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX idx_license_delivery_outbox_due
  ON license_delivery_outbox(status, next_attempt_at);
