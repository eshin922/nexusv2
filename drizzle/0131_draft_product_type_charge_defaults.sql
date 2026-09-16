-- Product Type → charge defaults (DRAFT — intentionally absent from
-- drizzle/meta/_journal.json until the Settings design is approved).
--
-- NOT APPLIED, AND NOT SEEDED. Two tables, both empty. An unapproved default
-- rule is a business decision made by a migration, and no rule here has been
-- agreed.
--
-- ══ WHY TWO TABLES ═══════════════════════════════════════════════════════
--
-- Because there are THREE states, not two, and one table can only express two
-- of them:
--
--   no profile row              NOBODY HAS LOOKED at this product type.
--                               "Needs review". Not an answer.
--   profile `none_expected`     SOMEBODY LOOKED and concluded no component
--                               charges are expected. A finished answer, with
--                               a name and a date against it.
--   profile `defaults` + rules  Suggestions to offer.
--
-- With one table, absence has to carry both "nobody looked" and "looked, found
-- none" — and absence cannot carry a flag, a reviewer or a date. The two would
-- be indistinguishable at exactly the moment the difference matters: an
-- operator seeing no suggestions cannot tell whether the firm decided there
-- are none or whether nobody has got to it.
--
-- This is the same distinction the spec-schema resolver already draws between
-- `no_schema` (a finished answer) and `unmapped` (nobody has looked), and it
-- is drawn here for the same reason.
--
-- ══ WHAT THESE TABLES MUST NEVER BECOME ══════════════════════════════════
--
-- A second product taxonomy. `product_type_value` holds HubSpot's raw internal
-- option value and is NOT an enum, NOT a foreign key to anything Nexus owns,
-- and carries no display name, description, parent or ordering. It is a
-- REFERENCE to someone else's vocabulary, never a definition of one. Rows may
-- legitimately exist for values Nexus has not mapped yet, and for values
-- HubSpot later retires; neither is this table's business.
--
-- ══ WHAT THEY MUST NEVER DECIDE ══════════════════════════════════════════
--
-- A NETSUITE ITEM. There is no item column and there must never be one.
-- `other_service` and `otc_testing` choose their item PER LINE, frozen at
-- send. A firm-wide default here would be a second answer to "which item does
-- this line post to", sitting in Settings looking authoritative while the
-- frozen per-line selection is what actually posts.
--
-- A TOOLING CLASSIFICATION. There is no `tooling_classification` column and
-- there must never be one. Mould/collar versus cutting die selects a different
-- NetSuite destination, and `componentChargeDestination` refuses an
-- unclassified tooling charge rather than defaulting. A default here would
-- silently make that accounting choice from a product category — the single
-- thing this design is forbidden to do. `tooling` may be SUGGESTED; its
-- classification stays an explicit per-instance fact.
--
-- POSTING READINESS. Whether a charge is APPLICABLE and whether its
-- destination is MAPPED AND VERIFIED are different questions with different
-- owners. Nothing here reports readiness, and a suggestion must never be read
-- as one.

-- ── The verdict for one product type ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_type_charge_profile" (
  -- HubSpot's raw INTERNAL option value, not its label. Three options diverge
  -- (`Primary Packaging` → `Primary`, `Secondary Packaging` → `Secondary`,
  -- `Logistics` → `Third Party Logistics`), so a label-keyed rule would miss
  -- roughly half the catalogue.
  "product_type_value" text PRIMARY KEY,

  -- `defaults`       rules exist below; offer them
  -- `none_expected`  reviewed, and no component charge is expected
  "verdict" text NOT NULL,

  -- WHO decided, and WHEN. This is the whole difference between a finished
  -- answer and an absent one, so it is NOT NULL: a verdict nobody owns is the
  -- state this table exists to distinguish itself from.
  "reviewed_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "reviewed_at" timestamptz DEFAULT now() NOT NULL,

  -- Why, for the admin who inherits it.
  "note" text,

  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id"),

  CONSTRAINT "product_type_charge_profile_verdict_values"
    CHECK ("verdict" IN ('defaults', 'none_expected')),
  CONSTRAINT "product_type_charge_profile_value_not_blank"
    CHECK (length(btrim("product_type_value")) > 0)
);

-- ── The rules themselves ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_type_charge_defaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- A rule cannot exist without a verdict that says rules exist. The FK makes
  -- "rules present but nobody reviewed" unrepresentable rather than merely
  -- discouraged.
  "product_type_value" text NOT NULL
    REFERENCES "product_type_charge_profile"("product_type_value") ON DELETE CASCADE,

  -- A component charge identity from the governed registry. CHECKed rather
  -- than free text: a rule naming a charge that does not exist is not a
  -- default, it is a typo that would suggest nothing forever.
  "charge_key" text NOT NULL,

  -- Whether the suggestion arrives ticked. Either way the OPERATOR CONFIRMS
  -- before it becomes a charge — preselection is a starting position, never an
  -- assertion that the charge applies.
  "preselected" boolean NOT NULL DEFAULT false,

  "note" text,

  "created_at" timestamptz DEFAULT now() NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id"),

  CONSTRAINT "product_type_charge_defaults_charge_key_values" CHECK (
    "charge_key" IN ('print_plates', 'tooling', 'artwork_plate', 'samples', 'other_service')
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

-- ── THE INVARIANT THIS DDL DOES NOT ENFORCE ──────────────────────────────
--
-- `verdict = 'none_expected'` should imply NO rows in the defaults table. A
-- CHECK cannot span two tables, so this is enforced in the action layer and
-- the resolver treats a violation as a NAMED CONTRADICTION rather than
-- silently preferring one side.
--
-- A constraint trigger could enforce it in the database. That is a real
-- option and is deliberately NOT taken here without a decision: this repo has
-- one constraint trigger already and it caused a migration to be refused in a
-- way that took real time to diagnose. Identified as an open question rather
-- than settled by a draft. See the requirements document.

-- NO SEED DATA. Intentional, and load-bearing: absence means "needs review",
-- and seeding a rule would make that claim on the firm's behalf.
