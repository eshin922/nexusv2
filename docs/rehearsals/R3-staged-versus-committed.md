# R3 · Staged-versus-committed at production shape

**Gate:** before operator validation.
**Source of requirement:** [`PHASE-3-PRICING-WORKSPACE.md`](../../PHASE-3-PRICING-WORKSPACE.md) §2 · R3.
**Status:** **BLOCKED — cannot be completed until `CellAction` exists.** Baseline
captured 2026-08-10; see §Results.

The requirement, verbatim, so a future run checks against it rather than against
this document's paraphrase:

> Exercise staging at **five to seven SKUs × four tiers** — the production
> range, not a two-SKU fixture.
>
> **Record:** render timing with deltas active, staging-bar legibility at that
> volume, and whether Apply's cost-base check completes acceptably.

---

## 1 · Objective

Prove the staged surface holds up at the volume operators actually work at.

Not correctness — H1–H14 and the unit suite cover that. R3 asks a different
question: the page computes **twice** while anything is staged, renders a delta
on every component row, and keeps a chip per pending change. All three scale
with SKUs × tiers, and all three were built against small fixtures. This is the
gate that says whether the design survives its own volume.

---

## 2 · Prerequisites / fixture state

**Required shape: 5–7 SKUs × 4 tiers.** It does not exist.

Measured 2026-08-10 across every quote in the database:

| leaves | tiers | quotes |
|---|---|---|
| 2 | 4 | 1 |
| 9 | 3 | 6 |
| 15 | 2 | 1 |
| 3 | 3 | 1 |

There is no quote at 5–7 × 4. The nearest available is **9 SKUs × 3 tiers = 27
cells**, against the specification's 20–28 — the *same cell-count band* reached
on different axes. Since every quantity R3 measures scales with the cell count
and with the chip count, that substitution is defensible, and it is recorded
here rather than made silently.

**What a future run should prefer:** a real 4-tier quote at 5–7 SKUs, built from
source inputs per Pattern 53. If one is constructed rather than found, it must
be provisioned through the real write paths — not by inserting rollups.

Also required, and this is the blocker:

- **An affordance that can stage a lift.** See §8.
- `.env.local`; the deployed runtime for timing (dev-mode figures are not
  representative — Webpack, no minification, no RSC caching).

---

## 3 · Operator steps

1. Open the production-shape quote's Pricing surface on the **deployed**
   runtime. Wait for the compliance grid to render.
2. Record navigation timings and grid dimensions (`§7` gives the snippet).
3. **Stage a lift** on a below-floor cell. *(Blocked — §8.)*
4. Stage a second lift on a different SKU, and a global adjustment.
5. Record: time from the third staging action to the surface settling; whether
   every cost-stack row that moved shows a delta; whether the staging bar's
   three chips remain readable without truncation or wrapping into the actions.
6. Press **Apply**. Record whether the cost-base check completes acceptably.
7. Press a cost-stack cell at this volume and record trace-open latency.

---

## 4 · Expected observable results

- Deltas appear on every row whose value moved, and **only** those. §3 of the
  specification: deltas vanish on Apply, and their absence is the signal.
- The staging bar shows one chip per pending change, each naming its SKU and
  tier — not a raw composite key.
- Staging is perceptibly immediate. It is a pure recompute over an in-memory
  input; no network call is involved.
- Trace opens at the pressed node without visible delay.

---

## 5 · Canonical authority exercised

- **H3 — `isStaged` is a difference, not a property.** At volume the failure
  this names is louder: a stuck flag keeps offering to commit changes already
  committed. `diffSets` recomputes every render.
- **§3.3 — committed and staged graphs share the key space by construction.**
  Every delta is a join on node identity across two graphs; at 27 cells the join
  runs on every row of the cost stack.
- **§3 — deltas are transient.** Their disappearance on Apply is the contract.
- **The engine is pure and runs twice.** `previewResult` is a full
  `computeQuoteCosting` over the working set. R3 is the only gate that asks what
  that costs.

---

## 6 · Pass / fail criteria

**PASS** — staging settles without perceptible lag at production shape; every
moved row carries a delta and no unmoved row does; chips remain legible at three
or more pending changes; Apply completes without a stall.

