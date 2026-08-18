-- Stage 3 A · Production ownership XOR, and the guards that must ship with it.
--
-- `assembly_production_inputs` may be owned by exactly one of:
--   • an Item Group (assembly), as today; or
--   • a top-level Direct Service quote leaf.
--
-- ── WHY THE GUARDS ARE IN THE SAME MIGRATION ──────────────────────────────
--
-- Today "a Direct Product cannot own Production economics" is FREE: the column
-- is `NOT NULL REFERENCES assemblies`, so a leaf cannot be named at all. This
-- migration relaxes that, which makes a leaf owner LEGAL — and the BV-012 §1.b
-- rule then has nothing holding it up.
--
-- Shipping the relaxation first would leave a window in which the database
-- accepts Production economics on a folding carton. Pattern 56: a property
-- that held only because nothing could express its violation.
--
-- ── DECLARATIVE, NOT A CONSTRAINT TRIGGER ─────────────────────────────────
--
-- OD-017 is the reason. A constraint trigger on a REFERENCING table silently
-- refused a write the action layer permitted, and the pre-migration probe
-- missed it because it only checked triggers on the table being altered.
-- Declarative constraints are visible in \d, enforced by the planner, and
-- cannot be conditionally skipped.
--
-- The identity predicate is two hops — production row → quote_leaves.leaf_id →
-- leaves.commercial_kind — which a plain CHECK cannot cross. So the kind is
-- denormalised one hop onto `quote_leaves` and the constraint becomes a
-- composite foreign key. `quote_leaves_assembly_quote_fk` already uses exactly
-- this shape for (assembly_id, quote_id), so the pattern is not novel here.
--
-- ── WHY DENORMALISATION IS SAFE HERE ──────────────────────────────────────
--
-- Because `leaves.commercial_kind` is an IDENTITY, not an attribute: a product
-- does not become a service. Rather than rely on that being true in practice,
-- step 2 makes it true by construction — the column cannot be updated at all.
-- With the source frozen and the copy under a composite FK, the two cannot
-- drift in either direction.
--
-- ── PRE-MIGRATION CENSUS (run against the shared database) ────────────────
--
--   assembly_production_inputs rows ................. 90
--   ... with assembly_id NULL ....................... 0     (XOR satisfied)
--   quotes carrying Production ...................... 20
--   assembly_leaves whose leaf is a service ......... 0     (FK satisfied)
--   quote_leaves rows ............................... 174
--   leaves: product 1082 / service 5
--
-- Every tightening step below is satisfied by every existing row. The census
-- is recorded because `0066` shipped on a model-level `.notNull()` that was a
-- declaration rather than a runtime check — true and untrue simultaneously.

-- ─────────────────────────────────────────────────────────────────────────
-- 1 · leaves: make (id, commercial_kind) referenceable
-- ─────────────────────────────────────────────────────────────────────────
-- `id` is already the primary key, so this adds no new uniqueness. It exists
-- only so the pair can be the target of a composite foreign key.

ALTER TABLE "leaves"
  ADD CONSTRAINT "leaves_id_commercial_kind_key" UNIQUE ("id", "commercial_kind");

-- ─────────────────────────────────────────────────────────────────────────
-- 2 · leaves.commercial_kind is immutable
-- ─────────────────────────────────────────────────────────────────────────
-- What a library entry may be SOLD AS is its identity. A product that became a
-- service would silently invalidate every denormalised copy below, and would
-- also retroactively change the meaning of quotes that already attached it.
--
-- A trigger rather than a CHECK because the rule is about the TRANSITION, not
-- about any single row's value. Note this trigger fires on the table being
-- altered and REFUSES a specific transition — it is not the OD-017 hazard,
-- which was a guard on a referencing table silently rejecting a legitimate
-- write. Replacing a canonical record is a migration, not an operator action.

CREATE OR REPLACE FUNCTION "leaves_commercial_kind_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF NEW."commercial_kind" IS DISTINCT FROM OLD."commercial_kind" THEN
    RAISE EXCEPTION
      'leaves.commercial_kind is immutable (leaf %: % -> %). What an entry may be sold as is its identity; changing it would invalidate denormalised copies on quote_leaves and assembly_leaves and would retroactively change quotes that already attached it.',
      OLD."id", OLD."commercial_kind", NEW."commercial_kind";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "leaves_commercial_kind_immutable"
  BEFORE UPDATE OF "commercial_kind" ON "leaves"
  FOR EACH ROW EXECUTE FUNCTION "leaves_commercial_kind_is_immutable"();

-- ─────────────────────────────────────────────────────────────────────────
-- 3 · quote_leaves carries the kind, maintained by the database
-- ─────────────────────────────────────────────────────────────────────────
-- Added nullable, backfilled, auto-populated, THEN made NOT NULL. The order is
-- the point: a `NOT NULL` column that deployed writers do not populate is the
-- `0066` outage, where a model-level declaration was mistaken for a runtime
-- guarantee and every attach-product 500'd.
--
-- The populate trigger means NO WRITER HAS TO KNOW THIS COLUMN EXISTS —
-- deployed code, branch code, future code, or a manual INSERT. It derives the
-- value rather than refusing a write that omits it, so it cannot break a
-- caller; and combined with the composite FK the copy cannot disagree with
-- its source.

ALTER TABLE "quote_leaves"
  ADD COLUMN "commercial_kind" "leaf_commercial_kind";

UPDATE "quote_leaves" ql
   SET "commercial_kind" = l."commercial_kind"
  FROM "leaves" l
 WHERE l."id" = ql."leaf_id";

