# Product Type → charge defaults · Settings feature

**2026-09-16 · for review · verified against an isolated database. No production
migration, no deployment, no seeded rule.**

Separate from the Ingestibles/Topicals gap-fill, which is released. This changes
no classification and depends on none. Costs and production changes are out of
scope by instruction.

The authoring integration contract is a **separate document**:
[`charge-defaults-authoring-contract.md`](charge-defaults-authoring-contract.md).

---

## 1 · What this is

An admin-maintained relationship between an **existing** HubSpot Product Type
value and an **existing** supported component charge identity, used to
**suggest** charges when an operator adds a component.

It introduces no vocabulary of its own. That is the line that keeps it from
becoming a second product taxonomy, and it is enforced structurally:
`product_type_value` holds HubSpot's raw internal option value with no display
name, description, parent or ordering, and `charge_key` is CHECK-constrained to
the five identities already in the governed registry — `print_plates`,
`tooling`, `artwork_plate`, `samples`, `other_service`.

---

## 2 · Three states, because two is a lie

The requirement that shaped the design: **a missing rule must differ from a
reviewed "no charges expected".**

| State | Stored as | Means |
|---|---|---|
| **Needs review** | no profile row | Nobody has looked. **Not an answer.** |
| **None expected** | profile `verdict = 'none_expected'` | Somebody looked and concluded none apply — with a name and a date against it |
| **Suggestions** | profile `verdict = 'defaults'` + rules | Offer these |

Absence alone cannot carry this. It would have to mean both "nobody looked" and
"looked, found none", and absence carries no reviewer and no date — so the two
would be indistinguishable exactly where the difference matters. An operator
seeing no suggestions could not tell whether the firm decided there were none or
whether nobody had got to it.

This is the same distinction `resolveSpecSchema` already draws between
`no_schema` and `unmapped`, drawn the same way, for the same reason.

### The fourth state: contradiction

`verdict = 'none_expected'` should imply no rules. A CHECK cannot span two
tables, so the resolver returns a named `contradiction` rather than quietly
preferring one side — preferring either would hide a state that should never
occur, which is how it would persist.

`verdict = 'defaults'` with zero rules is also a contradiction, deliberately:
reporting it as `none_expected` would invent a finished answer nobody gave.

### Two tables is one shape among several, not the only one

Two tables is what was built, and it is a defensible shape — but it is not the
only design that satisfies the requirement, and it should not be presented as
though it were. Three alternatives, with what each actually costs:

| Design | How the three states are represented | Why it was not taken |
|---|---|---|
| **A · Two tables** (built) | profile row + rule rows | The invariant spans two tables, so the database cannot hold it and the action layer must — §6 |
| **B · One table, nullable charge key** | one row per (type, charge); a row with `charge_key IS NULL` means "reviewed, none expected" | Makes the contradiction **unrepresentable** by a partial unique index. But a NULL in a key column that means a verdict is a second meaning for a column, and every reader has to know it. It also cannot carry a per-type note distinctly from a per-rule note. |
| **C · One table, verdict derived from rule count** | rules only; "reviewed" inferred from a separate `reviewed_at` on… something | The verdict has nowhere to live that isn't a rule, so a reviewer and a date cannot attach to "none expected" at all. Fails the core requirement. |
| **D · Derived verdict on the profile** | profile row, verdict computed as `rules > 0 ? defaults : none_expected` | Makes the contradiction unrepresentable — attractive. But it **silently converts deleting the last rule into a finished answer**: an admin removing a rule to re-add a corrected one would, between the two clicks, have published "the firm reviewed this and expects no charges." The state machine must not put words in a reviewer's mouth. |

**A was chosen over B mainly because B's NULL carries a meaning, and over D
because D invents a verdict.** The cost of A is that the invariant is a
convention the action layer keeps, which is what §6 is about. If review prefers
B, the resolver and the tests port unchanged — only the loader and the DDL move.

---

## 3 · Schema

`drizzle/0131_draft_product_type_charge_defaults.sql` — **draft, unjournaled,
not applied, not seeded.** Drizzle definitions now sit alongside it in
`src/db/schema.ts`.

### `product_type_charge_profile`

