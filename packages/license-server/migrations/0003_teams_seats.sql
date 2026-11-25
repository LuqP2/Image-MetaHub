PRAGMA foreign_keys = ON;

ALTER TABLE licenses ADD COLUMN tier TEXT NOT NULL DEFAULT 'pro' CHECK (tier IN ('pro', 'teams'));
ALTER TABLE licenses ADD COLUMN org_name TEXT;
ALTER TABLE licenses ADD COLUMN seat_limit INTEGER CHECK (seat_limit IS NULL OR seat_limit >= 1);

ALTER TABLE activations ADD COLUMN device_label TEXT;

CREATE INDEX IF NOT EXISTS idx_licenses_tier ON licenses(tier);
