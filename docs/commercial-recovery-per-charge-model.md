# Reconciled model — per-charge commercial recovery

Supersedes the two-axis model. Design return only; nothing implemented.

Per the direction: the two-axis disposition is withdrawn, the Design Authority's
three-mode contract is adopted, the missing policy layer is added, and the
recovery workspace is one governed product surface rather than "model now, UX
later".

---

## 0 · Migration 0098 is withdrawn, not extended

`0098_commercial_recovery_profile.sql` is applied to the shared database
(96 → 97) with **all 89 quotes NULL** and preservation clean. It is **not
committed**, and it creates two enums and four columns the per-charge model does
not use.

**It must be reversed before anything is committed on top of it.** Because every
value is NULL and no code reads the columns, the reversal is genuinely
behaviour-neutral — but it is a *destructive* migration (`DROP COLUMN`,
`DROP TYPE`), so it cannot precede the code that stops referencing them. Order:

1. revert `schema.ts` and `commercial-recovery.ts` to drop the two-axis shape;
2. deploy that (no reader remains);
3. then apply the reversal migration.

The journal row must be identified by its verified `created_at`/`id`, **never by
a `hash LIKE '%0098%'` predicate** — `hash` is a content hash and that predicate
silently matches zero rows, leaving the journal claiming a migration whose
objects no longer exist.

---

## 1 · Charge identity — proven, not invented

The Authority names five charges. Nexus governs more fee fields than that, so
the grain has to be derived from what the codebase already discriminates rather
than from a list of five.

**It already discriminates it.** `production-drilldown.tsx:110` declares:

```ts
kind: "tier_total_cogs" | "one_time_fee";
```

…and classifies all nine service-fee fields against it (lines 121-131). That is
the structural discriminator the recovery model needs.

**But it lives in a UI component's local constant table.** Building recovery on
it as-is would make a customer-facing commercial election read its policy out of
presentation code. So the first step is a promotion, not a new invention:

> Promote the `kind` discriminator and the field→charge mapping out of
> `production-drilldown.tsx` into a governed registry in `src/lib/`. The
> drilldown then *reads* the registry. Nothing about the classification changes;
> only its owner does.

### The three grains

| grain | members | election |
|---|---|---|
| **per-unit COGS** (`tier_total_cogs`) | filling/blending, CM assembly, bulk raw, all packaging | **none — always `included`** |
| **one-time fees** (`one_time_fee`) | setup, tooling, artwork, tooling/artwork *(legacy)*, R&D, testing, other | electable |
| **landed** | container freight, duty & tariffs | electable |

Per-unit COGS is **not a charge and gets no toggle**. It is the unit price. This
is what stops the model sprawling to every numeric field, and it is a structural
statement rather than a UI decision.

### Registry mapping

| Authority charge | Nexus governed source | grain | ruled by |
|---|---|---|---|
| Container freight | `freight_leg_tiers.total_freight` + freight markup | landed | Authority |
| Duty & tariffs | `freight_legs.customs` (duty, tariff) | landed | Authority |
| Tooling | `assembly_production_inputs.tooling_total` | one-time | Authority |
| Project setup | `assembly_production_inputs.setup_fee_total` | one-time | Authority |
| Artwork & plate | `assembly_production_inputs.artwork_total` | one-time | Authority |
| — | `rd_total`, `testing_micros_total`, `other_service_total`, `tooling_artwork_total` | one-time | **BV-011 — see §1.5** |

`chargeId` is **not arbitrary line-level configurability.** The registry is a
finite, closed set of known commercial charges, each carrying its own policy. A
charge exists because it is governed, not because a field is numeric.

---

## 1.5 · BV-011 trace — the four fees the Authority does not rule on

Traced before proposing policy, as directed. **BV-011 classifies all four.
Classification is not recovery policy, and BV-011 says so itself.**

### What BV-011 settles

| Nexus field | BV-011 destination | Item type |
|---|---|---|
| `rd_total` | `OTC - Formulation` | Non-inventory Item |
| `testing_micros_total` | `OTC - Testing` | Non-inventory Item |
| `other_service_total` | `OTC - Other Service` | Non-inventory Item |
| `tooling_artwork_total` | **spans two** — `OTC - Tooling` (Inventory) **and** `OTC - Artwork` (Non-inventory) | — |

### What BV-011 explicitly withholds

> *"This document **authorizes no implementation.** … no code, schema, or
> migration may cite it as authority to do so. … Until then it governs only one
> thing: what the categories **are**."* — BV-011 Status

And §3 excludes by name *"any change to customer-facing presentation (Quote
surface, customer PDF)"* — which is precisely what a recovery election is.