| Column | Notes |
|---|---|
| `product_type_value` **PK** | HubSpot raw internal value. Not an enum, not an FK to anything Nexus owns. |
| `verdict` | CHECK `'defaults' \| 'none_expected'` |
| `reviewed_by_user_id` | **NOT NULL** → `users` |
| `reviewed_at` | **NOT NULL** |
| `note`, `updated_at`, `updated_by_user_id` | |

`reviewed_by` and `reviewed_at` are NOT NULL on purpose: a verdict nobody owns
is the state this table exists to be distinguished from.

### `product_type_charge_defaults`

| Column | Notes |
|---|---|
| `id` **PK** | |
| `product_type_value` | **FK → profile, ON DELETE CASCADE** — a rule cannot exist without a verdict saying rules exist |
| `charge_key` | CHECK against the five registry identities |
| `preselected` | Starting position for a checkbox. **Not** an assertion that the charge applies. |
| `note`, timestamps, actors | |

Unique on `(product_type_value, charge_key)`; index on `product_type_value` for
the read.

### Deliberately absent, each absence load-bearing

- **No NetSuite item column, ever.** `other_service` chooses its item per line,
  frozen at send — it is the catch-all, and migration 0090 refuses it a
  firm-level row by CHECK. Every other destination means one thing and takes a
  firm-wide mapping in `netsuite_destination_item_map`. A column here would be a
  second answer either way, sitting in Settings looking authoritative while
  something else is what posts. *(Corrected: an earlier draft said `otc_testing`
  was per-line too. It is not — see
  `../business-validation/fee-charge-decisions.md` §3.)*
- **No `tooling_classification` column, ever.** Mould/collar versus cutting die
  selects a different NetSuite destination, and `componentChargeDestination`
  **refuses** an unclassified tooling charge rather than defaulting. A default
  here would make that accounting choice from a product category — the one
  thing this design is forbidden to do. `tooling` may be suggested; classifying
  it stays an explicit per-instance fact.
- **No readiness column.** See §5.
- **No seed data.** Absence means "needs review"; seeding a rule would make that
  claim on the firm's behalf.

### Migration classification

Two new tables, additive. No existing object altered, no backfill. Safe ahead of
code by the deployment-order rule. Reversible by `DROP TABLE` while empty.
**Still not applied**, pending approval.

---

## 4 · The write path

`src/app/actions/charge-defaults.ts` — four writers and one read, all
`requireAdminAction()`, all in `db.transaction`, each with its audit entry
written **through the transaction handle** so the state change and its record
commit together or not at all.

| Action | What it does | What it refuses |
|---|---|---|
| `setNoneExpected` | Records the reviewed verdict | **Refuses while rules exist**, naming the count. Deleting them would turn "I reviewed this" into "I discarded somebody's rules" — a different act |
| `upsertChargeDefault` | Adds or edits one suggestion | Rejects a charge key not in `COMPONENT_CHARGE_KEYS`. Creates the profile at `defaults` in the same transaction, so a rule with no verdict is unrepresentable |
| `removeChargeDefault` | Removes one suggestion | **Refuses to remove the LAST one under a `defaults` verdict**, naming both ways forward — see §4.1 |
| `clearChargeProfile` | Returns the type to needs-review, cascading its rules | A separate, explicit action precisely because it cascades |

New `audit_log.action` values, transition-named per the convention:
`product_type_charge_profile_reviewed`, `product_type_charge_profile_cleared`,
`product_type_charge_default_updated`, `product_type_charge_default_removed`.

### 4.1 · Removing the last rule — resolved

**An ordinary supported action must not be able to leave a valid state machine
in an invalid state.** The first implementation allowed the last rule to be
removed and let the type land at `defaults` with nothing under it — a
contradiction, reported honestly. Reporting it honestly did not make it
acceptable: a surface telling an admin their data is inconsistent immediately
after they used the only control available to them is describing its own defect.

Two repairs were possible. Both were required to avoid inferring anything.

| | Effect | Why not |
|---|---|---|
| **Return the profile to `needs_review`** | Removing one charge silently withdraws somebody's review | A larger act than the control names — the mirror image of inferring `none_expected`, wrong for the same reason |
| **Refuse, naming the next action** ← **taken** | Every action's effect equals its name | Costs one extra click in an uncommon flow |

