# Product Type → charge defaults · Settings design

**2026-09-15 · for review · no migration applied, no rule seeded, nothing deployed.**

Separate from the Ingestibles/Topicals gap-fill, which is released. This
proposal changes no classification and depends on none.

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

The requirement that shaped the schema: **a missing rule must differ from a
reviewed "no charges expected".**

| State | Stored as | Means |
|---|---|---|
| **Needs review** | no profile row | Nobody has looked. **Not an answer.** |
| **None expected** | profile `verdict = 'none_expected'` | Somebody looked and concluded none apply — with a name and a date against it |
| **Suggestions** | profile `verdict = 'defaults'` + rules | Offer these |

One table cannot express this. Absence would have to carry both "nobody
looked" and "looked, found none", and absence cannot carry a reviewer or a
date. The two would be indistinguishable exactly where the difference matters:
an operator seeing no suggestions could not tell whether the firm decided there
were none or whether nobody had got to it.

This is the same distinction `resolveSpecSchema` already draws between
`no_schema` and `unmapped`, drawn the same way, for the same reason.

### The fourth state: contradiction

`verdict = 'none_expected'` should imply no rules. **A CHECK cannot span two
tables**, so the resolver returns a named `contradiction` rather than quietly
preferring one side — preferring either would hide a state that should never
occur, which is how it would persist.

`verdict = 'defaults'` with zero rules is also a contradiction, deliberately:
reporting it as `none_expected` would invent a finished answer nobody gave.

---

## 3 · Schema requirements

`drizzle/0131_draft_product_type_charge_defaults.sql` — **draft, unjournaled,
not applied, not seeded.**

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
- **No seed data.** Absence means "needs review"; seeding a rule would make
  that claim on the firm's behalf.

### Migration classification

Two new tables, additive. No existing object altered, no backfill. Safe ahead
of code by the deployment-order rule. Reversible by `DROP TABLE` while empty.
**Still not applied**, pending design approval.

---

## 4 · How quote selections survive a change to defaults

**The mechanism, not a promise.** A quote's charges are rows the operator
authored in `quote_charge_instances`. Nothing re-derives them.

`resolveChargeDefaults` is read at **one moment only**: composing the offer for
a component being **added**. It is never read when rendering a charge that
already exists. An admin editing a default therefore changes what the *next*
component is offered and leaves every existing quote exactly as its operator
left it.

That guarantee lives at an **import boundary**, and the test enforces it:
no module under `src/components` or `src/app` may import `charge-defaults`
today, and when the authoring surface is wired, exactly one may. A rendering
path importing it is the way this guarantee would be lost, so it fails the
build rather than relying on care.

---

## 5 · Applicability is not posting readiness

Two questions, different owners:

| Question | Answered by |
|---|---|
| Should this charge be offered here? | this proposal |
| Is its destination mapped and verified in NetSuite? | `componentChargeDestination` + the item map |

A resolution carries no readiness field, and a suggestion must never be read as
one. This matters concretely today: **no component charge destination has a
verified production NetSuite mapping** — only `formulation` and
`filling_blending` are configured. A charge can be correctly suggested,
correctly accepted, and still not post.

---

## 6 · Integration requirements — not built here

This PR ships the schema and the resolver. Everything below is identified, not
implemented, and each needs its own review.

| # | Requirement | Notes |
|---:|---|---|
| 1 | **Drizzle schema entries** for both tables | Trivial; deliberately omitted until the DDL is approved, so the two cannot drift |
| 2 | **Admin actions** — set verdict, add/edit/remove rule | Admin-gated, transactional **with** their audit entry, audit action named after the transition. Must enforce the cross-table invariant §2 rejects. |
| 3 | **Audit vocabulary** | New `audit_log.action` values, e.g. `product_type_charge_profile_updated`, `product_type_charge_default_updated`. Transition-named per the convention. |
| 4 | **Settings surface** | Under `/admin`. Must render all four states distinctly — and a missing rule as "needs review", never as "no charges". |
| 5 | **Authoring-surface wiring** | The single permitted importer. Preselection only; the operator confirms. **Touches Costs — explicitly out of scope by instruction.** |
| 6 | **Read path** | One query per product type: profile + rules, resolved by `resolveChargeDefaults`. No second implementation in SQL. |

### Open questions

1. **Should the cross-table invariant be a constraint trigger?** It would move
   §2's contradiction from "reported" to "impossible". Not taken in the draft
   without a decision: this repo has one constraint trigger already, and it
   refused a migration in a way that took real time to diagnose.
2. **What happens to rules when a HubSpot option is retired?** Rows would
   reference a value the vocabulary no longer offers. Harmless — nothing can
   carry the type — but the Settings surface should probably show it.
3. **Who maintains these?** Same open question as unmapped Product Types. An
   admin surface with no named owner is the shape that decays.
4. **Does a rule belong to a product type, or to a type-and-something?** The
   audit found what Product Type cannot determine — stock vs custom tooling,
   printed vs unprinted. A per-type default is over-inclusive by design; the
   operator declines. Worth confirming that is acceptable rather than assumed.

---

## 7 · What is in the PR

| File | |
|---|---|
| `drizzle/0131_draft_product_type_charge_defaults.sql` | Draft DDL, unjournaled, unseeded |
| `src/lib/commercial-recovery/charge-defaults.ts` | The resolver — pure, total over four states |
| `tests/unit/charge-defaults.test.ts` | 12 tests, one per requirement |
| `scripts/verify/migration-index-unique.ts` | Records the draft |
| this document | |

No production migration. No deployment. No seeded rule. No classification
changed.
