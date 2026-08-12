# OD-012 · Drizzle migration baseline — defect, repair, and safety evidence

**Diagnosis complete. Repair proposed, NOT executed.** 2026-08-12.

Prerequisite for **OD-017**, which is prerequisite for **OD-022**. The goal is a
safe migration path for re-keying the cost-input tables to `quote_leaf_id`.

All findings below were reproduced in a **sandboxed copy** of `drizzle/`.
`drizzle-kit generate` is an offline diff and never contacts the database.
`git status drizzle/` is clean; nothing in the repo's migration state was
touched.

---

## 1 · What is NOT wrong (corrections to the recorded description)

Two things OD-012's original text implies are wrong, and they matter because
they would have driven a needless and risky repair.

**a · `0049` / `0050` are not a defect.** Two SQL files exist on disk with no
journal entry — `0049_product_structure_slice1_backfill.sql` and
`0050_product_structure_slice1_contract.sql`. Their own header explains why:

> *"DRAFT — intentionally absent from `drizzle/meta/_journal.json` until
> production rollout approval."*

This is a deliberate staging pattern, not drift. **Leave them exactly as they
are.** They are also directly relevant prior art for OD-017/OD-022 — a
Product Structure slice with an advisory-lock/contract migration already drafted
— and should be read before OD-017 is authored rather than duplicated.

**b · The journal and the database agree.** `_journal.json` has **64 entries**;
`drizzle.__drizzle_migrations` has **64 applied rows**. There is no
applied-vs-recorded divergence. The migration *history* is sound.

The defect is confined to the **generator's baseline**, which is a authoring-tool
problem, not a database-integrity problem. That distinction is what makes the
repair cheap.

---

## 2 · Defect 1 — the stale baseline (as recorded, confirmed and now quantified)

Meta snapshots stop at **`0048_snapshot.json`** (49 snapshots, `0000`–`0048`).
The journal runs to `0065`. **15 journaled-and-applied migrations have no
snapshot:**

```
0051_phase_1_commercial_settings_pins      0059_audit_actor_snapshots
0052_phase_1_sales_order_snapshot_identity 0060_audit_actor_backfill
0053_phase_2_component_freight_expand      0061_audit_actor_kind
0054_phase_2_worksheet_freight_expand      0062_audit_actor_enforcement
0055_phase_2_worksheet_freight_snapshots   0063_pricing_lift_persistence
0056_canonical_attachment_repair           0064_below_floor_authorization
0057_action_idempotency                    0065_durable_attempt_lifecycle
0058_packaging_materialization_backfill
```

`generate` therefore diffs `schema.ts` against a picture of the database from
**15 migrations ago**.

**Reproduced output — 260 lines:**

| statement | count |
|---|---|
| `ALTER TABLE … ADD CONSTRAINT` | **29** |
| `CREATE TABLE` | **15** |
| `CREATE INDEX` | **11** |
| `ALTER TABLE … ADD COLUMN` | **7** |
| `CREATE TYPE` | **4** |
| `ALTER TABLE … DROP COLUMN` | **1** |

Every one targets an object that **already exists**. Most would error; the
`DROP COLUMN` would succeed. Against a database where dev and prod are the same
instance, that is a production data-loss statement sitting behind a one-word
npm script.

---

## 3 · Defect 2 — index collision (NEW; not in the recorded description)

The generator named its output **`0064_od12_probe`** — an index already occupied
by the applied `0064_below_floor_authorization`.

**Cause:** drizzle numbers the next migration from the journal's **entry count**
(64), not its **maximum index** (65). The two intentional draft gaps at 49/50
mean count and max-index differ by exactly 2, permanently.

**Effect:** every `db:generate` run emits a tag **two indices behind reality**,
producing a duplicate index in both the filesystem and the journal.

- It does **not** overwrite `0064_below_floor_authorization.sql` — the filename
  carries the migration name, so the files differ.
- It **does** create two journal entries at index 64. Ordering still follows
  journal sequence, so `migrate` would not immediately misbehave, but the index
  stops being a unique identifier — and every human and tooling assumption in
  this repo keyed on migration index silently becomes wrong.

This defect is a direct consequence of the (correct) decision to keep 0049/0050
unjournaled. It will not resolve itself, and it survives the Defect 1 repair.

---

## 4 · Minimum repair

**Repair 1 — install a truthful baseline snapshot.**

1. `drizzle-kit introspect` (pull) against the live database into a **scratch**
   directory. This is a **read-only** database operation.
2. Take the snapshot JSON it produces — a faithful picture of the real schema —
   and install it as `drizzle/meta/0065_snapshot.json`, matching the journal's
   current head.
3. **Do not** add a journal entry, and **do not** keep the introspected
   `schema.ts`. The repair adds a *picture*, not a migration and not a
   hand-written schema rewrite.

**Repair 2 — make the index safe.** Since migrations here are hand-authored
regardless, the cheapest correct answer is to stop `generate` from writing into
`drizzle/` at all: point `db:generate` at a scratch out-dir and treat it purely
as a **drift detector**. Hand-authored migrations keep using max-index + 1.
This neutralises Defect 2 without journaling the drafts (which would be false —
they are not applied).

**Guard.** `db:push` must be removed or hard-blocked: it applies schema diffs
directly to the database, which on this shared instance means production, with
no migration record at all. It is a sharper version of the same hazard and is
currently one npm script away.

---

## 5 · Migration-safety evidence required for closure

The repair is only proven by what `generate` does *afterwards*:

