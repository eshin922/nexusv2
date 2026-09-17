# `project_setup`, `rd_formulation`, `testing_micros` as owned charges

**2026-09-16 · review answers, and the bounded extension is now IMPLEMENTED for
`project_setup` and `rd_formulation`. #596 itself stays held — no production
migration, deployment, seeding or CD change.**

> **Implemented:** the two keys are component-ownable, bound to the shared
> `PRODUCTION_MARKUP_CATEGORY`, and resolving `otc_setup` / `otc_formulation`.
> **`testing_micros` is NOT** — §1's per-line finding stands, and its existing
> paths and per-line selection are untouched. Evidence:
> `npm run validation:owned-production-fee-walk` — **0 failures, 3
> indeterminate** — plus `legacy-otc-owner-boundary`'s double-emission
> falsifications, now covering both new keys.
>
> **Freeze and readiness are now DRIVEN, not indeterminate.** The earlier round
> reported them blocked because no snapshot in the isolated environment carried
> a frozen line. That was true and was not a reason to stop: the walk now builds
> the frozen matrix from the quote's own projection with the real freeze writer,
> then runs readiness against it. Remaining detail in §7.

Candidate head for this round: **`f93f2e0c`** plus the commit adding
`scripts/gate-1b/per-line-destination-walk.ts` and the corrections below.
The evidence command is `npm run validation:per-line-destination-walk` —
**13 pass, 0 fail, 1 reported INDETERMINATE.**

---

## 1 · Testing, reconciled against runtime code — **I was wrong**

**`otc_testing` IS in `PER_LINE_DESTINATIONS` at HEAD.** My previous round said
it took a firm-wide mapping and needed no per-instance selection. That was
wrong, and the way it was wrong matters: I read migration `0090`'s comment,
which was accurate when written, and treated it as governing. It predates the
Case 0 extension. **The runtime set is the authority; a migration comment is
evidence about the day it was written.**

`src/lib/netsuite/bv011-destinations.ts` states the reason:

> `otc_testing` is per-line for a different reason, settled by Accounting in
> Case 0: the account carries several genuinely distinct testing items (Micro
> Testing, HRIPT, Re-Test) that one firm-wide mapping would collapse.

### The trace — authoring → freeze → readiness → posting

| Stage | Behaviour at HEAD | Demonstrated |
|---|---|---|
| **The switch** | `isPerLineDestination('otc_testing') === true`; exactly two per-line destinations, and `otc_setup` / `otc_formulation` are not among them | **executed** |
| **Authoring** | `saveDestinationMapping` **refuses** a firm-wide row for it — *"OTC - Testing has no firm-wide NetSuite item by design — its item is chosen per line."* Refused rather than accepted-and-ignored, because a firm default would silently win over the per-line choice. A firm-wide destination still accepts one, so the refusal is not blanket | **executed** |
| **Freeze** | A **Direct Service** line resolves its selection by asking the predicate (`isPerLineDestination(dest)`) and reading `quote_other_service_items` by leaf. A **component-charge** line freezes `selectedNetsuiteItem: null` **unconditionally** | **executed** (predicate + the hard-coded null) |
| **Readiness** | `isPerLineDestination(destination)` → an empty frozen selection raises `per_line_destination_unresolved`, whose remediation sends the operator to **Costs**, not Settings — the latter would ask an admin for a row the schema forbids | **partly. See below** |
| **Posting** | The **frozen** selection is carried as `netsuiteItemId`, not the current one: for this destination the operator's choice *is* the governance | not driven — no line reached posting |

### What could NOT be demonstrated, reported as its own outcome

**INDETERMINATE — the readiness stage could not be driven end to end.** No
snapshot in the isolated environment carries any frozen line, so
`assessProjectionReadiness` short-circuits at `no_frozen_matrix` and the
per-line branch is never reached. My first attempt appended a synthetic line to
such a snapshot and reported "no blocker" — a true reading of a state that has
nothing to do with the behaviour under test. It is reported as a third outcome
rather than folded into a pass.

What **was** established without a frozen matrix: the blocker's operator
instruction is distinct from every other unresolved-destination state, and
sends a person to Costs rather than Settings.

**Closing it needs a frozen-matrix fixture in the isolated environment.** That
is its own piece of work and is not in this scope.

