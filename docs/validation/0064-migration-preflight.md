# `0064_below_floor_authorization` — migration preflight

**APPLIED to the shared database 2026-08-11**, on Edward's explicit
authorization, via the governed `npm run db:migrate` (which targets `DIRECT_URL`
— port `:5432`, session mode). Applied count 62 → 63; **0064 was the only
pending migration**, verified before application, so nothing else rode along.

Post-application verification is recorded in §6. Two descriptive corrections and
one **material rollback defect** were found while verifying; both are marked
inline where they occur, and the rollback correction in §5 should be read before
any rollback is attempted.

Previously applied and verified on the isolated validation database
(`127.0.0.1:55432`, Docker), where it is also the 63rd journalled migration.

> **Standing rule in force:** code depending on `0064` does not merge before the
> migration is applied and verified. `298a8a5` already reads
> `users.commercial_approver` and `below_floor_authorizations`, so merging it
> ahead of application would reproduce the PR-E outage shape — every read path
> touching a relation that does not exist.

---

## 1 · Exactly what is created or altered

**Altered — `users`** (one column added):

| column | type | null | default |
|---|---|---|---|
| `commercial_approver` | `boolean` | `NOT NULL` | `false` |

Plus a `COMMENT ON COLUMN` recording that authority is independent of role.

**Created — `below_floor_authorizations`** (13 columns):

| column | type | notes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `quote_id` | `uuid` | FK → `quotes(id)` **ON DELETE CASCADE** |
| `quote_version_number` | `integer` | `NOT NULL` |
| `tier_id` | `uuid` | FK → `quote_tiers(id)` **ON DELETE CASCADE** |
| `margin_at_decision` | `numeric(9,6)` | `NOT NULL` |
| `floor_at_decision` | `numeric(5,4)` | `NOT NULL` |
| `state_fingerprint` | `text` | `NOT NULL` |
| `approved_by_user_id` | `uuid` | FK → `users(id)`, no cascade — a decision must outlive nothing |
| `approved_at` | `timestamptz` | `NOT NULL`, `now()` |
| `reason` | `text` | **`NOT NULL`** — mandatory per disposition |
| `invalidated_at` | `timestamptz` | nullable |
| `invalidated_reason` | `text` | nullable |
| `created_at` | `timestamptz` | `NOT NULL`, `now()` |

**Indexes:** `below_floor_authorizations_pkey` (implicit) and
`below_floor_auth_live_idx` on `(quote_id, quote_version_number, tier_id)` —
the lookup both gates perform.

**Constraints:** 3 foreign keys, 1 primary key, 11 `NOT NULL`. No unique
constraints, no check constraints, no triggers, no enum changes.

> **Corrected post-application (2026-08-11).** This section originally said
> "8 `NOT NULL`" and described `below_floor_auth_live_idx` without its predicate.
> Verified against the applied schema: **11** NOT NULL columns, and the index is
> **partial** — `WHERE (invalidated_at IS NULL)`. Neither changes the risk
> assessment; both are corrected so the document is usable as a reference.