**So BV-011 answers *what item type*, and deliberately does not answer *how it
is recovered from the customer*.** Citing it to justify allowed modes would be
the exact misuse it forbids in its own opening paragraph.

### Disposition — non-elective, with governed refusals

All four enter the registry so they are visible and accounted for, and all four
carry `available: []` with a stated reason — never a guessed mode set:

| charge | governed refusal reason |
|---|---|
| R&D / Formulation | *Recovery policy not yet dispositioned. BV-011 classifies this charge (`OTC - Formulation`) but does not authorize customer-facing recovery treatment (BV-011 §3).* |
| Testing / Micros | *Recovery policy not yet dispositioned (BV-011 §3). No input surface exists for this field today (BV-011 §4.1).* |
| Other Service | *Recovery policy not yet dispositioned. BV-011 classifies this charge (`OTC - Other Service`) but does not authorize customer-facing recovery treatment (BV-011 §3).* |
| Tooling / artwork *(legacy)* | *Legacy combined field spans two governed destinations with different item types — `OTC - Tooling` (Inventory) and `OTC - Artwork` (Non-inventory), BV-011 §4.2. A single election cannot be applied coherently until the field is split.* |

Each keeps today's behaviour exactly: they resolve through
`allocate_service_fees_to_cost`, unchanged.

The last is the strongest refusal in the registry, because it is not merely
"undecided" — it is **structurally un-electable in its current shape**, and the
reason names the migration that would change that.

### One consequence to record, not bury

BV-011 §4.9 states that `allocate_service_fees_to_cost` is *"a single boolean
governing Setup, Tooling / artwork, R&D and Other service **together**"*, and
that whether allocation stays uniform is a **workstream decision**.

Making Setup, Tooling and Artwork electable while R&D and Other Service stay on
the boolean is therefore **the first break in uniform allocation.** It follows
directly from the Authority ruling on three of them and not the others — it is
not smuggled in. Flagged in §8 so the Production / OTC workstream inherits it
stated rather than discovered.

---

## 2 · The three-mode contract

```ts
type RecoveryMode = "included" | "separate" | "absorbed";
```

| mode | cost | customer revenue | customer sees |
|---|---|---|---|
| `included` | in unit cost | in unit price | nothing — embedded |
| `separate` | in unit cost | **same total**, re-composed | its own line |
| `absorbed` | in unit cost | **removed** | nothing |

**`included ↔ separate` is revenue-neutral.** This preserves D1 exactly: it is
decomposition, not a price increase. The amount lifted out of unit revenue is
the amount the separate line carries.

**`absorbed` is the only mode that moves the total.** Per the Authority:
*absorbed charges add cost but no revenue* — absorbing is what pushes margin
toward the floor, and therefore what can drive a quote below floor and require
authorization.

### `per_assembly` is not a fourth mode

The recovery vocabulary is **exactly three**. `per_assembly` is not carried
forward as a mode, because it is not a commercial election at all — it is the
*absence* of one.

Legacy service-fee behaviour resolves through the existing per-assembly
`allocate_service_fees_to_cost` value when **no election row exists**. That
preserves the mixed legacy quotes without confusing provenance with a new
commercial choice: "nobody elected, so read the assembly setting" and "someone
elected `included`" stay distinguishable, which a fourth enum member would
collapse.

**Explicit elections override projection only.** They never rewrite the
underlying assembly values, so removing an election restores the legacy
behaviour exactly rather than resurrecting nothing.

The IEEE-754 discipline from D1 carries over unchanged and now applies per
charge: **short-circuit the identity case** rather than computing `rate − 0`,
assert neutrality on the per-tier total at a stated tolerance, and assert that
composition *changed* as well as that the total did not — a test proving only
the second passes against a branch wired to nothing.

---

## 3 · The policy layer

Each governed charge resolves four things. This is the layer the two-axis model
was missing, and the reason a free three-state toggle is wrong.

```ts
type ChargePolicy = {
  key: ChargeKey;                       // stable registry identity
  label: string;                        // operator- and customer-facing
  grain: "one_time" | "landed";
  available: RecoveryMode[];            // never assume all three
  refusals: Partial<Record<RecoveryMode, string>>;  // why, per denied mode
};
```

`available` and `refusals` are **exhaustive of each other**: every mode not in
`available` must carry a refusal reason. A mode denied without a stated reason is
a bug, and is asserted as such.

### The policy map

