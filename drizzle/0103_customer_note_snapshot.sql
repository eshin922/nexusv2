-- M2, second half · the column the RESOLVER reads.
--
-- ── WHY 0102 WAS NOT ENOUGH, AND HOW THE GAP HAPPENED ───────────────────
--
-- Nexus freezes sent-quote facts in TWO places, and they carry the same facts:
--
--   quotes.*_snapshot        payment_terms_snapshot, lead_time_snapshot,
--                            incoterms_snapshot, tcs_snapshot, the render axes
--                            — this is what `customer-view-resolver` reads on
--                            its `isSent` branch
--
--   quote_snapshots.*        tcs, payment_terms, lead_time, incoterms, the
--                            render axes — the VERSIONED record, closed and
--                            superseded as revisions happen
--
-- `sendQuote` writes both. The duplication predates this work and is not being
-- resolved here.
--
-- 0102 added `quote_snapshots.customer_facing_notes` — the versioned record —
-- and stopped there. So the note was frozen in the store nothing reads on the
-- render path, and a sent quote would have gone on following live edits
-- exactly as before: the defect closed on paper and open in the document.
--
-- The §0.5 pass verified that `quote_snapshots` lacked the column and that the
-- freeze list lacked the note. It did not verify WHICH of the two stores the
-- resolver reads. Checking that a store is missing a column is not the same
-- check as establishing that it is the store being read — the same shape of
-- miss as auditing the table being altered instead of the tables referencing
-- it.
--
-- ── CLASSIFICATION: ADDITIVE ────────────────────────────────────────────
--
-- One nullable column, backfilled. No tightening, nothing dropped, no
-- deployed-writer proof required.

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "customer_facing_notes_snapshot" text;

-- Backfill sent-and-later quotes from the live note, for the same reason 0102
-- backfilled the versioned record: what they were actually sent with is not
-- recoverable, the live note is the only value that exists, and adopting it
-- changes nothing about what they render today. Drafts stay NULL — they read
-- live by design, and a draft with a frozen note would be the inverse defect.
UPDATE "quotes"
   SET "customer_facing_notes_snapshot" = "customer_facing_notes"
 WHERE "status" <> 'draft'
   AND "customer_facing_notes_snapshot" IS NULL;
