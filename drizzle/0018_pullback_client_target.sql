-- Slice 9.4c pullback: drop client_target_price_* column from quote_tiers.
--
-- Slice 9.4c was pulled back per surface-placement audit (the per-tier
-- per-unit affordance was being placed on the Pricing Control Summary,
-- which redesign-implementation §5 commits to consolidating away; plus
-- per-tier per-unit framing doesn't map to real customer negotiation
-- patterns). See UX_BACKLOG entry "Quote-total client target affordance"
-- for the deferral + architectural patterns preserved for future reuse.
--
-- Idempotent across two states:
--   - Fresh DB: column was never added; DROP IF EXISTS no-ops.
--   - Shared DB: had column added under varying names during the slice
--     (originally `client_target_price_total NUMERIC(12,4)` from the
--     reverted-out migration; transiently became `client_target_price_per_unit
--     NUMERIC(10,4)` during a mid-slice schema correction that was also
--     reverted). DROP IF EXISTS for both names cleans whichever lingers.
--
-- After this migration, quote_tiers has no client_target_* column. State
-- matches what the schema in src/db/schema.ts (post-revert) declares.

ALTER TABLE "quote_tiers" DROP COLUMN IF EXISTS "client_target_price_total";
ALTER TABLE "quote_tiers" DROP COLUMN IF EXISTS "client_target_price_per_unit";