1. **Post-repair `generate` must emit ZERO statements.** That is the whole test.
   A truthful baseline diffed against a matching `schema.ts` has nothing to say.
2. **If it emits anything, that output is a genuine drift finding** between
   `schema.ts` and the real database — a real defect this exercise surfaced, to
   be dispositioned on its own merits, never "fixed" by applying the emitted SQL.
3. Re-run `npm run test:unit` (governed command, baseline on `main` first) —
   expected unchanged, since no runtime code is touched.
4. Confirm `drizzle.__drizzle_migrations` count is **still 64** and unchanged.
   The repair must not touch the database at all.

---

## 5a · REPAIR EXECUTED — **OD-012 CLOSED 2026-08-12**

Metadata and tooling only. No production schema change, no runtime change, no
database write.

**Repair 1 deviated from plan, with evidence.** `drizzle-kit introspect` is
**unusable in this repository**: it requires `drizzle-orm/gel-core`, which the
installed `drizzle-orm` does not export (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — a
drizzle-kit/drizzle-orm version mismatch whose fix is a dependency bump, and
therefore out of scope.

The baseline was instead derived from `schema.ts` and then **verified against the
live `information_schema`** — which supplies the DB-correspondence the plan
wanted from introspect:

| | |
|---|---|
| tables missing from DB | **0** |
| columns missing from DB | **0** |
| tables only in DB | 5 — `_archive_*` (Slice 11.5.1 archive snapshots, intentional) |
| columns only in DB | 1 — `freight_legs.freight_markup_pct` |

`schema.ts` is a strict subset of the database. Nothing it declares is absent,
which is the direction that makes the baseline safe for a generator.

**Drift finding, recorded not fixed:** `freight_legs.freight_markup_pct` exists
in the database and in no code path. The live markup column is
`freight_destination_breaks.freight_markup_pct`, which is used throughout
`actions/costing.ts`. The legs-level column is residual. **OD-009 territory** —
flagged for its owner, not touched here.

**Honest limitation:** a `schema.ts`-derived baseline means `db:generate` diffs
`schema.ts` against itself. It proves the *generator* is consistent; it cannot
see database objects absent from `schema.ts` — the residual column above stays
invisible to it. The `information_schema` comparison in
`.artifacts/snapcheck.ts` is what covers that direction, and is the check to
re-run if DB-correspondence is ever in doubt.

**Repair 2** — `db:generate` now runs `scripts/verify/schema-drift.mjs`, which
seeds a scratch dir from `drizzle/`, generates there, and reports statement
count. *(First attempt generated into an empty directory and emitted the entire
schema as `0000_…` — a missing baseline masquerading as catastrophic drift.
Seeding is not incidental.)*

**Repair 3** — `db:push` fails loudly with guidance to the governed path.

**Guard** — `scripts/verify/migration-index-unique.ts`, wired into `prebuild`.
Enforces highest-occupied-index authority, rejects duplicate indices, and
requires every unjournaled file to be a *recorded* draft that declares its own
contract — so the exemption is self-evidencing rather than a general licence.

### Closure evidence — all eight

| # | evidence | result |
|---|---|---|
| 1 | `meta/0065_snapshot.json` corresponds to applied schema | **PASS** — 0 missing tables/columns; 6 documented extras |
| 2 | `_journal.json` unchanged | **PASS** — absent from `git status` |
| 3 | applied-row count still 64 | **PASS** |
| 4 | no database write | **PASS** — reads only |
| 5 | scratch `db:generate` emits zero statements | **PASS** — *"zero statements"* |
| 6 | no duplicate governed index | **PASS** — 66 files, 64 journaled, 2 recorded drafts, next is **`0066`** |
| 7 | `db:push` cannot mutate | **PASS** — exits 1 with guidance |
| 8 | governed suite unchanged | **PASS** — **942/942** |

**Recorded separately, as required:** the migration history itself was already
healthy — **64 journal entries = 64 applied rows**. OD-012 was an
**authoring-tool safety defect**, never migration-history corruption.

**Migration numbering contract, now enforced:**

> The next governed hand-authored migration index derives from the highest
> occupied governed index, not from `_journal.json` entry count.
> **OD-017's migration begins at `0066`.**

---

## 6 · Original closure verdict *(superseded by §5a)*

**OD-012 was diagnosed, not yet closed at the time of writing.** The repair is a metadata-only change
with no database write and no runtime effect, but it changes the migration
authoring path and should be reviewed before it lands — which is why it is
proposed here rather than executed.

**Recommended disposition:**

- Adopt Repair 1 + Repair 2 + the `db:push` guard.
- Close OD-012 **only** on evidence 5.1 — a zero-statement `generate`.
- Treat any non-zero output as a new finding and disposition it before OD-017.

**Blocking status:** OD-017 must not author its re-keying migration until
OD-012 closes. That migration touches three cost-input tables on a shared
production database; authoring it against a 15-migration-stale baseline is the
precise scenario this decision exists to prevent.

---

## 7 · Note for OD-017

Read `0049_product_structure_slice1_backfill.sql` and
`0050_product_structure_slice1_contract.sql` first. They are a drafted, unapplied
Product Structure migration pair using an advisory-lock + `SHARE ROW EXCLUSIVE`
contract pattern over `assembly_leaves` and `quote_leaves` — the same tables
OD-017 must re-key. Whether they are superseded, adopted, or extended is an
OD-017 decision, but they should not be rediscovered late.
