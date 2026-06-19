# slice-11-5-1-old-table-drops — CC brief (canonical)

**Branch:** `slice-11-5-1-old-table-drops` (TBD on CC kickoff)
**Baseline:** `main` post Slice 11.5 close (PRs #73, #74, #75 merged)
**Strategic position:** **pre-launch** v1 critical-path follow-up
to Slice 11.5. Completes the OLD→NEW model migration: migrates 5
deeply-integrated files that still read OLD-model cost tables,
extends the realtime publication + subscriptions to NEW tables,
deletes orphan-on-disk PSR-superseded components, then drops the
OLD tables. Required before the launch wipe-and-reseed (Slice
11.5 Q2 posture) since legacy reads + stale realtime
subscriptions would otherwise hit empty-data states of unknown
handling quality.
**Driver:** Slice 11.5 Step 8 carve disposition + Edward
reclassification 2026-06-18 (v1.1+ → pre-launch) + CB walk
MIG-8 realtime FAIL absorption + MIG-4/5 orphan-on-disk
component cleanup absorption.
**Authoring:** CC drafts post Slice 11.5 close; v1 + v2
(7 amendments: C1-C4 + A1-A4) merged inline. Companion
documents:
- `docs/cc-comm-slice-11-5-1-brief-v2-amendments.md` — v2
  amendments historical changelog (this brief's v1 → v2 delta)
- `docs/cc-comm-slice-11-5-cb-walk-findings.md` — MIG-4/5/6/8
  investigation deliverable backing A2-A4
**Date:** 2026-06-18

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract.

Slice 11.5.1 is an internal architectural cleanup slice. **No CD
prototype.** UI surfaces don't change behavior (warnings panel +
admin markup-defaults page already render; this slice keeps them
rendering identical output sourced from NEW model).

**Architectural fidelity lives in:**
- `src/lib/costing.ts` — math layer untouched; consumer of NEW
  model + adapter
- `src/lib/costing-adapter.ts` — NEW-model adapter from Slice
  11.5 Step 3; this slice does NOT modify it
- Slice 11.5 Step 5 verification doc — UI invariants from the
  Pricing surface BELOW_FLOOR review panel + Mark-Accepted
  flagged lines that warnings.ts feeds into

**Before implementing each step, CC MUST:**
1. Read brief §X.Y for scope + table mapping
2. Verify warnings.ts behavior is parity-preserved against the
   seeded sample-order quote (verifier in §3 spec)
3. Verify MIG-8 realtime re-walk passes against the
   sample-order quote post-publication-migration

---

## §0.5 · Schema verification (pre-approval)

Per Pattern 22 standing protocol. CC ran verification BEFORE
brief draft (Step 8 audit serves double duty here — the OLD-
schema reference inventory IS the §0.5 verification for this
slice).

**OLD tables to drop:**
- [x] `quote_skus` ✓ exists (`schema.ts` Slice 5)
- [x] `packaging_inputs` ✓ exists (`schema.ts` Slice 5)
- [x] `production_inputs` ✓ exists (`schema.ts` Slice 6)
- [x] `quote_sku_tiers` ✓ exists (`schema.ts` Slice 9.3)
- [x] `quote_sku_tier_targets` ✓ exists (`schema.ts` Slice 9.4b)

**NEW tables to read from (already shipped Slice 11.5 Step 2):**
- [x] `assembly_leaf_inputs` ✓ exists
- [x] `assembly_production_inputs` ✓ exists
- [x] `assembly_leaf_overrides` ✓ exists
- [x] `assembly_leaf_targets` ✓ exists
- [x] `assemblies` + `assembly_leaves` + `leaves` ✓ exist

**Code architecture verification (Pattern 22 extension):**
- [x] `src/app/actions/warnings.ts` reads OLD model — confirmed
- [x] `src/app/actions/markup-defaults.ts` reads OLD — confirmed
- [x] `src/app/actions/quotes.ts` references OLD quote_skus —
      audit unused functions (C2 verified: all 14 + 2 audit
      functions have zero active callers)
- [x] `src/lib/quote-guards.ts` has OLD helpers
      (`quoteForSku`, `quoteForLeafSku`, `quoteForLineGroup`) —
      NEW equivalents shipped Step 4
      (`quoteForAssembly`, `quoteForAssemblyLeaf`,
      `quoteForAssemblyLeafInputLineGroup`)
- [x] `src/lib/sku-tree.ts` already migrated to structural
      `SkuRow` in Slice 11.5 Step 8 (PR #73)

**Realtime subscription audit (added v2 A2):**
- [x] `src/components/costing-store-provider.tsx` subscribes to
      OLD tables (`quote_skus`, `packaging_inputs`,
      `production_inputs`) per Slice 8.5 wiring — confirmed
- [x] `drizzle/manual/0001_supabase_realtime_publication.sql`
      publication membership includes OLD tables — confirmed
- [x] `assembly_leaf_overrides` + `assembly_leaf_targets` NEVER
      wired to realtime (Slice 8.5 omission; Slice 11.5.1
      brings online — positive externality)

No §0.5 catches surfaced beyond inventory. v2 §0.5 ledger entry
covers cross-consumer audit gap as a procedural learning, not a
slice-specific catch.

---

## §1 · Strategic framing

**Pre-launch positioning.** Per Edward 2026-06-18: Slice 11.5.1
is pre-launch, not v1.1+. The wipe-and-reseed at launch (Slice
11.5 Q2 posture) eliminates OLD-table data. Once data is gone,
legacy reads in the 5 files either:
- Break (NULL handling, type assumptions)
- Render degraded (empty warnings, empty admin views)
- Work fine

We can't safely wipe OLD tables at launch unless 11.5.1 has
shipped. Pre-launch slot is mandatory.

**Architectural commitment extension (v2 A1).** Slice 11.5
banked the math-layer-as-load-bearing-surface commitment.
Slice 11.5.1 extends it: load-bearing applies to math-layer
OUTPUT, not just input contract. Downstream systems (warnings
engine, audit projections, exports, future analytics) consume
the bundle's computed result as data; they do not parallel-
derive from raw schema. **warnings.ts migration is the canonical
instance** — engine becomes a pure projection of bundle data.

**Slottable in v1 critical path:**
- After Slice 11.5 close (PRs #73-#75 merged) — done
- Before Slice 11 audit OR in parallel with Slice 12 external
  lead time

**Scope (5 files + 1 schema drop + 1 realtime extension):**

| File | Migration |
|---|---|
| `src/app/actions/warnings.ts` | Validation engine projects from `bundle.data.costing.skuRollups` (v2 C1 verified) |
| `src/app/actions/markup-defaults.ts` | Admin category-usage counts from NEW |
| `src/app/actions/quotes.ts` | Delete 14 unused quote_skus-only functions (v2 C2 grep-verified zero callers) |
| `src/lib/quote-guards.ts` | Delete OLD helpers; NEW already shipped |
| `src/db/schema.ts` | Drop 5 OLD tables + drop migration |
| `src/components/costing-store-provider.tsx` | Subscriptions migrate OLD → NEW tables (v2 A2) |
| `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql` | Publication membership ALTER (v2 A2) |
| Orphan PSR-superseded components | Delete (v2 A3) |

---

## §2 · Architecture

### warnings.ts validation engine migration (v2 C1 verified)

`src/app/actions/warnings.ts` is the Slice 9.5 validation engine.
Surfaces warnings on:
- Pricing surface BELOW_FLOOR review panel
  (`LinesRequiringReview` component)
- Mark-Accepted flagged lines section

**v2 C1 verification result (CONFIRMED YES):** `validateQuote(input,
costing)` consumes both `QuoteCostingInput` AND
`QuoteCostingResult` — both shapes are already exposed in
`bundle.data` from `getCostingBundle()`:
- `bundle.data.packaging[].quoteSkuId / tierId / lineGroupId /
  unitCost / qtyPerSellableUnit / category / markupPct` — per-
  (leaf, tier) packaging context
- `bundle.data.production[].quoteSkuId / tierId /
  customerShipsRaws / allocateServiceFeesToCost /
  fillingBlendingCost / cmAssemblyTotal / setupFeeTotal /
  toolingArtworkTotal / rdTotal / otherServiceTotal /
  bulkRawCost / actualUnitsProduced` — per-(leaf, tier)
  production context
- `bundle.data.cellOverrides[]` / `cellTargets[]` — sparse
  override + target context
- `bundle.data.skus[] / tiers[] / firmSettings / markupDefaults`
- `bundle.data.costing` — full `QuoteCostingResult` (skuRollups,
  quoteRollup, quoteSummary, breakdowns)

**Migration:** rewrite `loadCostingForQuote` to call
`getCostingBundle()` and consume `bundle.data` directly. Engine
becomes a pure projection from bundle → warnings list. No
adapter changes; no fallback path; Pattern 22 §3 architectural
commitment holds.

### markup-defaults.ts admin queries

Three queries currently read `packaging_inputs.category`:
1. List categories with usage counts (display in admin)
2. Count rows using a category before delete (warning)
3. Cascade-delete rows when admin removes a category (rare)

**Migration:** swap `packaging_inputs` → `assembly_leaf_inputs`
in all three. Same column name (`category`); same semantics.
~10 line change per query.

### actions/quotes.ts — 14 + 2 functions all delete-safe (v2 C2)

**v2 C2 broad grep audit result** (every match cross-referenced):

| Function | Real active callers | Disposition |
|---|---|---|
| `addSkuFromHubspotProduct` | 0 (lineage comment only) | **delete** |
| `addProductSku` | 0 (lineage comments only) | **delete** |
| `addAssemblySku` | 0 (lineage comment only) | **delete** |
| `reorderQuoteSkus` | 0 (lineage comment only) | **delete** |
| `updateQtyPerParent` | 0 | **delete** |
| `assignSkuToParent` | 0 (lineage comment only) | **delete** |
| `unassignSkuFromParent` | 0 | **delete** |
| `convertSkuRole` | 0 (lineage comment only) | **delete** |
| `convertLeafToAssemblyDestructive` | 0 | **delete** |
| `attachAndConvertToLeaf` | 0 | **delete** |
| `refreshSkuFromHubspot` | 0 | **delete** |
| `updateSku` | 0 | **delete** |
| `deleteSku` | 0 (lineage comments only) | **delete** |
| `moveSku` | 0 | **delete** |
| `checkProductSku` | 0 | **delete** |
| `getCurrentHubspotOwner` | 0 | **delete** |

All "matches" outside `actions/quotes.ts` are lineage COMMENTS
(e.g., "mirrors `deleteSku` in quotes.ts"). No active code calls
any of the 16 functions. Step 3 deletes all 16 with per-function
commit-message rationale.

**Preserve** (tier-side + quote-level — not quote_skus-bound):
`createQuote`, `createScenario`, `setScenarioRecommended`,
`updateQuoteNotes`, `searchHubspotProductsAction`, `addTier`,
`updateTier`, `setTierRecommended`, `deleteTier`, `moveTier`,
`applyTierPreset`, `sendQuote`, `recordCustomerAcceptance`,
`clearCustomerAcceptance`.

### quote-guards.ts cleanup

Remove `quoteForSku`, `quoteForLeafSku`, `quoteForLineGroup`.
NEW counterparts already shipped Slice 11.5 Step 4. Confirm no
remaining callers post-cleanup.

### Orphan PSR-superseded component deletes (v2 A3)

MIG-4/5/6 investigations during Slice 11.5 close gate revealed
three components that are orphan-on-disk — wired by Slice 11.5
Step 4 to call NEW write actions, but NOT rendered by any
active page. PR #54 PSR redesign moved their workflows out of
inline cell-click into the read-only display + action-zone
workflow pattern; the old per-cell input components were never
deleted.

**Step 3 orphan delete scope:**
- `src/components/required-sell-cell.tsx` (zero imports; Step 4
  wired to `updateAssemblyLeafOverride` but never rendered)
- `src/components/pricing/client-target-cell.tsx` (same; wired
  to `updateAssemblyLeafTarget`)
- `src/components/pricing/reverse-solve-dialog.tsx` (audit:
  consumed only by orphan client-target-cell? if yes, delete;
  if has other consumers, preserve)

**Preserve** (Costs-surface still consumes):
- `src/components/pricing/active-tier-selector.tsx` — imported
  by `cost-stack-header.tsx` (Costs page tier-switching)

### schema.ts drop migration

Drop in this order (FK dependency safety):
```sql
DROP TABLE quote_sku_tier_targets;
DROP TABLE quote_sku_tiers;
DROP TABLE production_inputs;
DROP TABLE packaging_inputs;
DROP TABLE quote_skus;  -- cascading FKs already cleared
```

Generate via drizzle-kit after schema.ts edits. **Cutover
sequencing critical (v2 A2):** publication DROP must run BEFORE
schema DROP because you can't `DROP TABLE` while it's in a
publication.

### Realtime publication + subscription migration (v2 A2)

**Catch:** Slice 11.5 added 4 NEW cost-data tables (Step 2
schema migration), migrated read paths (Step 3) + write actions
(Step 4), but **realtime subscriptions stayed on OLD tables**.
CB walk MIG-8 surfaced empirically; investigation confirmed
root cause in `src/components/costing-store-provider.tsx` and
`drizzle/manual/0001_supabase_realtime_publication.sql`.

**Publication migration** (`drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql`):

```sql
-- Add NEW tables (idempotent; can run pre-merge)
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.assemblies,
  public.assembly_leaves,
  public.assembly_leaf_inputs,
  public.assembly_production_inputs,
  public.assembly_leaf_overrides,
  public.assembly_leaf_targets,
  public.quote_leaves;

-- Drop OLD tables (must run BEFORE Step 4 schema-drop migration)
ALTER PUBLICATION supabase_realtime DROP TABLE
  public.quote_skus,
  public.packaging_inputs,
  public.production_inputs;
-- quote_sku_tiers + quote_sku_tier_targets never in publication;
-- skip DROP for those.
```

**Subscription wiring update** in `src/components/costing-store-provider.tsx`:

| OLD table | NEW table(s) |
|---|---|
| `quote_skus` | `assemblies` + `assembly_leaves` |
| `packaging_inputs` | `assembly_leaf_inputs` |
| `production_inputs` | `assembly_production_inputs` |
| (none) | `assembly_leaf_overrides` (NEW — Slice 8.5 omission) |
| (none) | `assembly_leaf_targets` (NEW — Slice 8.5 omission) |
| (none) | `quote_leaves` (NEW for quote-pin events) |

Per-quote filter logic preserved (client-side filter by quote
membership stays the same shape; just routes through new event
payloads).

**Bonus catch fixed alongside:** `assembly_leaf_overrides` +
`assembly_leaf_targets` realtime subscriptions never existed in
OLD model (Slice 8.5 omission). Slice 11.5.1 brings per-cell
override + client-target cross-tab propagation online for the
first time — positive externality of NEW-model wiring.

**Cutover sequencing (critical):**

1. **Pre-merge:** publication ADD NEW tables (idempotent; no
   consumer yet). Verify dev + prod publications both include
   NEW table names.
2. **Merge + deploy:** code change updates subscriber to NEW
   tables. Brief gap when prod app has merged but PMs haven't
   refreshed (their loaded clients still subscribe to OLD
   tables). This gap is benign — OLD tables aren't written
   anymore post-Slice-11.5 Step 4, so missing OLD subscription
   events doesn't lose data.
3. **Post-merge:** publication DROP OLD tables — sequenced
   BEFORE Step 4's `DROP TABLE` migration (publication
   membership must be cleared before the underlying tables can
   be dropped).
4. **Step 4 drizzle migration runs DROP TABLE OLD.**
5. **Verify** MIG-8 re-walk passes against the seeded sample-
   order quote: cross-tab edit propagates.

---

## §3 · Verification

### Parity test (CC pre-PR; v2 C3)

**v2 C3 disposition: CA option (a) — programmatic override mid-
test in a rolled-back transaction.** The seeded sample order has
all-GOOD margins by Slice 11.5 Step 6 design; pure parity of
"empty output vs empty output" proves zero. The verifier must
exercise the warning-generation code path.

**Verifier spec** (`scripts/verify/slice-11-5-1-warnings-parity.ts`):

```typescript
// 1. Load seeded sample order quote_id
// 2. BEGIN TRANSACTION
// 3. Apply force-warning state:
//    - INSERT assembly_leaf_overrides row pushing one leaf-tier
//      cell below floor (e.g., bottle T1 sell_price_override
//      = $0.40, well below the ~$0.60 computed sell)
//    - (Optional) Toggle assembly_production_inputs.customer_ships_raws
//      true on HGS-30-001 to exercise raw-cost completeness
//      warnings
// 4. Run engine via current code (pre-migration): capture
//    warning list
// 5. Run engine via Step 1 migrated code: capture warning list
// 6. Assert: lists identical (shape, content, order)
// 7. ROLLBACK TRANSACTION
// 8. Exit 0 on parity pass; exit 1 with diff on mismatch
```

The migrated engine code path is loaded via the same test file
(separate import); pre-migration code path stays on disk
through Step 1 → Step 2 (deleted in Step 4 schema cleanup).

MIG wording update (v2 A1): wipe-and-reseed posture has no
pre-state. MIG entries that previously read "identical to
pre-migration" now read **"matches expected fixture values"**
— the parity verifier's force-warning fixture is the ground
truth.

### Browser smoke walks (CB)

- **Walk 1:** Pricing surface — open seeded sample order. PSR
  detail-zone client-target display + action-zone workflow
  exercised by overriding one cell below floor → flagged line
  surfaces with correct (assembly_leaf-keyed) identity.
- **Walk 2:** Mark-Accepted page — open seeded sample order →
  flaggedLines section empty (all GOOD). Override one cell
  below floor → flagged line surfaces in modal.
- **Walk 3:** Admin markup-defaults page — open
  `/admin/markup-defaults`. Category usage counts render
  correctly (sample order has 9 assembly_leaf_inputs rows
  across Primary / Secondary / Soft Goods categories).
- **Walk 4 (MIG-8 re-walk):** open seeded sample order in two
  tabs. Edit a packaging cell on tab A; tab B reconciles via
  realtime per Slice 8.5 pattern. Edit a sell-price override
  cell on tab A; tab B reflects (NEW capability — never worked
  before Slice 11.5.1).

---

## §4 · Step plan

5 steps over ~half-day to one day:

### Step 0 · §0.5 verification + brief amendments lock
- C1 verification (DONE pre-brief; skuRollups confirms cell-
  level warning context)
- C2 grep audit (DONE pre-brief; 16 functions zero callers)
- §0.5 ledger update +1 catch (cross-consumer audit gap)

### Step 1 · warnings.ts migration + parity verifier
- Rewrite `loadCostingForQuote` to call `getCostingBundle()`
  and consume `bundle.data` directly. `validateQuote(input,
  costing)` call shape unchanged.
- Ship `scripts/verify/slice-11-5-1-warnings-parity.ts` (C3
  spec). Runs against prod DB in transaction-rolled-back mode.
- tsc check.

### Step 2 · markup-defaults.ts migration
- Swap `packaging_inputs.category` → `assembly_leaf_inputs.category`
  in 3 admin queries.
- Smoke admin page renders correct category usage counts.

### Step 3 · quotes.ts + quote-guards.ts cleanup + orphan PSR deletes
- Delete 16 functions per C2 verified-zero-active-callers table
  (per-function commit-message rationale).
- Remove OLD guard helpers from quote-guards.ts.
- Delete orphan PSR components per A3:
  `required-sell-cell.tsx`, `client-target-cell.tsx`,
  `reverse-solve-dialog.tsx` (if orphan).
- tsc check.

### Step 4 · Realtime publication + schema drop + archive + docs
- **Archive snapshot** (C4 safety net):
  ```sql
  CREATE TABLE _archive_quote_skus AS SELECT * FROM quote_skus;
  CREATE TABLE _archive_packaging_inputs AS SELECT * FROM packaging_inputs;
  CREATE TABLE _archive_production_inputs AS SELECT * FROM production_inputs;
  CREATE TABLE _archive_quote_sku_tiers AS SELECT * FROM quote_sku_tiers;
  CREATE TABLE _archive_quote_sku_tier_targets AS SELECT * FROM quote_sku_tier_targets;
  ```
- **Realtime publication SQL** (A2; manual SQL file):
  - Apply `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql`
    against dev + prod
  - Verify publication membership matches expected NEW set
- **Subscription wiring update** in `costing-store-provider.tsx`:
  point at NEW table names per the mapping table above
- **Schema cleanup:** remove OLD table declarations from
  `src/db/schema.ts`
- `drizzle-kit generate` — verify migration is exactly 5 DROP
  TABLE statements + cascading FK cleanup
- Apply drizzle migration to prod (Single Supabase project
  posture)
- **Step 4 docs:**
  - CLAUDE.md "Math layer is the load-bearing surface" section
    extended per A1 (load-bearing applies to math-OUTPUT, not
    just input; downstream consumers project from bundle data)
  - CLAUDE.md cross-consumer audit catch (§0.5 #70) banked as
    standing pre-flight check
- **MIG-8 re-walk:** cross-tab realtime sync verification
- **UX_BACKLOG:** 30-day archive cleanup follow-up
  (calendar-anchored) + Slice 11.5.1 bonus catch note (per-cell
  override + client-target cross-tab propagation came online
  for the first time)
- PR open.

---

## §5 · Cutover plan

**Hard cutover at slice merge** (mirrors Slice 11.5 Q5 posture).

### Pre-merge tasks
1. CC verifies parity verifier passes (force-warning fixture)
2. CC verifies tsc clean post-deletion
3. CC verifies publication ADD-NEW lands on dev + prod
   pre-merge
4. CB walks 1-4 sign off (including MIG-8 re-walk)

### Merge day
1. PR merges
2. Production deploys
3. Manual SQL: publication DROP OLD tables (must run BEFORE
   drizzle migration)
4. drizzle-kit migrate against prod drops OLD tables
5. Archive snapshot survives

### Post-merge monitoring (Week 1)
- Pricing surface BELOW_FLOOR review panel renders correctly
  on any quote that triggers warnings
- Mark-Accepted flagged lines section renders correctly
- Admin markup-defaults page renders correctly
- Realtime cross-tab sync works on packaging + production +
  override + target edits

### Rollback plan (v2 C4)
Git revert + redeploy. OLD tables dropped at merge time; archive
tables (`_archive_*`) survive for queryable recovery. If anything
surfaces Week 1 requiring OLD data, archive is direct-SQL
queryable — no PITR ceremony. After 30-day stability window,
archives drop in calendar-anchored follow-up PR.

---

## §6 · Out of scope / banked v1.1+

- **Per-assembly production fan-out math layer extension** —
  remains v1.1+ per CB walk outcome (CB confirmed math correct;
  visual asymmetry on Production drilldown not blocking)
- **Per-component vs per-product flagging mitigation** — remains
  v1.1+ per CB walk outcome
- **Packaging copyTier helper** — remains v1.1+ ("promote if
  PMs ask")
- **CB walk spec update** (A4) — banked for comprehensive CB
  test suite work (v1 critical-path item #13)
- **MIG-4/5 Hypothesis A/B verification** (does PSR action-zone
  carry sell-price override + client-target entry workflow, or
  removed without replacement?) — banked for Slice 11 audit
  pre-brief inventory

---

## §7 · §0.5 ledger update post-this-brief

- Slice 11.5.1 contributes 0 §0.5 catches inline (inventory
  done during Slice 11.5 Step 8 audit; no new architectural
  catches surfaced)
- Adjacent retrospective catches banked at Slice 11.5 close:
  - #69: Supabase pooler dual-budget gotcha
  - #70: Cross-consumer audit gap (banked alongside MIG-8
    investigation as procedural learning; future Pattern 22
    §0.5 extension)
- Cumulative across slices post-this-brief: **70 across 15
  slices**

---

## §8 · Sign-off

CA + Edward review v2 → CA confirms architectural commitments
locked → Edward greenlights → Step 1 kickoff.

CC runs:
- Step 1 warnings.ts migration + parity verifier
- Step 2 markup-defaults admin migration
- Step 3 quotes.ts + quote-guards + orphan PSR cleanup
- Step 4 realtime publication + schema drop + archive + docs +
  MIG-8 re-walk
- PR open

Half-day to one-day focused work. Single PR closes the slice's
cleanup arc + completes the NEW-model migration.

---

**Status: v1 + v2 (7 amendments: C1-C4 + A1-A4) merged inline.
Ready for Edward + CA review. Step 1 kicks off on greenlight.**

Historical references preserved:
- `docs/cc-comm-slice-11-5-1-brief-v2-amendments.md` — v2
  amendments changelog (this brief's v1 → v2 delta)
- `docs/cc-comm-slice-11-5-cb-walk-findings.md` — MIG-4/5/6/8
  investigation deliverable backing A2-A4