| charge | included | separate | absorbed | refusal |
|---|:--:|:--:|:--:|---|
| Container freight | ✓ | ✓ | ✗ | *Policy: freight must be recovered* |
| Duty & tariffs | ✓ | ✓ | ✗ | *Statutory pass-through — cannot be absorbed* |
| Tooling | ✓ | ✓ | ✓ | — |
| Project setup | ✓ | ✓ | ✓ | — |
| Artwork & plate | ✓ | ✗ | ✓ | *Not separately invoiceable* |
| R&D / Formulation | ✗ | ✗ | ✗ | BV-011 §3 — see §1.5 |
| Testing / Micros | ✗ | ✗ | ✗ | BV-011 §3 + §4.1 — see §1.5 |
| Other Service | ✗ | ✗ | ✗ | BV-011 §3 — see §1.5 |
| Tooling / artwork *(legacy)* | ✗ | ✗ | ✗ | BV-011 §4.2 — see §1.5 |

Refusal strings for the first five are taken **verbatim** from the Design
Authority rather than paraphrased. The last four are governed by BV-011 and are
**non-elective** — present in the registry, visible in the surface, and refused
with a reason, rather than absent or guessed.

**The surface renders the denied mode as denied with its reason visible — it
does not hide it.** A hidden option reads as an option that does not exist; a
visibly-refused one teaches the policy. The action layer refuses it
independently, because the surface is not the boundary.

---

## 4 · Schema

### The election table

```sql
CREATE TYPE "recovery_mode" AS ENUM ('included', 'separate', 'absorbed');

CREATE TABLE "quote_charge_recovery" (
  "quote_id"   uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "charge_key" text NOT NULL,
  "mode"       "recovery_mode" NOT NULL,
  "elected_at" timestamptz NOT NULL DEFAULT now(),
  "elected_by_user_id" uuid REFERENCES "users"("id"),
  PRIMARY KEY ("quote_id", "charge_key")
);
```

…and a snapshot mirror keyed to the snapshot, so a sent revision can never
inherit a later revision's election (D2, preserved and now structural).

### Absence of a row is the load-bearing state

This is what the two-axis `per_assembly` enum member was reaching for, and the
row model expresses it better:

| charge | no row means | which is exactly |
|---|---|---|
| freight | `included` | today's `freightLines: []` |
| duty & tariffs | `included` | today's silent embedding |
| one-time fees | **defer to the per-assembly setting** | today's `allocate_service_fees_to_cost` |

So **mixed allocation stays representable without a fourth enum member**, and
D3's non-destructive override survives intact: an explicit election overrides at
*projection* time and never writes the assembly column, so clearing it restores
the preserved exceptions rather than resurrecting nothing. The three real mixed
quotes — `f2db6e10`, `f5f5ac14`, `a264a755` (sent) — are untouched.

No backfill. No default written to any row. **All 89 quotes and all 29 snapshots
are byte-identical with zero rows in the new table.**

### Migration / reversal sequence

Two migrations, in this order. The ordering is set by **compatibility**, not by
a fixed direction — an additive one may lead its code, a destructive one may
not.

| # | step | class | may it precede its code? |
|---|---|---|---|
| 1 | revert `schema.ts` + `commercial-recovery.ts` to drop the two-axis shape | code | — |
| 2 | **deploy** step 1 — no reader of the 0098 columns remains | deploy | — |
| 3 | `00NN_withdraw_0098.sql` — `DROP COLUMN` ×4, `DROP TYPE` ×2 | **destructive** | **no** — must follow step 2 |
| 4 | `00NN_quote_charge_recovery.sql` — new enum + 2 new tables | **additive** | **yes** |
| 5 | registry + policy + resolution + projection + freeze + workspace | code | — |

Step 3 is behaviour-neutral in effect — all 89 quotes are NULL and nothing
reads the columns — but it is destructive in *kind*, which is what decides its
position. Step 4 is safe ahead of its code because every existing writer of
`quotes` and `quote_snapshots` continues to succeed without mentioning the new
tables.

Migration filenames resolve against `drizzle/meta/_journal.json` at authoring
time rather than being assumed from the brief. The journal row for 0098 is
identified by its **verified `created_at`/`id`** — never by a
`hash LIKE '%0098%'` predicate, which matches zero rows and silently leaves the
journal claiming a migration whose objects are gone.

### Freeze list

`quote_charge_recovery` joins the Pattern 52 freeze list; `assertNotFrozen`
guards every election writer.

---

## 5 · Revised test matrix

**Preserved guarantees — these must not move:**