The refusal names both real intents and the action for each:

- **replace it** → add the replacement first, then remove this one
- **no charges here** → `Clear review`, then `None expected`

Both already exist, both are explicit, and neither puts words in a reviewer's
mouth. The control is disabled with the same explanation, so the refusal is
visible before it is hit; the server refuses independently, which is what
catches a stale screen showing two rules when one remains.

**One condition, and it matters.** The refusal applies **only under a `defaults`
verdict**. Against a stored `none_expected` that carries rules — a contradiction
the database permits and these actions never create — removing the last rule is
the *repair*, and refusing it would trap an admin in the invalid state with no
exit but a cascade that discards the review as well.

**Neither contradiction is reachable through supported actions any more.** The
walk asserts it by driving 120 supported actions in sequence and checking the
resolution after every step. `contradiction` survives in the resolver because
state written *around* the actions can still reach it, and each kind now carries
the `remedy` that fixes **it** — the two are repaired by opposite actions, and a
surface that composed one sentence for both would send an admin the wrong way
half the time.

### Reads refuse contradictory state

`listChargeDefaults` resolves every row through `resolveChargeDefaults` — the
**same function** the authoring path will use. A contradiction therefore reads
identically in Settings and at authoring time, rather than being smoothed over
by whichever surface happened to read it. The Settings surface renders it as a
fault with its detail; it is never resolved by preference.

---

## 5 · Applicability is not posting readiness

Two questions, different owners:

| Question | Answered by |
|---|---|
| Should this charge be offered here? | this feature |
| Is its destination mapped and verified in NetSuite? | `componentChargeDestination` + the item map |

A resolution carries no readiness field, and a suggestion must never be read as
one. A charge can be correctly suggested, correctly accepted, and still not
post.

**Corrected 2026-09-16.** An earlier draft of this section said no component
charge destination had a NetSuite mapping and named only `formulation` and
`filling_blending`. That was wrong, and it was wrong in the direction that
understates readiness. Read from `netsuite_destination_item_map`: ten
destinations are resolved, and four of the five component charge types among
them — `print_plates` (OTC-0004), `artwork_plate` (OTC-0001), and both tooling
classifications (`otc_mould` OTC-0006, `otc_dies` OTC-0002).

What remains true, and is the point the section exists to make:

- **`samples` and `other_service` have no mapping at all.** Either can be
  suggested, accepted and frozen, and neither can post.
- **Every resolved id is a SANDBOX record** (`NETSUITE_ENV=sandbox`). Production
  resolution is separate work and is not done. "Mapped" means mapped in the
  environment Nexus currently talks to.

The full picture is in the applicability matrix, §2.

---

## 6 · Does the database need to enforce the invariant?

**Recommendation: no — not now. The application layer is sufficient, and the
reason is the writer set, not a judgement about triggers.**

### The actual writer paths

Every reference to either table in the repository:

```
src/app/actions/charge-defaults.ts        4 writers, 1 reader
scripts/gate-1b/charge-defaults-walk.ts   the isolated walk, which writes
                                          around the actions deliberately
src/db/schema.ts                          definitions
drizzle/0131_…sql                         the DDL
scripts/verify/…                          the index + the writer guard
```

**No other writer.** No seed, no migration backfill, no second action module,
no external process. Four functions in one file, each admin-gated.

`scripts/verify/charge-defaults-writers.ts` now enforces that, in `verify:ci`.
A second writer fails the build with the file and line, so the premise is
re-checked every commit rather than remembered. It also fails if it stops
matching the action module at all — an instrument that can no longer express a
violation must not report a clean result (Pattern 60). That failure mode was
confirmed by introducing a violating file and watching it exit 1.

### The limit of that evidence — stated, not buried

**Repository references do not prove no external writer exists.** They prove
nothing was added to *this repository*. A psql session, a query in the Supabase
SQL editor, a future service, a restored dump, or anyone holding the connection
string writes this database without appearing anywhere in a static scan, and
always will. On a shared dev/prod project that is not hypothetical.

So the honest statement of the recommendation is narrower than "a trigger is
unnecessary":

> The invariant is enforced and serialized for **every writer that goes through
> the application**, and no other application writer exists. For a writer that
> does not, the only place that could hold it is the database.

