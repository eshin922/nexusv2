-- The five canonical Direct Service records, and the invariant that keeps
-- them the only ones.
--
-- ADDITIVE + SEED. One unique index and five rows. Nothing is altered or
-- dropped, so this is safe to apply ahead of the code that reads it.
--
-- ── WHY THESE ARE SEEDED, NOT OPERATOR-CREATED ────────────────────────────
--
-- The five Direct Services are CANONICAL LAUNCH RECORDS: production data, not
-- fixtures, and not removed after testing. An operator selling a filling
-- engagement selects the standardized record; they do not mint another
-- governed identity for it.
--
-- That is a business decision with a structural consequence. Each of these
-- records will carry a NetSuite item mapping, and "which NetSuite item is
-- Filling / Blending" must have exactly one answer. Two operator-created
-- Filling records would make that question ambiguous at the moment it is least
-- recoverable — a Sales Order push.
--
-- ── THE INVARIANT ─────────────────────────────────────────────────────────
--
-- A partial unique index on `service_identity`. Partial because products carry
-- NULL there and a plain unique index would be satisfied by NULLs being
-- distinct — true, but it would leave the index meaninglessly wide.
--
-- Deliberately NOT scoped to `archived = false`. Archiving a canonical service
-- and creating a replacement would produce two records competing for one
-- governed identity, which is the exact state this prevents. If a canonical
-- record must ever be replaced, that is a migration, not an operator action.
--
-- ── NO HUBSPOT IDENTITY ───────────────────────────────────────────────────
--
-- `hubspot_product_id` and `hubspot_product_type` are NULL by omission. A
-- service's downstream identity is a BV-011 accounting destination resolved at
-- NetSuite projection; HubSpot is not in that path, so a catalog record for it
-- would be a row in a system with no question to answer about it.
--
-- ── SKUs ──────────────────────────────────────────────────────────────────
--
-- `SVC-*`, deterministic and stable. A SKU is not decoration here: the
-- attachment gate refuses any leaf without a usable one, because a product
-- with no SKU cannot resolve in NetSuite. These are the strings the future
-- Settings mapping will key its NetSuite item lookup against, so they are
-- chosen to be readable and never regenerated.

CREATE UNIQUE INDEX "leaves_service_identity_unique_idx"
  ON "leaves" ("service_identity")
  WHERE "service_identity" IS NOT NULL;

INSERT INTO "leaves" ("name", "sku", "commercial_kind", "service_identity", "archived")
VALUES
  ('Formulation',          'SVC-FORMULATION',      'service', 'formulation',      false),
  ('Filling / Blending',   'SVC-FILLING-BLENDING', 'service', 'filling_blending', false),
  ('Pack-out / Assembly',  'SVC-PACKOUT-ASSEMBLY', 'service', 'packout_assembly', false),
  ('Testing / Micros',     'SVC-TESTING-MICROS',   'service', 'testing_micros',   false),
  ('Other Service',        'SVC-OTHER',            'service', 'other_service',    false)
ON CONFLICT DO NOTHING;

COMMENT ON INDEX "leaves_service_identity_unique_idx" IS
  'Exactly one library record per governed Direct Service identity. Not scoped to archived=false on purpose: archiving one and creating a replacement would produce two records competing for one identity, which is the state this prevents. Replacing a canonical record is a migration, not an operator action.';
