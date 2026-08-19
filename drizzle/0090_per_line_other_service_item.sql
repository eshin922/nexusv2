-- Per-line NetSuite item selection for `OTC - Other Service`.
--
-- ADDITIVE. One new table, two new columns on the frozen line.
--
-- ── WHY THIS DESTINATION ALONE NEEDS A PER-LINE CHOICE ───────────────────
--
-- Every other BV-011 destination means one thing, so one firm-wide mapping is
-- correct for all of them. `OTC - Other Service` is the catch-all: two quotes
-- can use it for entirely unrelated charges, and migration 0081 refuses it a
-- firm-level row by CHECK rather than by convention for exactly that reason.
--
-- So the operator's choice IS the governance for this line. That makes it a
-- commercial decision about THIS quote — not firm configuration — and it is
-- therefore FROZEN at send, unlike every other destination, whose record is
-- resolved at push from whatever mapping is current.

-- ── the draft-side selection ─────────────────────────────────────────────
--
-- Keyed by the line's owner, with the same assembly-XOR-leaf shape migration
-- 0082 established for production ownership. A selection belongs either to an
-- Item Group's Other-Service fee or to a Direct Service leaf, never both and
-- never neither.
CREATE TABLE "quote_other_service_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  -- The Item Group whose `other_service_total` this selection is for.
  "assembly_id" uuid REFERENCES "assemblies"("id") ON DELETE CASCADE,
  -- The Direct Service leaf, when its identity is `other_service`.
  "quote_leaf_id" uuid REFERENCES "quote_leaves"("id") ON DELETE CASCADE,
  -- NOT NULL both: a selection that names no item is not a selection. The
  -- absence of a row is how "not chosen yet" is represented, so a half-filled
  -- row would be a third state nothing needs.
  "netsuite_item_code" text NOT NULL,
  "netsuite_internal_id" text NOT NULL,
  "selected_at" timestamptz NOT NULL DEFAULT now(),
  "selected_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "qosi_owner_xor" CHECK (
    ("assembly_id" IS NOT NULL) <> ("quote_leaf_id" IS NOT NULL)
  )
);

-- One selection per owner. A second row would be a second answer to "which
-- item is this line", which is the divergence Pattern 58 warns about.
CREATE UNIQUE INDEX "qosi_assembly_unique"
  ON "quote_other_service_items" ("assembly_id") WHERE "assembly_id" IS NOT NULL;
CREATE UNIQUE INDEX "qosi_leaf_unique"
  ON "quote_other_service_items" ("quote_leaf_id") WHERE "quote_leaf_id" IS NOT NULL;
CREATE INDEX "qosi_quote_idx" ON "quote_other_service_items" ("quote_id");

COMMENT ON TABLE "quote_other_service_items" IS
  'Per-line NetSuite item for OTC - Other Service, the one BV-011 destination with no firm-wide record. The operator choice IS the governance for the line, so it is frozen at send rather than resolved at push.';

-- ── the frozen selection ─────────────────────────────────────────────────
--
-- Distinct from `netsuite_item_id`, and the distinction is load-bearing:
--
--   selected_netsuite_item_id  what the operator CHOSE, frozen at send
--   netsuite_item_id           what was actually POSTED, written at push
--
-- They should agree. Keeping both means a disagreement is detectable instead
-- of being absorbed into a single field that overwrites its own history.
ALTER TABLE "quote_snapshot_lines"
  ADD COLUMN "selected_netsuite_item_id" text,
  ADD COLUMN "selected_netsuite_item_code" text;

COMMENT ON COLUMN "quote_snapshot_lines"."selected_netsuite_item_id" IS
  'Frozen per-line item selection, for OTC - Other Service only. NULL everywhere else, where the record is resolved at push from the governed destination mapping.';