That is a reasonable basis for review and for merging. It is not a proof, and
if anyone starts writing these tables from outside the application the question
reopens on that fact alone. A constraint trigger remains cleanly addable later:
adding one to tables with no violating rows is an ordinary additive migration.

### Why a transaction alone would NOT have been enough

Worth stating plainly, because it is the part that is easy to get wrong: under
READ COMMITTED, two admins acting on the same product type can each read a
consistent state, each pass their own check, and each commit. A transaction
gives atomicity, not serialization of check-then-write. That is the shape of the
SKU registry defect where one customer briefly held two approved codes.

So every writer takes **`pg_advisory_xact_lock` keyed on the product type**
before its first read, making check and write one critical section. It is
transaction-scoped, so it releases on commit, on rollback, and on a crash. It is
per-type, so two admins editing different types do not queue. Direct precedent:
`sku-registry.ts`, `leaves.ts`, `hubspot-pull.ts`.

**This is now verified executing, not merely present** — §7.

---

## 7 · Verified against an isolated database

`npm run validation:charge-defaults-walk` — **63 checks, 0 failures, repeatable
across runs.** Isolated Postgres on `127.0.0.1:55432`; the walk refuses to start
against anything else. The draft DDL was applied there and nowhere else, and it
was applied **unjournaled**, so the migrator's pending set is unchanged.

| Asked for | How it was established |
|---|---|
| **Missing rule / reviewed none / suggestions transitions** | Every transition driven through the real actions and read back through the real read path, both directions, including withdrawing a review |
| **Two concurrent admins on the same type** | Three ways — see below |
| **Audit failure rolls back the data change** | A trigger rejects the audit row; the profile the action would have written is absent afterwards. Repeated for the rule table, where the write has a different shape. The trigger is then dropped and the same call succeeds, so a later PASS is not the trigger still firing |
| **Non-admin refusal with no writes** | All four writers **and the read** refused `FORBIDDEN` as a PM; a full signature of both tables and the audit-log count are byte-identical before and after |
| **Contradictory stored state reported and refused safely** | The contradiction was written **around** the actions, which the database permits — that is the point. The read names it and which side is inconsistent; re-recording a verdict over it is refused; removing the rule resolves it |
| **`None expected` distinct from unreviewed** | Both read through the real path; the two produce different operator sentences, and only one claims somebody decided |

### The concurrency evidence, specifically

Three separate things, because the obvious one proves the least:

1. **The hazard is real.** A control runs the *same statements with the lock
   removed* and produces the contradiction. Without it, "no contradiction
   observed" is equally consistent with a working lock and with a race that
   never existed.
2. **The action waits on the lock.** Deterministic: the walk holds the same
   advisory lock from a separate connection, fires `setNoneExpected`, and
   observes that it does not complete and has written nothing — then completes
   the moment the lock is released. A *different* product type is unaffected
   (12 ms), so the lock is per type rather than global.
3. **Competing writes settle consistently.** 25 rounds of `setNoneExpected` and
   `upsertChargeDefault` fired simultaneously at the same type: zero
   contradictions, and the stored rows consistent every time. Plus two admins
   writing the same rule (both succeed, exactly one row) and a concurrent
   remove-and-add (either order legitimate; the result is always a state the
   resolver can name).

### The UI, and what was actually clicked

Driven in a browser against that same database, as `admin@nexus-validation.invalid`:

| Path | Result |
|---|---|
| `/admin/charge-defaults` loads | All 16 live HubSpot types, in the portal's display order, all **Needs review** |
| Label/value divergence | `Primary Packaging`, `Secondary Packaging` and `Logistics` each render the label with **“stored as …”** beneath — the value a rule is keyed by |
| Record **None expected** with a note | Chip flips, row shows reviewer email, date and note; success notice |
| Select a charge → **Add** | Row becomes **Suggestions**, reviewer + date, rule listed |
| Toggle **preselection** | Caption moves “offered, not ticked” → “ticked by default”; note survives |
| **None expected** while a rule exists | Rendered **disabled**, and the accessibility tree carries the reason: *“Remove the 1 suggested charge(s) first — recording "none expected" will not discard rules somebody added.”* Pattern 47(f) |
| **Remove** the last rule | Row renders **Inconsistent** with the detail, in the alert treatment — the contradiction reaching an admin, not being smoothed away |
| **None expected** on the contradiction | Resolves to a consistent reviewed-none |
| **Clear review** | Returns the row to **Needs review** |
| Nav + index | “Charge defaults” present in the admin nav |

