-- Firm-level NetSuite item mapping for the four fixed Direct Service identities.
--
-- ADDITIVE ONLY. One new table. Nothing existing is altered, tightened or
-- dropped, so this is safe to apply ahead of the code that reads it.
--
-- ── WHY THIS TABLE EXISTS AT ALL ──────────────────────────────────────────
--
-- `resolveNetsuiteItem(sku)` resolves a leaf to a NetSuite item by exact
-- SKU-match. That works for catalog products because their SKUs ARE the
-- NetSuite item codes — both sides got them from the same place.
--
-- The canonical services break that at the root. `SVC-FORMULATION` and its
-- siblings are Nexus-invented identifiers (migration 0080); nothing put them
-- in NetSuite. So SKU-match resolves not_found for every service, every time
-- — correct, and a permanent block no operator can clear, because the SKU
-- that fails is a canonical value they cannot edit.
--
-- Renaming the canonical SKUs to match NetSuite was the tempting alternative
-- and is rejected in the design doc: it would make a governed Nexus identity
-- depend on an external system's naming, so a NetSuite rename would break
-- attachment and costing rather than just the push.
--
-- ── WHY THE KEY IS THE IDENTITY ───────────────────────────────────────────
--
-- `service_identity` is what the closed enum exists to name and what the
-- database already guarantees unique (`leaves_service_identity_unique_idx`).
--
-- Keying on `leaves.id` would tie the mapping to a specific row, and 0080's
-- own comment says replacing a canonical record is a migration — one that
-- would then silently orphan the mapping. Keying on the SKU string would
-- reintroduce the string-matching fragility this table exists to remove.
--
-- ── WHY BOTH THE CODE AND THE INTERNAL ID ─────────────────────────────────
--
-- They answer different questions and must not be collapsed.
--
-- The item code is for humans: an admin recognises `SVC-FILL-01`, not `41350`.
-- The internal id is for machines, and is the ONLY thing a write may
-- reference — NetSuite item codes are mutable, internal ids are not.
--
-- Storing only the code would mean re-resolving on every push, which is the
-- fragility being removed. Storing only the id would leave an admin looking at
-- a number with no way to tell whether it is the right one.
--
-- ── WHY other_service IS EXCLUDED, IN THE SCHEMA RATHER THAN BY CONVENTION ─
--
-- `other_service` is the catch-all and carries no single accounting meaning,
-- so it takes a PER-LINE selection (workstream C) rather than a firm default.
-- A fifth row here "for symmetry" would be exactly the generic default the
-- disposition prohibits, and it would be a quiet one — a plausible-looking row
-- that silently routes every miscellaneous service to one item.
--
-- The CHECK makes that unreachable rather than merely discouraged.

CREATE TABLE "netsuite_service_item_map" (
  "service_identity" "direct_service_identity" PRIMARY KEY,
  "netsuite_item_code" text NOT NULL,
  "netsuite_internal_id" text NOT NULL,
  "resolved_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_by_user_id" uuid REFERENCES "users"("id"),
  CONSTRAINT "netsuite_service_item_map_not_other_service"
    CHECK ("service_identity" <> 'other_service')
);

COMMENT ON TABLE "netsuite_service_item_map" IS
  'Firm-level NetSuite item mapping for the four FIXED Direct Service identities. other_service is excluded by CHECK: it is the catch-all, carries no single accounting meaning, and takes a per-line selection instead (BV-012 / #292 workstream C). A routing table, not a commercial term — deliberately NOT a Pattern 52 frozen column, because what actually pushed is recorded on the Sales Order and in the quote_completed audit row.';

COMMENT ON COLUMN "netsuite_service_item_map"."netsuite_item_code" IS
  'The NetSuite itemid. For human recognition in Settings only. NEVER what a write references — item codes are mutable.';

COMMENT ON COLUMN "netsuite_service_item_map"."netsuite_internal_id" IS
  'The authoritative NetSuite internal id. This is what every write references. Resolved at save time through resolveNetsuiteItem, never guessed and never derived from the SKU at push time.';

COMMENT ON COLUMN "netsuite_service_item_map"."resolved_at" IS
  'When netsuite_internal_id was last CONFIRMED against NetSuite — at save, or at an explicit admin Verify. Not a row-modified timestamp.';
