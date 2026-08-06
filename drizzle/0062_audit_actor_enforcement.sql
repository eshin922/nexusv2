-- Gate 1A actor model, part 2 of 2 — ENFORCEMENT. RESTRICTIVE.
--
-- ################################################################
-- #  DO NOT APPLY BEFORE THE ACTOR-MODEL CODE IS DEPLOYED.        #
-- ################################################################
--
-- This database is shared between development and production. Production is
-- served by whatever is on `main`. Until the actor-model branch is merged and
-- deployed, the running application inserts audit rows WITHOUT actor_kind,
-- actor_user_id or actor_display_name — and these constraints reject exactly
-- those rows. Applying this early does not degrade audit quality; it takes
-- production down, because an audit write failing inside a transaction rolls
-- back the operator action it was recording.
--
-- The usual project rule is additive migrations FIRST, then merge the code
-- that reads them. This is the mirror case: a restrictive migration goes LAST,
-- after the code that satisfies it is live. 0061 is the additive half and can
-- go early; this half cannot.
--
-- SELF-SUFFICIENT. Between 0061 and the deploy, production keeps writing rows
-- with none of the three columns set. So this re-runs the whole backfill before
-- constraining, rather than assuming 0060 and 0061 left nothing behind. It
-- aborts if any actor cannot be resolved: a fallback in that position would
-- claim a person was reached whose name was never recorded, when what actually
-- happened is that we no longer know who acted.
--
-- WHAT IT ENFORCES.
--
--   actor_kind          NOT NULL — every row says what it terminates in
--   actor_display_name  NOT NULL and non-blank — a terminal always reads
--   shape CHECK         human => actor_user_id present
--                       system => actor_user_id absent
--
-- actor_user_id is deliberately NOT made NOT NULL. That would assert that
-- every audit row describes a person, which is the one thing the system kind
-- exists to deny. Conditional enforcement through the CHECK says the same
-- thing about human rows without lying about the others.
--
-- actor_user_id still carries no FOREIGN KEY. An FK would reintroduce the
-- coupling to a live users row that this whole model exists to remove; a
-- deleted user must not be able to alter what an audit row says happened.

-- ---------- resolvability gate ----------
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
      'Gate 1A enforcement aborted: audit_log contains actor references that no longer resolve. Report them; do not infer an identity.';
  END IF;
END $$;

-- ---------- catch anything written since 0060/0061 ----------
-- Mirrors displayNameFor() in src/lib/audit.ts exactly, so historical and
-- runtime terminals render the same person the same way.
UPDATE audit_log a
   SET actor_user_id      = a.user_id,
       actor_display_name = COALESCE(
         NULLIF(BTRIM(u.name), ''),
         'Unnamed user (' || LEFT(u.id::text, 8) || ')'
       )
  FROM users u
 WHERE u.id = a.user_id
   AND a.actor_user_id IS NULL;

UPDATE audit_log SET actor_kind = 'human' WHERE actor_kind IS NULL;

-- A row with no user_id that predates the actor model cannot be classified:
-- we cannot tell an unattended act from a lost actor after the fact. None
-- exist today (0 of 2,701). If one appears, stop rather than guess.
DO $$
DECLARE unclassifiable integer;
BEGIN
  SELECT count(*) INTO unclassifiable
    FROM audit_log
   WHERE actor_kind IS NULL
      OR actor_display_name IS NULL
      OR BTRIM(actor_display_name) = '';
  IF unclassifiable > 0 THEN
    RAISE EXCEPTION
      'Gate 1A enforcement aborted: % row(s) cannot be classified as human or system. Classify them explicitly.', unclassifiable;
  END IF;
END $$;

-- ---------- constraints ----------
ALTER TABLE audit_log ALTER COLUMN actor_kind SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN actor_display_name SET NOT NULL;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_display_name_not_blank
  CHECK (BTRIM(actor_display_name) <> '');

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_shape
  CHECK (
    (actor_kind = 'human'  AND actor_user_id IS NOT NULL) OR
    (actor_kind = 'system' AND actor_user_id IS NULL)
  );
