# slice-11.5-cost-data-model-migration — CC brief v1

**Branch:** `slice-11-5-cost-data-model-migration` (TBD on CC kickoff)
**Baseline:** `main` post-Slice 12 v4 amendments + sample-order seed merge
**Strategic position:** v1 critical-path PRECURSOR to Slice 12 Step 2. Aligns Costs/Pricing/Quote read paths with Phase A.1 v2 NEW-model architecture so cost-data writes from Setup actually fan into the rollup.
**Driver:** 2026-06-17 sample-order-seed disposition surfaced the architectural drift: Setup writes NEW model (assemblies + assembly_leaves + quote_leaves + leaves); Costs/Pricing/Quote/Mark-Accepted still read OLD model (quote_skus tree + packaging_inputs + production_inputs + quote_sku_tiers + quote_sku_tier_targets). New quotes render empty on cost-bearing surfaces today.
**Authoring:** CC drafts post-disposition lock (Edward + CA dispositioned Q1–Q5 inline).
**Date:** 2026-06-17

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract.

This is an internal architectural slice. **No CD prototype.** Per the
scoping inventory §7 — schema shift is below the UI surface; existing R6
Cost build + R2 Pricing + R3 Quote chromes carry through unchanged.

**Architectural fidelity lives in:**
- `docs/cc-slice-11-5-scoping.md` — the scoping inventory; full
  OLD→NEW map + 3 path analysis. Read before EVERY step.
- `src/lib/costing.ts` — the math layer. Untouched by this slice; its
  input contract (`QuoteCostingInput`) IS the load-bearing surface.

**Before implementing each step, CC MUST:**
1. Read brief §X.Y for scope + schema sources
2. Re-read scoping doc for the touchpoint inventory (which actions,
   which stores, which UI components are affected at this step)
3. Verify the math layer's `QuoteCostingInput` shape stays untouched
   (see §10 architectural commitment)

**Implement adapter + schema changes ONLY.** No math-layer
modifications. No new UI surfaces. No new design rounds.

---

## §0.5 · Schema + Code-architecture verification (pre-approval)

Per Pattern 22 standing protocol. CC ran verification BEFORE Edward
+ CA approved this brief.

### Schema verification

- [x] `assemblies` table exists ✓ (`schema.ts:1643`)
- [x] `assembly_leaves` junction exists ✓ (`schema.ts:1782`)
- [x] `leaves` library exists ✓ (`schema.ts:1695`)
- [x] `quote_leaves` per-quote pin exists ✓ (`schema.ts:1909`)
- [x] `leaf_specs` versioned spec data exists ✓ (`schema.ts:1850`)
- [x] `quote_skus` legacy tree exists ✓ — TO BE DROPPED post-migration
- [x] `packaging_inputs` exists ✓ — TO BE DROPPED post-migration
- [x] `production_inputs` exists ✓ — TO BE DROPPED post-migration
- [x] `quote_sku_tiers` (sparse sell_price_override) exists ✓ — TO BE DROPPED
- [x] `quote_sku_tier_targets` (sparse client target) exists ✓ — TO BE DROPPED
- [x] `freight_leg_*` tables already model-agnostic ✓ — no migration
- [x] `markup_defaults` already model-agnostic ✓
- [x] `firm_settings` already model-agnostic ✓

### Architectural verification

- [x] Math layer `computeQuoteCosting` consumes `QuoteCostingInput` as
      pure data ✓ (`costing.ts:308-321` enumerates the shape;
      function is pure)
- [x] CostingStore hydrates from `HydrateSnapshot`; selectors are
      named primitives over the snapshot ✓
