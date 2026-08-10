# Handoff · page-boundary mounting and entry-at-node wiring

**Status: specified, not implemented.** The integration points below are read
off the current code, not inferred. Everything they connect is merged and
green.

**Why this is a handoff and not a commit.** Mounting is the last Phase 3 item
and touches five landed pieces at once. I reached the end of a working session
with enough context to establish the wiring accurately but not enough to
implement and verify it to the standard the rest of the phase was held to. A
half-mounted page is the one outcome the sequencing was chosen to avoid.

---

## What is being mounted

All merged, all currently unreferenced by any route:

| Piece | Module |
|---|---|
| Compliance grid | `pricing-surface/compliance-grid.tsx` |
| Trace overlay | `pricing-surface/pricing-trace.tsx` |
| Client-target headroom | inside the grid |
| Staging model | `pricing-surface/pricing-staging-context.tsx` · `lib/pricing-staging.ts` |
| Staging bar | `pricing-surface/staging-bar.tsx` |
| Transient deltas | `pricing-surface/staged-delta.tsx` · `lib/pricing-delta.ts` |

**Integration only.** No new commercial logic. Every number on the page after
mounting must already be stated by the engine or the classifier; if wiring
appears to require a calculation, that is a finding, not a licence.

---

## 1 · The staging provider

`src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx:185` mounts
`PricingClassifierProvider`. `PricingStagingProvider` nests **inside** it:

```tsx
<PricingClassifierProvider …>
  <PricingStagingProvider initialGlobalAdj={Number(quote.globalPriceAdjPct)}>
    <main className="r2-pricing r2-page">
```

Inside, not outside, and the order matters: the staging provider calls
`useCostingStoreApi`, and its preview run must observe the same store the
classifier reads. Nothing in the classifier depends on staging, so the reverse
nesting would also *work* — and would put the two in an order that implies a
dependency that does not exist.

---

## 2 · Tier metadata reaches the grid

`ComplianceGrid` needs `tierMeta: Map<number, { label, recommended }>`. The page
holds `tiersForReframe` (label + `recommended`); the shell holds `idMap`, which
maps tier UUID → the classifier's numeric id.

**Build it in the page and pass it down**, rather than having the grid resolve
identity. The grid already declines to look identity up for itself, and the
staging bar does the same with its `CellLabeller` — the same discipline, for
the same reason: a component that resolves identity is one that can resolve it
wrongly.

`PricingSurfaceShellProps` gains one prop. That is the whole change.

---

## 3 · The cell labeller

`StagingBar` takes `label: (cellKey: string) => string`. Keys are
`{quote_leaf_id}::{tier_id}` — two UUIDs.

**VERIFIED 2026-08-09 — they are NOT the same value, and assuming so would have
mislabelled every chip.**

`pricing-classifier-context.tsx:476` sets the classifier's SKU id from
`sr.skuId`, which is the engine's SKU id. `canonicalQuoteLeafId` is a
**separate field** on the same `SkuRollup` (`costing.ts:614`). The staging key's
SKU half is the canonical one, so a labeller keyed on `state.skus[].id` matches
nothing and every chip falls back to the raw key — two UUIDs, in the one place
the operator looks to see what they are about to commit.

**Build the labeller from `skuRollups`, keyed on the canonical id:**

```ts
const nameByQuoteLeafId = new Map<string, string>();
for (const sr of skuRollups) {
  if (sr.canonicalQuoteLeafId) nameByQuoteLeafId.set(sr.canonicalQuoteLeafId, sr.productName);
}
```

Both fields are already on the store's `selectSkuRollups`, so this needs no new
data — only the correct key.

**Fail closed to the raw key** when either half does not resolve. An ugly chip
is recoverable; a chip naming the wrong SKU beside a price change is not.

---

## 4 · Entry-at-node

The one piece with no precedent in the repo, and the one to build carefully.

`PricingTrace` takes `{ graph, nodeKey, title, onClose }` and opens **at** the
key. The cost stack's rows already address canonical keys — `read("pkg")` etc.
in `pricing-surface-shell.tsx:262` uses `quoteScopeKey(tierUuid, name)`, which
is exactly the key the trace should open at.

So the wiring is: a stack cell's press handler sets
`{ nodeKey: quoteScopeKey(tierUuid, name), title }`, and the trace renders
beneath the pressed row.

**The accepted implementation correction applies here** (Phase 3, "Cost-Stack
Inline Trace"): the trace opens immediately beneath the pressed row, the row
stays visually pinned while open, and the CSS contract is
`overflow: clip` — **not** `overflow: hidden`, which silently breaks the sticky
positioning even though the surface looks correct. The property and its
explanatory comment are inseparable requirements.

---

## 5 · Deltas into the cost stack

`StagedDelta` and `StagedMarginDelta` take `{ committedGraph, previewGraph,
nodeKey }`.

- committed graph: `useCostingStore(selectGraph)`
- preview graph: `usePricingStaging().previewResult?.graph ?? null`

Both are already available at the shell. The keys are the ones the rows already
read, plus `quoteScopeKey(tierUuid, "margin")` for the margin row — which
exists as of the `ratio` implementation.

Nothing else is needed: a delta is a join, and both sides are stated.

---

## Verification the mount must carry

- `verify:types`, `test:unit`, `prebuild` green.
- **S-7 unchanged at `541a75a0…`.** Mounting reads; it must move no scalar.
- The operator checklist items reachable without persistence: banner and page
  read as today above the fold; pricing detail open with no disclosure control;
  a below-floor quote names its tiers; staging a lift shows a delta and writes
  nothing; Reset returns to last-applied; pressing a stack cell opens the trace
  **at that node**, not the root.
- Items **not** reachable until OD-012: Apply surviving navigation, removing an
  applied lift, return-to-baseline across a page load.

---

## What remains after mounting

| Item | Blocked on |
|---|---|
| Applied-lift persistence | **OD-012** |
| Trace terminals naming a person | **A-2** — including the `NodeCandidate` model gap folded into its scope |
| Operator validation checklist | mounting |
| R1 rollback rehearsal | persistence |
| R2 identity parity · R3 staging at production shape | mounting |
