-- The frozen accepted commercial line set.
--
-- ADDITIVE. Two new tables and two enums. Nothing existing is altered.
--
-- ── WHAT WAS MISSING ──────────────────────────────────────────────────────
--
-- Nothing priced was frozen. `quote_snapshots` held commercial terms, the PDF
-- axes and `pdf_url`; every figure NetSuite received was RECOMPUTED at push
-- time from a live costing bundle, and reproduced the accepted quote only
-- because draft-lock prevents cost edits and the commercial pin holds the
-- rate.
--
-- That is a convention. REG-4's claim — lines sum exactly to the accepted
-- commercial total — was therefore a claim about a recomputation rather than
-- about a record.
--
-- ── TWO CHECKPOINTS, ONE NUMBER ───────────────────────────────────────────
--
-- SEND freezes the complete customer-facing line x tier MATRIX: at send no
-- tier has been chosen, but a finalised artifact showing every tier exists,
-- and that is what must be reproducible.
--
-- ACCEPT does not compute anything. It SELECTS:
--
--   accepted commercial total := tier_commercial_total
--                                WHERE tier_id = quotes.customer_accepted_tier_id
--
-- Hence `tier_commercial_total` and not `accepted_commercial_total`: at send
-- nothing has been accepted, and after acceptance three of four tiers still
-- have not been. There is one number, read twice, so the accepted figure
-- cannot drift from the offered one.
--
-- Hung off `quote_snapshots`, which is already per-send and per-version, so a
-- v2 revision produces a new matrix and the superseded one stays intact.

CREATE TYPE "commercial_line_kind" AS ENUM (
  'item_group_member',
  'direct_product',
  'direct_service',
  'otc'
);

-- Priced or not, stated rather than inferred. See the CHECK below.
CREATE TYPE "commercial_pricing_state" AS ENUM ('priced', 'quote_on_request');

CREATE TYPE "commercial_allocation_state" AS ENUM ('allocated', 'separately_billed');

CREATE TABLE "quote_snapshot_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_snapshot_id" uuid NOT NULL
    REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "line_kind" "commercial_line_kind" NOT NULL,
  -- The Item Group this line belongs to. NULL for top-level lines: a Direct
  -- Product, a Direct Service, or an OTC charge attributed to the quote.
  "owning_assembly_id" uuid,
  "quote_leaf_id" uuid,
  -- AS PRINTED, not re-resolved. A library rename after send must not change
  -- what a sent quote says it sold — the same reasoning that made
  -- prepared_by_name_snapshot a snapshot column rather than a join.
  "display_name" text NOT NULL,
  "display_sku" text,
  "service_identity" "direct_service_identity",
  -- Destination identity WHERE ALREADY GOVERNED. NULL is not a defect: eleven
  -- of BV-011's sixteen destinations have no mapping yet, and F1/F4 scoped
  -- projection to those that do.
  "netsuite_item_id" text,
  "position" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- A service line is top-level by definition (BV-012 s5.c). Asserted here
  -- too because this table outlives the runtime that produced it.
  CONSTRAINT "qsl_service_is_top_level"
    CHECK ("line_kind" <> 'direct_service' OR "owning_assembly_id" IS NULL)
);

CREATE INDEX "qsl_snapshot_idx" ON "quote_snapshot_lines" ("quote_snapshot_id", "position");

CREATE TABLE "quote_snapshot_line_tiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_snapshot_line_id" uuid NOT NULL
    REFERENCES "quote_snapshot_lines"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL,
  -- Label as shown, for the same reason display_name is stored: a later tier
  -- edit must not rewrite what the customer was quoted.
  "tier_label" text NOT NULL,
  -- THIS LINE's quantity at this tier, not the tier's own — the tier's lives on
  -- quote_snapshot_tier_totals. They differ: a one-time fee is quantity 1 at
  -- every tier, and storing the tier's put a $140 charge on record as 1,000
  -- units. unit_rate x quantity = line_amount holds by construction, which is
  -- what lets REG-4 check NetSuite's own multiplication.
  "quantity" integer,
  "pricing_state" "commercial_pricing_state" NOT NULL,
  "unit_rate" numeric(14, 4),
  "line_amount" numeric(14, 2),
  "allocation_state" "commercial_allocation_state",
  -- The unpriced requirement, structural.
  --
  -- A nullable rate ALONE would repeat the OD-027 ambiguity: "no price" and
  -- "we failed to compute one" would be the same value, and a later reader
  -- could not tell which. The biconditional means an unpriced cell is a
  -- statement, and a priced cell cannot be half-written.
  CONSTRAINT "qslt_priced_iff_amounts"
    CHECK (
      ("pricing_state" = 'priced')
      = ("unit_rate" IS NOT NULL AND "line_amount" IS NOT NULL)
    ),
  CONSTRAINT "qslt_line_tier_unique" UNIQUE ("quote_snapshot_line_id", "tier_id")
);

CREATE INDEX "qslt_by_line" ON "quote_snapshot_line_tiers" ("quote_snapshot_line_id");

-- Per-tier totals on the snapshot itself.
CREATE TABLE "quote_snapshot_tier_totals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_snapshot_id" uuid NOT NULL
    REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL,
  "tier_label" text NOT NULL,
  "quantity" integer,
  "unit_subtotal" numeric(14, 2) NOT NULL,
  "otc_subtotal" numeric(14, 2) NOT NULL,
  "tier_commercial_total" numeric(14, 2) NOT NULL,
  -- Reproduces the PDF's "from" semantics. STORED rather than derived from
  -- "does any line say quote_on_request", because the rule deciding when a
  -- total is provisional is presentation policy and may change. The artifact
  -- must reproduce what the customer was shown, not what a later rule would
  -- produce from the same lines.
  "total_is_provisional" boolean NOT NULL,
  CONSTRAINT "qstt_total_is_sum"
    CHECK ("tier_commercial_total" = "unit_subtotal" + "otc_subtotal"),
  CONSTRAINT "qstt_snapshot_tier_unique" UNIQUE ("quote_snapshot_id", "tier_id")
);

COMMENT ON COLUMN "quote_snapshot_tier_totals"."tier_commercial_total" IS
  'What was OFFERED at this tier. NOT the accepted total — at send nothing is accepted, and after acceptance three of four tiers still are not. The accepted commercial total is a SELECTION: this column for quotes.customer_accepted_tier_id.';

COMMENT ON TABLE "quote_snapshot_lines" IS
  'The frozen customer-facing line set, per send. With quote_snapshot_line_tiers this is the source of truth for REG-4 and for NetSuite projection — never a later getCostingBundle recomputation.';
