-- #431 Step 2 + 3 · source the customer's contact and address, and freeze them.
--
-- ── CONTACT SELECTION IS RECORDED, NOT JUST APPLIED ─────────────────────
--
-- The governed V1 rule:
--
--   explicit HubSpot primary contact          -> use it
--   exactly one associated contact            -> use it
--   zero associated contacts                  -> blank
--   several, with no explicit primary         -> blank
--
-- First-association, most-recently-modified and every other ordering
-- heuristic are excluded. They are technical ordering rules wearing business
-- intent, and the cost of being wrong is a named individual printed on a
-- customer-facing quotation on the strength of a sort order.
--
-- `customer_contact_selection` records WHICH branch fired. Without it a blank
-- contact is ambiguous — "nobody is associated" and "several are associated and
-- none is primary" are different facts about the CRM, and only one of them is
-- something an operator can fix. A NULL name with no reason is the shape that
-- makes people guess.
--
-- ── COMPANY SELECTION HAS ONE RULE NOW ──────────────────────────────────
--
-- `fetchCompanyIdsForDeals` took `to[0]` — first association wins. Verified
-- against the live API: deal->companies genuinely defines `typeId 5, label
-- "Primary"`, so an explicit primary exists and the first row was only ever
-- coincidentally right. The reader now selects typeId 5. Same rule, one place.
--
-- (deal->contacts, by contrast, defines exactly ONE type: `typeId 3, label
-- null`. HubSpot publishes no primary-contact association for deals in this
-- portal, which is why the sole-contact branch above carries the real weight.)
--
-- ── FREEZE DISCIPLINE, UNCHANGED FROM 0105 ──────────────────────────────
--
-- Drafts read the currently sourced identity; Finalize freezes the resolved
-- block; sent quotes read frozen. Both stores again — `quotes.*_snapshot` is
-- what the resolver reads, `quote_snapshots.*` is the versioned record.
--
-- ── NO BACKFILL, DELIBERATELY ───────────────────────────────────────────
--
-- 0105 backfilled the customer NAME because the live project name was the only
-- value that existed and adopting it changed nothing about what those quotes
-- already rendered. These are different: nothing was ever sourced, so there is
-- no prior value to adopt. Writing today's HubSpot contact onto a quote sent
-- last month would assert that it was addressed to that person, which is not
-- true. They stay NULL and render as absent.
--
-- ── CLASSIFICATION: ADDITIVE ────────────────────────────────────────────
--
-- Nullable columns only. No tightening, nothing dropped, no deployed-writer
-- proof required.

-- Sourced identity, cached alongside the rest of the deal's HubSpot lineage.
ALTER TABLE "hubspot_deals_cache"
  ADD COLUMN IF NOT EXISTS "company_address_line1" text,
  ADD COLUMN IF NOT EXISTS "company_address_line2" text,
  ADD COLUMN IF NOT EXISTS "company_city" text,
  ADD COLUMN IF NOT EXISTS "company_state" text,
  ADD COLUMN IF NOT EXISTS "company_postal_code" text,
  ADD COLUMN IF NOT EXISTS "company_country" text,
  ADD COLUMN IF NOT EXISTS "customer_contact_id" text,
  ADD COLUMN IF NOT EXISTS "customer_contact_name" text,
  ADD COLUMN IF NOT EXISTS "customer_contact_email" text,
  ADD COLUMN IF NOT EXISTS "customer_contact_title" text,
  -- 'primary' | 'sole' | 'none_zero' | 'none_multiple' | 'unresolved'
  ADD COLUMN IF NOT EXISTS "customer_contact_selection" text;

-- The read path the resolver uses on its isSent branch.
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "customer_contact_snapshot" text,
  ADD COLUMN IF NOT EXISTS "customer_role_snapshot" text,
  ADD COLUMN IF NOT EXISTS "customer_address_snapshot" text;

-- The versioned record.
ALTER TABLE "quote_snapshots"
  ADD COLUMN IF NOT EXISTS "customer_contact" text,
  ADD COLUMN IF NOT EXISTS "customer_role" text,
  ADD COLUMN IF NOT EXISTS "customer_address" text;