- [x] Pricing UI (PR #54 era) reads via classifier-context adapter
      from store snapshot ✓ — no direct OLD-model imports
- [x] Mark-Accepted page reads cost data via `getCostingBundle` only
      ✓ — single touch point
- [x] Setup write actions (`assemblies.ts` `addAssembly`,
      `assembly-leaves.ts` `attachLeafToAssembly`) write NEW model
      exclusively ✓
- [x] Add Product Modal (Phase A.1 v2 impl-4) writes NEW model
      exclusively ✓

### Cross-surface verification

- [x] `quote_skus` legacy tree is read by `getCostingBundle` →
      threads into `QuoteCostingInput.skus` field ✓
- [x] `packaging_inputs` / `production_inputs` / `quote_sku_tiers` /
      `quote_sku_tier_targets` are the four "deep gap" tables per
      scoping inventory §2 ✓
- [x] Costs `/page.tsx` directly imports legacy schema for the
      outer `Promise.all` queries ✓ — this page DOES need rewiring
      directly, not via getCostingBundle

### Q4 verification — `bulk_raw_*` + `cost_section_deposits` NULL-safe consumers

Per CA Q4 disposition: defer `bulk_raw_*` + `cost_section_deposits`
to v1.1+ IF no v1-rendered surface breaks on NULL/absent data.

**Inventory of consumers + NULL-safe branch verification (CC owns
during Step 0):**

- [ ] `BulkRawDrilldown` component (Costs page) — render guard:
      `rawsMode === 'dps_sources'`. With NEW model absent, `rawsMode`
      defaults to `'cm_sources'` (per `cost_build/page.tsx:179-180`
      fallback). Component never renders. ✓ Pending Step 0 confirm.
- [ ] `cost-stack-header` RAW row — gating on `rawsMode === 'dps_sources'`
      + `bulkRawCost > 0`. NEW model has no production_inputs.bulk_raw_cost
      → falls through to zero/hidden. Pending Step 0 confirm.
- [ ] Deposits chip on section headers — gates on
      `costSectionDeposits[].depositAmount > 0`. Empty array =
      no chip. Pending Step 0 confirm.
- [ ] Production "services billed separately" UX —
      `production_inputs.allocate_service_fees_to_cost` policy. NEW
      model has no production_inputs; defaults must produce a sane
      "no services" render. Pending Step 0 confirm.

**If any consumer breaks** → that surface enters Slice 11.5 scope
(or escalates back to Edward + CA for re-scoping).

### §0.5 catches surfaced

Per scoping inventory §10:

- **#A15** — `assemblies.unit_cost` flat semantic vs math layer's
  composed `factoryCostPerUnit`. **Disposition needed:** is
  `assemblies.unit_cost` deprecated post-11.5 (writes deleted; reads
  ignored), OR kept as a denormalized rollup field for Setup UI
  scan/summary use? CC lean: deprecate (writes from Setup form
  delete; reads ignored — Setup form re-computes from
  assembly_leaves rollup). Edward + CA disposition during brief
  review.
- **#A16** — Mark-Accepted page bundle consumer compatibility.
  Bundle shape unchanged by this slice (math layer untouched), so
  the bundle remains binary-compatible. **Verification:** SV-1
  walk-through against sample order on prod after Slice 11.5 ships
  confirms.
- **#A17** — PR #54 orphan-on-disk components (`verdict-band`,
  `lines-requiring-review`, `per-tier-override-card`,
  `pricing-section-head`, etc.) carry OLD-model schema references
  via imports. **Disposition:** stay orphan-on-disk through 11.5;
  do NOT migrate. v1.1+ cleanup deletes the files outright.

---

## §1 · Strategic framing

**This slice closes the cost-data read/write loop.**

Today's split:
```
PM uses Setup (NEW model)
    ↓
   writes assemblies + assembly_leaves + quote_leaves + leaves
    ↓
PM navigates to Costs
    ↓
   reads quote_skus tree (OLD model — empty for new quotes)
    ↓
   Costs page renders empty
```

Post-Slice 11.5:
```
PM uses Setup (NEW model)
    ↓
   writes assemblies + assembly_leaves + quote_leaves + leaves
    ↓
   writes cost-data extension tables (this slice adds them)
    ↓
PM navigates to Costs
    ↓
   adapter reads NEW model + cost-extension tables
    ↓
   feeds existing QuoteCostingInput shape
    ↓
   math layer unchanged → identical rollup output
    ↓
   Costs page renders properly
```

**Why this matters:**
- **Unblocks Slice 12 SV-1 happy path.** Sample order seeded via
  PR #61 + this slice's read-path migration = a real renderable
  quote demoable + acceptable + NetSuite-pushable.
