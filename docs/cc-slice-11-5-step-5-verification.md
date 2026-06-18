# Slice 11.5 — Step 5 UI affordance verification

Branch: `slice-11-5-step-5-ui-verification` (off main @ 1573725,
PR #69 merge — Step 4 hard cutover).

Step 5 closes the gate between the write-action migration (Step 4)
and sample-order re-seed (Step 6). Per brief §6 Step 5:

> `src/components/costs/*` — verify drilldowns work against new
> data shape (likely no changes needed; data shape constant through
> the adapter)
> `src/components/pricing-surface/*` — PSR classifier-context
> adapter consumes store, no direct schema deps; verify untouched
> Mark-Accepted host + accept-confirm-modal — bundle shape
> unchanged; verify untouched

This is a verification step. The output is (a) code-level audit of
each surface's data flow against NEW model, and (b) explicit CB
walk asks for empirical PM behavior testing. CC adds proactive UI
mitigation ONLY when a structural break is observable in code; PM-
ergonomics concerns surface as banked v1.1+ candidates pending CB
walk outcome.

---

## §1 · Audit summary

| Surface | Renders against NEW data? | Action calls correct? | UX concern banked |
|---|---|---|---|
| PackagingDrilldown | ✓ via synthetic wrapper | ✓ NEW actions | — |
| ProductionDrilldown | ✓ via synthetic wrapper | ✓ NEW actions | **Anchor-leaf production fan-out** |
| BulkRawDrilldown | ✓ (NULL-safe per Step 0) | n/a | — |
| FreightDrilldown | ✓ (model-agnostic) | ✓ (no change) | — |
| Pricing required-sell-cell | ✓ store-selector based | ✓ NEW actions | — |
| Pricing client-target-cell | ✓ store-selector based | ✓ NEW actions | — |
| Pricing LinesRequiringReview | ✓ skuRollups-based | n/a | **Per-component flagging** |
| Pricing PSR classifier-context | ✓ store-abstract | n/a | — |
| Mark-Accepted host | ✓ skuRollups-based | n/a | **Per-component flagging** |
| Mark-Accepted accept-confirm-modal | ✓ TierCardData props | n/a (stub) | — |

**Two UX concerns banked as v1.1+ candidates** pending CB walk.
Both share a common shape: NEW-model surfaces correct math + correct
DB writes, but the per-component (assembly_leaf) granularity may
surprise PMs used to per-product (former leaf SKU) granularity.

---

## §2 · Costs page drilldowns

### PackagingDrilldown — clean

`src/components/costs/packaging-drilldown.tsx`

- Receives `skus: QuoteSku[]` + `inputRows: PackagingInputRow[]` via
  Step 3 synthetic reshape. Iterates `leafSkus = skus.filter((s) =>
  s.skuRole === "leaf")` to find assembly_leaves (math-leaves in
  NEW model).
- Per-line cell render: groups by `lineGroupId`; maps tier cells via
  `r.packaging_inputs.tierId`. Line metadata (supplier, category,
  markup) reads from the first row of each group.
- Action calls: `updateAssemblyLeafInputLineMeta`,
  `deleteAssemblyLeafInputLine`, `updateAssemblyLeafInputCell`. All
  three wired via Step 4. FormData field "quoteSkuId" carries
  assembly_leaf.id per Q2 (a) preserve-prop-names.
- AddLineButton sets `fd.set("quoteSkuId", leafSkus[0].id)` →
  routes to `addAssemblyLeafInput` per Step 4.
- **Verdict:** no surprises expected. Drilldown renders one line
  block per assembly_leaf with its own packaging entries. Sample
  order pre-seed has zero packaging rows; drilldown renders empty
  state (existing empty-state guard at line 116-127, verified
  NULL-safe in Step 0).

### ProductionDrilldown — clean with anchor-leaf UX concern

`src/components/costs/production-drilldown.tsx`

- Receives same `skus` + `inputRows` synthetic shapes. Filters
  `leafSkus` (assembly_leaves).
- Iterates leafSkus → renders one production block per assembly_leaf.
  Cell lookup: `rowsBySku.get(sku.id)` resolves only for the anchor
  leaf (lowest position per assembly, per Step 3 synthesis +
  costing-adapter anchor-leaf fan-out).
- Policy fallback: `policyBySku.get(sku.id) ?? sectionPolicy` —
  sibling leaves with no production data fall back to default policy
  (customerShipsRaws=false, allocateServiceFeesToCost=true). No
  crash.
- Action calls: `upsertAssemblyProductionInputs`,
  `updateAssemblyProductionPolicy`. Both wired Step 4. FormData
  field "quoteSkuId" → for production this carries the
  assembly.id, not assembly_leaf.id (production policy lives at
  assembly level in NEW model).

**Anchor-leaf rendering reality:** for an assembly with N
assembly_leaves (e.g., HGS-30-001 with bottle + dropper + label +
carton):
- Bottle (lowest position) shows production cost cells populated
- Dropper / label / carton show empty production cells (no
  production data attached)
- Math correctness: assembly_total = bottle_packaging + dropper_pkg
  + label_pkg + carton_pkg + bottle_production. The anchor-leaf
  carries the full production lump on its row; siblings carry only
  packaging. Total is correct.
- UX visibility: PMs see "production fees on bottle only, not on
  other components." Asymmetric per-leaf rendering.

**Status:** banked as v1.1+ candidate "Per-assembly production
fan-out — math layer extension" in UX_BACKLOG. Step 5 disposition
deferred to CB walk per Edward + CA Step 3 close.

### BulkRawDrilldown + FreightDrilldown — clean

- BulkRawDrilldown: Step 0 verified NULL-safe for the empty bulk_raw
  tables case. Continues to render gates and empty states correctly
  on NEW model.
- FreightDrilldown: freight tables (`freight_leg_groups`,
  `freight_legs`, `freight_leg_tiers`) are model-agnostic per
  scoping inventory §1. No Step 3/4 changes. Renders unchanged.

---

## §3 · Pricing surface

### required-sell-cell + client-target-cell — clean

`src/components/required-sell-cell.tsx` +
`src/components/pricing/client-target-cell.tsx`

- Both components take `quoteSkuId` + `tierId` props (assembly_leaf.id
  + quote_tier.id in NEW model). Store selectors abstract over the
  IDs — `selectPerTierForSku(quoteSkuId, tierId)`,
  `selectCellOverride(...)`, `selectCellTarget(...)`. No direct
  schema dependency.
- Math output via `selectPerTierForSku` returns the correct rollup
  for the (assembly_leaf, tier) cell, computed by the math layer
  from NEW-model adapter input.
- Action calls: `updateAssemblyLeafOverride`,
  `updateAssemblyLeafTarget`. Both wired Step 4.

**Verdict:** transparent through Step 3+4 migration. PM-side
behavior on Pricing surface (per-cell override + per-cell client
target) is identical to OLD model from the PM's mental model
perspective.

### LinesRequiringReview — clean but flag per-component concern

`src/components/pricing/lines-requiring-review.tsx`

- Reads `skuRollups` from store (`selectSkuRollups`). Filters
  `skuRole === "leaf"` then `marginStatus === "BELOW_FLOOR"`.
  Surfaces each as a flagged line with `skuLabel` + `productName`.
- In NEW model, `skuLabel` = library leaf SKU (e.g., "LIB-PP-BOTTLE-30");
  `productName` = library leaf name (e.g., "30ml amber bottle").
  Per-component identity.
- Affordance: "Jump to tier" button moves Pricing surface focus to
  the flagged tier. Mechanically works against NEW model.

**Per-component flagging concern:** PMs expecting "which PRODUCT is
below floor" may be surprised to see "LIB-PP-BOTTLE-30 — T1 — 24%
margin" instead of "HGS-30-001 — T1 — 24% margin". Component-level
verdict is more granular but may not match PM mental model at the
review surface.

Banked as v1.1+ candidate "Per-component vs per-product flagging on
Mark-Accepted + Pricing surfaces" in UX_BACKLOG.

### PSR classifier-context — transparent

`src/components/pricing-surface/pricing-classifier-context.tsx`

- Consumes store selectors: `selectSkuRollups`, `selectQuoteRollup`,
  `selectFirmSettings`, `selectGlobalAdj`, `selectQuoteSummary`. No
  direct schema dependency.
- Threads classifier output through `usePricingSurfaceClassifier()`
  context to downstream cells.

**Verdict:** completely transparent through Step 3 adapter
migration. Brief's "no direct schema deps; verify untouched" claim
confirmed.

---

## §4 · Mark-Accepted surface

### Mark-Accepted page + accept-confirm-modal — clean with per-component flag concern

`src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx`

- Reads `getCostingBundle(quoteId)` which post-Step-3 returns the
  NEW-model adapter output. Bundle shape unchanged from PM
  perspective.
- Iterates `bundle.data.costing.skuRollups` filtering for leaves
  with `marginStatus === "BELOW_FLOOR"`. Surfaces in `flaggedLines`
  array passed to the modal.
- Each flagged line: `sku.skuLabel` (library leaf SKU) + tier label
  + marginPct. Same per-component identity concern as
  LinesRequiringReview.
- TierCardData built from `bundle.data.costing.quoteRollup` (per-
  tier blended). Quote-level totals are correct (math layer
  unchanged).

`src/components/mark-accepted/accept-confirm-modal.tsx`

- Receives TierCardData props (no schema dependency). Confirm
  button is currently a console.log stub per Slice RI.6 framing
  (real action contract lands in Slice 12 / Quote umbrella). No
  Slice 11.5 impact.

**#A16 disposition (Step 3 close):** Mark-Accepted bundle compat
verified. Math layer untouched → bundle shape binary-compatible.
MIG-7 smoke walk + post-merge SV-1 walkthrough confirm at Step 7.

**Per-component flagging concern banked.** Same as Pricing
LinesRequiringReview. Pending Step 5 CB walk.

---

## §5 · CB walk asks

Three questions for empirical CB testing before Step 6 sample re-
seed:

### Walk 1 — Anchor-leaf production rendering

**Setup:** sample order with an assembly (e.g., HGS-30-001) +
production cost data on the assembly_production_inputs row.

**Walk:** open Costs page → Production drilldown.

**Observe:** production cost cells populated on the FIRST component
(bottle), empty on dropper/label/carton.

**Ask PM:** "Does this rendering make sense? Do you understand that
the production fees apply to the entire product, not just the
bottle?"

**Decision tree:**
- If "yes, clear" → no UI tweak; close anchor-leaf as
  fan-out-acceptable
- If "confusing" → ship one of the three low-effort mitigations
  (tooltip / visual treatment / hide-from-non-anchor) within
  Slice 11.5 scope per Edward + CA Step 3 close

### Walk 2 — Per-component flagging on Mark-Accepted

**Setup:** sample order with one assembly_leaf override pushing a
single component below floor (e.g., override on bottle T1 below
cost). Other components remain GOOD.

**Walk:** navigate Mark-Accepted page. Observe `flaggedLines`
output.

**Observe:** "LIB-PP-BOTTLE-30 — T1 — 24% margin" surfaces in the
flagged list. Other tiers and other quote lines remain unflagged.

**Ask PM:** "Does this represent what you need to see at the
acceptance review? Do you want the alerts at the component level,
or at the finished-product level (HGS-30-001 — T1)?"

**Decision tree:**
- If "component level is fine" → close as banked
- If "product level preferred" → bank as v1.1+ slice (math layer
  extension to roll BELOW_FLOOR up to parent assembly when any
  child triggers)

### Walk 3 — Per-component flagging on Pricing LinesRequiringReview

**Setup:** same as Walk 2 (override pushing one component below
floor).

**Walk:** navigate Pricing surface. Trigger blended BELOW_FLOOR by
adding more overrides until blended drops; observe
LinesRequiringReview surface.

**Observe:** component-level rows with "Jump to tier" affordance.

**Ask PM:** "When the floor is breached, do you want to see which
components contributed, or which products are at risk?"

**Decision tree:** same as Walk 2 — banked if confusion confirmed,
closed if PMs intuit it.

---

## §6 · Tsc + structural verification

- `tsc --noEmit` clean as of Step 4 merge; no Step 5 code changes
  required (verification-only step).
- v2 A4 grep audit (Step 4 deliverable): zero hits for the 13
  deleted action names across `src/`. Confirms no orphan caller
  re-emerged.
- v2 A7 audit-name check (Step 4 deliverable): all 8 §4 audit
  names landed verbatim.

---

## §7 · Step 5 closure

**Code-level audit:** clean. Every surface consumes the NEW-model
adapter output correctly. No structural breaks. No crash modes.

**UX-level audit:** two PM-ergonomics concerns banked as v1.1+
candidates:
1. Anchor-leaf production fan-out — surfaces as asymmetric per-leaf
   rendering on Production drilldown
2. Per-component flagging — surfaces on Mark-Accepted +
   LinesRequiringReview as library-leaf-keyed verdict rows

**Step 5 deliverables:**
- This verification doc (`docs/cc-slice-11-5-step-5-verification.md`)
- UX_BACKLOG updates: 3 v1.1+ entries (the 2 above + copyTier
  helper from Step 4 close)
- Three CB walk asks specified for Edward to empirical-test before
  Step 6

**What's NOT in Step 5 scope:**
- Proactive UI mitigations for the banked concerns. Edward + CA
  Step 3 close authorized "in-scope mitigation IF CB walk surfaces
  confusion." CC can't surface confusion empirically; defers to
  Edward's CB pass.
- Math-layer extensions (per-assembly production native input;
  parent-assembly BELOW_FLOOR rollup). Both are real candidates but
  require math-layer scope per Pattern 22 §3.
- Sample-order re-seed: Step 6.

**Step 6 kickoff is unblocked.** No CC implementation work surfaced
from Step 5 audit; CB walk outcome may add 1-3 small UI mitigations
within Step 6 timing if needed.

---

## Reference

- Slice 11.5 brief (canonical, v1 + v2 merged): `docs/cc-comm-slice-11-5-brief.md`
- Step 3 PR #68: NEW-model adapter + read-path migration
- Step 4 PR #69: NEW-model write actions + hard cutover
- Pattern 22 §3 math-layer commitment (CLAUDE.md "Math layer is the
  load-bearing surface")
- Pattern 39 nexus-extension hygiene (CLAUDE.md "Pattern 39 nexus
  extension hygiene")
