-- A frozen line says whether it is legacy-unresolved. It is no longer inferred.
--
-- ADDITIVE. One NOT NULL column with a DEFAULT, so existing rows take `false`
-- without a backfill pass and no deployed writer can violate it.
--
-- ── WHY A NULL DESTINATION WAS NOT ENOUGH ────────────────────────────────
--
-- `bv011_destination IS NULL` was carrying two unrelated meanings at once:
--
--   1. the LEGACY combined Tooling/Artwork charge, which no rule can assign to
--      a destination — the state that must block with a named remediation;
--   2. a line frozen BEFORE 0088 added the column at all, which simply has no
--      destination recorded yet.
--
-- Every frozen line in the database today is case 2, and the readiness check
-- reported all of them — including a Direct Service — as legacy combined
-- Tooling/Artwork charges. The remediation told an operator to resolve a
-- Formulation service into Tooling and Artwork inputs, which is nonsense.
--
-- Same discipline as `pricing_state`: an ambiguous null is replaced by an
-- explicit statement, so the two states are distinguishable by construction
-- rather than by guessing from a display name.
ALTER TABLE "quote_snapshot_lines"
  ADD COLUMN "legacy_unresolved" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "quote_snapshot_lines"."legacy_unresolved" IS
  'TRUE only for the legacy combined Tooling/Artwork charge, whose accounting destination cannot be determined by any rule. Distinguishes that from a line frozen before bv011_destination existed, which merely has nothing recorded. Existing rows default to false, which is correct: they are the second case.';