- **Aligns architecture before more cost-data features ship.**
  Adding new features to a forked OLD/NEW split would compound
  technical debt slice-over-slice.
- **Sets up clean v1 deprecation.** OLD model tables drop in Step
  8; codebase moves to NEW-model-only.

### Three-leg integrity model (carried from Slice 12)

| Leg | Owns | Slice 11.5 impact |
|---|---|---|
| **Math layer (`computeQuoteCosting`)** | All cost computation | UNCHANGED. Pure data input. |
| **Adapter (NEW)** | Map NEW-model rows → `QuoteCostingInput` shape | NEW — Step 3 ships this |
| **NEW-model schema** | Source of truth for cost data | EXTENDED with 4 new tables in Step 2 |

---

## §2 · Architecture

### Adapter pattern (load-bearing principle)

CC ships a new module `src/lib/costing-adapter-new.ts` (name TBD —
see §9 Q1) that exports:

```typescript
export function buildQuoteCostingInputFromNewModel(args: {
  quoteId: string;
  // ... loaded NEW-model rows
}): QuoteCostingInput;
```

This is a **pure function**. Takes loaded DB rows, returns the math
layer's input shape. No DB access (caller loads rows). No
side-effects. Fully testable.

`getCostingBundle()` in `src/app/actions/costing.ts` becomes:

```typescript
async function getCostingBundle(quoteId) {
  // 1. Load NEW model rows in parallel (assemblies, assembly_leaves,
  //    quote_leaves, leaves + cost-extension tables)
  const rows = await loadNewModelCostData(quoteId);
  // 2. Adapter builds the input shape
  const input = buildQuoteCostingInputFromNewModel({ quoteId, ...rows });
  // 3. Math layer runs unchanged
  const result = computeQuoteCosting(input);
  // 4. Snapshot returned unchanged
  return { ok: true, data: hydrateSnapshot(input, result) };
}
```

**Dual-source posture during transition (per CA Q5 disposition):
HARD CUTOVER. No fallback to OLD model.** Once this slice merges,
the adapter is the only read path.

### Schema additions (per Q1 Path B)

Four new tables align NEW model with the math layer's input needs.
Each is a sparse-row table mirroring the OLD-model semantic so the
adapter does straightforward translation.

**`assembly_leaf_inputs`** — per-cell packaging cost data:
```sql
CREATE TABLE assembly_leaf_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_leaf_id uuid NOT NULL REFERENCES assembly_leaves(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES quote_tiers(id) ON DELETE CASCADE,
  line_group_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  supplier text,
  qty_per_sellable_unit numeric,
  category text,
  markup_pct numeric(5, 4),
  markup_pct_source text CHECK (markup_pct_source IN ('category_default', 'manual_override')),
  inventory_eligible boolean NOT NULL DEFAULT false,
  notes text,
  unit_cost numeric(10, 4),
  purchase_qty numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX assembly_leaf_inputs_line_tier_idx
  ON assembly_leaf_inputs (assembly_leaf_id, line_group_id, tier_id);
CREATE INDEX assembly_leaf_inputs_assembly_leaf_id_idx
  ON assembly_leaf_inputs (assembly_leaf_id);
CREATE INDEX assembly_leaf_inputs_tier_id_idx
  ON assembly_leaf_inputs (tier_id);
```

**`assembly_production_inputs`** — per-assembly-tier production policies:
```sql
CREATE TABLE assembly_production_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES quote_tiers(id) ON DELETE CASCADE,
  customer_ships_raws boolean NOT NULL DEFAULT false,
  allocate_service_fees_to_cost boolean NOT NULL DEFAULT true,
  actual_units_produced integer,
  filling_blending_cost numeric(12, 2),
  cm_assembly_total numeric(12, 2),
  setup_fee_total numeric(12, 2),
  tooling_artwork_total numeric(12, 2),
  rd_total numeric(12, 2),
  other_service_total numeric(12, 2),
  bulk_raw_cost numeric(12, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX assembly_production_inputs_assembly_tier_idx
  ON assembly_production_inputs (assembly_id, tier_id);
```

