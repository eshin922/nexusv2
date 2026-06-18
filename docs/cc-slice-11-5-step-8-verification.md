# Slice 11.5 — Step 8 close-out: orphan cleanup + CLAUDE.md updates
# (OLD-table drops carved to Slice 11.5.1)

Branch: `slice-11-5-step-8-old-drop` (off main @ f42cde4, PR #72
merge — predicate verification + MIG walks).

Step 8 closes the slice. Per brief §6 Step 8 the intent was:

> - Drop migrations for legacy tables
> - Delete `src/app/actions/packaging.ts`, `production.ts`,
>   `costing.ts` `updateSellPriceOverride/updateClientTarget`
> - Delete orphan-on-disk components carrying OLD-model imports
>   (per #A17 disposition: clean delete in this step)
> - Update CLAUDE.md
> - PR open

**Step 8 scope re-disposition.** Audit during Step 8 found ~215
remaining OLD-schema refs across 5 deeply-integrated files
(warnings.ts engine, markup-defaults admin, sku-tree library,
actions/quotes.ts legacy functions, quote-guards.ts helpers).
Migrating these cleanly to drop the OLD tables is half-day to
one-day focused work — beyond the brief's expected Step 8 scope.

**Carved disposition:** Step 8 ships the orphan cleanup + CLAUDE.md
updates that close the slice's architectural commitment.
**Slice 11.5.1 — finish OLD-table drops** (banked in UX_BACKLOG)
handles the migration + actual table drops.

This carve maintains the v1 production system in a clean state:
NEW-model adapter + write actions running on prod, sample order
demonstrating the curve, OLD tables write-orphaned but read-
compatible until 11.5.1 ships.

---

## §1 · What Step 8 ships

### Orphan Setup tree files deleted (6 files)

Per Pattern 17 "Surface unification can orphan components" — the
Setup page (`src/app/projects/[id]/quotes/[quoteId]/page.tsx`)
already renders ONLY the NEW `AssemblyTreeView` (per the explicit
"legacy quote_skus render path is removed in this slice" comment
in page.tsx). The OLD Setup tree components remained on disk
post-RI.4 / Phase A.1 v2 but were unreachable from any active
page.

Deleted (zero callers after cross-reference audit):
- `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx`
- `src/app/projects/[id]/quotes/[quoteId]/sku-row-list.tsx`
- `src/app/projects/[id]/quotes/[quoteId]/sku-footer.tsx`
- `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx`
  (different file than `src/components/add-product/add-product-modal.tsx`
  which is the NEW model implementation)
- `src/app/projects/[id]/quotes/[quoteId]/add-assembly-button.tsx`
- `src/app/projects/[id]/quotes/[quoteId]/sku-search-panel.tsx`

`tsc --noEmit` clean post-deletion confirmed all 6 had no active
imports from any compilation path.

### OLD-schema $inferSelect type refs replaced

Three component-side type refs migrated from
`typeof X.$inferSelect` (OLD schema) to inline structural types:

- `src/components/costs/packaging-drilldown.tsx` — `QuoteSku` type
  inlined with the fields the drilldown actually reads (id,
  skuLabel, productName, skuRole, parentSkuId, qtyPerParent,
  sortOrder)
- `src/components/costs/production-drilldown.tsx` — `QuoteSku`
  type aliased to `SkuRow` from `src/lib/sku-tree.ts` (which is
  also now structural)
- `src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx` —
  `SyntheticQuoteSku`, `SyntheticPackagingRow`,
  `SyntheticProductionRow` inlined with the exact field shapes
  the drilldowns consume

### sku-tree.ts library generalized to structural SkuRow

`src/lib/sku-tree.ts` was importing `typeof quoteSkus.$inferSelect`.
Step 8 replaced with a structural `SkuRow` type carrying the
fields the library reads (id, skuLabel, productName, skuRole,
parentSkuId, qtyPerParent, sortOrder, createdAt, hubspotProductId,
unitsPerPack, retailBenchmark, notes, quoteId). Library is now
model-agnostic; consumed by both remaining OLD-model paths in
quotes.ts AND the new synthetic Costs page shape.

### CLAUDE.md updates (3 new sections, per brief §6 Step 8 list)

**Math layer is the load-bearing surface; future cost-data
migrations don't touch it** — brief §3 architectural commitment
banked verbatim. References math layer + adapter + Pattern 22
insulation rationale; documents the de-risking consequences;
includes a working test for future-CC ("input-slot additions
stay model-agnostic; behavior additions tie to a model").

**Per-assembly source → per-leaf adapter coercion** — pattern
documentation for the anchor-leaf fan-out shape introduced in
Slice 11.5 Step 3 adapter. Describes the trade-off (auditable
1:1 trace vs UI asymmetry), the escalation path (math layer
extension if PM confusion confirmed), and cross-references to
UX_BACKLOG "Per-assembly production fan-out — math layer
extension."

**audit_log action namespace — Slice 11.5 additions** — 8 audit
action names from brief §4 documented with per-action
description, entity_type / entity_id semantics, and diff_json
shape:
- `assembly_leaf_input_line_added`
- `assembly_leaf_input_line_updated`
- `assembly_leaf_input_line_deleted`
- `assembly_leaf_input_cell_updated`
- `assembly_production_input_updated`
- `assembly_production_policy_updated`
- `assembly_leaf_sell_override_updated`
- `assembly_leaf_client_target_updated`

---

## §2 · What Step 8 does NOT ship (carved to Slice 11.5.1)

OLD tables stay in `src/db/schema.ts`. Drop migration not generated.
Five files retain OLD-schema references (215 total):

| File | OLD-schema usage | Migration scope |
|---|---|---|
| `src/app/actions/warnings.ts` | Validation engine reads `packaging_inputs` + `production_inputs` | Migrate to NEW-model reads (critical path) |
| `src/app/actions/markup-defaults.ts` | Admin queries `packaging_inputs.category` for usage counts | Migrate to `assembly_leaf_inputs.category` |
| `src/app/actions/quotes.ts` | Legacy quote_skus action functions (orphan callers deleted) | Audit + delete unused; preserve tier-side actions |
| `src/lib/quote-guards.ts` | `quoteForSku`, `quoteForLeafSku`, `quoteForLineGroup` OLD helpers | Remove (NEW counterparts shipped Step 4) |
| `src/db/schema.ts` | OLD table definitions | Drop after consumers migrate |

UX_BACKLOG entry **"Slice 11.5.1 — finish OLD-table drops (carved
from Slice 11.5 Step 8)"** captures the full scope + risk profile
+ estimated effort.

**Why this carve is safe:**
- OLD tables are write-orphaned post Step 4 (no production code
  writes them)
- Legacy reads from warnings.ts + markup-defaults admin continue
  to work because the OLD data still exists in prod from pre-
  Slice-11.5 quotes
- Sample order is on NEW model end-to-end; PM-facing demo path
  is clean
- 11.5.1 can ship at Edward's pace without blocking other v1
  release-path work

---

## §3 · Slice 11.5 close summary

8 steps shipped over 2026-06-17 → 2026-06-18:

| Step | PR | Deliverable |
|---|---|---|
| 0 | #65 | §0.5 verification + Q4 NULL-safe audit |
| 1 | #66 | Final canonical brief (v1 + v2 merged) |
| 2 | #67 | 4 NEW cost-data tables (additive migration applied) |
| 3 | #68 | NEW-model adapter + read-path migration + 11 unit invariants |
| 4 | #69 | 8 NEW write actions + hard cutover + v2 A4/A7 gates |
| 5 | #70 | UI verification audit + 3 banked v1.1+ concerns + CB walks |
| 6 | #71 | Sample-order re-seed + margin curve + verify script |
| 7 | #72 | Predicate verification + MIG-1 through MIG-9 walks |
| 8 | #73 | Orphan cleanup + CLAUDE.md + 11.5.1 carve |

**Architectural commitment delivered.** Math layer untouched
(Pattern 22 §3). Adapter pattern shipped + tested + production-
running. NEW model is the canonical source for cost data.

**Sample order demo-quality.** Margin curve verified within 2.5pp
of brief v2 A2 targets. Quote-level blended margins T1 37% / T2
42% / T3 46% — all GOOD verdict.

**Banked v1.1+ work:**
- Slice 11.5.1 — finish OLD-table drops (Step 8 carve)
- Per-assembly production fan-out — math layer extension
- Per-component vs per-product flagging — Mark-Accepted +
  Pricing surface mitigation (pending CB walk)
- Packaging copy-tier-to-all helper — promote priority if PMs ask

**Three CB walks** ready for Edward against the live seeded
sample-order quote (Step 5 deliverable doc §5).

---

## Reference

- Slice 11.5 brief (canonical): `docs/cc-comm-slice-11-5-brief.md`
- Step 0-7 verification docs: `docs/cc-slice-11-5-step-{0..7}-verification.md`
- Pattern 22 §3 math-layer commitment (CLAUDE.md "Math layer is the
  load-bearing surface")
- Pattern documented Step 8: "Per-assembly source → per-leaf
  adapter coercion"
- audit_log namespace: CLAUDE.md "audit_log action namespace —
  Slice 11.5 additions"
- UX_BACKLOG entries: "Slice 11.5.1 — finish OLD-table drops",
  "Per-assembly production fan-out", "Per-component vs per-
  product flagging", "Packaging copy-tier-to-all"
