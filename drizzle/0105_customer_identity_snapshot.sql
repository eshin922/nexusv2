-- #431 Step 1 · freeze the customer's identity on the sent read model.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────
--
-- `quote_snapshots` freezes `prepared_by_name` / `_email` / `_phone` — the
-- SELLER. It captures no customer identity at all, not even the company name.
-- So a sent quote's PREPARED FOR block reads `projects.client_name` LIVE:
-- rename the company in HubSpot, re-import, and a quote that was sent weeks ago
-- re-renders addressed to a different customer.
--
-- The stored PDF is safe — an immutable file in Storage. The read model is not,
-- and it is what every internal surface, audit query and cross-quote comparison
-- actually reads. This is the Pattern 52 shape, already true today with one
-- field.
--
-- ── BOTH STORES, DELIBERATELY ───────────────────────────────────────────
--
-- Nexus freezes sent-quote facts in two places (see 0103 for the full account):
--
--   quotes.*_snapshot     what `customer-view-resolver` reads on its `isSent`
--                         branch — the RENDER path
--   quote_snapshots.*     the VERSIONED record, superseded as revisions happen
--
-- 0102 added a column to the versioned record only, and the defect stayed open
-- in the document while closing on paper. 0103 recorded the lesson: verifying
-- that a store LACKS a column is not the same check as establishing that it is
-- the store being READ. Both get the column here, and `sendQuote` writes both.
--
-- ── SCOPE ───────────────────────────────────────────────────────────────
--
-- The customer NAME only. It is the one customer-identity fact Nexus holds
-- today: contact, role and address have never existed in the schema (verified
-- across the full migration history — the only `customer_contact` is on
-- `freight_customer_arranges_meta`, a freight-leg field). They arrive with the
-- HubSpot Companies/Contacts source in Step 2 and are frozen in Step 3; adding
-- permanently-NULL columns for them now would be speculative.
--
-- ── CLASSIFICATION: ADDITIVE ────────────────────────────────────────────
--
-- Two nullable columns, backfilled. No tightening, nothing dropped, no
-- deployed-writer proof required.

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "customer_name_snapshot" text;

ALTER TABLE "quote_snapshots"
  ADD COLUMN IF NOT EXISTS "customer_name" text;

-- Backfill sent-and-later quotes from the live project name, on 0103's
-- reasoning: what they were actually sent with is not recoverable, the live
-- value is the only one that exists, and adopting it changes nothing about what
-- they render today — it only stops them drifting tomorrow.
--
-- Drafts stay NULL. They read live by design, and a draft with a frozen
-- customer name would be the inverse defect.
UPDATE "quotes" q
   SET "customer_name_snapshot" = p."client_name"
  FROM "projects" p
 WHERE p."id" = q."project_id"
   AND q."status" <> 'draft'
   AND q."customer_name_snapshot" IS NULL;

UPDATE "quote_snapshots" s
   SET "customer_name" = p."client_name"
  FROM "quotes" q
  JOIN "projects" p ON p."id" = q."project_id"
 WHERE q."id" = s."quote_id"
   AND s."customer_name" IS NULL;
