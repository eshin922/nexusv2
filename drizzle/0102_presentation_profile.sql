-- G4 · the customer presentation profile, and the customer note's freeze.
--
-- ── CLASSIFICATION: ADDITIVE ────────────────────────────────────────────
--
-- Two new tables and one new nullable column. No SET NOT NULL, no CHECK over
-- existing data, no narrowing, nothing dropped. Every currently deployed
-- writer keeps working untouched, so this may land before the code that reads
-- it and needs no deployed-writer compatibility proof.
--
-- That classification is the whole reason this file is safe on a database dev
-- and prod share. The CHECK below is on a table that does not exist yet and
-- therefore has no rows to violate it — a constraint on new data, not a
-- tightening of old.
--
-- ── WHAT THIS RECORDS, AND WHAT IT DELIBERATELY DOES NOT ────────────────
--
-- What the operator has decided the customer will SEE. Not what the quote
-- costs, not what it recommends, not what it says.
--
-- Four authorities described this record differently and the disposition
-- (docs/g4-presentation-profile-disposition.md) split them by what KIND of
-- fact each one is:
--
--   recommendation  ->  quote_tiers.recommended        (a quote fact)
--   note content    ->  quotes.customer_facing_notes   (a quote fact)
--   visibility, itemization, layout, shape  ->  here   (presentation facts)
--
-- The §0.5 pass caught both quote facts before any DDL was written
-- (docs/g4-schema-verification.md). `quote_tiers.recommended` already existed
-- with its own audit trail. `quotes.customer_facing_notes` already existed,
-- was already authored on Setup, and already printed verbatim above How to
-- accept — so a `customer_note` column here would have given one printed
-- sentence two owners and two authoring surfaces, with nothing in the schema
-- saying which one the customer receives.
--
-- So there is no recommendation column and no note text column. `include_note`
-- decides whether the note PRINTS; `quotes.customer_facing_notes` remains the
-- only place it is written. The schema is the enforcement.
--
-- ── ENUMS: REUSED, NOT MINTED ───────────────────────────────────────────
--
-- `pdf_layout` and `detail_level` already exist and are already used by
-- quotes.*_snapshot and quote_snapshots. Referencing them keeps one vocabulary
-- with one spelling; a parallel `presentation_layout` would be the same
-- divergence this record exists to prevent, one level down.