**`assembly_leaf_overrides`** — sparse sell-price overrides per (assembly_leaf, tier):
```sql
CREATE TABLE assembly_leaf_overrides (
  assembly_leaf_id uuid NOT NULL REFERENCES assembly_leaves(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES quote_tiers(id) ON DELETE CASCADE,
  sell_price_override numeric(10, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assembly_leaf_id, tier_id)
);
```

**`assembly_leaf_targets`** — sparse client target benchmark per (assembly_leaf, tier):
```sql
CREATE TABLE assembly_leaf_targets (
  assembly_leaf_id uuid NOT NULL REFERENCES assembly_leaves(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES quote_tiers(id) ON DELETE CASCADE,
  client_target_price_per_unit numeric(10, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assembly_leaf_id, tier_id)
);
```

**Renaming note for `assembly_leaf_overrides` / `_targets`:** OLD
tables were `quote_sku_tiers` / `quote_sku_tier_targets`. NEW names
are `assembly_leaf_overrides` / `assembly_leaf_targets` because the
unit of override is the (assembly_leaf, tier) intersection — sharper
than the old "quote_sku" framing.

### Drop migrations (Step 8)

```sql
DROP TABLE quote_sku_tier_targets;
DROP TABLE quote_sku_tiers;
DROP TABLE production_inputs;
DROP TABLE packaging_inputs;
DROP TABLE quote_skus;  -- legacy tree
```

Cascades clean per existing FK structure. CC verifies no orphan
FKs remain post-drop.

---

## §3 · Architectural commitment: math layer is the load-bearing surface

Per CA architectural insight (banked verbatim in CLAUDE.md):

> The math layer (`computeQuoteCosting`) consumes `QuoteCostingInput`
> as **data**, not table references. Slice 11.5's job is to rebuild
> the input shape from NEW-model sources WITHOUT touching the math.
> Future schema migrations of the underlying cost data do not
> require math changes — only adapter changes.

**De-risking consequences:**
- Math regression risk: near-zero (math layer untouched, no logic
  paths altered)
- Verification approach: NEW-source-built input vs OLD-source-built
  input on equivalent data → must produce identical
  `computeQuoteCosting` output
- Adapter testability: pure function from typed rows to
  `QuoteCostingInput`; trivially unit-testable

**Pattern 22-style insulation.** Math layer is the load-bearing
math; Slice 11.5 swaps the data source feeding it without changing
the load-bearing surface. Future cost-data migrations (v1.1+, etc.)
follow the same discipline.

---

## §4 · Server actions

### NEW write actions (Step 4)

| Action | Replaces | Table written |
|---|---|---|
| `addAssemblyLeafInput(assemblyLeafId, tierId, ...)` | `addPackagingLine` | `assembly_leaf_inputs` |
| `updateAssemblyLeafInputCell(rowId, fields)` | `updatePackagingTierCell` | `assembly_leaf_inputs` |
| `updateAssemblyLeafInputLineMeta(lineGroupId, fields)` | `updatePackagingLineMetadata` | `assembly_leaf_inputs` |
| `deleteAssemblyLeafInputLine(lineGroupId)` | `deletePackagingLine` | `assembly_leaf_inputs` |
| `upsertAssemblyProductionInputs(assemblyId, tierId, fields)` | `upsertProductionInputs` | `assembly_production_inputs` |
| `updateAssemblyProductionPolicy(assemblyId, fields)` | `updateSkuProductionPolicy` | `assembly_production_inputs` |
| `updateAssemblyLeafOverride(assemblyLeafId, tierId, value\|null)` | `updateSellPriceOverride` | `assembly_leaf_overrides` |
| `updateAssemblyLeafTarget(assemblyLeafId, tierId, value\|null)` | `updateClientTarget` | `assembly_leaf_targets` |

Each follows existing action-layer conventions:
- Returns `ActionResult<T>`
- Uses `runAction` + `ActionGuardError`
- Uses `quoteByIdDraft()` for status='draft' gate (Slice 12 v4 freeze
  enforcement strategy)
- Writes `audit_log` row with cascade `caused_by_audit_id` when
  applicable
- Calls `revalidateQuoteTree()` post-write

### Action audit names (banked into CLAUDE.md audit namespace)