**FAIL** — any of: a delta on a row that did not move, or missing from one that
did; chips truncated or overflowing; a perceptible stall on stage or Apply.

**A failure here is not necessarily a performance bug.** The design computes
twice by choice, and if that is too expensive at volume the answer may be to
change what is recomputed rather than to optimise around it. Report before
tuning.

---

## 7 · Evidence to capture

Release evidence calls for **"Staging timings: R3 at 5–7 SKUs × 4 tiers."**

```js
// On the deployed surface, after the grid renders.
const nav = performance.getEntriesByType('navigation')[0];
({
  cells: document.querySelectorAll('.r11-bcell').length,
  skuRows: document.querySelectorAll('.r11-brow').length,
  tierCols: document.querySelectorAll('.r11-srow.head .r11-scell').length,
  domNodes: document.getElementsByTagName('*').length,
  ttfb: Math.round(nav.responseStart - nav.requestStart),
  domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
  loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
})
```

Trace-open latency across every traceable cell, which doubles as an exhaustive
entry-at-node proof:

```js
const stack = [...document.querySelectorAll('.psr-tier-table')][1];
for (const tr of stack.querySelectorAll('tbody tr')) {
  for (const btn of tr.querySelectorAll('td button.psr-stack-cell')) {
    const t0 = performance.now();
    btn.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // record performance.now() - t0, and the panel's anchor title
    btn.click();
  }
}
```

With deltas active, capture the same two measurements plus a screenshot of the
staging bar at three pending changes.

---

## 8 · Known exclusions

**All three of R3's required records are currently unreachable, and the blocker
is not persistence.**

`stageLift`, `stageOverride` and `stageGlobalAdj` exist on the staging context
and **have no caller anywhere in `src/`**. The R12 bundle exports `CellAction` —
the affordance that turns a pressed grid cell into a staged lift or direct price
— and it was never built. Without it an operator cannot stage anything, so:

| Required record | Blocked by |
|---|---|
| render timing with deltas active | `CellAction` |
| staging-bar legibility at volume | `CellAction` |
| Apply's cost-base check completes acceptably | `CellAction` **and** OD-012 |

**Not blocked by OD-012 for the first two.** Staging is session state — "nothing
persists across navigation; there is no third state." What OD-012 blocks is
persisting an *applied* lift. Sequencing `CellAction` behind OD-012 would delay
it for a dependency it does not have.

**The third record is genuinely OD-012's.** `apply()` today is
`setCommitted(working)` — an in-memory assignment. There is no cost-base check
to time, because there is no server round-trip yet. That check arrives with
persistence.

**Not blocked by A-2.** Provenance affects what a trace terminal says, not what
the surface costs to render.

**What was run anyway:** the committed-side baseline, which is the comparison
point the delta-active measurement needs and which is worth having before
`CellAction` lands rather than after.

---

## Results · 2026-08-10 — baseline only

Deployed runtime (`nexusv2-nu.vercel.app`), commit `22d6820`, quote
`27581262` — **9 SKUs × 3 tiers = 27 cells**, the substitute shape recorded in
§2. Signed-in session, warm.

**Grid and page**

| | |
|---|---|
| cells rendered | 27 |
| SKU rows · tier columns | 9 · 3 |
| DOM nodes | 720 |
| TTFB | 37 ms |
| DOMContentLoaded | 2,557 ms |
| load complete | 2,782 ms |

**Trace at volume — every traceable cell**

| | |
|---|---|
| cells exercised | 24 (8 per tier row × 3) |
| opened successfully | 24 / 24 |
| **distinct trace targets** | **24 / 24** |
| median open | 12.2 ms |
| slowest open | 41.3 ms |

The distinct-target count is the incidental finding worth keeping: 24 presses
produced 24 different anchor titles, so entry-at-node resolves **per cell**
rather than per row or to a common root — proven exhaustively across the
surface rather than sampled.

**Verdict: baseline captured, R3 not complete.** Nothing here exercises a staged
set, which is what R3 is for. Re-run in full once `CellAction` lands, at a real
5–7 × 4 quote if one exists by then, and compare the delta-active timings
against the numbers above.
