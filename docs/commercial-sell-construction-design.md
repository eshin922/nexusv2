# Commercial sell construction — design

**Status — design. Authorizes no implementation.**
Implements the boundary corrected in
[`commercial-sell-construction-boundary.md`](commercial-sell-construction-boundary.md)
(2026-08-23). The infrastructure it builds on merged as inert in #367.

> **Recovery must never change cost truth.**
> **Recovery may change sell composition and revenue.**

---

## 1 · What the engine does today, exactly

Established by reading `src/lib/costing.ts`, not assumed. A one-time charge —
setup, tooling, artwork, R&D, other service, testing — takes one of two paths,
decided by `assembly_production_inputs.allocate_service_fees_to_cost`:

**Allocation ON** (`costing.ts:1848`)

```
oneTimeServiceFeeTotal / tierQty  ->  allocatedServiceFeesPerUnit
                                  ->  productionCostSum
                                  ->  contributionCostPerUnit          (COST)
                                  ->  production section node
                                  ->  sellBefore -> requiredSellPerUnit (REVENUE)
```

Both sides. The margin reflects the charge's cost and its marked-up recovery.

**Allocation OFF**

`allocatedServiceFeesPerUnit = 0`, and `separateServiceFees = 0` —
**unconditionally**, at `costing.ts:1858`. The charge is **absent from the
engine entirely**: not in `contributionCostPerUnit`, not in
`requiredSellPerUnit`, not in `totalCost`, not in `totalRevenue`, not in
`blendedMarginPct`. It exists only as a line the projection emits.

The engine already says so in its own comment at `costing.ts:2472` —
`separateServicesMarkupSum` *"contributed a hard zero … a permanently-zero
operand would put a line in front of operators that never means anything."*

**So `separateServiceFeesPerUnit` and `separateServicesMarkupSumPerUnit` are
dead primitives.** Their type comment still says *"when
allocate_service_fees=false"*. They are always zero. Any design that assumes
they carry the separate-billing case is designing against a name, not a value.

### What this makes the projection

The projection was never relocating a charge. With allocation ON it suppresses
a line for a charge the unit price already carries; with allocation OFF it emits
the only representation of a charge the engine never saw. Those are two
different acts wearing one condition — which is why an election that flipped the
condition deleted a charge in one direction and double-billed it in the other.

---

## 2 · The population this must preserve

Live data, queried 2026-08-23:

| | |
|---|---|
| production rows | **111** |
| rows with allocation OFF | **17** |
| …of those, carrying money | **14** |
| quotes with any allocation OFF | **8** |

| quote | status | one-time money outside every margin | mixed |
|---|---|---|---|
| `4781e4bb` | draft | **$24,600** | |
| `f5f5ac14` | draft | **$17,000** | ✓ |
| `f2db6e10` | draft | **$17,000** | ✓ |
| `52bd0077` | draft | **$14,600** | |
| `97d25286` | **complete** | **$1,600** | |
| `93a5d4bb` | **sent** | **$225** | |
| `071486be` | sent | $0 | |
| `a264a755` | sent | $0 | ✓ |

**≈ $75,025 of real charges sit outside every margin the system computes**, on
quotes the customer has been billed for. Two of them are frozen and carry money:
one `complete`, one `sent`.

This is the number the design has to be honest about. It is not a rounding
concern and it is not hypothetical.

---

## 3 · The handoff — explicit, never by subtraction

**The cost layer emits charge economics as first-class values. The constructor
decides where the sell amount lives. Nothing reverse-engineers a charge out of
an aggregated unit price.** (Boundary doc §2; the reasoning is there and is not
repeated.)

Proposed record, per `(charge, tier, owner)` — owner being an assembly or a
top-level direct leaf:

```
ChargeEconomics {
  chargeKey        RecoveryChargeKey   the governed identity (#367 registry)
  tierId           string
  ownerId          string
  cost             number              what DPS pays. COST TRUTH — invariant.
  recoverableSell  number              cost x (1 + governed rate). NOT a
                                       placement decision; the amount that
                                       WOULD be recovered wherever it lands.
  rateSource       string              which governed rate priced it
}
```

Two properties the shape is chosen for:

- **`cost` and `recoverableSell` are both stated.** Neither is derivable from
  the other by a consumer without knowing the rate, and a consumer that knows
  the rate is a consumer that can drift from it.
- **Emitted unconditionally**, at both allocation states. Today the charge
  vanishes at one of them; a record that appears only when a boolean is set is
  the coupling again.

The per-charge origins already exist in the graph (`costing.ts:1944-1955` —
setup, tooling+artwork legacy, tooling, artwork, R&D, other, each a keyed
node). What does not exist is their exposure in the RESULT, per charge, with
cost and recoverable sell separated. **That gap is most of the work**, and it is
additive rather than a rewrite.

---

## 4 · The constructor

One pure function. Input: charge economics + resolved elections. Output: one
post-recovery commercial state.

| election | unit sell | separate line | cost retained | margin |
|---|---|---|---|---|
| `included` | **+ recoverableSell** | — | cost | unchanged |
| `separate` | — | **recoverableSell** | cost | unchanged |
| `absorbed` | — | — | cost | **falls** |

