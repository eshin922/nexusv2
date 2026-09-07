-- WHY A FROZEN LINE RECORDS WHY IT HAS NO DESTINATION.
--
-- `bv011_destination` is nullable, and null describes FOUR unrelated states:
-- a product line that resolves by SKU; the legacy combined Tooling/Artwork
-- charge; a line frozen before destinations were recorded at all; and a
-- component charge whose destination could not be resolved at projection.
-- Only the last two are new, and they need different instructions.
--
-- The readiness gate was telling them apart by `displayName.startsWith(...)`,
-- comparing a frozen CUSTOMER-facing name against an OPERATOR-facing label.
-- Those are two vocabularies, one word apart -- "Tooling" against "Tooling &
-- dies" -- so the test was never true, and every unclassified tooling line was
-- told its type had no governed destination and should be removed.
--
-- This is the same fix `legacy_unresolved` already is, for the same reason its
-- comment gives: re-deriving accounting meaning from display copy means a copy
-- change can silently repoint a destination. The resolution is STRUCTURAL, it
-- is decided once at projection, and it is persisted beside the destination it
-- explains.
--
-- NULL means one of two things, and they stay distinguishable:
--   destination IS NOT NULL                 -> resolved
--   destination IS NULL AND reason IS NULL  -> frozen before this model
--   destination IS NULL AND reason IS NOT NULL -> resolution ran, and failed
--
-- No backfill. A historical line's reason is genuinely unknown -- the model did
-- not exist when it froze -- and writing one would invent a resolution nobody
-- performed. That absence IS the signal readiness needs to route those lines to
-- `destination_not_recorded`, whose remedy is a revise-and-re-send.

CREATE TYPE "destination_unresolved_reason" AS ENUM (
  -- A Tooling charge nobody classified. An operator can state this.
  'tooling_classification_missing',
  -- The charge type names no governed BV-011 destination. An operator cannot
  -- close this from the quote; it is a governance gap.
  'component_type_ungoverned'
);

ALTER TABLE "quote_snapshot_lines"
  ADD COLUMN "destination_unresolved_reason" "destination_unresolved_reason";

-- A reason only makes sense when there is no destination. Recording both would
-- be a line that resolved and did not.
ALTER TABLE "quote_snapshot_lines"
  ADD CONSTRAINT "quote_snapshot_lines_unresolved_reason_needs_null_destination"
  CHECK ("destination_unresolved_reason" IS NULL OR "bv011_destination" IS NULL);
