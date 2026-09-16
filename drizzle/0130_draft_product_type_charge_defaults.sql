-- Product Type → charge defaults (DRAFT — intentionally absent from
-- drizzle/meta/_journal.json until the Settings design is approved).
--
-- NOT APPLIED, AND NOT SEEDED. The table ships empty by design: an unapproved
-- default rule is a business decision made by a migration, and no rule here
-- has been agreed. An empty table is the correct starting state, because
-- "no rule" means NEEDS REVIEW rather than "no charges apply" — see below.
--
-- ── WHAT THIS IS, AND WHAT IT MUST NOT BECOME ────────────────────────────
--
-- An admin-maintained relationship between an EXISTING HubSpot Product Type
-- value and an EXISTING supported charge identity. It introduces no new
-- vocabulary of its own, which is the line that keeps it from becoming a
-- second product taxonomy:
--
--   * `product_type_value` is not an enum and not a foreign key to anything
--     Nexus owns. It holds HubSpot's raw internal option value, and rows may
--     legitimately exist for values Nexus has not mapped yet. It is a
--     REFERENCE to someone else's vocabulary, never a definition of one.
--   * `charge_key` is CHECKed against the five component charge identities
--     that already exist in the governed registry. A row cannot invent a
--     charge.
--
-- Anything that would make this table the place where product categories are
-- decided -- a display name, a description, a parent, an ordering, a
-- hierarchy -- is deliberately absent and should stay absent.
--
-- ── WHAT IT DOES NOT DECIDE ──────────────────────────────────────────────
--
-- NOT a NetSuite posting mapping. Destination resolution stays in
-- `componentChargeDestination`; `other_service` and `otc_testing` keep
-- per-line item selection frozen at send; this table has no item column and
-- must never acquire one.
--
-- NOT the tooling classification. `tooling` may be SUGGESTED here, but mould
-- versus cutting die remains an explicit per-instance fact that refuses when
-- absent. There is deliberately no `tooling_classification` column: a default
-- would silently choose an accounting destination, which is the single thing
-- this design is forbidden to do.
--
-- NOT applied to a quote retroactively. A quote's charge instances are the
-- operator's own choices; editing a default here changes what a FUTURE quote
-- is offered and leaves every existing quote exactly as its operator left it.
-- That property lives in the reading code, which consults this table only when
-- composing suggestions for a component being added -- never when rendering
-- one already present.
--
-- ── MISSING RULE ≠ NO CHARGES ────────────────────────────────────────────
--
-- The absence of a row for a product type means NOBODY HAS SAID YET. The
-- reading surface must render that as "needs review" and must not present it
-- as "no charges apply", which is a finished answer nobody gave. This table
-- cannot enforce that distinction -- absence has no row to carry a flag -- so
-- it is stated here and belongs in the reader's contract and its tests.

CREATE TABLE IF NOT EXISTS "product_type_charge_defaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- HubSpot's raw internal option value, NOT its label. Three options diverge
  -- (`Primary Packaging` → `Primary`, `Secondary Packaging` → `Secondary`,
  -- `Logistics` → `Third Party Logistics`), so a label-keyed rule would miss
  -- roughly half the catalogue.
  "product_type_value" text NOT NULL,

  -- A component charge identity from the governed registry. CHECKed rather
  -- than free text: a rule naming a charge that does not exist is not a
  -- default, it is a typo that would suggest nothing forever.
  "charge_key" text NOT NULL,

  -- Whether the suggestion arrives ticked. Either way the operator confirms
  -- applicability before it becomes a charge -- preselection is a starting
  -- position, never an assertion that the charge applies.
  "preselected" boolean NOT NULL DEFAULT false,

  -- Why this rule exists, for the admin who inherits it.
  "note" text,

  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id"),

  CONSTRAINT "product_type_charge_defaults_charge_key_values" CHECK (
    "charge_key" IN ('print_plates', 'tooling', 'artwork_plate', 'samples', 'other_service')
  ),
  CONSTRAINT "product_type_charge_defaults_type_not_blank" CHECK (
    length(btrim("product_type_value")) > 0
  )
);

-- One rule per (type, charge). A second row for the same pair would be two
-- answers to one question, and nothing could say which was meant.
CREATE UNIQUE INDEX IF NOT EXISTS "product_type_charge_defaults_pair_idx"
  ON "product_type_charge_defaults" ("product_type_value", "charge_key");

-- The read pattern: every rule for one product type, when composing
-- suggestions for a component being added.
CREATE INDEX IF NOT EXISTS "product_type_charge_defaults_type_idx"
  ON "product_type_charge_defaults" ("product_type_value");

-- NO SEED DATA. Intentional, and load-bearing: see the header.
