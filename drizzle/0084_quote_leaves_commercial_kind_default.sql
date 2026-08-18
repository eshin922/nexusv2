-- Let writers omit `quote_leaves.commercial_kind` entirely.
--
-- ADDITIVE. One DEFAULT. Changes no existing row.
--
-- ── WHY A DEFAULT THAT IS NEVER OBSERVED ──────────────────────────────────
--
-- 0082 made this column NOT NULL and had a BEFORE INSERT trigger populate it
-- from `leaves`, so that no writer — deployed, branch, or future — has to know
-- it exists. The trigger does that job completely: it fires before the NOT
-- NULL check and sets the correct value on every insert.
--
-- But the ORM's insert type is derived from the column being NOT NULL with no
-- default, so it demanded the column from every call site — the exact writers
-- the trigger exists to spare. Adding the default makes the column omittable
-- in the type, which is the only thing it does: the trigger overwrites it
-- unconditionally, so no row will ever actually carry it.
--
-- 'product' rather than nothing because a default must be some value and the
-- overwhelming majority of attachments are products. It is never a fallback:
-- if the trigger were ever dropped, a service attachment would then land as
-- 'product' and be REFUSED by quote_leaves_leaf_kind_fk rather than silently
-- mislabelled. Fails closed.

ALTER TABLE "quote_leaves"
  ALTER COLUMN "commercial_kind" SET DEFAULT 'product';

COMMENT ON COLUMN "quote_leaves"."commercial_kind" IS
  'Denormalised from leaves.commercial_kind, maintained by quote_leaves_commercial_kind_sync. The DEFAULT exists only so writers may omit the column; the trigger overwrites it on every insert, so no row carries the default value. If the trigger were dropped, a service attachment would fail the composite FK rather than be mislabelled.';
