# slice-11-5-1-old-table-drops — Brief AMENDMENTS v2

**Brief baseline:** v1 (`docs/cc-comm-slice-11-5-1-brief.md`)
**Amendment driver:** CA critique on PR #74 draft. C1 critical verification + C2/C3 important polish + C4 optional safety net + A1 affirmation worth folding into CLAUDE.md.
**Status:** Dispositions locked. v2 supersedes specified sections of v1. CC reads canonical brief set as **v1 + v2** with v2 taking precedence on conflicts.
**Date:** 2026-06-18

CA critique verdict on v1: "Architectural shape sound. 1 CRITICAL verification + 2 important polish items + 1 optional safety net." Core scope unchanged; v2 sharpens verification gates + adds insurance.

---

## §0 · C1 verification result (CONFIRMED YES)

**CA's question (v1 §2 brief, restated):**

> Does `bundle.data.costing.skuRollups` (and the rest of
> `bundle.data`) expose enough cell-level context for warnings.ts
> to surface specific cells without re-querying raw cost tables?

**Verification method (CC, pre-v2 draft):**

1. Read `src/lib/validation.ts` — `validateQuote(input, costing)`
   takes both `QuoteCostingInput` AND `QuoteCostingResult` as args
2. Read `src/lib/costing-store.ts` — `HydrateSnapshot` includes
   `packaging`, `production`, `cellOverrides`, `cellTargets`,
   `skus`, `tiers`, `firmSettings`, `markupDefaults`,
   `freightLeg*`, AND `costing: QuoteCostingResult`
3. Read `src/app/actions/warnings.ts` `loadCostingForQuote` —
   currently builds `QuoteCostingInput` from raw OLD-table reads,
   then calls `validateQuote(input, costing)`

**Verification result: YES — bundle exposes everything warnings.ts
needs.**

