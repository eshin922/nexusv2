-- A revision on the handoff row, so a stale screen cannot act on a state it
-- never displayed.
--
-- ADDITIVE AND SAFE AHEAD OF CODE: one NOT NULL column WITH a default, which
-- Postgres applies without rewriting the table and without requiring anything
-- of existing writers. Deployed code inserts handoffs without naming this
-- column and keeps working; the default supplies it.
--
-- ── WHY ID AND STATUS WERE NOT ENOUGH ────────────────────────────────────
--
-- Completion and reopening move the SAME row back and forth:
--
--   open ──complete──> completed ──reopen──> open ──complete──> completed
--
-- Every update was conditioned on `(id, status)`, and both completed states
-- above answer to exactly that. A screen showing the FIRST completion, left
-- open while logistics reopened and finished the work again, would match on
-- the second one and reopen a completion it never saw. The operator would be
-- reversing someone else's decision believing they were reversing their own,
-- and nothing in the row could tell the two apart -- they are genuinely
-- identical in id and in status.
--
-- A revision distinguishes them because it is the one thing that does not come
-- back: every state change increments it, so "the completed state I was
-- looking at" has a name that a later completed state cannot borrow.
--
-- ── WHY `production_completions` DOES NOT NEED ONE ───────────────────────
--
-- It never reuses a row. Reopening marks the record `reopened` and completing
-- again INSERTS a new one, so each completion has an id no later completion
-- can hold. The id is already the revision. Adding a column there would be
-- ceremony around a guarantee the shape already gives.

ALTER TABLE "freight_handoffs"
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN "freight_handoffs"."revision" IS
  'Incremented by every state change. Callers pass the revision they displayed; '
  'an update whose revision no longer matches is refused as a stale write.';