### What this does to the proposal — a verified gap that requires a migration

The same file carries the constraint that decides it:

> `quote_other_service_items` is keyed by OWNER — (quote, assembly XOR leaf) —
> with no destination discriminator. That holds only while at most ONE per-line
> destination can attach to a given owner… The moment a per-line destination
> arrives as an OTC FEE COLUMN, one assembly could need two selections and the
> key admits one — that needs a `destination` column, a new unique key, and a
> backfill. **Do not add such a destination here without doing that first.**

**Demonstrated against the database, not read:** the table has **no**
destination column, and `qosi_leaf_unique` — `UNIQUE (quote_leaf_id) WHERE
quote_leaf_id IS NOT NULL` — **refused a second selection for the same owner**
in the walk.

So an owned `testing_micros` charge trips exactly the case the comment warns
against: an owner could hold an Other-Service selection and a Testing selection,
and the key admits one.

**Revised recommendation — the three keys split:**

| Key | Destination | Per-line? | Verdict |
|---|---|:--:|---|
| `project_setup` | `otc_setup` | no | **Proceed.** Firm-wide mapping, already resolved. No migration |
| `rd_formulation` | `otc_formulation` | no | **Proceed.** Same |
| **`testing_micros`** | `otc_testing` | **yes** | **HOLD.** Needs the selection table to gain a `destination` discriminator, a new unique key and a backfill — plus a place on a component charge to record the selection at all, since freeze hard-codes it null |

**My previous "no migration" claim holds for two of the three and not the
third.** This is the verified gap that would justify one, and it should be its
own scoped change rather than folded in.

---

## 2 · Duplicate guard — concrete cases

The question is what **recorded facts** distinguish one cost represented twice
from two genuinely separate fees that share a category.

### Case A · The same cost, twice — a duplicate

A Direct Service leaf whose identity is **Testing / Micros**:

```
quote_leaves            id = L, commercial_kind = 'service', identity = testing_micros
assembly_production_inputs   quote_leaf_id = L, tier = T, testing_micros_total = 900.00
quote_charge_instances       owner_quote_leaf_id = L, charge_key = 'testing_micros'
quote_charge_instance_tiers  tier = T, cost_amount = 900.00
```

**Recorded facts that make this a duplicate — no judgement required:**

1. `DIRECT_SERVICE_PRODUCTION_INPUT[testing_micros] = 'testingMicrosTotal'` —
   that column **is** this leaf's one governed input.
2. `OTC_COLUMN_TO_CHARGE['testingMicrosTotal'] = 'testing_micros'` — the charge
   key resolves to the same column.
3. The charge's owner **is** the leaf that owns the column.

Composition 1→2→3 is exact: the leaf's identity determines one column, the
column determines one charge key, and both rows sit on the same owner. **They
are two representations of one governed value**, and the amounts need not match
for that to be true — a $900 column and a $500 charge is the same duplication,
mis-stated.

Only three identities can collide this way: `formulation` → `rd_formulation`,
`testing_micros` → `testing_micros`, `other_service` → `other_service`.
`filling_blending` and `packout_assembly` map to recurring columns that are in
no charge-key map, so they cannot.

**Guard: refuse.** Narrow, computable from recorded facts, and the only case
where identical facts mean one fee.

### Case B · Two separate fees sharing a category — not a duplicate

**B1 — two testings on one component.** A carton fails micro and is re-tested:

```
instance 1  owner_ref = L, charge_key = 'testing_micros', label = 'Micro Testing'
instance 2  owner_ref = L, charge_key = 'testing_micros', label = 'Re-Test'
```

**The distinguishing recorded fact is `label`.** The business-unique key is
`(quote_id, charge_key, owner_ref, label)` with `NULLS NOT DISTINCT`, so two
same-key charges on one owner **can only exist if their labels differ** — the
constraint forces the distinction to be recorded rather than assumed. Both are
real, both bill, and the Accounting items behind them genuinely differ, which is
precisely why Case 0 made testing per-line.

> **And B1 is representable but not postable today**, for the §1 reason: the
> selection table admits one row per owner, so two testing charges on one owner
> cannot carry two different NetSuite items. The same tripwire, reached from the
> other direction.

**B2 — a group's set-up and a component's set-up.**