Following Slice 9.2 namespace conventions:
- `assembly_leaf_input_cell_updated`
- `assembly_leaf_input_line_updated`
- `assembly_leaf_input_line_added` / `_deleted`
- `assembly_production_input_updated`
- `assembly_production_policy_updated`
- `assembly_leaf_sell_override_updated`
- `assembly_leaf_client_target_updated`

`diff_json.source` per Slice 9.2 namespace convention (where
applicable — system-suggestion paths, etc.).

### Actions DELETED in Step 8

After the read-path migration + write-action migration + Setup re-
points to the new actions, the OLD action surface area is dead code:

- `src/app/actions/packaging.ts` — entire file deleted
- `src/app/actions/production.ts` — entire file deleted
- `src/app/actions/costing.ts` `updateSellPriceOverride` + `updateClientTarget` — removed (other costing.ts actions stay)

CC enumerates remaining cross-surface consumers in Step 8 §0.5
sub-verification — any non-Setup caller (admin tooling, dev scripts)
needs migration before drop.

---

## §5 · Verification

Per CC's de-risking insight, verification reduces to: same data,
same math output, NEW source vs OLD source.

### Predicate-layer verification (CC pre-PR)

1. **Pure-adapter unit test** — given fixture NEW-model rows
   matching a known OLD-model layout, the adapter produces a
   `QuoteCostingInput` that matches the OLD-path-built input
   byte-for-byte (after normalization for non-load-bearing fields
   like row IDs, timestamps).
2. **`computeQuoteCosting` invariant test** — extend
   `scripts/verify/pricing-classifier-invariants.ts` with NEW-model
   fixtures. The 18 scenarios already pass on the classifier output;
   they must pass identically with NEW-source-built input.
3. **Quote rollup parity test** — for a real test quote populated
   in BOTH models (one-off seed during Step 7 verification), verify
   identical `quoteRollup` + `skuRollups` + `quoteSummary` output.

### Browser smoke walks (CB after CC ships)

Suggested scenarios (CB + CA iterate during Step 1):

- **MIG-1** — Vanilla render: sample-order seed quote renders
  correctly on Costs + Pricing + Quote + Mark-Accepted
- **MIG-2** — Edit packaging cell: update unit_cost on Costs page;
  Pricing recomputes; identical numbers to pre-migration
- **MIG-3** — Edit production policy: customer_ships_raws toggle;
  Pricing recomputes
- **MIG-4** — Sell-price override: per-cell override on Pricing
  surface; classifier mode updates per PR #54 logic
- **MIG-5** — Client target benchmark: enter benchmark; verdict
  pair surfaces correctly
- **MIG-6** — Multi-tier: switch active tier via Pricing
  ActiveTierUrlSync; all surfaces refresh
- **MIG-7** — Mark-Accepted bundle compat: open accepted-flow modal;
  status reads + flagged lines populate
- **MIG-8** — Concurrent realtime: open quote in two tabs; edit on
  tab A; tab B reconciles via realtime per Slice 8.5 pattern
- **MIG-9** — Q4 NULL-safe verification: open the sample order on
  Costs; confirm `BulkRawDrilldown` doesn't crash; deposits chip
  doesn't crash; production "no services" renders cleanly

### Drop-migration verification (Step 8)

Pre-drop:
- Grep entire codebase for `quoteSkus`, `packagingInputs`,
  `productionInputs`, `quoteSkuTiers`, `quoteSkuTierTargets`. Zero
  hits in `src/` outside the actions/lib/components being deleted.
- Drop migrations dry-run on prod-shape staging DB.

Post-drop:
- TypeScript compile (`npx tsc --noEmit`) — zero errors.
- Smoke walk MIG-1 through MIG-9 pass identically.

---

## §6 · Step plan

8 steps; Path B per Q1 disposition.

### Step 0 · §0.5 pre-build verification
- CC walks the verification checklist in §0.5 (above)
- Confirms `bulk_raw_*` + deposits consumers are NULL-safe per Q4
- Surfaces any new catches to Edward + CA before kickoff

### Step 1 · Kickoff + brief amendments
- CC ships any §0.5 catch dispositions inline
- Slice plan calendar locks
- Branch created