Concretely, `bundle.data` already contains the EXACT
`QuoteCostingInput` shape `validateQuote` consumes:
- `bundle.data.packaging[].quoteSkuId / tierId / lineGroupId /
  unitCost / qtyPerSellableUnit / category / markupPct` —
  per-(leaf, tier) packaging context (the source for "packaging
  line X on tier T2" warnings)
- `bundle.data.production[].quoteSkuId / tierId / customerShipsRaws /
  allocateServiceFeesToCost / fillingBlendingCost / cmAssemblyTotal /
  setupFeeTotal / toolingArtworkTotal / rdTotal / otherServiceTotal /
  bulkRawCost / actualUnitsProduced` — per-(leaf, tier) production
  context
- `bundle.data.cellOverrides[].quoteSkuId / tierId /
  sellPriceOverride` — sparse override context
- `bundle.data.cellTargets[].quoteSkuId / tierId /
  clientTargetPricePerUnit` — sparse target context
- `bundle.data.costing` — full `QuoteCostingResult` (skuRollups,
  quoteRollup, quoteSummary, breakdowns)

Override-source attribution is preserved transparently: the
adapter's packaging array already carries the markup_pct value
(which differs from category_default when manual override is
active). The engine reads it directly per
`checkLineLevelCompleteness` etc.

**Architectural commitment HOLDS unchanged.** v1 §2 warnings.ts
migration design proceeds as drafted: warnings.ts becomes a pure
projection of bundle data. No adapter changes; no fallback path
needed; no Pattern 22 §3 escape.

**§0.5 ledger update:** zero catches surfaced from C1 verification
(architectural commitment was achievable). Slice 11.5.1 §0.5
contribution stays at 0; cumulative 68 across 15 slices.

---

## §1 · C2 — Broad grep audit of 14 "delete" + 2 "audit" functions

CA flagged that v1 §2 actions/quotes.ts cleanup listed UI-orphan
status only. Real callers could exist in other actions, dev
scripts, test fixtures, API routes, webhook handlers.

CC ran broad grep across `src/` + `scripts/` for all 16
functions. Each match cross-referenced to confirm active code
vs documentation reference.

**Results:**

| Function | Apparent callers | Real active callers | Disposition |
|---|---|---|---|
| `addSkuFromHubspotProduct` | sku-tree.ts (comment) | 0 | **delete** |
| `addProductSku` | leaves.ts (comment), page.tsx (comment) | 0 | **delete** |
| `addAssemblySku` | sku-tree.ts (comment) | 0 | **delete** |
| `reorderQuoteSkus` | assemblies.ts (comment) | 0 | **delete** |
| `updateQtyPerParent` | none | 0 | **delete** |
| `assignSkuToParent` | sku-tree.ts (comment) | 0 | **delete** |
| `unassignSkuFromParent` | none | 0 | **delete** |
| `convertSkuRole` | sku-tree.ts (comment) | 0 | **delete** |
| `convertLeafToAssemblyDestructive` | none | 0 | **delete** |
| `attachAndConvertToLeaf` | none | 0 | **delete** |
| `refreshSkuFromHubspot` | none | 0 | **delete** |
| `updateSku` | none | 0 | **delete** |
| `deleteSku` | assemblies.ts (comment), freight.ts (comment), costing-store.ts (comment) | 0 | **delete** |
| `moveSku` | none | 0 | **delete** |
| `checkProductSku` | none | 0 | **delete** |
| `getCurrentHubspotOwner` | none | 0 | **delete** |

All "matches" outside `actions/quotes.ts` are LINEAGE COMMENTS —
references like "mirrors `deleteSku` in quotes.ts" or "pattern
from Slice 5.5 `deleteSku`". No active code calls any of the 16
functions. Setup-page lineage acknowledgment for `addProductSku`
(`page.tsx:79`) explicitly notes the OLD write path was removed
in Phase A.1 v2 and the HubSpot bidirectional micro-slice
restores the new write path before pre-launch review.

**Brief v2 amendment:** all 16 functions safe to delete in Step 3.
Lineage comments in other files stay (they're historical
context, not active references). Step 4 grep verification re-runs
the same scan post-deletion to confirm zero hits.

Per CA C2 disposition, deletions get a comment in the commit
message explaining what was removed + why orphan (one-line each;
the lineage comments in other files provide the deeper rationale
for any future-CC pattern-matching).

---

## §2 · C3 — Parity verifier coverage extension

CA flagged that the seeded sample order has all-GOOD margins
(T1 37% / T2 42% / T3 46% per brief v2 A2 design). Parity of
"empty output vs empty output" proves zero. The actual warning-
generation logic isn't exercised.

**Disposition: CA option (a) — programmatic override mid-test.**

The verifier opens a transaction, applies override(s) to push
the seeded sample order below floor, runs warnings engine pre vs
post (or pre-migration vs post-migration in the actual run),
captures the warning list, rolls back the transaction.

This is testing-discipline-clean: no fixture state to maintain
outside the verifier; the seeded sample order stays unchanged
post-test; verifier is self-contained + re-runnable.

**Verifier spec (Step 1 deliverable):**

```typescript
// scripts/verify/slice-11-5-1-warnings-parity.ts
//
// 1. Load seeded sample order quote_id
// 2. BEGIN TRANSACTION
// 3. Apply force-warning state:
//    - INSERT assembly_leaf_overrides row pushing one leaf-tier
//      cell below floor (e.g., bottle T1 sell_price_override
//      = $0.40, well below the ~$0.60 computed sell)
//    - (Optional) Toggle assembly_production_inputs.customer_ships_raws
//      true on HGS-30-001 to exercise raw-cost completeness warnings
// 4. Run engine via current code: capture warning list
// 5. Run engine via Step 1 migrated code: capture warning list
// 6. Assert: lists identical (shape, content, order)
// 7. ROLLBACK TRANSACTION
// 8. Exit 0 on parity pass; exit 1 with diff on mismatch
```

The migrated engine code path is loaded via the same test file
(separate import); pre-migration code path stays on disk
through Step 1 → Step 2 (deleted in Step 4 schema cleanup).

**Step plan v2 update:** Step 1 deliverable now includes both
the warnings.ts migration AND the parity verifier. Verifier
runs against prod DB transaction-rolled-back; safe execution
posture.

---

## §3 · C4 — Archive-before-drop safety net

CA recommended creating `_archive_*` tables before the drop,
holding 30 days, then cleanup. CC concurs: 5 minutes of work for
queryable insurance vs. PITR ceremony.

**Disposition: CC INCLUDES.** Minimal cost; meaningful insurance
during Week 1 monitoring window when an unanticipated
regression could surface a need for OLD data.

**Step 4 v2 update:**

Before the DROPs, run:

```sql
CREATE TABLE _archive_quote_skus AS SELECT * FROM quote_skus;
CREATE TABLE _archive_packaging_inputs AS SELECT * FROM packaging_inputs;
CREATE TABLE _archive_production_inputs AS SELECT * FROM production_inputs;
CREATE TABLE _archive_quote_sku_tiers AS SELECT * FROM quote_sku_tiers;
CREATE TABLE _archive_quote_sku_tier_targets AS SELECT * FROM quote_sku_tier_targets;
```

Then proceed with DROPs. Archive tables retain owner +
grant by inheritance; admin access only.

**30-day cleanup:** banked in UX_BACKLOG as a calendar-anchored
follow-up. Drops `_archive_*` tables on 2026-07-19 (30 days
post-merge of Slice 11.5.1; specific date when slice ships).
Single DROP TABLE × 5 migration; ~10-line schema cleanup PR.

If anything surfaces Week 1 requiring OLD data, archive is
queryable via direct SQL — no PITR ceremony. After 30-day
window of stability, archives drop in follow-up cleanup.

**Cutover plan v2 update:** §5 rollback plan now reads "git
revert + redeploy + manual restore of any affected rows from
`_archive_*` (queryable for 30 days post-merge)." PITR remains
the next-level fallback.

---

## §4 · A1 — CLAUDE.md §3 commitment extension

CA observed that v1 brief's warnings.ts reframe extends the
Slice 11.5 §3 architectural commitment from "math layer is load-
bearing" to "math-layer output is load-bearing; downstream
consumers project from math output, not from raw schema."

**Disposition: CC FOLDS INTO STEP 4 CLAUDE.md DOCS.**

Step 4 docs update (originally adds the schema drop completion
note) gets an extension to the existing "Math layer is the load-
bearing surface" section banked in Slice 11.5 Step 8:

> **Extension banked Slice 11.5.1 (2026-06-18):** the load-bearing
> commitment extends to math-layer OUTPUT, not just the input
> contract. Downstream systems (warnings engine, audit
> projections, exports, future analytic surfaces) consume the
> bundle's computed result as data; they do not parallel-derive
> from raw schema. When a new downstream consumer surfaces,
> first question is: "does
> `getCostingBundle().data.costing.skuRollups` (or sibling
> bundle fields) expose what you need?" If yes, project from
> bundle. If no, propose a new bundle field; do not parallel-
> derive from cost tables.

Slice 11.5.1's warnings.ts migration is the canonical instance of
this extension; future-CC pattern-matches on "is this a parallel
raw-data consumer? → make it downstream of math instead."

---

## §5 · Step plan v2 update

3-4 steps reframed with v2 amendments incorporated:

### Step 1 · warnings.ts migration + parity verifier
- Rewrite `loadCostingForQuote` to call `getCostingBundle()`
  and consume `bundle.data` directly. Engine input is now the
  bundle's `QuoteCostingInput` shape (sourced via adapter from
  NEW model).