```
instance 1  owner_ref = '@quote'   charge_key = 'project_setup'   (from the Item Group column)
instance 2  owner_ref = L          charge_key = 'project_setup'   (a component-caused set-up)
```

**The distinguishing recorded fact is `owner_ref`.** A run set-up and a
component-specific set-up are different commercial facts, and the owner is what
says so. Both rows are permitted by the unique key and **should be** — refusing
this is what pushes operators back to the group's single column.

**Guard: allow, and surface both together on Costs so a person can see they are
two.** Nexus cannot tell a legitimate pair from a mis-entered one; it can make
the pair visible, which is the honest limit.

### The rule, in one line

> Refuse only where the recorded facts prove identity: **same owner, and the
> charge key is the one that owner's own governed production input already
> occupies.** Every other repetition is distinguished by `owner_ref` or by
> `label`, both of which the schema already forces to be recorded.

---

## 3 · Markup — reuse the existing authority, introduce no rate

**Corrected framing.** My previous round wrote "Production 0.40" throughout,
which reads as proposing a rate. **No rate is being proposed.** The rate lives in
`markup_defaults.Production` — admin-editable, currently 0.40 — and is resolved
at compute time by `resolveMarkupStrict`. What is chosen is the **category
binding**.

**Reuse the existing binding, not a second copy of the string:**

```ts
// costing.ts today
export const PRODUCTION_MARKUP_CATEGORY = "Production";
// …applied by chargeEconomicsFor to all seven fee columns
rateCategory: ratePct === null ? null : PRODUCTION_MARKUP_CATEGORY,
```

The component authority table should reference **that binding**:

```ts
project_setup:   { kind: "governed", category: PRODUCTION_MARKUP_CATEGORY },
rd_formulation:  { kind: "governed", category: PRODUCTION_MARKUP_CATEGORY },
```

**One mechanical obstacle, and its resolution.** `costing.ts` imports from
`registry.ts`, so `registry.ts` cannot import from `costing.ts` — the constant
must **move to `registry.ts`** and `costing.ts` import it from there. Not a
rewrite: one declaration relocated, one import added, no call site changed, and
`chargeEconomicsFor` keeps using the same binding it uses now.

Writing `category: "Production"` in the authority table would compile and be
correct today, and would be a **second copy free to drift** from the one
`chargeEconomicsFor` reads. One binding is the point.

**What this guarantees:** if an admin changes the Production rate, the owned
charge and the production column move together, because they resolve the same
category through the same map. Attribution does not move arithmetic — Pattern 58.