**One defect was found this way and fixed.** Deleting a rule from another
connection and then clicking Remove on the now-stale screen produced the right
refusal — *“Secondary has no tooling rule to remove”* — while the row it named
**remained on screen**, because only the success path re-read. A refusal that
denies the existence of something the operator can see reads as a broken
control. The refusal path now refreshes too, and the re-test shows both the
message and the corrected state (the row becomes **Inconsistent**, which is what
that type genuinely is). `router.refresh()` re-renders the server tree without
disturbing client state, so a half-typed note survives it.

### 7.1 · Why the Settings surface showed 16 types when production has 18

**The vocabulary source is `loadHubspotProductTypeOptions()`**, which resolves
through the composed provider — never a list in this codebase. In **production**
that reads HubSpot's live `hs_product_type` property definition. In the
**isolated harness** it reads `tests/harness/providers/fake-hubspot.ts`.

The 16 was the fixture's age, not the application's behaviour. That fixture was
captured read-only on **2026-09-12**; `Ingestibles` and `Topicals` were created
in production HubSpot on **2026-09-15**, with the formulated-schema release. A
fixture reporting its own capture date as the firm's vocabulary — Pattern 53, in
the direction that makes a harness quietly certify less than production has.

**Verified against production HubSpot, read-only, 2026-09-16:**

```
production options: 18
  16  value="Ingestibles"  label="Ingestibles"
  17  value="Topicals"     label="Topicals"
```

Both present, label and value identical, and `verify:product-type-vocabulary`
reports `UNMAPPED: none · AHEAD: 0` against production. **The application was
right; only the fixture was behind.** The fixture is now at 18, so the isolated
Settings surface renders what production offers.

*(The same live check reports two UNMAPPED values in the SANDBOX portal —
`Corrugated` and `Preliminary`. Pre-existing, separately tracked, and not
touched here.)*

### What is still NOT verified

- **The non-admin UI path.** `requireAdminPage()`'s redirect was not exercised;
  the isolated server available to this session runs as admin and restarting it
  would have disturbed a session in use. The **action-layer** refusal is
  verified for all five entry points, and the page guard is the same one every
  other admin section uses — but the redirect itself is asserted, not observed.
- **Anything against the production database.** Nothing has run there. The
  migration remains unapplied.
- **The authoring surface.** It does not exist; see the contract document.

---

## 8 · Status — foundation versus what remains

**Implemented and green.** `npm run verify:ci` clean (now including
`verify:charge-defaults-writers`), 3,259 unit tests passing, 63-check isolated
walk passing.

| | |
|---|---|
| Draft DDL, unjournaled, unapplied in production | `drizzle/0131_…sql` |
| Drizzle definitions for both tables | `src/db/schema.ts` |
| The resolver — pure, total over four states | `src/lib/commercial-recovery/charge-defaults.ts` |
| Admin actions — gated, transactional, audited in-transaction, serialized per type | `src/app/actions/charge-defaults.ts` |
| Settings surface rendering all four states distinctly | `src/app/admin/charge-defaults/` |
| Writer-boundary guard, in `verify:ci` | `scripts/verify/charge-defaults-writers.ts` |
| Isolated-environment walk | `scripts/gate-1b/charge-defaults-walk.ts` |
| 16 unit tests | `tests/unit/charge-defaults.test.ts` |

**Not implemented, deliberately:**

| | Why |
|---|---|
| **The migration is not applied in production** | Pending approval |
| **Authoring-surface wiring** | Touches Costs — out of scope. Contract specified separately |
| **No seeded rule** | Every product type reads “needs review”, which is the truthful state |
| **Non-admin UI redirect** | See §7 |

### The store is built; the content is not approved

Settings can now **store** defaults. Nothing here approves **what they should
be**, or **who owns them**. Those are business questions and the schema has no
opinion on either — which is why it ships empty, and why an unreviewed type says
so rather than saying “none”.

