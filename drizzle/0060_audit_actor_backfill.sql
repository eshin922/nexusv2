-- Gate 1A — backfill actor snapshots onto historical audit rows.
--
-- Every row written from now on carries event-time actor identity because
-- writeAuditEntry() puts it there. This gives the same to the 2,701 rows that
-- predate the writer, so the Pricing trace terminates in a person for the
-- whole history rather than only the part written after 2026-08-06.
--
-- STRICTLY ADDITIVE TO THE TWO SNAPSHOT COLUMNS. It reads users, writes only
-- actor_user_id and actor_display_name, and touches nothing else: no user_id,
-- no FK, no action, entity, summary, label or diff_json. The post-backfill
-- proof re-derives the original global semantic digest over the pre-existing
-- columns and requires it unchanged.
--
-- PRECONDITION, ENFORCED HERE AND NOT ONLY IN A PREFLIGHT. The migration
-- aborts if any historical actor no longer resolves. A preflight run minutes
-- earlier proves the state at that moment; this proves it at the moment of
-- the write.
--
-- Why abort rather than fall back: the never-empty fallback asserts a specific
-- fact — a person was reached, and their name was never recorded. For a
-- deleted or missing actor that fact is false. What happened there is that we
-- no longer know who acted, which the trace must be able to say plainly
-- instead of dressing it as thin provenance. Inferring an identity for an
-- unknown historical person is the one thing an audit trail cannot do.
--
-- IDEMPOTENT. Guarded on actor_user_id IS NULL; a rerun updates nothing.
-- Rows with no user_id at all (machine-authored) are left alone by the join —
-- there are none today, and if any appear they need the system-actor contract,
-- not a human-shaped snapshot.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
     WHERE a.user_id IS NOT NULL
       AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Gate 1A backfill aborted: audit_log contains actor references that no longer resolve. Report them; do not infer an identity.';
  END IF;
END $$;

-- The display-name rule mirrors displayNameFor() in src/lib/audit.ts exactly:
-- a trimmed non-empty name, otherwise "Unnamed user (" + first 8 of the id.
-- Historical rows and runtime writes must not disagree about what a terminal
-- looks like.
UPDATE audit_log a
   SET actor_user_id     = a.user_id,
       actor_display_name = COALESCE(
         NULLIF(BTRIM(u.name), ''),
         'Unnamed user (' || LEFT(u.id::text, 8) || ')'
       )
  FROM users u
 WHERE u.id = a.user_id
   AND a.actor_user_id IS NULL;