| # | case | expect |
|---|---|---|
| 1 | 29 existing snapshots, rendered with zero election rows | **byte-identical** |
| 2 | the 3 mixed-allocation quotes | mixed state **representable and preserved**, not flattened |
| 3 | Layer 1 under any election set | every internal cost scalar **identical** |
| 4 | Layer 1, asserted from the other side | revenue **moved** — a cost-only assertion passes against a no-op branch |
| 5 | `included → separate`, any charge | total revenue **identical**, composition **different** |
| 6 | `included → absorbed` | revenue **falls by the charge**, margin **falls**, cost unchanged |

**New — the policy layer:**

| # | case | expect |
|---|---|---|
| 7 | absorb container freight | **refused**, with *Policy: freight must be recovered* |
| 8 | absorb duty & tariffs | **refused**, with the statutory reason |
| 9 | separate artwork & plate | **refused**, with *Not separately invoiceable* |
| 10 | every charge in the registry | every mode absent from `available` has a refusal string |
| 11 | refusal enforcement | the **action** refuses, not only the surface |
| 12 | a per-unit COGS field | **no election exists** — not addressable as a charge |
| 13 | quote-level election | **never writes** `allocate_service_fees_to_cost` |
| 14 | clear an election | per-assembly exceptions **restored**, not lost |
| 15 | absorb enough to cross floor | authorization **required**; existing fingerprint invalidation fires |
| 16 | sent revision, later revision elects | sent revision **unchanged** |
| 17 | identity case (`0` charge) | rate left **untouched** — no `rate − 0` round trip |
| 18 | registry ↔ drilldown | the drilldown reads the registry; classification has **one** owner |
| 19 | the four BV-011 fees | `available` is **empty**, each with a governed refusal; none is electable |
| 20 | legacy `freight_treatment` | **has no commercial consequence** — it cannot become a second recovery authority |
| 21 | economics-changing election with a live approval | supersession fires through the **existing** mechanism; **no second invalidation write is added** |

Case 20 is the one that keeps "one governed source" enforced rather than
intended. It pins the property directly — that changing `freight_treatment`
moves no customer-facing number — rather than asserting that some module does
not import it, because an import ban is cheap to satisfy while still breaking
what it was meant to protect.

Case 21 is asserted as an **absence**: `projectApprovalTierState` already
compares each authorization's stored fingerprint against current economics and
returns `superseded` on any difference, so recovery changing revenue invalidates
automatically. What gets built is only the **warning surface** — telling the
operator at *edit* time that an election will supersede an approval they just
chased, rather than at SEND. No new write.

Cases 4, 5 and 6 together are what make the contract falsifiable: 5 asserts two
constants and one change; 6 asserts the opposite of 5 on the same machinery.

---

## 6 · Implementation boundary — corrected

The earlier "model now, UX later" split is withdrawn. **The recovery workspace is
one governed product surface**, delivered as a unit: registry + policy +
resolution + projection + freeze + the two-panel workspace the Authority
specifies (fluid preview, 452px rail, four numbered cards, freeze-and-send
footer).

Preservation evidence (§5 cases 1-6) is still reported **before** the surface is
built — not as a separate deliverable, but because a surface built on an
unproven projection has nothing to stand on.

---

## 7 · Findings requiring disposition

### 7.1 · Terms & conditions — governed, frozen, resolved, and never rendered

Raised in review, and worse than an Authority omission.

| layer | state |
|---|---|
| `firm_settings.tcs_default` | exists, **NULL** |
| `quotes.tcs_snapshot` | exists, **on the Pattern 52 freeze list** |
| `customer-view-resolver.ts:161` | resolves `isSent ? tcsSnapshot : tcsDefault` |
| `CustomerViewQuote.tcs` (`quote.ts:106`) | declared in the customer contract |
| `quote-fixtures.ts:49` | a Pattern 45 stub: `{tcs-pending — configure on /admin/firm-settings}` |
| **any renderer** | **none** |

`TermsBlock` exists but renders the *commercial terms pairs* — payment terms,
lead time, incoterms. It does not render `tcs`. So the legal terms text is
resolved into the customer contract, frozen at send, and **invisible to the
customer**.

This is the third instance this month of governed state with no consumer, after
`refreshFromHubspot` (zero callers) and `freight_treatment` (persisted,
operator-set, acted on by nothing).

**Disposition — treat as a real Quote Presentation defect.** `tcs` is added to
the new customer-facing Quote presentation as **its own governed element**,
rendered from the governed contract state rather than left invisible.

**It is not conflated with `TermsBlock`.** Those are the commercial terms
*pairs* — payment terms, lead time, incoterms — which are short labelled values
in a four-cell block. T&C is the actual terms-and-conditions body: different
content, different length, different governance, and it carries its own
snapshot column on the freeze list. Rendering it inside the pairs block would
misrepresent both.

