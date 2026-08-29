-- OD-028 · the frozen instruction says which identity space its owner is in.
--
-- ── TWO SIBLING COLUMNS, ONE NAME, DIFFERENT DOMAINS ────────────────────
--
-- `quote_charge_instances.owner_ref` is CLOSED: a CHECK ties it to
-- `owner_quote_leaf_id`, which references `quote_leaves`. It is '@quote' or a
-- leaf, and an assembly id cannot be written there.
--
-- `quote_snapshot_recovery_instructions.owner_ref` is open text. Its own column
-- comment has always said "Assembly or quote-leaf id as text — the two are
-- different tables and a single FK cannot address both", so the dual domain was
-- intended from the start; it was simply never typed. Every reader was verified
-- to treat it as opaque before this migration: no FK, no CHECK, no join to
-- `quote_leaves` or `assemblies` anywhere in src or scripts, and the Accounting
-- agreement card keys on (charge_key, treatment) without reading the owner at
-- all. `frozen-instruction-certify.ts` already writes 'certify-%' sentinels
-- into it.
--
-- Opaque-in-practice is not unambiguous. OD-028 makes assembly-owned Production
-- freeze against its assembly rather than an arbitrary member, so the freeze
-- starts carrying assembly ids beside leaf ids under a name that means "leaf"
-- one table over. Leaving that as convention is how the next reader gets it
-- wrong.
--
-- ── RETAINED, NOT INVENTED ──────────────────────────────────────────────
--
-- `ownerKind` already exists in the domain: `construct.ts` computes
-- "assembly" | "direct_service" | "component" on every charge, and
-- `projectFrozenInstructions` discarded it. This preserves a fact the system
-- already knows rather than modelling ownership a second time.
--
-- ── WHY NULLABLE, AND WHY THAT IS NOT A LOOPHOLE ────────────────────────
--
-- The 42 existing rows were frozen before this contract and stay untouched.
-- NULL means precisely "pre-contract historical instruction" — it is not a
-- fourth kind and it is not inferred from the old coerced owner_ref, which
-- named a member the anchor rule happened to pick and would be a guess dressed
-- as a record.
--
-- No backfill. A freeze records what was frozen.
--
-- NULL is forbidden for new writes at the application boundary, asserted by
-- `tests/unit/od-028-frozen-owner-kind.test.ts` and by the OD-028 gate, so it
-- can never become a runtime discriminator: post-cutover, every instruction
-- carries a governed kind.
--
-- ADDITIVE. A new nullable column and a new type; no tightening, no drop. Safe
-- to apply before the code that writes it, per the deployment-order rule —
-- every currently deployed writer omits it and gets NULL, which is the correct
-- value for anything written before the writer ships.

CREATE TYPE "recovery_owner_kind" AS ENUM ('assembly', 'component', 'direct_service');

ALTER TABLE "quote_snapshot_recovery_instructions"
  ADD COLUMN IF NOT EXISTS "owner_kind" "recovery_owner_kind";

COMMENT ON COLUMN "quote_snapshot_recovery_instructions"."owner_kind" IS
  'Which identity space owner_ref is in. NULL = frozen before the contract (OD-028); never inferred, never backfilled. Required for every post-cutover write.';
