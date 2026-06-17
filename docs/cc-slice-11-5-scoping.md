# slice-11.5 — OLD→NEW cost-data read-path migration · CC scoping deliverable

**Driver:** 2026-06-17 CA disposition (sample-order seed comm + OLD-model deprecation banking). Architectural drift between Setup (writes NEW model) and Costs/Pricing/Quote (reads OLD model) is a v1 launch blocker.
**Owner:** CC drafts scope; CA reviews; Edward signs off on slice plan.
**Status:** Inventory complete. Slice plan skeleton below. Awaiting Edward + CA disposition on the three migration paths in §6.
**Date:** 2026-06-17

This doc is the **scoping deliverable** that precedes a proper Slice 11.5
brief. Once the three open dispositions in §9 lock, CC drafts the slice
brief.

---

## §1 · OLD-model read inventory

Six OLD-model tables (and `bulk_raw_*` cluster) are load-bearing for
Costs/Pricing/Quote/Mark-Accepted today.

### Direct schema imports (route-level)

| File | Tables touched | Read purpose |
|---|---|---|
| `src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx` | `quoteSkus`, `quoteTiers`, `packagingInputs`, `productionInputs`, `bulkRaw*`, `costSectionDeposits`, `freightLeg*` | Builds the costs UI: per-SKU sections, drilldowns, freight panel, bulk raws conditional UI. Reads ~21 queries per render. |

(Pricing/Quote/Mark-Accepted pages read NONE of OLD model directly — they go through `getCostingBundle()`.)

### Bundle reader (action layer)

| File | Tables touched | Purpose |
|---|---|---|
| `src/app/actions/costing.ts` (`getCostingBundle`) | `quoteSkus`, `quoteTiers`, `packagingInputs`, `productionInputs`, `markupDefaults`, `quoteSkuTiers`, `quoteSkuTierTargets`, `freightLeg*` | Loads all cost inputs + computes the rollup. Returns `HydrateSnapshot` (the CostingStore seed). Called by Pricing/Quote/Mark-Accepted page renders + Costs page (sequentially before its outer Promise.all). |

### Math layer (pure)

| File | Input shape | Output |
|---|---|---|
| `src/lib/costing.ts` (`computeQuoteCosting`) | `QuoteCostingInput = { quote, firmSettings, markupDefaults, skus, tiers, packaging, production, freightLeg*, cellOverrides, cellTargets }` | `QuoteCostingResult` (per-SKU rollups, per-tier rollups, quote-blended summary) |

**Important: the math layer is model-agnostic.** It takes the `QuoteCostingInput` shape as data, not table references. Slice 11.5's job is to rebuild this input shape from NEW-model sources without touching the math.

### Store + UI consumers