- `validateQuote(input, costing)` call shape unchanged.
- Ship `scripts/verify/slice-11-5-1-warnings-parity.ts` (C3
  spec). Runs against prod DB in transaction-rolled-back mode;
  safe to re-run.
- tsc check.

### Step 2 · markup-defaults.ts migration
- Swap `packaging_inputs.category` → `assembly_leaf_inputs.category`
  in 3 admin queries.
- Smoke admin page renders correct category usage counts.

### Step 3 · quotes.ts + quote-guards.ts cleanup
- Delete 16 functions per C2 verified-zero-active-callers table
  (commit message lists each deletion + lineage rationale).
- Remove OLD guard helpers from quote-guards.ts.
- tsc check.

### Step 4 · Schema drop migration + archive + docs
- Archive: `CREATE TABLE _archive_* AS SELECT *` for all 5 OLD
  tables (C4 safety net).
- Schema cleanup: remove OLD table declarations from
  `src/db/schema.ts`.
- `drizzle-kit generate` — verify migration is exactly 5 DROP
  TABLE statements + cascading FK cleanup.
- Apply migration to prod (Single Supabase project posture).
- Step 4 docs: add A1 §3 extension to CLAUDE.md.
- UX_BACKLOG: add 30-day archive cleanup follow-up
  (calendar-anchored).
- PR open.

---

## §6 · Summary of v2 changes

| # | Amendment | v1 impact |
|---|---|---|
| C1 | skuRollups verification result CONFIRMED YES | v1 §2 architectural commitment HOLDS unchanged |
| C2 | Broad grep audit — all 16 fns zero active callers | v1 §2 actions/quotes.ts step proceeds; commit lists rationale |
| C3 | Parity verifier extended with force-warning fixture path | v1 §3 + v1 Step 1 deliverable |
| C4 | Archive-before-drop safety net (5-min insurance) | v1 §5 cutover plan; v1 Step 4 |
| A1 | §3 extension to math-OUTPUT-is-load-bearing | v1 Step 4 CLAUDE.md docs add |

### Net effect

v1 architecture + 4-step plan + warnings.ts pure-projection
design stand verbatim. v2 sharpens the verification gates +
adds insurance + extends Slice 11.5 §3 commitment cleanly.

**Step 1 kickoff is unblocked once Slice 11.5 closes via CB walks
+ Edward greenlights this v2 amendments doc.**

---

## Authorization

CC reads canonical set as **v1 + v2** with v2 taking precedence on
conflicts.

CA reviews v2 + Edward signals kickoff → Slice 11.5.1 Step 1
begins (post Slice 11.5 close via MIG-1 through MIG-9 walks).

---

**End of v2 amendments.** Canonical brief set: **v1 + v2**.
v2 takes precedence on conflicts.
