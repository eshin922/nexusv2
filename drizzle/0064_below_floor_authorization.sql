-- Track A · BV-005 disposition 1c — minimal governed below-floor override.
--
-- Edward's disposition, 2026-08-10: V1 may permit a below-floor quote to be
-- accepted, but only through an explicit governed override. NOT the full BV-005
-- asynchronous request/approval lifecycle — there is no request, no routing and
-- no Slack. An authorized approver records a decision; the acceptance and
-- completion gates consult it.
--
-- WHAT THIS IS NOT. It is not a relaxation of the floor. Acceptance and
-- completion remain blocked by default; this adds the only door, and the door
-- is governed, independent of admin, and audited.

-- ── the permission ────────────────────────────────────────────────────────
--
-- A DEDICATED commercial permission, deliberately not a role and deliberately
-- not derived from `admin`. BV-005 is explicit: authority "must not be
-- hardcoded to the `admin` role", and admin may ADMINISTER the list without
-- being on it. Modelled as its own column so that separation is structural
-- rather than a convention someone can collapse later.
--
-- Defaults false. Membership is assigned after organisation-tenant SSO, when
-- real staff identities exist; it is deliberately NOT seeded from the three
-- pre-SSO rows currently in production, all of which are the same person.
alter table users
  add column if not exists commercial_approver boolean not null default false;

comment on column users.commercial_approver is
  'BV-005 Commercial Approver authority. Independent of role: admin does not confer it, and holding it does not confer admin. Assigned post-SSO.';

-- ── the decision record ───────────────────────────────────────────────────
create table if not exists below_floor_authorizations (
  id uuid primary key default gen_random_uuid(),

  -- Scope. BV-005: an approval applies to exactly one quote, one version, one
  -- tier, one material commercial state. All four are columns so that a
  -- mismatch is a query result rather than a judgement call.
  quote_id uuid not null references quotes(id) on delete cascade,
  quote_version_number integer not null,
  tier_id uuid not null references quote_tiers(id) on delete cascade,

  -- What was true when the decision was made. Kept as evidence, not as inputs
  -- to any later computation: a floor change afterwards must not rewrite the
  -- history of a decision that was correct when it was taken.
  margin_at_decision numeric(9, 6) not null,
  floor_at_decision numeric(5, 4) not null,

  -- The material commercial state, fingerprinted. Invalidation compares this
  -- rather than re-deriving what "material" means at every call site.
  state_fingerprint text not null,

  -- Who decided, when, and why. The reason is NOT NULL because a refusal or an
  -- approval without a why is a record that satisfies an auditor and helps
  -- nobody read the deal a year later.
  approved_by_user_id uuid not null references users(id),
  approved_at timestamptz not null default now(),
  reason text not null,

  -- Invalidation is a state transition, not a delete: the decision was really
  -- taken and must stay legible after it stops being usable.
  invalidated_at timestamptz,
  invalidated_reason text,

  created_at timestamptz not null default now()
);

-- The lookup both gates perform: the live authorization for this quote version
-- and tier. Partial on the not-yet-invalidated rows, because that is the only
-- set a gate ever asks about.
create index if not exists below_floor_auth_live_idx
  on below_floor_authorizations (quote_id, quote_version_number, tier_id)
  where invalidated_at is null;

comment on table below_floor_authorizations is
  'BV-005 1c — governed below-floor override. One row per decision, scoped to quote+version+tier+state. Consulted by markAccepted and markComplete; never relaxes the floor, only opens a governed door through it.';
