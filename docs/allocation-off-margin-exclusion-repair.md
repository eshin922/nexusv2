# Allocation-OFF margin exclusion — defect repair

**Status — design. Authorizes no implementation.**
Dispositioned 2026-08-23. Prerequisite for
[`commercial-sell-construction-design.md`](commercial-sell-construction-design.md);
discovered while designing it, and separated because it is a **pre-existing
correctness defect**, not a recovery-design problem.

---

## 1 · The defect

When `assembly_production_inputs.allocate_service_fees_to_cost` is **false**, a
one-time charge is **absent from the costing engine entirely**.

`costing.ts:1858` sets `separateServiceFees = 0` unconditionally inside the
`production && tierQty > 0` branch, and `allocatedServiceFeesPerUnit` is already
0 on that path. So the charge enters **neither** `contributionCostPerUnit`
**nor** `requiredSellPerUnit`, and therefore neither `totalCost`, nor
`totalRevenue`, nor `blendedMarginPct`.

The customer is still billed for it — the projection emits the line — so the
money is real on both sides. Only the engine cannot see it.

Two named primitives advertise the missing behaviour and do not implement it:
`separateServiceFeesPerUnit` and `separateServicesMarkupSumPerUnit`, whose type
comment still reads *"when allocate_service_fees=false"*. Both are permanently
zero, and `costing.ts:2472` already says so in prose.

### The rule this violates

> Cost truth must be complete. A charge DPS pays is a cost regardless of where
> the customer sees it, and a charge the customer pays is revenue regardless of
> which line carries it.

Presentation decides *where a charge appears*. It must not decide *whether the
charge exists* to the engine.

---

## 2 · Exposure — measured

`scripts/gate-1b/alloc-off-margin-exposure.ts` (read-only; shipped with this
design). 111 production rows · 17 allocation-OFF · 14 carrying money ·
**8 quotes**, of which 6 carry non-zero money.

Governed `Production` rate 40% · firm target 35% · floor 25%:

| quote | status | tiers | excluded | margin now | estimate |
|---|---|---|---|---|---|
| `4781e4bb` | draft | 1–4 | $5,600–$6,500 | 29.04–31.92% | 28.88–31.64% |
| `52bd0077` | draft | 1–4 | $3,100–$4,000 | 38.96–42.37% | 35.93–41.26% |
| `93a5d4bb` | **sent** | 1 | $225 | 74.36% | **66.67%** |
| `97d25286` | **complete** | 1–3 | $100–$1,000 | 29.58–31.03% | 29.56–30.85% |
| `f2db6e10` | draft | 1 | $17,000 | **11.86%** | **14.54%** |
| `f5f5ac14` | draft | 1 | $17,000 | **11.86%** | **14.54%** |

≈ **$75,025** outside every margin the system computes.

### The direction is not uniform — and that is the argument for repairing it

Adding cost `e` and recovery `e(1+r)` raises the margin **only when the tier's
current margin is below `r/(1+r)`** — the margin implied by the charge's own
rate, **28.57%** at the governed 40%. Above that, the charge **dilutes**
downward.

So the exclusion does not modestly understate profit. It pulls the reported
margin **away from the charge's own economics in whichever direction the quote
sits**: thin quotes understated, healthy quotes **overstated** — `93a5d4bb` by
7.7 percentage points. An inconsistent distortion is worse than a consistent
one, because no reader can correct for it.

### No status crossings on today's population

Every affected tier keeps its floor/target classification under the estimate:
the two `BELOW_FLOOR` tiers rise and stay below floor; the `GOOD` tiers fall and
stay good.

**This is a fact about today's data, not a property of the repair.** A quote
sitting near a boundary would cross, and §5 requires the certification run to
re-establish it against the engine rather than inheriting this claim.

---

## 3 · The repair

**One change, stated as a rule rather than a diff:** a one-time charge
participates in cost truth and, when it is recovered, in revenue —
**independently of `allocate_service_fees_to_cost`**. That boolean keeps
deciding *where the customer sees the charge*. It stops deciding *whether the
engine sees it.*

| | cost | revenue | customer sees |
|---|---|---|---|
| allocation ON | charge cost | recovery, inside unit sell | inside unit price |
| allocation OFF — **today** | *nothing* | *nothing* | separate line |
| allocation OFF — **repaired** | charge cost | recovery, outside unit sell | separate line *(unchanged)* |