`included ↔ separate` is revenue-neutral **structurally**: the same value is
placed in one of two positions. Nothing is added on one side and removed on the
other, so there is no subtraction whose result has to be trusted — the OD-025
shape never arises, and no identity case needs short-circuiting.

`absorbed` keeps the cost and drops the recovery. It is the only mode that moves
the total, which is exactly why it is the one that can require authorization.

**Cost is retained in every mode.** That is the accounting guarantee stated as
an implementation property: no election changes `cost`.

---

## 5 · The consumers

Every one reads the same post-recovery construction:

- `quoteRollup.totalRevenue` and `blendedMarginPct`
- `fingerprintCommercialState` → the below-floor authorization
- the SEND gate (`requireBelowFloorAuthorizedToSend`)
- the customer PDF
- the frozen commercial line set
- NetSuite SO line projection

Proven the way the projection seam already is: **by call-site count**, not by
comparing two reconstructions. Two constructions can agree today and diverge on
the next change — that is how the PDF and the Sales Order came to disagree about
allocation-OFF fees while each stayed internally consistent.

---

## 6 · The preservation problem, and the question it forces

**This is the decision that governs the slice, and it is a business call.**

Under §4, `separate` puts the charge's cost into cost and its recovery into
revenue. Today, allocation-OFF charges are in **neither**. So implementing §4
faithfully **changes the computed margin of all 8 quotes in §2** — including a
`sent` quote and a `complete` one.

The direction is knowable in advance. For a charge at a positive rate the
recovery exceeds the cost, so including both raises revenue by more than it
raises cost: **the blended margin of an allocation-OFF quote goes UP**, and
today's figure **understates** DPS's actual profit on those quotes. The current
treatment is not conservative — it hides margin rather than overstating it.

Three ways to hold this, none of them free:

**(a) Legacy quotes keep the exclusion.** No-election quotes resolve exactly as
today; the new construction applies only where an election exists. Preservation
is total and S-7 stays at zero delta. The cost is that *margin means two
different things depending on how a quote was authored*, with nothing on the
surface saying which — and that is the shape of defect this whole workstream
exists to remove.

**(b) Recompute everything; frozen quotes are protected by their snapshots.**
The 4 sent/complete quotes render from frozen state, so what the customer
received cannot move. The 4 drafts' margins change — upward — and any that sit
near the floor could cross it, which is a *governed* event that must go through
the floor gate rather than appear silently. Honest, and it makes margin mean one
thing. The cost is that S-7 will show real deltas that have to be reviewed
line-by-line rather than being zero.

**(c) Treat the current exclusion as its own defect.** Repair it independently
of recovery, with its own evidence and its own disposition, so that when the
constructor lands both allocation states already agree about what margin
includes. Cleanest separation of concerns, longest path, and it front-loads the
$75,025 question rather than deferring it.

**Recommendation: (c), then (b) as the constructor's baseline.** (a) buys
preservation with the one thing this workstream is trying to eliminate — a
quantity that means two things depending on provenance. Separating the repair
also means the margin change is reviewed on its own evidence, instead of
arriving inside a slice about recovery where it would read as a side effect.

**This needs Edward's disposition before implementation begins.**

---

## 7 · Open, requiring disposition

1. **§6 — the margin-recompute question.** Governs the slice. Nothing else
   should start until it is settled.
2. **Whether the constructor is a distinct module or a second phase inside
   `computeQuoteCosting`.** The single-consumer requirement is the constraint;
   file layout is not settled. A distinct module is easier to prove and adds a
   hop; a second phase keeps the graph in one place and makes the internal
   boundary a matter of discipline rather than structure.
3. **The dead primitives.** `separateServiceFeesPerUnit` and
   `separateServicesMarkupSumPerUnit` are permanently zero with a stale type
   comment. Repurpose them as the constructor's output, or delete them and
   introduce new names. Deleting is cleaner; they are read by
   `costing.ts:3516` and the cost breakdown, so it is not a rename.
4. **Freight and duty stay refused**, still for open decision 2 / BV-011 §4.5.
   This design does not settle freight presentation versus its accounting
   destination, and shipping a freight election before that is settled would
   create the second source of truth the decision exists to prevent.
5. **`allocate_service_fees_to_cost`** is dispositioned already (boundary doc
   §4.5) — legacy provenance, not the new authority, retired only when the
   constructor no longer needs it *and* the cross-consumer audit is clean.

---

## 8 · Sequence

1. **§6 dispositioned.** Blocking.
2. Per-charge economics emitted from the cost layer — additive, provable
   against S-7 at zero delta because nothing consumes them yet.
3. The constructor, plus consumer cutover, proven by call-site count.
4. Revenue-neutrality proven numerically — **the existing tripwires convert
   from vacuous to governing on the first run**, which is what they were
   written for.
5. Refusals lifted, one mode at a time, each with its evidence.
6. **Only then** the recovery workspace.

No control may be offered for a mode the system would mis-price.
