-- SKU identity, allocation and recovery — the tables.
--
-- ADDITIVE ONLY: three new tables. Nothing existing is altered, so this is
-- safe ahead of the code that reads it.
--
-- ── THIS MIGRATION TURNS NOTHING ON ──────────────────────────────────────
--
-- It creates the machinery empty. `sku_brand_registry` starts with no
-- approved rows and `sku_counters` starts with nothing seeded, and allocation
-- refuses on both of those conditions independently. So applying this to
-- production would leave generation exactly as unavailable as it is now --
-- the feature is off BY CONSTRUCTION, not by a flag someone can flip by
-- accident.
--
-- Registry approval and counter seeding are separate operations, each
-- requiring its own approval. Neither is performed here.

-- ── the governed brand registry ──────────────────────────────────────────
--
-- A token is a NAMESPACE, and minting one is a decision about identity that
-- outlives whoever made it. Tokens are never derived from a product name:
-- deriving `MISTR` from a product title would mint a namespace from whatever
-- someone typed, including a typo, and that namespace would then be permanent.
CREATE TABLE IF NOT EXISTS "sku_brand_registry" (
  -- The token as it appears between the prefix and the number, normalized
  -- upper-case. It IS the identity, so it is the key.
  "token" text PRIMARY KEY,

  -- Who the token belongs to, as a human reads it.
  "customer_label" text NOT NULL,

  -- The customer record this token is tied to, so "who is ELE" resolves to a
  -- record rather than to a label someone can retype differently tomorrow.
  -- Nullable because a token may be proposed from folder evidence before the
  -- company record behind it has been identified.
  "hubspot_company_id" text,

  -- proposed — evidence gathered, awaiting adjudication. CANNOT allocate.
  -- approved — adjudicated. May allocate, once its counter is seeded.
  -- rejected — considered and declined; kept so it is not re-proposed.
  "status" text NOT NULL DEFAULT 'proposed',

  -- How this entry was arrived at: the folder, the product count, the query.
  -- A future reader can re-run the evidence rather than trust the conclusion.
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,

  "proposed_by_user_id" uuid,
  "proposed_at" timestamptz DEFAULT now() NOT NULL,
  "approved_by_user_id" uuid,
  "approved_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "sku_brand_registry_status_values"
    CHECK ("status" IN ('proposed', 'approved', 'rejected')),
  -- Approval is an act by a person at a time. Recording one without the other
  -- leaves a row that claims adjudication with no adjudicator.
  CONSTRAINT "sku_brand_registry_approval_complete"
    CHECK (("status" <> 'approved')
           OR ("approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL)),
  -- The token must be the shape the convention allows, checked where it is
  -- stored rather than only where it is entered.
  CONSTRAINT "sku_brand_registry_token_shape"
    CHECK ("token" ~ '^[A-Z][A-Z0-9]{1,11}$')
);

-- ── counters ─────────────────────────────────────────────────────────────
--
-- One counter per brand, because numbering is per-brand: DPS-SPJ-1001 and
-- DPS-JLF-1001 are different products and always were.
--
-- A counter is USELESS UNTIL SEEDED, and that is enforced rather than assumed:
-- `next_number` is nullable and allocation refuses on NULL. Seeding must read
-- actual catalog identities across all three systems and start above the
-- highest, which is an operation requiring its own approval -- so the column
-- starts empty and no default can quietly stand in for having done it.
CREATE TABLE IF NOT EXISTS "sku_counters" (
  "token" text PRIMARY KEY
    REFERENCES "sku_brand_registry"("token") ON DELETE RESTRICT,

  -- NULL = never seeded. Allocation refuses.
  "next_number" integer,

  -- What the seed was computed from: the max found in each system, when, and
  -- by whom. Without this a counter is a number nobody can re-derive.
  "seed_basis" jsonb,
  "seeded_by_user_id" uuid,
  "seeded_at" timestamptz,

  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "sku_counters_seeded_together"
    CHECK (("next_number" IS NULL AND "seeded_at" IS NULL)
        OR ("next_number" IS NOT NULL AND "seeded_at" IS NOT NULL
            AND "seed_basis" IS NOT NULL)),
  CONSTRAINT "sku_counters_positive"
    CHECK ("next_number" IS NULL OR "next_number" > 0)
);

-- ── allocations ──────────────────────────────────────────────────────────
--
-- One durable allocation per creation intent, written BEFORE any external
-- request, so a crash between allocating and creating leaves a record of what
-- was intended rather than a silently consumed number.
--
-- TWO unique constraints, excluding two different failures:
--   attempt_key  — one intent yields one allocation, however many times it is
--                  retried. This is what makes retry safe.
--   sku          — no two allocations hold the same identifier, ever, whoever
--                  asked and whenever. This is what makes it an identity.
-- Neither implies the other: one intent could otherwise allocate twice, and
-- two intents could otherwise land on one SKU.
CREATE TABLE IF NOT EXISTS "sku_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  -- The caller's idempotency key for one creation intent.
  "attempt_key" text NOT NULL,

  -- The allocated identifier, stored normalized. Assigned SKUs are NEVER
  -- recycled -- not on failure, not on abandonment, not after archival -- so
  -- rows are kept in every terminal state rather than deleted.
  "sku" text NOT NULL,
  "token" text NOT NULL REFERENCES "sku_brand_registry"("token") ON DELETE RESTRICT,
  "number" integer NOT NULL,

  -- allocated  — issued, not yet attached to anything
  -- applied    — the product exists and carries it
  -- conflicted — the external system disagreed; needs a human
  -- abandoned  — the intent was dropped. The SKU stays spent.
  "state" text NOT NULL DEFAULT 'allocated',

  "leaf_id" uuid REFERENCES "leaves"("id") ON DELETE SET NULL,
  "hubspot_product_id" text,
  "note" text,

  "allocated_by_user_id" uuid,
  "allocated_at" timestamptz DEFAULT now() NOT NULL,
  "settled_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "sku_allocations_state_values"
    CHECK ("state" IN ('allocated', 'applied', 'conflicted', 'abandoned')),
  CONSTRAINT "sku_allocations_number_positive" CHECK ("number" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "sku_allocations_attempt_key_idx"
  ON "sku_allocations" ("attempt_key");

-- Normalized, because "dps-spj-1001" and "DPS-SPJ-1001" are the same identity
-- and a constraint that lets both in is not a uniqueness constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "sku_allocations_sku_idx"
  ON "sku_allocations" (upper(btrim("sku")));

CREATE INDEX IF NOT EXISTS "sku_allocations_open_idx"
  ON "sku_allocations" ("token", "number")
  WHERE "state" IN ('allocated', 'applied');
