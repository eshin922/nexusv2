-- Pre-authorized first-sign-in binding (#327).
--
-- An admin provisions a Nexus row BEFORE the person has ever reached Clerk.
-- The first successful Enterprise SSO attaches the authenticated Clerk identity
-- to that row — and to nothing else, ever.
--
-- ── DEPLOYMENT COMPATIBILITY ─────────────────────────────────────────────
--
-- Every statement here is a LOOSENING, so the currently deployed writer stays
-- valid against the new shape and this may land ahead of the code.
--
-- `binding_state` KEEPS its DEFAULT deliberately. The deployed `ensure-user`
-- INSERT does not mention the column; with NOT NULL and no default that INSERT
-- would begin failing the moment this migration applied, which is exactly the
-- 0066 outage shape. With the default it writes 'bound', which is correct for a
-- row that supplies a clerk_user_id.

-- 1 · a pending row has no Clerk identity yet.
ALTER TABLE "users" ALTER COLUMN "clerk_user_id" DROP NOT NULL;--> statement-breakpoint

-- 2 · the state is STATED, never inferred from the nullity of a handle.
--
-- Inferring "pending" from `clerk_user_id IS NULL` would make an unprovisioned
-- row and a deliberately pre-authorized one the same thing — the OD-027
-- ambiguity in a new place. The CHECK below then keeps the statement and the
-- handle from ever disagreeing.
CREATE TYPE "public"."user_binding_state" AS ENUM('pending_first_sign_in', 'bound');--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN "binding_state" "user_binding_state"
  NOT NULL DEFAULT 'bound';--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_binding_state_matches_clerk_id" CHECK (
  ("binding_state" = 'bound'                 AND "clerk_user_id" IS NOT NULL) OR
  ("binding_state" = 'pending_first_sign_in' AND "clerk_user_id" IS NULL)
);--> statement-breakpoint

-- 3 · exactly-one-match made UNREPRESENTABLE rather than merely checked (Q5).
--
-- `email` is already unique, but on the RAW value — so 'Cally@thedps.co' and
-- 'cally@thedps.co' could both exist and a binding would have two candidates.
-- A runtime "did we find exactly one?" check would then be guarding against a
-- state the schema still permits. This forbids the state.
--
-- Case-folding ONLY. Plus-addressing and dots are NOT stripped: those rules are
-- provider-specific, and collapsing 'a+b@thedps.co' onto 'a@thedps.co' would
-- let one person's sign-in claim another person's pre-authorized row.
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" (lower("email"));