| Layer | Consumers | Purpose |
|---|---|---|
| `src/lib/costing-store.ts` (Zustand) | The whole store | Hydrates from `HydrateSnapshot`, exposes selectors (`selectSkuRollups`, `selectQuoteRollup`, etc.) |
| `src/components/costing-store-provider.tsx` | React Provider | Wraps the store; handles wait-for-quiet reconcile pipe |
| `src/components/costs/*` (cost-stack-header, drilldowns, section-with-drilldown) | Costs UI | Read store + render rollups + edit affordances |
| `src/components/pricing-surface/*` (PricingClassifierProvider + composer + zones) | Pricing UI | PSR composer adapts store → classifier QuoteInput |
| `src/components/quote-summary-card.tsx` | (Orphan-on-disk per PR #54 §8 catalog correction) | — |
| `src/components/pricing/*` (verdict-band, reverse-solve-dialog, etc.) | Mostly orphan-on-disk post-PR #54 | — |
| Mark-Accepted host | Mark-Accepted UI | Reads costing summary via bundle |

### Write actions

| File | Functions | Tables mutated |
|---|---|---|
| `src/app/actions/packaging.ts` | `addPackagingLine`, `updatePackagingLineMetadata`, `revertMarkupToDefault`, `deletePackagingLine`, `movePackagingLine`, `updatePackagingTierCell`, `copyTierValueToAllTiers`, `countPackagingLinesForQuote` | `packagingInputs` |
| `src/app/actions/production.ts` | `countProductionCellsWithDataForQuote`, `upsertProductionInputs`, `updateSkuProductionPolicy` | `productionInputs` |
| `src/app/actions/costing.ts` | `updateQuoteGlobalPriceAdj`, `updateTierPriceAdj`, `updateQuoteTargetMargin`, `applySuggestedGlobalAdj`, `updateSellPriceOverride`, `updateClientTarget` | `quotes`, `quoteTiers`, `quoteSkuTiers`, `quoteSkuTierTargets` |
| `src/app/actions/quotes.ts` | (various — quote/SKU lifecycle, customer-accept, copy/scenarios) | `quotes`, `quoteSkus` (legacy tree) |
| `src/app/actions/warnings.ts` | (Slice 9.5 validation persistence) | `quoteWarnings` (reads `quoteSkus`) |

---

## §2 · OLD → NEW model field-equivalence map

For each OLD-model surface, identify NEW-model equivalent or surface the gap.

| OLD surface | NEW model surface | Status |
|---|---|---|
| `quote_skus` tree (parent_sku_id + sku_role enum) | `assemblies` (per-quote ASYs) + `assembly_leaves` (junction) + `quote_leaves` (per-quote leaf pin) + `leaves` (global library) | ✓ **Replaceable** via adapter. Tree structure flattens into ASY→LEAF list. |
| `quote_skus.hubspot_product_id` | `leaves.hubspot_product_id` + `assembly.product_type_id` | ✓ Replaceable |
| `quote_skus.retail_benchmark` | (No equivalent on NEW model assemblies) | ⚠ **GAP** — assemblies don't carry retail benchmark today. Banking question. |
| `packaging_inputs` (per-cell unit_cost + qty_per_sellable_unit + markup_pct + supplier + category) | `leaves.unit_cost` (flat) + `assembly_leaves.quantity` | ⚠⚠ **PARTIAL GAP** — NEW model has FLAT per-leaf cost only. No per-tier variation. No multi-line per-leaf (e.g., bottle from Supplier A at $0.40 vs Supplier B at $0.45). No `markup_pct` per line; no `supplier` field; no `category` for markup routing. |
| `production_inputs` (per-leaf-tier production policies + service fees + bulk raw cost + customer_ships_raws + allocate_service_fees_to_cost) | (No equivalent) | ⚠⚠⚠ **TOTAL GAP** — NEW model has no production-side inputs at all. Filling fees, setup/tooling/R&D fees, raw bulk cost, raws-mode policy — none represented. |
| `quote_sku_tiers` (sparse `sell_price_override`) | (No equivalent) | ⚠⚠ **TOTAL GAP** — NEW model has no per-cell sell-price override. The cell_ovr table that hung us today literally has no NEW-model home. |
| `quote_sku_tier_targets` (sparse `client_target_price_per_unit`) | (No equivalent) | ⚠⚠ **TOTAL GAP** — NEW model has no per-cell client target benchmark. |
| `bulk_raw_categories` + `bulk_raw_ingredients` + `bulk_raw_section_meta` (Slice 6 raws-mode UI) | (No equivalent) | ⚠⚠ **TOTAL GAP** — bulk raw UI surface has no NEW-model representation. |
| `cost_section_deposits` (per-section deposit input on Cost build) | (No equivalent) | ⚠ **GAP** — no NEW equivalent |
| `freight_leg_groups` + `freight_legs` + `freight_leg_tiers` + `freight_customer_arranges_meta` | **Already quote-scoped, not SKU-scoped — model-agnostic** | ✓ **No migration needed.** Used by sample seed already. |
| `markup_defaults` (firm-level category defaults) | Same table, no FK to OLD model | ✓ No migration needed |
| `firm_settings` (target/floor margin, vendor identity) | Same table | ✓ No migration needed |

**Gap summary:**

- ✓ **Replaceable today:** SKU tree (assemblies/assembly_leaves/leaves), freight (already model-agnostic), markup_defaults, firm_settings
- ⚠ **Single-field gaps:** retail_benchmark, cost_section_deposits
- ⚠⚠ **Partial gaps:** packaging cost data (NEW has flat unit_cost; needs per-tier variation + multi-line + markup_pct + supplier + category extensions)
- ⚠⚠⚠ **Total gaps:** production_inputs (no equivalent), quote_sku_tiers (sell override — no equivalent), quote_sku_tier_targets (no equivalent), bulk_raw_* (no equivalent)

---

## §3 · Three migration paths

### Path A — Adapter-only ("translation layer")

**Scope:** Build a server-side adapter that reads NEW-model tables (assemblies + assembly_leaves + quote_leaves + leaves) + maps into the existing `QuoteCostingInput` shape. Math layer + store + UI all untouched.

**Pros:**
- Smallest scope. Math + store + UI work day-1.
- Reversible — adapter can dual-source (read both models, prefer NEW) during transition.

**Cons:**
- All ⚠⚠ + ⚠⚠⚠ GAPS render as zero/null. packaging_inputs translated as flat unit_cost from leaves; per-tier variation lost. Production inputs render as zero. Sell overrides + client targets absent.
- **Costs/Pricing/Quote surfaces remain feature-incomplete vs. today.** PMs can see the assembly tree + flat per-tier rollup, but no production fees, no per-tier cost variation, no sell-override surfacing.
- Sets a precedent — every future cost-data feature touches both an adapter and the model below it.

**Best for:** Demo + SV-1 + simple-quote rendering. NOT a full v1 launch posture.

### Path B — Schema-extension ("NEW model gets cost-data parity")

**Scope:** Add NEW-model tables for the ⚠⚠ + ⚠⚠⚠ gaps:
- `assembly_leaf_inputs` (per-tier per-leaf packaging cost + markup_pct + supplier + category + qty_per_sellable_unit)
- `assembly_production_inputs` (per-tier per-assembly production policies + service fees + raws mode)
- `assembly_leaf_overrides` (sparse sell_price_override per assembly_leaf × tier)
- `assembly_leaf_targets` (sparse client_target per assembly_leaf × tier)
- `bulk_raw_*` re-anchored to assemblies (or kept quote-scoped as is — TBD)

Then build the read adapter on NEW tables. Math + store + UI unchanged.

**Pros:**
- Full feature parity post-migration.
- NEW model has a coherent cost story; future cost features write to NEW directly.

**Cons:**
- ~5 new tables + migration script + write-action rewrites for packaging/production/sell-override/client-target.
- Likely 8-12 step slice. Larger than Slice 12.
- Migration data path: existing OLD-model quotes need to migrate to NEW model BEFORE the read path flips, OR they live in OLD forever (stale). Edward + CA must disposition migration scope.

**Best for:** Real v1 launch posture. Aligns the architecture before more features mount on top.

### Path C — Hybrid ("ASYs migrate, cost inputs stay on OLD via FK bridge")

**Scope:** quote_skus tree → assemblies/assembly_leaves migrates. BUT packaging_inputs / production_inputs / quote_sku_tiers / quote_sku_tier_targets keep their existing schema with `quote_sku_id` FKs **changed to point at `assembly_leaves.id`** (or a sibling join table). Math + store + UI mostly unchanged; adapter glues NEW model joins to OLD cost-data tables.

**Pros:**
- Preserves the rich packaging/production/sell-override model.
- Smaller than Path B.
- Reversible.

**Cons:**
- The OLD cost-data tables linger forever — never deprecated, never re-modeled.
- assembly_leaves.id-vs-quote_skus.id FK rewiring is a one-way migration; rollback hard.
- Write actions need to learn the new FK target.

**Best for:** Pragmatic v1 launch if Path B is too big to fit in the v1 calendar.

---

## §4 · Migration data approach

Regardless of path:

### Existing-quotes migration

Production has some quotes on OLD model (the cell_ovr investigation showed 1 row in quote_sku_tiers). Options:

1. **Wipe + reseed** — Edward's stated posture for v1 launch. DB wipes before launch. Existing-quotes migration becomes a no-op. **CA disposition: this is the recommended path.**
2. **Forward-migrate** — write a one-time migration script that reads OLD tables + writes NEW. Complex; not worth the effort if wipe-before-launch holds.
3. **Co-exist** — both models live; new quotes use NEW, old quotes use OLD. Forks the read paths forever. NOT recommended.

### Adapter dual-source posture (during slice implementation)

CC can implement the read adapter to **dual-source** during transition:
- Read NEW model first; if rows exist, use them
- Fall back to OLD model if NEW model has zero rows for that quote
- Eventually drop the OLD-model fallback once all writes route to NEW

This gives a 1-2 week window where both quotes-on-OLD and quotes-on-NEW render correctly. Useful for any quote created between sample-seed and slice merge.

---

## §5 · Verification strategy

Three layers of verification:

1. **Sample order parity test** — re-seed the sample order; verify Costs/Pricing/Quote/Mark-Accepted all render identical numbers pre- vs post-slice. Sample-order = ground truth.
2. **Margin computation invariant** — extend `scripts/verify/pricing-classifier-invariants.ts` (current verifier) with NEW-model fixture variants. Same scenarios should produce identical mode + state-line output regardless of which model fed the input.
3. **Smoke walk** — PM walks Costs/Pricing/Quote/Mark-Accepted on the sample order. Numbers match brief-stated margins. cell_ovr / cell_tgt write affordances work.

---

## §6 · Slice plan skeleton

Assuming **Path B** (schema-extension) is chosen — adjust if Path A or C:

**Step 0** — Pre-build §0.5 schema/code verification (Pattern 22 protocol)
**Step 1** — Kickoff + scoping confirmation + brief amendment (any catches from §0.5)
**Step 2** — Schema migration (new tables: `assembly_leaf_inputs`, `assembly_production_inputs`, `assembly_leaf_overrides`, `assembly_leaf_targets`, optionally `bulk_raw_*` re-anchor)
**Step 3** — Adapter implementation: read NEW model → fan-in into `QuoteCostingInput`. Dual-source posture (NEW preferred; OLD fallback) for transition period.
**Step 4** — Write-action migration: packaging/production/sell-override/client-target actions write to NEW tables. OLD-action paths gated behind a feature flag for emergency rollback.
**Step 5** — UI affordance rewiring: Costs UI components currently expect `packaging_inputs` shape — update to new shape OR keep the shape constant via the adapter (preferred — keeps UI untouched).
**Step 6** — Sample-order migration: re-seed sample order against new schema. Update sample-seed script to populate NEW tables.
**Step 7** — Verification: invariants pass; smoke walk clean; sample-order numbers match pre-slice.
**Step 8** — OLD-model deprecation: drop fallback path; DROP old tables; CLAUDE.md notes + smoke guide.

**Estimated step count: 8.** Adjust by path:
- Path A: 5 steps (skip schema extension, write migration, UI rewire)
- Path B: 8 steps (above)
- Path C: 6 steps (FK rewire + write-action update + minor schema work)

---

## §7 · CD coordination

Likely NONE for Path A / Path C. **Path B may need a small CD round** for Cost build UI if the schema extension requires new affordances (multi-supplier packaging lines on assembly_leaves, etc.). Most likely existing R6 Cost build UI stays intact; the schema shift is below-the-UI.

---

## §8 · §0.5 pre-build verification additions

For the Slice 11.5 brief's §0.5 gate:

- [ ] Verify `assemblies.unit_cost` matches the math-layer `factoryCostPerUnit` semantic OR document the divergence
- [ ] Verify `quote_leaves.leaf_spec_version_id` is the canonical pin (Phase A.1 v2 spec versioning per `leaf_specs` table) and decide whether Slice 11.5 reads pinned spec values for cost data
- [ ] Verify Setup's `<AssemblyTreeView>` write flow — does it create `quote_leaves` rows on assembly_leaf attach? (Yes, but confirm.) Adapter consumes these rows.
- [ ] Inventory orphan-on-disk components from PR #54 Step 8 (verdict-band, lines-requiring-review, etc.) — do they still need to be migrated OR can they stay orphan-on-disk in NEW model? CA disposition: stay orphan; they're scheduled for v1.1+ cleanup.
- [ ] Verify Mark-Accepted page's bundle consumer is compatible with the new adapter shape OR identify the touch points

---

## §9 · Open questions for Edward + CA disposition

Before drafting the proper Slice 11.5 brief:

### Q1 · Migration path: A / B / C?

CA recommendation: **Path B** (schema extension) for real v1 launch posture. Aligns architecture before more features mount. Path A is fine for SV-1 + demo but leaves cost-data architecture in a transitional state forever.

### Q2 · Existing-quotes posture: wipe-and-reseed or forward-migrate?

Per Edward's stated v1 launch posture: **wipe + reseed**. Forward-migrate not worth the effort given v1 timeline.

### Q3 · Slice 11.5 sequencing vs Slice 12?

Slice 12 v4 amendments noted Step 2 (schema migration) depends on Slice 11.5 disposition. Options:

- **(a)** Slice 11.5 lands FIRST → Slice 12 Step 2 picks up the migrated schema → clean.
- **(b)** Slice 11.5 + Slice 12 Step 1 run in parallel (external workstreams — Aisha + DPS NetSuite admin RESTlet iteration takes weeks). Slice 11.5 ships before Slice 12 Step 2 schema work.
- **(c)** Fold Slice 11.5 INTO Slice 12 (super-scope). CA strongly against — Slice 12 is already large with the combined #A7 disposition.

CA recommendation: **(b)** — parallel workstreams; Slice 11.5 ships before Slice 12 Step 2.

### Q4 · Bulk raw + cost_section_deposits: in-scope for 11.5 or v1.1+?

Bulk raw mode (Slice 6 raws-mode UI: cm_sources / dps_sources / customer_supplies) is a niche but functioning feature. If Path B, do we migrate bulk_raw_* tables to NEW model? CC scope budget says **defer to v1.1+** if Edward + CA agree the bulk raw surface is low-frequency. Sample-order seed uses default `cm_sources` mode anyway.

`cost_section_deposits` (per-section deposit entry): same disposition — defer to v1.1+ if low-frequency.

### Q5 · Write-action gating: feature flag or hard cutover?

Slice 11.5 Step 4 migrates write actions. Two postures:
- **Feature flag** — old write paths gated behind `process.env.NEXUS_LEGACY_WRITES=1` for emergency rollback. Adds complexity but safer.
- **Hard cutover** — old write paths deleted. Cleaner; rollback requires git revert.

CA recommendation: **hard cutover.** v1 codebase doesn't have other feature-flag infrastructure; introducing one here is overhead. Wipe-and-reseed posture means there are no legacy writes to preserve anyway.

---

## §10 · §0.5 ledger update

This scoping deliverable surfaced **3 additional Pattern 22 §0.5 catches** worth banking once the Slice 11.5 brief drafts:

- **#A15** — `assemblies.unit_cost` flat-per-assembly semantic doesn't match math layer's `factoryCostPerUnit` (which is composed from packaging + production + raws). Brief amendment must disposition: is the assemblies col deprecated post-11.5, OR is it kept as a denormalized rollup field?
- **#A16** — Mark-Accepted page bundle consumer may not be fully compatible with the adapter output (depends on PSR composer shape). Verify during 11.5 Step 1.
- **#A17** — Orphan-on-disk components from PR #54 Step 8 carry OLD-model usage in their imports. They'll stay orphan-on-disk in NEW model; banking that they DO NOT need migration cleanup as part of 11.5.

Cumulative §0.5 ledger update: **65 + 3 = 68 across 14 slices** (post-disposition).

---

## Sign-off

CC delivered this scoping inventory. Standing by for Edward + CA disposition on:

- §9 Q1 (path choice A/B/C — CA lean: B)
- §9 Q2 (wipe-and-reseed — likely yes)
- §9 Q3 (sequencing — CA lean: parallel with Slice 12 Step 1, ship before Step 2)
- §9 Q4 (bulk raw + deposits — likely defer)
- §9 Q5 (hard cutover — likely yes)

Once dispositioned, CC drafts the Slice 11.5 brief (proper format: §0 fidelity discipline, §0.5 pre-build verification, §1 strategic framing, §2 architecture, §3 schema, §4 server actions, §5 verification, §6 step plan).

Slice 11.5 brief delivery target: **same day** as Edward + CA disposition. CC has the inventory; the brief is mostly composition from this doc + standard slice-brief template.

Edward + CA standing by for §9 dispositions; CC standing by for the proper brief draft once dispositions land.
