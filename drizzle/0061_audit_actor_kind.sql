-- Gate 1A actor model, part 1 of 2 — ADDITIVE ONLY. Safe to apply ahead of
-- the code deploy.
--
-- Adds `actor_kind` and marks all existing history `human`. Every one of the
-- 2,701 rows was written by an operator action: the preflight found zero rows
-- with no user_id, so no row is being reclassified — this records what they
-- already were.
--
-- The column is left NULLABLE here on purpose. This database is shared with
-- production, and production is currently serving code that does not set the
-- column. A NOT NULL constraint applied now would reject every audit write
-- from the running application, which is to say every audited operator action,
-- until the deploy caught up. Enforcement lives in 0062 and runs AFTER the
-- deploy, which is the reverse of the usual order because this constraint is
-- restrictive rather than additive.
--
-- WHY A KIND COLUMN AT ALL. Gate 1B's trace stops when it reaches a person.
-- Without this, a system-generated event and a human event whose actor went
-- missing are the same thing on disk: a null. The trace would have to infer
-- which from an absence, and an absence cannot distinguish "nobody acted" from
-- "we lost track of who did". The exception is recorded as intent instead.

CREATE TYPE audit_actor_kind AS ENUM ('human', 'system');

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_kind audit_actor_kind;

-- Every historical row is human. Guarded so a rerun is a no-op.
UPDATE audit_log SET actor_kind = 'human' WHERE actor_kind IS NULL;
