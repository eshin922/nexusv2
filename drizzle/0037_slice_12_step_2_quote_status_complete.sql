-- Slice 12 Step 2 — extend quote_status pgEnum with 'complete'.
--
-- Sixth enum value; marks a quote whose Tier Selection Advance
-- has fired (NetSuite SO push landed). Per v3 brief §4.1 + §4.5,
-- `complete` is terminal + non-editable — the Pattern 52
-- immutability lock relocates here from `sent` (Step 6 makes the
-- relocation live when the Revise action ships).
--
-- Reversibility model: `sent` and `accepted` remain reversible to
-- `draft` via Revise (Step 6). `complete` is the only irreversible
-- state; admin override only (v1.5+) to unwind.
--
-- IF NOT EXISTS makes the migration re-runnable without error.

ALTER TYPE "public"."quote_status" ADD VALUE IF NOT EXISTS 'complete';
