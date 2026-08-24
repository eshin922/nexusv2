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

**Requirement — settled:** wherever both can be surfaced, the frozen historical
margin and the corrected analytical margin are **explicitly labelled**. Neither
is quietly substituted for the other. The visual form is an implementation
design question; the labelling is not optional.

### Where both can be surfaced — enumerated, not assumed

The scope is every surface that renders a margin from a LIVE
`getCostingBundle` recompute while the quote is frozen. Found:

| surface | reads | reachable when frozen |
|---|---|---|
| Pricing (`pricing/page.tsx:87`) | live bundle | **yes** — `editable = status === "draft"`, so a frozen quote renders read-only rather than being turned away |
| Mark Accepted (`mark-accepted/page.tsx:94`) | live bundle | **yes, by definition** — the surface exists only after send |
| Costs cost-stack header | live bundle | yes, same read-only pattern |

The implementation sweep must confirm this list rather than inherit it; the
method is *"calls `getCostingBundle` and renders a margin"*, and a surface added
between now and then would not be in it.

### The governed-gate coupling — named, because it is not merely analytical

`markComplete` refuses on `tierRollup.blendedMarginStatus === "BELOW_FLOOR"`
(`mark-complete.ts:255`), computed from a **live** bundle read at
`mark-complete.ts:236` — on a quote that is already accepted. So the repair
changes a value that a **governed gate enforces on**, not only one that a
surface displays.

On today's population that is safe: no affected tier changes classification
(§2). It is named anyway, because "no crossing today" is a fact about data and
this is a fact about structure.

**The Sales Order amount is NOT affected**, and for a good reason that already
exists. `currentAmount` was deliberately moved off the live rollup onto the
**frozen** commercial total (`mark-complete.ts:313, 652`) — the comment there
says *"a convention is not an authority."* `tierRollup` survives at that call
site only for the margin verdicts and the per-unit cost basis. So the repair
moves the gate's input and leaves the external write untouched, which is the
right split and is already load-bearing rather than something this slice has to
establish.

The S-7 harness is the first consumer of this distinction: it compares live
recomputation against a captured baseline, so it **will** report deltas for
these quotes. Those deltas are the repair working. They must be certified
line-by-line, and the baseline re-captured only once they are.

---

## 5 · Certification

The evidence this slice must produce, before merge. Ordered, and the order is
load-bearing — the baseline is re-captured last, and only once everything above
it has been certified.

1. **Certify every affected quote/tier against the ENGINE**, not the sizing
   script. Cost, revenue, margin and floor/target status, before and after. The
   §2 estimate is a first-order reconstruction; certifying against it would be
   certifying a reimplementation, and the script's own header says so.
2. **Prove the PDF and customer totals are unchanged** for all 8 quotes. This is
   the control, not an output — any movement is a defect in the repair.
3. **Prove frozen snapshots are untouched** — `quote_snapshots`, frozen
   commercial line sets, `pdf_url` targets. Asserted, not assumed.
4. **Report exact margin deltas and floor/target classification before and
   after**, per tier. Every crossing enumerated, or an explicit statement that
   there are none. A crossing is a governed event and does not get to arrive as
   a side effect.
5. ~~Explicitly label frozen historical margin vs corrected analytical
   margin.~~ **WITHDRAWN 2026-08-24.** No dual-margin label ships and no
   application data model was created.

   The requirement assumed a frozen-margin authority to be in tension with.
   There is none: `quote_snapshots` carries no margin, and the frozen
   commercial line set carries revenue without cost. The 74.36% existed only
   in a stale S-7 baseline.

   What the evidence found instead is stronger — where a frozen commercial
   record exists, live revenue now **reconciles to the frozen customer total
   exactly** (§3 of the certification record). The historical contract was
   already correct; only the analytical margin was wrong. Labelling a figure
   "corrected" indefinitely would make a one-time defect repair look like a
   permanent dual-authority model.

   Replaced by: the historical discrepancy recorded in
   [`allocation-off-margin-exclusion-certification.md`](allocation-off-margin-exclusion-certification.md) §4.
6. **Re-prove `markComplete` specifically**, because it consumes live margin
   STATUS rather than merely displaying it (§4). The proof required is negative
   and must be stated as such: *the repair creates no unintended progression
   refusal.* An accepted quote that could be completed before must still be
   completable, and any quote for which that changes is a governed event
   surfaced by name — never discovered by an operator at the gate.
7. **Only then, deliberately re-capture the S-7 baseline** — as its own act with
   its own record, after line-by-line review of the deltas. Never as a way of
   making a diff go away.

Alongside these, and not in place of them: a **consumer sweep** for both dead
primitives and for `breakdown.serviceFees` — queries, writes, realtime
subscriptions, publication membership, raw SQL outside `actions/`, and the
PDF/SO projections. This codebase has been caught twice by a sweep that covered
only the first of those.

---

## 6 · Open

1. **The visual form of the labelling** (§4) — badge, paired figure, or
   diagnostic-only field. The requirement is settled; the form is not.
2. **Fill or replace the dead primitives** (§3).

### Dispositioned

**`93a5d4bb` — record internally, do not notify externally.** (Edward,
2026-08-23.)

No external notification and **not treated as a commercial correction**: the
customer-facing economics and the money charged do not change. It is recorded
as a **certified historical analytical discrepancy** — the frozen quote remains
the commercial record at 74.36%, while live recomputation shows the corrected
66.67%.

Both halves of that matter. We do not silently rewrite history, and we do not
keep presenting 74.36% as analytically correct once the defect is fixed. It is
the §4 distinction applied to the one quote where the gap is large enough to be
noticed, and it is why §5 item 5 is a certification requirement rather than a
polish item.

---

## 7 · Sequence

1. This design dispositioned.
2. Repair implemented; §5 evidence produced.
3. Certified; S-7 baseline re-captured with its record.
4. **Then** `commercial-sell-construction-design.md` builds on the corrected
   baseline.
5. **Then** the recovery workspace.