*(`testing_micros`'s authority is held with the rest of that key, per §1.)*

---

## 4 · What changed in this round

| | |
|---|---|
| `scripts/gate-1b/per-line-destination-walk.ts` | **new** — the four-stage trace, isolated-only, self-cleaning |
| `package.json` | the walk's script entry |
| `src/lib/commercial-recovery/charge-defaults.ts` | **reverted** — my last round changed this comment to say testing was firm-wide. Restored, with the runtime set cited |
| `docs/proposals/product-type-charge-defaults.md` | same revert |
| this document | rewritten around the three answers |

**No change to `registry.ts`, `component-charge-destination.ts`,
`commercial-projection.ts` or any schema.** The §3 relocation is recommended,
not made.

---

## 5 · Decisions, revised

| # | Decision | Status |
|---:|---|---|
| **1** | **`project_setup` + `rd_formulation`**: bind to `PRODUCTION_MARKUP_CATEGORY`, relocating the constant to `registry.ts` so there is one copy | ready for approval — no migration |
| **2** | **`testing_micros`**: **held.** Per-line destination; needs a `destination` discriminator on `quote_other_service_items`, a new unique key, a backfill, and somewhere on a component charge to record a selection | needs its own scoped change |
| **3** | **Duplicate guard**: refuse same-owner-same-governed-input (§2 Case A); allow and surface everything else | ready for approval |
| **4** | **Frozen-matrix fixture** for the isolated environment, so readiness and posting can be driven | separate, and it would close the INDETERMINATE above |

---

## 7 · Freeze → readiness → posting, driven

`npm run validation:owned-production-fee-walk`, repeatable, self-cleaning.

**Both presentations, from one election:**

| Election | Customer line | Verified |
|---|---|---|
| `included` | **none** — recovered inside the unit price | ✓ |
| `separate` | its own line, keyed `otc:instance:<id>` | ✓ |

The first version of this section asserted an OTC line with **no election
recorded** and reported a failure. The code was right and the fixture was
wrong — an unelected charge is not `separate`, and `included` correctly emits
nothing. Both are now asserted, so the check can tell them apart instead of
assuming one.

**Freeze.** The real writer wrote 5 lines, the owned charge among them, with
`bv011_destination = otc_setup` **recorded on the frozen line** and
`selected_netsuite_item_id` null — correct, because `otc_setup` is firm-wide. A
per-line destination there would have had nowhere to record a selection, which
is §1's finding reached from the freeze side.

**Readiness.** Reaches the line loop — no `no_frozen_matrix`. The charge raises
**no blocker of its own**: not `per_line_destination_unresolved`, not
`ungoverned`, not `destination_not_recorded`. `unmapped_destination` was
cleared by seeding stand-in mappings the isolated database lacks (removed
afterwards; production mappings and their account provenance are untouched).

**One blocker remains: `provisional_tier`** — the fixture quote's tier total is
provisional, so an order cannot be posted for a number the customer was told was
a floor. That is a property of that quote, not of the charge, and clearing it
would mean manufacturing a different quote. The posting payload is therefore
reported INDETERMINATE for the real frozen line and **verified for the emitter**:
`emitAccountingLines` produces one line, quantity 1, the amount as the line, at
the resolved item — and sends nothing.

### 7.1 · The payload, closed on a purpose-built quote

`npm run validation:owned-fee-payload-walk` — **0 failures, 0 indeterminate,
repeatable.**

The other walk stops at `provisional_tier` on an existing quote. **That quote is
deliberately untouched and is the evidence that posting is correctly refused**
for a total the customer was told was a floor. This walk builds its own fully
costed, non-provisional quote instead — one product at a real unit cost, which
is the only difference that matters, since a tier is provisional exactly when a
UNIT line is unpriced.

Both supported keys, through the real path, **nothing sent**:

| | `project_setup` | `rd_formulation` |
|---|---|---|
| Cost | $1,000 | $2,500 |
| Destination | `otc_setup` | `otc_formulation` |
| Resolved item | 81001 | 81002 |
| Quantity | 1 | 1 |
| Amount | **140,000c** | **350,000c** |

The amounts are the costs at the configured Production rate — 1,000 × 1.40 and
2,500 × 1.40 — and the two differ, so a payload that crossed them would be
caught rather than coincidentally passing.

**No duplicate recovery**, at three levels: exactly two OTC lines project;
exactly one accounting line per charge emits; and the emitted total is
**490,000c against a frozen OTC subtotal of 490,000c, exactly**. The unit
subtotal (560,000c) is real and excluded — it posts by its own path — so the
equality is not satisfied by a quote that priced nothing.

`testing_micros` is asserted to still refuse as a component charge.

**Two assertions in this walk were wrong before the code was.** It matched
frozen and emitted lines on `COMPONENT_CHARGE_LABELS`, which is the authoring
picker's vocabulary ("R&D / formulation"), while a line carries its charge
POLICY label ("R&D") — a pre-existing, deliberate divergence. And it reconciled
the emitted total against the whole tier total rather than the OTC subtotal,
which measured two different things. Both were fixture errors reported as
failures, and both are recorded here because the fix was to the measurement.

---

## 6 · Tracked separately, unchanged

**The $1,727.60 unbillable placement.** Quote `4781e4bb`, named in
`unbillable-placements.ts`: a Direct Service leaf's charge placed
`separate_line`, counted as tier revenue by the engine while the customer
document billed nothing for it — $1,727.60 / $3,283.00 / $172.20 / $1,727.60
across four tiers. Electing it is now refused
(`DIRECT_SERVICE_NOT_SEPARATELY_BILLABLE`); the detector finds states created
before the refusal existed.

**Tracked as `docs/defects/DEFECT-2026-09-16-unbillable-direct-service-placement.md`.
Not investigated, not repaired, and the affected quote is not touched** —
correcting one of these changes what a real customer owes, which is why the
module detects rather than repairs.

**#596 remains held. Nothing in §5 is implemented.**
