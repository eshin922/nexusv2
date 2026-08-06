-- Request idempotency for operator actions.
--
-- Duplicate-submission protection for Freight destinations cannot be a
-- uniqueness constraint on (shipment, destination, consignee): multiple
-- commercial alternatives for one destination and consignee are the intended
-- comparison workflow, and at creation time an intentional alternative is
-- indistinguishable from an accidental repeat. The discriminator is the
-- REQUEST, not the data.
--
-- Additive only. No existing row is read or modified, and nothing depends on
-- this table until the action layer starts writing keys.
CREATE TABLE IF NOT EXISTS action_idempotency (
  key text PRIMARY KEY,
  action text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