CREATE OR REPLACE FUNCTION "quote_leaves_sync_commercial_kind"()
RETURNS trigger AS $$
BEGIN
  SELECT l."commercial_kind" INTO NEW."commercial_kind"
    FROM "leaves" l WHERE l."id" = NEW."leaf_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quote_leaves_commercial_kind_sync"
  BEFORE INSERT OR UPDATE OF "leaf_id" ON "quote_leaves"
  FOR EACH ROW EXECUTE FUNCTION "quote_leaves_sync_commercial_kind"();

ALTER TABLE "quote_leaves"
  ALTER COLUMN "commercial_kind" SET NOT NULL;

ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_id_commercial_kind_key"
  UNIQUE ("id", "commercial_kind");

-- The copy cannot disagree with its source. Same shape as the existing
-- `quote_leaves_assembly_quote_fk`.
ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_leaf_kind_fk"
  FOREIGN KEY ("leaf_id", "commercial_kind")
  REFERENCES "leaves" ("id", "commercial_kind")
  ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────
-- 4 · an Item Group member must be a product — enforced by the database
-- ─────────────────────────────────────────────────────────────────────────
-- BV-012 §5.c was enforced only by the action gate. The gate stays, because it
-- produces the operator-facing sentence a constraint violation cannot, but the
-- database no longer depends on it.
--
-- GENERATED rather than DEFAULT + CHECK: a default can be overridden, so a
-- writer could still name 'service' and be refused only by the CHECK. A
-- generated column cannot be written AT ALL, so the constraint is not about
-- catching a bad value — the bad value is unrepresentable. (Verified against
-- this database before authoring: constant generation expressions are
-- supported, and a generated column may be a foreign-key referencing column
-- when the referenced pair carries a unique constraint.)

ALTER TABLE "assembly_leaves"
  ADD COLUMN "member_commercial_kind" "leaf_commercial_kind"
  GENERATED ALWAYS AS ('product'::"leaf_commercial_kind") STORED;

ALTER TABLE "assembly_leaves"
  ADD CONSTRAINT "assembly_leaves_member_is_product_fk"
  FOREIGN KEY ("leaf_id", "member_commercial_kind")
  REFERENCES "leaves" ("id", "commercial_kind")
  ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────
-- 5 · the XOR itself
-- ─────────────────────────────────────────────────────────────────────────
-- Migration 0077 established this shape for Client Target — a value owned by
-- either a group or a top-level direct unit. The addition here is that one
-- branch is restricted to a SERVICE leaf.

ALTER TABLE "assembly_production_inputs"
  ADD COLUMN "quote_leaf_id" uuid REFERENCES "quote_leaves"("id") ON DELETE CASCADE;

-- Derived, not supplied. `0066`'s defect was a writer omitting a column it was
-- declared to provide; a column no writer CAN provide has no such failure mode.
-- NULL for assembly-owned rows so the composite FK below (MATCH SIMPLE) is
-- inert for them, and 'service' exactly when a leaf owns the row.
ALTER TABLE "assembly_production_inputs"
  ADD COLUMN "owner_commercial_kind" "leaf_commercial_kind"
  GENERATED ALWAYS AS (
    CASE WHEN "quote_leaf_id" IS NULL THEN NULL
         ELSE 'service'::"leaf_commercial_kind" END
  ) STORED;

ALTER TABLE "assembly_production_inputs"
  ALTER COLUMN "assembly_id" DROP NOT NULL;

-- Exactly one owner. Every one of the 90 existing rows satisfies this: all
-- carry an assembly_id and none can yet carry a quote_leaf_id.
ALTER TABLE "assembly_production_inputs"
  ADD CONSTRAINT "assembly_production_inputs_owner_xor"
  CHECK (
    ("assembly_id" IS NOT NULL AND "quote_leaf_id" IS NULL)
    OR ("assembly_id" IS NULL AND "quote_leaf_id" IS NOT NULL)
  );

-- The leaf branch resolves ONLY to a service. A Direct Product's quote leaf
-- carries commercial_kind='product', so the pair ('<that leaf>', 'service')
-- has no referent and the insert is refused — BV-012 §1.b, enforced by the
-- planner rather than by convention.
ALTER TABLE "assembly_production_inputs"
  ADD CONSTRAINT "assembly_production_inputs_service_owner_fk"
  FOREIGN KEY ("quote_leaf_id", "owner_commercial_kind")
  REFERENCES "quote_leaves" ("id", "commercial_kind")
  ON DELETE CASCADE;

CREATE INDEX "assembly_production_inputs_quote_leaf_idx"
  ON "assembly_production_inputs" ("quote_leaf_id")
  WHERE "quote_leaf_id" IS NOT NULL;

COMMENT ON COLUMN "assembly_production_inputs"."quote_leaf_id" IS
  'Owner when Production belongs to a top-level Direct Service. Mutually exclusive with assembly_id (assembly_production_inputs_owner_xor). Restricted to service-classified leaves by the composite FK on (quote_leaf_id, owner_commercial_kind).';

COMMENT ON COLUMN "assembly_production_inputs"."owner_commercial_kind" IS
  'Derived, never written. Exists so the leaf-owner branch can be constrained to service leaves by a composite FK. A generated column cannot be set by any writer, so a wrong value is unrepresentable rather than merely checked.';

COMMENT ON COLUMN "quote_leaves"."commercial_kind" IS
  'Denormalised from leaves.commercial_kind and maintained by quote_leaves_commercial_kind_sync. Safe because leaves.commercial_kind is immutable (leaves_commercial_kind_immutable) and this copy is held to its source by quote_leaves_leaf_kind_fk.';

COMMENT ON COLUMN "assembly_leaves"."member_commercial_kind" IS
  'Always product, generated. Exists so assembly_leaves_member_is_product_fk can assert BV-012 s5.c at the database: a service-classified entry may never be an Item Group member.';