---

## 9 · The applicability matrix

**The product/service type → charge applicability matrix is now delivered:**
[`../business-validation/charge-applicability-matrix.md`](../business-validation/charge-applicability-matrix.md).
It covers all 18 production product types and every supported service, with
worked examples for MISTR gummies, MISTR lubricants, a contracted bag, a stock
bottle and a printed carton. It is a business-review artifact, not an
engineering one, and it approves nothing by existing.
Until it exists:

- **No rule is seeded.** Seeding one would make a claim on the firm's behalf
  that nobody has made.
- **No schema expansion is proposed.** In particular, no second key on a rule —
  see OQ4.
- **CD's Costs redesign remains paused**, pending that matrix. The authoring
  surface is where a default would meet an operator, and designing it before the
  applicability question is settled would fix a shape around an unanswered one.

**OQ3 and OQ4 are to be resolved through concrete examples** — real products and
real charges, worked through — rather than in the abstract. Both questions turn
on facts about the firm's catalogue that a general answer cannot settle, and the
matrix is where those examples would live.

### The four open questions

#### OQ1 · Should the invariant be a database constraint?

**Recommendation: no, per §6, with the limitation there stated plainly.** The
writer guard now holds the premise for every commit. **Does not block** — the
invariant is enforced and serialized today, and verified executing.

#### OQ2 · What happens when a HubSpot option is retired?

**Recommendation: show it, never prune it.** The surface lists a
reviewed-but-retired type with a warning and keeps its Remove controls, because
a rule nobody can see is a rule nobody can remove. Automatic deletion would
discard a firm decision because of a vocabulary edit made elsewhere.
**Does not block** — implemented; what is open is whether an admin should also
be *prompted* to clean up, which is later polish.

#### OQ3 · Who maintains these?

**Resolve through the matrix, from concrete examples.** The abstract question —
"who owns charge defaults" — has no answer that survives contact with a real
case; the useful version is "for these twelve real charges, who decided, and who
would notice if it were wrong." An admin surface with no named owner is the
shape that decays, but an empty, truthful "needs review" list decays into
nothing worse than itself.
**Does not block the feature. It blocks the first seeded rule.**

#### OQ4 · Does a rule belong to a product type, or to a type-and-something?

**Resolve through the matrix, from concrete examples — and this is the one that
genuinely blocks.** The audit found facts Product Type cannot determine: stock
versus custom tooling, printed versus unprinted. Whether that makes a per-type
default *acceptably* over-inclusive is a question about how often it would be
wrong, which only worked examples can answer.

It blocks the **first rule**, not the merge. If the answer turns out to be
type-and-something, rules written against type alone need re-authoring and the
second key is a schema change. Confirming it before the first rule costs
nothing; confirming it after costs a migration and a re-review.

**So: none of the four blocks reviewing or merging. OQ4 blocks the first rule;
OQ3 blocks the first seed. Both are matrix work, not engineering work.**

---

## 10 · What is in the PR

| File | |
|---|---|
| `drizzle/0131_draft_product_type_charge_defaults.sql` | Draft DDL, unjournaled, unseeded |
| `src/db/schema.ts` | Drizzle definitions for both tables |
| `src/lib/commercial-recovery/charge-defaults.ts` | The resolver |
| `src/app/actions/charge-defaults.ts` | Admin actions |
| `src/app/admin/charge-defaults/page.tsx` + `charge-defaults-table.tsx` | Settings surface |
| `src/app/admin/sections.ts` | Nav + index entry |
| `scripts/verify/charge-defaults-writers.ts` | Writer-boundary guard, wired into `verify:ci` |
| `scripts/gate-1b/charge-defaults-walk.ts` | Isolated-environment walk, 70 checks |
| `tests/harness/providers/fake-hubspot.ts` | Vocabulary fixture brought to 18 — §7.1 |
| `docs/business-validation/charge-applicability-matrix.md` | **The matrix** |
| `tests/unit/charge-defaults.test.ts` | 18 tests |
| `scripts/verify/migration-index-unique.ts` | Records the draft |
| this document + the authoring contract | |

No production migration. No deployment. No seeded rule. No classification
changed. No Costs change.