All statements are `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so the
migration is **idempotent** and re-running it is safe.

## 2 · Is any existing row rewritten?

**No table rewrite.** `ADD COLUMN … NOT NULL DEFAULT false` on PostgreSQL 11+
stores the default in the catalogue rather than writing every row — the added
column is materialised lazily. `users` holds **3 rows**, so even a rewrite would
be trivial, but none occurs.

Nothing else is touched. No `UPDATE`, no `DELETE`, no data migration, no
backfill of any existing column.

## 3 · Default and backfill behaviour for the three existing users

All three existing rows — `edward.shin@gmail.com`, `edward@thedps.co`,
`edisonlshin@gmail.com` — receive **`commercial_approver = false`**.

**No seeding, deliberately.** Per Edward's disposition, membership is not
manufactured from the pre-SSO rows: all three are the same person, so granting
any of them would create an independence the estate does not have, and the
self-approval prohibition would then be satisfiable by signing in as the other
account.

**Consequence, stated plainly:** on application, below-floor acceptance remains
**blocked for everyone** — the control ships dormant, exactly as dispositioned.

## 4 · Lock and downtime risk

| statement | lock | held for |
|---|---|---|
| `ALTER TABLE users ADD COLUMN … DEFAULT false` | `ACCESS EXCLUSIVE` on `users` | milliseconds — catalogue-only, no rewrite |
| `CREATE TABLE below_floor_authorizations` | none on existing tables | — |
| `CREATE INDEX below_floor_auth_live_idx` | on the new, empty table | — |
| FK creation → `quotes`, `quote_tiers`, `users` | `SHARE ROW EXCLUSIVE` briefly on each parent | milliseconds — validating a FK from an empty child scans nothing |

**Assessed risk: low.** The only lock on a live table is the brief
`ACCESS EXCLUSIVE` on a 3-row `users`. Any concurrent query touching `users`
waits milliseconds.

**One real caveat:** an `ACCESS EXCLUSIVE` lock queues *behind* existing long
transactions and blocks everything behind it while it waits. Apply when the
estate is quiet, not mid-operation.

**No downtime expected. No data loss possible** — the migration only adds.

## 5 · Rollback and recovery

Fully reversible, because nothing is destroyed:

```sql
DROP TABLE IF EXISTS below_floor_authorizations;
ALTER TABLE users DROP COLUMN IF EXISTS commercial_approver;
-- Identify the journal row by created_at, NOT by filename. See the correction below.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1786320001000;
```

> ### ⚠ Correction — the original rollback step would have matched nothing
>
> This section previously read
> `DELETE FROM drizzle.__drizzle_migrations WHERE hash LIKE '%0064_below_floor%'`.
> **`hash` holds a content SHA of the migration file, not its name** — verified
> post-application, where the 0064 row is
> `id=66, created_at=1786320001000, hash=00d99293c617929ba5a69fa8…`.
>
> The predicate matches zero rows, so a rollback following it would have dropped
> the table and column while **leaving the journal row in place**. Drizzle would
> then consider 0064 applied against a database where its objects no longer
> exist, and the next `db:migrate` would skip it — the schema silently one
> migration behind what the journal claims, which is worse than a failed
> rollback because nothing reports it.
>
> Surfaced by a verification query that searched on the same wrong assumption and
> returned `journal rows matching 0064 : 0` while the migration was plainly
> applied. The disagreement between two of my own checks is what exposed it.
>
> **Correct identification:** `created_at = 1786320001000` (or the row with the
> maximum `created_at`, which is 0064 until a later migration lands). Confirm
> before deleting:
> `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;`

**Ordering matters on the way back:** the code at `298a8a5` reads both objects,
so a rollback must be preceded by rolling the deploy back — otherwise every
acceptance path errors on a missing relation, which is the same failure shape as
merging early, arriving from the other direction.

**Recovery if application half-fails:** every statement is `IF NOT EXISTS`, so
re-running completes the remainder. Nothing needs manual repair.

**Data loss on rollback:** any authorizations recorded between application and
rollback are lost with the table. Under the dormant configuration there can be
none, since no user holds the permission.

## 6 · Verification after application

```sql
-- 1 · the column exists, NOT NULL, defaulting false
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'users' AND column_name = 'commercial_approver';
-- expect: boolean | NO | false

-- 2 · the table exists with 13 columns
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'below_floor_authorizations';
-- expect: 13

-- 3 · the gate's lookup index exists
SELECT indexname FROM pg_indexes
 WHERE tablename = 'below_floor_authorizations';
-- expect: below_floor_authorizations_pkey, below_floor_auth_live_idx

-- 4 · THE ONE THAT MATTERS COMMERCIALLY — nobody was granted authority
SELECT commercial_approver, count(*) FROM users GROUP BY 1;
-- expect: false | 3     (and NO row with true)

-- 5 · no authorizations exist yet
SELECT count(*) FROM below_floor_authorizations;
-- expect: 0
```

Query 4 is the confirmation Edward asked for, and it is the one to read first: if
it ever returns a `true` row after application, something granted authority that
no disposition authorised.

**Observed on the validation database after application:**
`boolean | NO | false` · 13 columns · both indexes present ·
`false | 2` (its two seeded users) · 0 authorizations.

### Observed on the SHARED database after application, 2026-08-11

| # | check | result |
|---|---|---|
| 1 | journal state | applied 62 → **63**; journal file has 63 entries; new row `id=66, created_at=1786320001000` |
| 2 | column | `commercial_approver` · `boolean` · `NO` · default `false` |
| 2 | table | `below_floor_authorizations` · **13** columns |
| 2 | indexes | `below_floor_authorizations_pkey`; `below_floor_auth_live_idx` on `(quote_id, quote_version_number, tier_id) WHERE invalidated_at IS NULL` |
| 2 | constraints | 3 FKs — `quote_id`→`quotes` CASCADE, `tier_id`→`quote_tiers` CASCADE, `approved_by_user_id`→`users` (no cascade) — plus PK; 11 NOT NULL |
| 3 | **population** | **`false \| 3`. No `true` row.** |
| 4 | estate | 0 authorizations · 0 `below_floor_authorized` audit rows |
| 5 | paths load | action + `mark-complete` + `quotes` modules import against real schema; gate lookup executes; permission column readable (0 approvers of 3 users); gate returns `ok=false code=NO_AUTHORIZATION` on the live estate |
| 6 | gates | `test:unit` 761/761 · `tsc` clean · `prebuild` PASS |

Verification 5 was **read-only**: no action was invoked and nothing was written
to production. Pre-application state was captured first and confirmed the column
absent, the table absent, 3 users, and 0 audit rows.

## 7 · Confirmation

**Existing users remain `commercial_approver = false` unless explicitly granted
later.** The migration contains no `UPDATE` and no seed. The only writer of that
column in the codebase is a future admin surface that does not yet exist; the
verification script grants it to a controlled test identity and revokes it in a
`finally` block.