CREATE TABLE IF NOT EXISTS "presentation_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  -- Keyed per VERSION because reviseQuote bumps version_number on the SAME
  -- quotes row. Without the version in the key a revision would inherit
  -- nothing and the surface would fall back to defaults — an operator
  -- revising a sent quote would silently lose every presentation choice the
  -- customer has already seen.
  "quote_version" integer NOT NULL,
  "layout" "pdf_layout" DEFAULT 'tier_table' NOT NULL,
  "detail_level" "detail_level" DEFAULT 'itemized' NOT NULL,
  -- SET NULL, not CASCADE: deleting a tier must not delete the presentation
  -- record for the entire quote.
  "presented_tier_id" uuid REFERENCES "quote_tiers"("id") ON DELETE SET NULL,
  -- Disclosure, never economics. `include_fee_lines = false` collapses the
  -- ITEMIZATION and never removes the charge — the fold sentence still states
  -- the total. "Hide the fee lines" and "omit the fees" are one edit apart and
  -- the second is a customer-facing misstatement.
  "include_fee_lines" boolean DEFAULT true NOT NULL,
  "include_terms" boolean DEFAULT true NOT NULL,
  "include_addendum" boolean DEFAULT false NOT NULL,
  "include_note" boolean DEFAULT true NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Required iff single_tier. Enforced rather than remembered: a single-tier
  -- layout with no presented tier is a document with no prices on it.
  CONSTRAINT "presentation_profile_presented_tier_required"
    CHECK ("layout" <> 'single_tier' OR "presented_tier_id" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "presentation_profile_quote_version_idx"
  ON "presentation_profile" ("quote_id", "quote_version");

-- "Tiers shown" — the one presentation fact the reference's Card 2 needs that
-- no existing column carries. Per-tier because that is what the control is: a
-- toggle per tier, not a count and not a range.
--
-- ABSENCE MEANS SHOWN. A tier with no row here is presented, so adding a tier
-- to a quote can never silently hide it from a customer.
CREATE TABLE IF NOT EXISTS "presentation_profile_tier" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "quote_version" integer NOT NULL,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE CASCADE,
  "shown" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "presentation_profile_tier_idx"
  ON "presentation_profile_tier" ("quote_id", "quote_version", "tier_id");

-- ── M2 · the customer note joins the send snapshot ──────────────────────
--
-- It was the only customer-facing text read LIVE on a sent quote. Payment
-- terms, lead time, incoterms and T&Cs all resolve `isSent ? snapshot : live`
-- and are all captured here; the note was not, and nothing captured it
-- anywhere. So editing it after send changed what an already-sent quote said —
-- the customer holds one document and Nexus reports another, with nothing
-- failing and nothing warning.
--
-- Nullable and backfilled below. `quotes.customer_facing_notes` remains the
-- single authored owner; this is the frozen copy, never a second author.
ALTER TABLE "quote_snapshots"
  ADD COLUMN IF NOT EXISTS "customer_facing_notes" text;

-- Existing snapshots: adopt the quote's current note as the frozen value.
--
-- This is the honest choice among imperfect ones. The note was never captured,
-- so what these quotes were SENT with is not recoverable from the database —
-- and inventing a value would be worse than adopting the only one that exists.
-- It changes nothing about what these quotes currently render: they read the
-- live note today, and after this they read a copy of that same live note.
--
-- From here forward the value is captured at send and stops following edits,
-- which is the point.
UPDATE "quote_snapshots" s
   SET "customer_facing_notes" = q."customer_facing_notes"
  FROM "quotes" q
 WHERE q."id" = s."quote_id"
   AND s."customer_facing_notes" IS NULL;

-- ── Backfill: one profile per quote, at today's EFFECTIVE behaviour ─────
--
-- Defaults are chosen so no quote's document changes on the day this lands.
-- The three render axes come from the quote's own snapshot columns, which are
-- exactly what the resolver falls back to today; the include-* flags take the
-- values that reproduce current rendering, where every block is shown and the
-- addendum follows the quote's existing setting.
--
-- Keyed to each quote's CURRENT version_number: prior versions are closed
-- records and are not given profiles retroactively.
-- ── The single-tier case, found by dry-running this file ────────────────
--
-- One production quote carries `pdf_layout = 'single_tier'` and has NO
-- recommended tier. A naive backfill of its layout violated the CHECK above
-- and would have failed this migration in production.
--
-- The resolver is what settles the value. A single-tier document shows the
-- RECOMMENDED tier — `singleTier && recommendedTierIdx !== null ? [that] :
-- every tier` — so a single_tier quote with no recommendation renders ALL
-- tiers today. It is single-tier in the column and tier-table on the page.
--
-- So the backfill records what the document DOES, which is also the only
-- value that changes nothing:
--
--   single_tier + a recommended tier  ->  single_tier, presenting that tier
--   single_tier + no recommendation   ->  tier_table  (what it renders)
--   anything else                     ->  its own layout
--
-- `quotes.pdf_layout` is not touched. This records the presentation fact; that
-- column remains whatever it was.
INSERT INTO "presentation_profile" (
  "quote_id", "quote_version", "layout", "presented_tier_id", "detail_level",
  "include_fee_lines", "include_terms", "include_addendum", "include_note"
)
SELECT q."id",
       q."version_number",
       CASE WHEN q."pdf_layout" = 'single_tier' AND rec."id" IS NULL
            THEN 'tier_table'::"pdf_layout"
            ELSE COALESCE(q."pdf_layout", 'tier_table')
       END,
       CASE WHEN q."pdf_layout" = 'single_tier' THEN rec."id" ELSE NULL END,
       COALESCE(q."detail_level", 'itemized'),
       true,
       true,
       COALESCE(q."include_spec_addendum", false),
       true
  FROM "quotes" q
  LEFT JOIN LATERAL (
    SELECT t."id" FROM "quote_tiers" t
     WHERE t."quote_id" = q."id" AND t."recommended"
     ORDER BY t."sort_order" LIMIT 1
  ) rec ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM "presentation_profile" p
    WHERE p."quote_id" = q."id" AND p."quote_version" = q."version_number"
 );

-- Per-tier rows are NOT backfilled, deliberately. Absence means shown, so
-- every existing tier is already presented and writing rows to say so would
-- add 4-6 rows per quote to state the default. Rows appear when an operator
-- first hides a tier, which is when the fact stops being the default.
