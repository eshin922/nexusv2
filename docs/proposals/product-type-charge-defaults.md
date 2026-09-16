# Product Type → charge defaults · Settings feature

**2026-09-16 · for review · no migration applied, no rule seeded, nothing merged
or deployed.**

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

- **No NetSuite item column, ever.** `other_service` and `otc_testing` choose
  their item per line, frozen at send. A firm-wide default would be a second
  answer to "which item does this line post to", sitting in Settings looking
  authoritative while the frozen per-line selection is what posts.
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
| `removeChargeDefault` | Removes one suggestion | Leaves a last-rule deletion as a visible contradiction rather than inventing `none_expected` — see §2 design D |
| `clearChargeProfile` | Returns the type to needs-review, cascading its rules | A separate, explicit action precisely because it cascades |

New `audit_log.action` values, transition-named per the convention:
`product_type_charge_profile_reviewed`, `product_type_charge_profile_cleared`,
`product_type_charge_default_updated`, `product_type_charge_default_removed`.

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
one. This matters concretely today: **no component charge destination has a
verified production NetSuite mapping** — only `formulation` and
`filling_blending` are configured. A charge can be correctly suggested,
correctly accepted, and still not post.

---

## 6 · Does the database need to enforce the invariant?

**Recommendation: no — not now. The application layer is sufficient, and the
reason is the writer set, not a judgement about triggers.**

### The actual writer paths

Every reference to either table in the repository:

```
src/app/actions/charge-defaults.ts      4 writers, 1 reader
src/db/schema.ts                        definitions
drizzle/0131_…sql                       the DDL
scripts/verify/migration-index-unique.ts   records the draft
```

**There is no other writer.** No seed, no migration backfill, no script, no
second action module, no external process. Four functions in one file, each
admin-gated.

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

`tests/unit/charge-defaults.test.ts` asserts, per writer, that the lock is taken
**before** the first read — the ordering is the whole protection, and it is the
kind that survives a refactor only if something checks it.

### What a constraint trigger would and would not add

It would make the contradiction impossible rather than merely reported, for a
writer that bypasses these actions. Since no such writer exists, what it buys
today is protection against a future one — and it costs a deferred constraint
trigger on a shared production database, which this repo has exactly one of, and
which refused a migration in a way that took real time to diagnose.

**That diagnosis is not the reason for this recommendation, and should not be
read as one.** The reason is that the writer set is one module. If that stops
being true the answer changes, and the honest way to hold this is a test rather
than a memory:

> **`charge-defaults-writers` (proposed, small):** assert that the only files
> writing `product_type_charge_profile` or `product_type_charge_defaults` are
> the action module and the schema definition. A second writer fails the build,
> and the DB-enforcement question reopens on evidence instead of by recollection.

That test is **not in this PR** — it is a one-file addition worth landing with
the reviewer's agreement about its scope rather than assumed. The premise it
protects is stated here so the recommendation can be re-checked.

---

## 7 · Status — foundation versus what remains

**Implemented and green** (`npm run verify:ci` clean, 3,259 unit tests passing):

| | |
|---|---|
| Draft DDL, unjournaled and unapplied | `drizzle/0131_…sql` |
| Drizzle definitions for both tables | `src/db/schema.ts` |
| The resolver — pure, total over four states | `src/lib/commercial-recovery/charge-defaults.ts` |
| Admin actions — gated, transactional, audited in-transaction, serialized per type | `src/app/actions/charge-defaults.ts` |
| Settings surface rendering all four states distinctly | `src/app/admin/charge-defaults/` |
| Admin nav + index entry | `src/app/admin/sections.ts` |
| 16 tests, one per requirement | `tests/unit/charge-defaults.test.ts` |

**Not implemented, and deliberately so:**

| | Why |
|---|---|
| **The migration is not applied** | Pending approval. Additive and safe ahead of code, but unapplied means unapplied |
| **Authoring-surface wiring** | Touches Costs — out of scope by instruction. Contract specified separately |
| **No seeded rule** | Every product type currently reads "needs review", which is the truthful state |
| **The writer-set test of §6** | Proposed, not written |
| **Retired-option handling** | The surface shows a reviewed-but-retired type with a warning; nothing prunes. See OQ2 |

**Not verified:** nothing has run against a database. The write path's
behaviour — the advisory lock, the transactional audit, the refusals — is
asserted structurally and by unit test, not by executing it. The isolated
harness remains blocked by the `world.ts` seed defect, and preview origins are
not authenticated. Closing this needs either the harness repair or a
post-application check on the real database, and it should be closed before the
feature is trusted rather than after.

---

## 8 · The four open questions, with recommendations

Marked by whether they genuinely **block** the Settings feature.

### OQ1 · Should the cross-table invariant be a database constraint?

**Recommendation: no, per §6. Land the writer-set test instead.**
**Does not block.** The invariant is enforced and serialized today; the question
is about defence in depth against a writer that does not exist. It can be
reopened on evidence at any time, and the constraint remains addable later —
adding one to tables with no violating rows is a clean migration.

### OQ2 · What happens when a HubSpot option is retired?

**Recommendation: show it, never prune it.** The surface already lists a
reviewed-but-retired type with a warning and keeps its Remove controls, because
a rule nobody can see is a rule nobody can remove. Automatic deletion would
discard a firm decision on the strength of a vocabulary edit made elsewhere.
**Does not block** — the behaviour is implemented; what is open is whether an
admin should additionally be *prompted* to clean up, which is a later polish.

### OQ3 · Who maintains these?

**Recommendation: name an owner before seeding anything, not before merging.**
This is the same unanswered question as the unmapped Product Types, and an admin
surface with no named owner is the shape that decays — but an empty, truthful
"needs review" list decays into nothing worse than itself.
**Does not block the feature. It blocks the first seeded rule**, which is where
an unowned surface starts making claims on the firm's behalf.

### OQ4 · Does a rule belong to a product type, or to a type-and-something?

**Recommendation: type only, for now, and accept over-inclusiveness.** The audit
found real facts Product Type cannot determine — stock versus custom tooling,
printed versus unprinted. A per-type default is therefore over-inclusive by
design and the operator declines what does not apply; `preselected: false` is
exactly the setting for a charge that often-but-not-always applies.
**This is the one that genuinely blocks — not the build, but the seeding.** If
the answer turns out to be type-and-something, rules seeded against type alone
would have to be re-authored, and the second key would be a schema change.
Confirming it before the first rule is written costs nothing; confirming it after
costs a migration and a re-review.

**So: one question blocks the first rule (OQ4), one blocks the first seed for a
different reason (OQ3), and none block reviewing or merging the feature.**

---

## 9 · What is in the PR

| File | |
|---|---|
| `drizzle/0131_draft_product_type_charge_defaults.sql` | Draft DDL, unjournaled, unseeded |
| `src/db/schema.ts` | Drizzle definitions for both tables |
| `src/lib/commercial-recovery/charge-defaults.ts` | The resolver |
| `src/app/actions/charge-defaults.ts` | Admin actions |
| `src/app/admin/charge-defaults/page.tsx` + `charge-defaults-table.tsx` | Settings surface |
| `src/app/admin/sections.ts` | Nav + index entry |
| `tests/unit/charge-defaults.test.ts` | 16 tests |
| `scripts/verify/migration-index-unique.ts` | Records the draft |
| this document + the authoring contract | |

No production migration. No deployment. No seeded rule. No classification
changed. No Costs change.