### Step 2 · Schema migration (NEW tables)
- Migration adds `assembly_leaf_inputs`,
  `assembly_production_inputs`, `assembly_leaf_overrides`,
  `assembly_leaf_targets`
- Drizzle types regenerated
- Smoke against staging: tables empty but referenceable

### Step 3 · Adapter implementation (READ path)
- `src/lib/costing-adapter-new.ts` (name TBD per Q1) — pure function
  `buildQuoteCostingInputFromNewModel`
- `getCostingBundle()` rewired to load NEW model + adapter +
  math layer
- Costs `/page.tsx` outer Promise.all rewired to load NEW model
  directly (parallel — not via getCostingBundle)
- Pure-adapter unit tests pass (verification #1)

### Step 4 · Write-action migration
- 8 new write actions per §4 table
- Setup UI cell-edit affordances rewired to call new actions
- Audit log namespace per §4 table
- Old write actions DELETED (hard cutover per Q5)

### Step 5 · UI affordance verification
- `src/components/costs/*` — verify drilldowns work against new
  data shape (likely no changes needed; data shape constant
  through the adapter)
- `src/components/pricing-surface/*` — PSR classifier-context
  adapter consumes store, no direct schema deps; verify untouched
- Mark-Accepted host + accept-confirm-modal — bundle shape
  unchanged; verify untouched

### Step 6 · Sample-order migration
- Update `scripts/seed-sample-order.mjs` to populate the new tables
  (packaging cost lines per assembly_leaf, production policy per
  assembly tier)
- Re-seed sample order (`--force`)
- Verify all 4 surface URLs render properly with the seeded data
- Margins land at brief-stated values (~42% on HGS-30-001 T2,
  ~41% on HGS-50TS-001 T2; per-tier adj per `tier_price_adj_pct`)

### Step 7 · Verification (CC pre-PR)
- Predicate-layer verifications #1, #2, #3 pass
- Re-extend the classifier invariant verifier with NEW-source
  fixtures (Step 3 brief calls this out: 16 → 20 scenarios maybe)
- MIG-1 through MIG-9 smoke walks pass

### Step 8 · OLD-model drop + cleanup
- Drop migrations for legacy tables
- Delete `src/app/actions/packaging.ts`, `production.ts`,
  `costing.ts` `updateSellPriceOverride/updateClientTarget`
- Delete orphan-on-disk components carrying OLD-model imports
  (per #A17 disposition: clean delete in this step)
- Update CLAUDE.md:
  - Math-layer architectural commitment (per §3 of this brief)
  - "Math layer consumes input as data; future schema migrations
    don't touch math"
- PR open

---

## §7 · Cutover plan

**Hard cutover at slice merge** (per Q5 disposition).

### Pre-merge tasks
1. CC verifies sample-order seed re-runs cleanly with new tables
2. CC verifies PR #61 sample seed script still produces the same
   navigation URLs (idempotency holds across the data-model shift)
3. CB walks MIG-1 through MIG-9; signs off

### Merge day
1. Slice 11.5 PR merges
2. Production deploys
3. Wipe + reseed sample order against new schema (per Q2)
4. Edward navigates the sample order on all 4 surfaces; full
   render confirms

### Post-merge monitoring (Week 1)
- Vercel function logs for `[bundle:` / `[costs:` / `[pricing:`
  instrumentation — confirm bundle queries complete cleanly
- Sample order continues rendering cleanly across PM smoke tests
- Slice 12 Step 2 can now schedule (Slice 11.5 lands before
  Slice 12 schema work per Q3 sequencing)

### Rollback plan
Git revert + redeploy. Drop migrations would need a backup-restore
to undo — but per Q2 wipe-and-reseed posture, the database has no
preserved state to defend, so revert + reseed sample order is the
recovery path.

---

## §8 · Out of scope / banked v1.1+

- **`bulk_raw_categories` + `bulk_raw_ingredients` +
  `bulk_raw_section_meta` migration to NEW model.** Per Q4
  disposition: defer to v1.1+. v1 surfaces render cleanly with
  these tables absent (CB-verified MIG-9). UX_BACKLOG already
  carries the bulk-raw deferral note.
- **`cost_section_deposits` migration to NEW model.** Same
  disposition — defer; not load-bearing for v1 demo or SV-1.
- **`quote_skus.retail_benchmark` carry-forward.** Single-field
  gap. v1.1+ adds `assemblies.retail_benchmark` if PM demand
  surfaces.
- **`assemblies.unit_cost` rollup denormalization.** Per #A15
  disposition: deprecate (CC lean) — writes from Setup form
  delete; reads ignored. v1.1+ can re-introduce if needed for
  Setup UI scan/summary performance.
- **PR #54 orphan-on-disk components carrying OLD-model imports.**
  Per #A17: deleted in Step 8 of this slice; their cleanup is
  IN-scope for Slice 11.5 (was banked v1.1+ until this slice
  needed to drop OLD-model schema).
- **Forward-migration of existing OLD-model quotes.** Not in scope
  per Q2 wipe-and-reseed disposition.

---

## §9 · Open questions for Edward + CA before kickoff

1. **Adapter module name** — `costing-adapter-new.ts` is placeholder.
   Alternatives: `costing-adapter.ts` (replaces an implicit
   reading layer in `getCostingBundle`), `quote-cost-adapter.ts`,
   `new-model-cost-adapter.ts`. CC lean: `costing-adapter.ts` —
   shortest; the "new" qualifier is meaningless once Step 8 drops
   OLD model.
2. **Cell-edit affordance UI rewiring scope (Step 5).** Existing
   Costs drilldowns expect `packaging_inputs.id` row IDs in their
   action calls. Once the action layer changes to
   `assembly_leaf_inputs.id`, the UI prop passing through the
   drilldown changes shape. Two paths:
   - (a) Keep the drilldown's prop names (rowId/lineGroupId/etc.)
     but point them at NEW table IDs. Minimal UI change.
   - (b) Rename props to reflect NEW table semantics. More
     invasive but cleaner naming.
   CC lean: (a) — preserves UI surface area; renaming can be
   v1.1+ polish.
3. **NULL-safe verification timing (Q4 sub-question).** Step 0 has
   the verification, but if any consumer breaks, scope re-opens.
   Should Edward + CA pre-disposition the escalation path BEFORE
   Step 0 runs? CC lean: yes — if breakage surfaces, escalate
   immediately + add the broken consumer's table to the scope
   (likely a small extension; not a full reshape).

---

## §10 · Architectural commitments locked

For the slice-fold doc + future v1.1+ reference:

- **Math layer is the load-bearing surface.** `computeQuoteCosting`
  consumes `QuoteCostingInput` as data; future cost-data schema
  migrations don't touch the math, only the adapter.
- **Adapter layer is a pure function.** Testable in isolation;
  fixtures + parity checks confirm equivalence with OLD source.
- **Sparse-row tables for overrides + targets.** Mirror Slice 9.3
  / 9.4b semantics on the NEW-model side.
- **Hard cutover deprecation.** OLD tables drop in Step 8; no
  parallel-run.
- **Wipe-and-reseed v1 launch posture.** Existing OLD-model quote
  data not preserved.
- **§3 source-of-truth invariant extends** (per PR #54 + PR #60
  pattern): no parallel re-derivation of cost data outside the
  adapter. UI components consume the rollup via store selectors;
  no direct OLD-model reads remain after Step 8.

---

## §11 · §0.5 ledger update post-this-brief

- Slice 11.5 contributes 3 §0.5 catches: #A15 (assemblies.unit_cost
  semantic), #A16 (Mark-Accepted bundle compat), #A17 (PR #54
  orphan-on-disk OLD-model imports cleanup scope)
- Cumulative across slices post-this-brief: **65 + 3 = 68 across 14
  slices**

Pattern 22 §0.5 standing protocol holds; CC ran verification before
this brief drafted (caught the 3 above; surfaced bulk_raw + deposits
NULL-safety as a Step 0 sub-verification per Q4 deferral).

---

**End of brief v1.** CC reads + Edward + CA review. Amendments
expected (per standard cadence: brief v1 → critique → v2 etc.).
Slice 11.5 kicks off post-brief lock.

CA standing by for brief review.
Edward standing by for kickoff signal.
CC standing by for amendments cycle + Step 1 implementation start.
