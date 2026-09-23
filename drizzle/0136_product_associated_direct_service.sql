-- A Direct Service may be associated with the Direct Product it serves.
--
-- ── WHAT THIS ENABLES ─────────────────────────────────────────────────────
--
-- Two products on one quote may each carry their own Filling / Blending,
-- Pack-out / Assembly or Testing / Micros service. The five canonical service
-- library leaves stay unique (`leaves_service_identity_unique_idx`), so the
-- only way to express "Product A's filling" and "Product B's filling" is two
-- `quote_leaves` rows of the SAME service leaf, told apart by the product each
-- one serves. That product is what this column records.
--
-- The service keeps its own quote leaf, its own quantity and its own
-- Production row (`assembly_production_inputs.quote_leaf_id`), so NetSuite
-- still receives a separate priced service line and the product's own line
-- carries none of the service amount. The association is attribution; it moves
-- no arithmetic (Pattern 58).
--
-- ── WHAT IS PRESERVED ─────────────────────────────────────────────────────
--
-- A standalone (unassociated) Direct Service stays one-per-quote. Until now
-- that was held only by the attach helper's duplicate check; step 4 makes it a
-- database invariant, because the helper's check is about to become
-- association-scoped and a scoped application check is exactly where a
-- regression would hide.
--
-- ── DECLARATIVE, SAME SHAPE AS 0082 ───────────────────────────────────────
--
-- The owner predicate — same quote, product-classified, top-level — crosses a
-- row boundary, so it is a composite foreign key onto `quote_leaves` itself.
-- The referencing-side kind and directness are GENERATED constants: a writer
-- cannot set them, so a wrong value is unrepresentable rather than refused.
-- NULL when there is no association, which keeps the FK (MATCH SIMPLE) inert
-- for every existing row.
--
-- ── CLASSIFICATION (deployment-order rule) ────────────────────────────────
--
--   quote_leaves.is_direct (generated)              additive
--   associated_product_quote_leaf_id (nullable)     additive; no deployed
--                                                   writer names it
--   generated referencing columns                   additive
--   UNIQUE (id, quote_id, commercial_kind, is_direct)
--                                                   adds no uniqueness (id is PK)
--   self CHECK + composite FK                       tightening, satisfied by
--                                                   every row: all are NULL
--   unassociated-service partial UNIQUE             tightening — deployed
--                                                   writers already refuse the
--                                                   duplicate (direct-attachment
--                                                   duplicate check); step 0
--                                                   refuses to proceed if the
--                                                   data disagrees
--
-- Deployed code never writes the new column and never reads it, so every
-- step is compatible with the currently deployed tree in both directions.

-- ─────────────────────────────────────────────────────────────────────────
-- 0 · census guard for the new uniqueness
-- ─────────────────────────────────────────────────────────────────────────
-- CREATE UNIQUE INDEX would fail on a duplicate anyway; this fails FIRST and
-- names the rows, so the repair is a decision rather than an investigation.

DO $$
DECLARE
  dup record;
BEGIN
  SELECT ql."quote_id", ql."leaf_id", count(*) AS n
    INTO dup
    FROM "quote_leaves" ql
   WHERE ql."assembly_id" IS NULL
     AND ql."commercial_kind" = 'service'
   GROUP BY ql."quote_id", ql."leaf_id"
  HAVING count(*) > 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      '0136: quote % carries % standalone attachments of service leaf %. Standalone Direct Services are one-per-quote; resolve the duplicate before applying.',
      dup."quote_id", dup.n, dup."leaf_id";
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1 · quote_leaves: make (id, quote_id, commercial_kind, is_direct)
--     referenceable
-- ─────────────────────────────────────────────────────────────────────────
-- `is_direct` is derived, never written. A product that later moves into an
-- Item Group changes it, and the NO ACTION foreign key below then refuses the
-- move while an associated service still points at it — the application
-- refuses first with a sentence; this is the backstop.

ALTER TABLE "quote_leaves"
  ADD COLUMN "is_direct" boolean
  GENERATED ALWAYS AS ("assembly_id" IS NULL) STORED;

ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_association_target_key"
  UNIQUE ("id", "quote_id", "commercial_kind", "is_direct");

-- ─────────────────────────────────────────────────────────────────────────
-- 2 · the association
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "quote_leaves"
  ADD COLUMN "associated_product_quote_leaf_id" uuid;

ALTER TABLE "quote_leaves"
  ADD COLUMN "associated_product_kind" "leaf_commercial_kind"
  GENERATED ALWAYS AS (
    CASE WHEN "associated_product_quote_leaf_id" IS NULL THEN NULL
         ELSE 'product'::"leaf_commercial_kind" END
  ) STORED;

ALTER TABLE "quote_leaves"
  ADD COLUMN "associated_product_is_direct" boolean
  GENERATED ALWAYS AS (
    CASE WHEN "associated_product_quote_leaf_id" IS NULL THEN NULL
         ELSE true END
  ) STORED;

-- Only a top-level SERVICE may name a product. A Direct Product naming another
-- product, or an Item Group member naming anything, is unrepresentable.
ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_association_owner_is_direct_service"
  CHECK (
    "associated_product_quote_leaf_id" IS NULL
    OR ("commercial_kind" = 'service' AND "assembly_id" IS NULL)
  );

-- The named product must be on the SAME quote (quote_id is in the key and is
-- NOT NULL on the referencing row), be a PRODUCT, and be top-level.
--
-- NO ACTION rather than CASCADE or RESTRICT:
--   • not CASCADE — removing a product must not silently destroy a priced
--     service and its Production economics; the detach helper refuses and
--     names the services instead.
--   • not RESTRICT — deleting a whole quote deletes both rows in one
--     statement, and only a check deferred to statement end sees that the
--     referencing row went too.
ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_associated_product_fk"
  FOREIGN KEY (
    "associated_product_quote_leaf_id",
    "quote_id",
    "associated_product_kind",
    "associated_product_is_direct"
  )
  REFERENCES "quote_leaves" ("id", "quote_id", "commercial_kind", "is_direct")
  ON DELETE NO ACTION;

-- ─────────────────────────────────────────────────────────────────────────
-- 3 · one service of each identity per product
-- ─────────────────────────────────────────────────────────────────────────
-- Service library leaves are one per identity, so (product, leaf) is
-- (product, identity). Also serves as the FK's referencing-side index.

CREATE UNIQUE INDEX "quote_leaves_product_service_unique_idx"
  ON "quote_leaves" ("associated_product_quote_leaf_id", "leaf_id")
  WHERE "associated_product_quote_leaf_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4 · a standalone Direct Service stays one-per-quote
-- ─────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "quote_leaves_standalone_service_unique_idx"
  ON "quote_leaves" ("quote_id", "leaf_id")
  WHERE "assembly_id" IS NULL
    AND "commercial_kind" = 'service'
    AND "associated_product_quote_leaf_id" IS NULL;

COMMENT ON COLUMN "quote_leaves"."associated_product_quote_leaf_id" IS
  'The Direct Product this Direct Service is performed for. NULL = standalone service (one per quote per service leaf). Set only on a top-level service row (quote_leaves_association_owner_is_direct_service); must name a top-level product on the same quote (quote_leaves_associated_product_fk). Attribution only: the service keeps its own Production row and its own NetSuite line.';
