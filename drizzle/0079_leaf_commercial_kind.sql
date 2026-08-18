-- Product Library commercial classification: product vs Direct Service.
--
-- ADDITIVE ONLY. Two new enums, two new columns, one CHECK over the new
-- columns. Nothing existing is tightened or dropped, so this is safe to apply
-- ahead of the code that reads it, per the deployment-order rule in CLAUDE.md.
-- `commercial_kind` defaults to 'product', so every existing row and every
-- deployed writer keeps its current meaning without being touched.
--
-- ── WHY A NEW COLUMN, GIVEN STEP 9 ────────────────────────────────────────
--
-- Step 9 REMOVED `leaves.product_type_id` precisely to avoid "two authorities
-- for one question", leaving `hubspot_product_type` as the only leaf
-- classification. Adding a classification back needs to answer that.
--
-- It is a DIFFERENT question:
--
--   `hubspot_product_type`  what KIND OF THING this is, physically — an
--                           upstream vendor taxonomy (Primary, Secondary,
--                           Third Party Logistics) from which Nexus DERIVES
--                           which specification fields apply.
--
--   `commercial_kind`       what this may be SOLD AS, and therefore how it may
--                           attach. A Nexus governed statement, not a
--                           description of the object.
--
-- Three reasons the HubSpot field cannot carry it, any one of which is
-- sufficient:
--
--   1. A Direct Service may be Nexus-authored with no HubSpot record at all
--      (`hubspot_product_id` is nullable), so the field is absent exactly where
--      the classification is needed most.
--   2. HubSpot owns that vocabulary and may add options at any time. A
--      commercial rule that changes when a vendor edits a dropdown is not a
--      governed rule.
--   3. BV-012 §5.f forbids deriving service identity from it, from
--      `product_types.scope` (which is placement: assembly vs leaf), from the
--      legacy `Service / labor` type, from the presence of Production values,
--      or from attachment position.
--
-- ── THE CLOSED VOCABULARY ─────────────────────────────────────────────────
--
-- Five identities, per BV-012 §5.f. An enum rather than free text BECAUSE it
-- is closed: BV-011's other destinations (Setup, Tooling, Artwork, Dies, Print
-- Plates, Samples, Processing Fee, Freight/Duties/Tariffs, Customs, Cartons,
-- Bulk Raw) are deliberately NOT sellable as Direct Services, and adding one
-- should require saying so in a migration rather than passing a new string.
--
-- Note the contrast with `hubspot_product_type`, which is deliberately text for
-- the opposite reason: that vocabulary is owned upstream and open. This one is
-- owned here and closed.
--
-- ── NO BACKFILL ───────────────────────────────────────────────────────────
--
-- Nothing is classified as a service by this migration. In particular the
-- legacy `Service / labor` product type is NOT swept into `commercial_kind =
-- 'service'`: that type is a migration bucket, not evidence that an entry is a
-- sellable service. Any classification of existing data is separately
-- evidenced and separately dispositioned.

CREATE TYPE "leaf_commercial_kind" AS ENUM ('product', 'service');

CREATE TYPE "direct_service_identity" AS ENUM (
  'formulation',
  'filling_blending',
  'packout_assembly',
  'testing_micros',
  'other_service'
);

ALTER TABLE "leaves"
  ADD COLUMN "commercial_kind" "leaf_commercial_kind" NOT NULL DEFAULT 'product';

ALTER TABLE "leaves"
  ADD COLUMN "service_identity" "direct_service_identity";

-- Biconditional, not two one-way checks: a service MUST name which service,
-- and a product must NOT name one. Either half alone would permit a row that
-- claims to be a service without saying which, or a product carrying a service
-- identity nothing reads — both of which are states a later reader would have
-- to guess about.
ALTER TABLE "leaves"
  ADD CONSTRAINT "leaves_service_identity_matches_kind"
  CHECK (("commercial_kind" = 'service') = ("service_identity" IS NOT NULL));

-- Library browse filters and the attachment gate both ask "is this a service".
CREATE INDEX "leaves_commercial_kind_idx"
  ON "leaves" ("commercial_kind") WHERE "archived" = false;

COMMENT ON COLUMN "leaves"."commercial_kind" IS
  'What this library entry may be SOLD AS. Nexus-governed; distinct from hubspot_product_type, which is an upstream taxonomy describing what the thing physically is. A service entry may be sold as a top-level Direct Service and may NOT be attached as an Item Group member (BV-012 s5.c).';

COMMENT ON COLUMN "leaves"."service_identity" IS
  'Which of the five governed Direct Service identities (BV-012 s5.f). NOT NULL exactly when commercial_kind = service. Determines which Production input the Costs surface exposes.';