**The customer-facing document does not change.** No line moves, no amount
moves, no total moves. The repair is entirely internal: the same money the
projection has always shown becomes visible to cost, revenue and margin.

That is the property that makes this certifiable — the customer-facing surface
is a **control**, not a variable. Any movement in the PDF is a defect in the
repair.

### What this is not

- **Not** a change to `allocate_service_fees_to_cost`'s meaning as a
  presentation instruction, nor to its per-assembly grain.
- **Not** the recovery model. No election is read; no election exists to read.
- **Not** a rewrite of the sell ladder. The recovery is added outside unit sell
  on the OFF path, where the projection already places it.

### The dead primitives

`separateServiceFeesPerUnit` / `separateServicesMarkupSumPerUnit` were named for
exactly this behaviour. The repair either fills them or replaces them; either
way the stale *"when allocate_service_fees=false"* comment goes. They are read
at `costing.ts:3516` and by the cost breakdown, so filling them is not a rename
and both options need the consumer sweep in §5.

---

## 4 · Historical truth vs corrected analytical truth

**Edward's directive, 2026-08-23:** frozen customer-facing economics stay
untouched, but live recomputation must not silently pretend the old margin was
correct if the record is inspected diagnostically. **Distinguish the two rather
than mutate history.**

| | authority | after the repair |
|---|---|---|
| `quote_snapshots`, frozen commercial line set, `pdf_url` | **historical commercial truth** — what the customer received | **untouched** |
| live recompute of a sent/complete quote | **corrected analytical truth** | **moves**, and must say so |

The two will disagree for `93a5d4bb` (7.7pp) and `97d25286`. That disagreement
is **correct and must be legible**, which rules out both easy answers:
overwriting the snapshot destroys history, and suppressing the corrected figure
reasserts the defect wherever anyone looks.

**Requirement:** any surface or diagnostic that shows a live-recomputed margin
for a frozen quote must be able to say which of the two it is showing. What that
looks like — a badge, a paired figure, a diagnostic-only field — is a design
question for implementation. **What is settled is that "corrected" and "as
sent" must be distinguishable, and that neither is quietly substituted for the
other.**

The S-7 harness is the first consumer of this distinction: it compares live
recomputation against a captured baseline, so it **will** report deltas for
these quotes. Those deltas are the repair working. They must be certified
line-by-line, and the baseline re-captured only once they are.

---

## 5 · Certification

The evidence this slice must produce, before merge:

1. **Per (quote, tier), from the engine**: cost, revenue, margin and
   floor/target status before and after. Not the §2 estimate — that is a
   first-order reconstruction, and certifying against it would be certifying a
   reimplementation. The script's own header says so.
2. **Every status crossing enumerated**, or an explicit statement that there
   are none. A crossing is a governed event and does not get to be a
   side effect.
3. **The customer-facing document is byte-identical** for all 8 quotes. This is
   the control: any movement is a defect.
4. **Frozen artifacts unchanged** — snapshots, frozen line sets, `pdf_url`
   targets. Asserted, not assumed.
5. **Consumer sweep** for both dead primitives and for `breakdown.serviceFees`:
   queries, writes, realtime subscriptions, publication membership, raw SQL
   outside `actions/`, and the PDF/SO projections. This codebase has been caught
   twice by a sweep that covered only the first of those.
6. **S-7 deltas reviewed line-by-line**, then the baseline re-captured as a
   deliberate act with its own record — never as a way of making a diff go away.

---

## 6 · Open

1. **The distinguishability mechanism** (§4) — badge, paired figure, or
   diagnostic-only field.
2. **Fill or replace the dead primitives** (§3).
3. **Whether `93a5d4bb`'s 7.7pp correction warrants notifying anyone.** It is a
   `sent` quote whose recorded margin was overstated. Nothing customer-facing
   moves and no money changes hands, so this is a records question rather than a
   commercial one — but it is Edward's call, not an implementation detail.

---

## 7 · Sequence

1. This design dispositioned.
2. Repair implemented; §5 evidence produced.
3. Certified; S-7 baseline re-captured with its record.
4. **Then** `commercial-sell-construction-design.md` builds on the corrected
   baseline.
5. **Then** the recovery workspace.