Two sub-decisions remain (§8): whether it renders on the quote body or as an
addendum page, and that `tcs_default` is **NULL today**, so nothing prints
until it is configured — a Pattern 45 stub decision, not a rendering one.

### 7.2 · Post-production reconcile — retire; the trace supports it for a stronger reason than stated

Traced before deleting, as directed.

| | finding |
|---|---|
| **field** | `assembly_production_inputs.actual_units_produced` (`schema.ts:3426`), integer, nullable. **Formula yield has no fields at all** — 3 of its 4 cells are hardcoded `—`. |
| **writers** | `assembly-production-inputs.ts` accepts it. **No input element is named `actualUnitsProduced` anywhere in `src/`.** The only `fd.set` (`production-drilldown.tsx:902`) is a carry-forward that preserves the existing value while *other* fields save. |
| **math layer** | declared at `costing.ts:223` and **never read**. A dead input slot. |
| **readers** | one read-only display, one derived `runLocked` flag (`costs/page.tsx:913`), one forensic clone-path snapshot, and the cost fingerprint. |
| **live data** | **0 of 111 rows populated.** Legacy `production_inputs` no longer exists. |

**The premise was that this is manual data entry nobody does. The truth is it
cannot be entered at all** — there is no input, and the math never reads it.
"Pricing reconciliation" is a hardcoded em-dash. The decision is right for a
better reason than the one given.

**One dependency needs care.** `actualUnitsProduced` is a segment of the
`prod:` part of `costBaseFingerprint` (`pricing-cost-base.ts:89`). Removing it
changes the fingerprint string for every quote.

It is **safe**, and this was checked rather than assumed:

- `costBaseFingerprint` is **never persisted** — no column holds it; it is
  recomputed on both sides of a comparison;
- the one stored authorization (`below_floor_authorizations`, 1 row) carries a
  **different** fingerprint — `rev:124800.00|cost:110000.00|margin:0.118590` —
  which does not include this field. **It is not invalidated.**

The residual window is a client holding a pre-change `economicFingerprint`
mid-session seeing one false stale. Self-correcting on re-preview, and inherent
to any fingerprint change.

**Recommendation — retire cleanly:** delete `PostProdReconcile` and its styles,
drop the field from the math-layer input type, the fingerprint, the action, and
the carry-forward. **Keep** the column dormant and keep it in the clone-path
forensic snapshot, per the standing precedent set with `customer_ships_raws` —
the column is free, and dropping it is a destructive migration bought for
nothing. No replacement workflow. Historical quote economics are never
recalculated from later actuals; nothing in this removal touches that, since the
math never read the value.

### 7.3 · Progression-bar consolidation — checked against this Authority

The Authority **does** define a canonical next-action pattern: the
freeze-and-send footer — state chip, recipient, four readiness lines, one
primary action, one secondary, foot sentence. Two of its properties should
govern the consolidation:

- readiness **reports; it does not re-evaluate**;
- presentation is **never invalid, only stated**.

But it is the footer of the **Quote workspace**, whose action is *Send to
customer*. The Costs/Pricing bars advance toward that workspace; their action is
*Continue to Quote*. Same grammar, different act.

**Adopt the footer's grammar, not its action semantics.** Costs and Pricing get
**one consolidated next-action bar** carrying exactly three things:

1. **readiness / status** — reporting, not re-evaluating;
2. **current tier context**;
3. **one action — `Continue to Quote`.**

**It must not say `Send`.** SEND belongs to the Quote surface, one step later.
That is the correction the check produced, and it is why the standalone cleanup
was worth checking against this authority before implementing.

---

## 8 · Open decisions

1. **T&C placement** — quote body or addendum page, and the NULL `tcs_default`
   stub decision.
2. **Freight `separate` vs the Accounting instruction.** The data-source map
   carries a downstream `accounting.freight_billing` (`landed` /
   `at cost, separate`). If the recovery election also decides freight
   presentation, these are two sources for one fact. **BV-011 §4.5 already
   flags this**, in its own words: which document governs freight's
   *presentation* versus its *accounting destination* "needs stating
   explicitly, or the two will be read as competing." They must be reconciled,
   not shipped in parallel.
3. **Uniform allocation breaks here** (§1.5). Setup, Tooling and Artwork become
   electable while R&D and Other Service stay on the shared
   `allocate_service_fees_to_cost` boolean. BV-011 §4.9 records that uniformity
   as a Production / OTC workstream decision; this slice is the first thing to
   depart from it. Recorded so the workstream inherits it stated.

*(The four BV-011 fees are no longer open — traced and dispositioned in §1.5.)*
