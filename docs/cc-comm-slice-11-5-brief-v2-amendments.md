# slice-11.5-cost-data-model-migration — Brief AMENDMENTS v2

**Brief baseline:** v1 (`docs/cc-comm-slice-11-5-brief.md`)
**Amendment driver:** CA critique on PR #63 (brief v1). All 3 §0.5 catches + 3 open questions dispositioned inline; 7 substantive-polish amendments surfaced.
**Status:** Dispositions locked. v2 supersedes specified sections of v1. CC reads canonical brief set as **v1 + v2** with v2 taking precedence on conflicts.
**Date:** 2026-06-17

CA critique verdict on v1: "substantively sound. v2 amendments are polish + a few tightening items, not structural rework." Architecture, adapter pattern, math-layer insulation, 8-step plan all carry forward unchanged.

---

## §0 · Dispositions locked from v1 critique

### §0.5 catches

| Catch | Disposition |
|---|---|
| **#A15** `assemblies.unit_cost` semantic | **DEPRECATE.** Writes deleted in Step 4; reads verified absent in Step 5. v1.1+ may re-introduce as denormalized rollup field if Setup UI scan/summary performance demands. |
| **#A16** Mark-Accepted bundle compat | **VERIFY via SV-1.** Math layer untouched → bundle shape binary-compatible. MIG-7 smoke walk + post-merge SV-1 walkthrough confirm. |
| **#A17** PR #54 orphan-on-disk OLD-model imports | **CLEAN DELETE in Step 8.** Dropping OLD schema breaks the orphan files at compile time; deletion is the correct path. Step 8 §0.5 sub-verification enumerates the kill list + TypeScript compiles clean post-deletion. |

### Open questions (§9 of v1)

| Q | Disposition |
|---|---|
| **Q1** Adapter module name | `src/lib/costing-adapter.ts` (CC lean). Shortest; "new" qualifier carries no information post-Step-8. |
| **Q2** Cell-edit UI rewiring scope | **Path (a) — preserve prop names, point at NEW table IDs.** Lower regression risk. Prop-renaming (`rowId` → `assemblyLeafInputId`) banked as v1.1+ token-discipline polish. |
| **Q3** NULL-safe verification escalation path | **PRE-AUTHORIZE.** Don't pre-commit scope additions; pre-commit the escalation protocol. See §1 below for the locked protocol. |

---

## §1 · Q3 escalation protocol (locked)

If any consumer breaks NULL-safety during Step 0 verification, CC follows this protocol:

1. CC identifies breaking consumer + the specific data shape the consumer expects
2. CC drafts a scope extension proposal (one-sentence framing + table addition + migration impact)
3. CA + Edward disposition same-day
4. Brief amends inline (v3); Step 2 schema migration absorbs the addition
5. Step 0 re-runs verification; if clean, kickoff proceeds

Pre-authorization means: when Step 0 catches a NULL-safe break, CC moves immediately into step (1) without further authorization. Edward + CA disposition in step (3) is the gate, not the trigger.

---

## Amendment A1 · MIG smoke wording — "matches expected fixture values" (not "identical to pre-migration")

v1 §5 MIG-2 currently reads:
> **MIG-2** — Edit packaging cell: update unit_cost on Costs page; Pricing recomputes; identical numbers to pre-migration.

With wipe-and-reseed (per Q2 v1 disposition), there is no pre-migration state to compare against. Replace verbatim:

> **MIG-2** — Edit packaging cell: update unit_cost on Costs page; Pricing recomputes; resulting margin matches expected fixture values from the pure-adapter unit test (verification #1).

Same intent (does the change propagate through the math layer?); clearer reference (the unit-test fixture is the ground truth, not a phantom pre-state).

**Same edit applies to any MIG entry with similar phrasing.** CC sweeps MIG-1 through MIG-9 during v2 application; surface any other instances inline.

---

## Amendment A2 · Step 6 margin curve specification

v1 §6 Step 6 currently reads:
> Margins land at brief-stated values (~42% on HGS-30-001 T2, ~41% on HGS-50TS-001 T2; per-tier adj per `tier_price_adj_pct`)

That spec carries forward the FLAT margin from PR #61 sample seed — the constraint the OLD model imposed (single unit_cost per assembly). **NEW model restores per-tier cost variation via `assembly_leaf_inputs` + `assembly_production_inputs`** — the original `cc-comm-sample-order-seed.md` brief specified a margin CURVE demonstrating economies of scale.

**Step 6 expected output (replaces the flat-margin spec):**

| SKU | T1 (5K) | T2 (15K, recommended) | T3 (50K) |
|---|---|---|---|
| HGS-30-001 | ~37% | ~42% | ~46% |
| HGS-50TS-001 | ~35% | ~41% | ~47% |

These exercise:
- **BELOW-target T1** — classifier emits suggestion-led mode (yellow band); informs PM of headroom
- **AT-target T2** — recommended tier, classifier emits sendable (green); default visual
- **ABOVE-target T3** — classifier emits sendable + retail benchmark headroom signal; demonstrates volume curve

**CC adjusts the sample-seed fixtures** during Step 6 to land these curves. The curve emerges from per-tier `assembly_leaf_inputs.unit_cost` variation (component cost negotiated lower at higher volumes per realistic supplier discounts) — not from `tier_price_adj_pct` alone.

Locks the demo intent the flat-margin PR #61 couldn't honor.

---

## Amendment A3 · `line_group_id` semantics explicit documentation

v1 §2 schema defines:
```sql
line_group_id uuid NOT NULL,
```

Without specifying whether it's:
- (a) FK to a `line_groups` table (no such table exists)
- (b) Synthetic UUID grouping multiple rows representing the same logical line across tiers

Almost certainly (b) per OLD `packaging_inputs` precedent. **v2 amendment:** add explicit documentation in the schema column comment + brief §2 callout:

> `line_group_id` — synthetic UUID grouping rows that represent the **same logical packaging line across tiers** (e.g., one bottle supplier line × 3 tier variants = 3 rows sharing one `line_group_id`). NOT a FK; UUIDs are minted client-side on line creation (action layer `addAssemblyLeafInput` generates via `crypto.randomUUID()` on the first row + reuses for tier siblings). Pattern carries through from OLD `packaging_inputs` semantics.

Apply to the schema migration comment in Step 2 verbatim — future-CC reading the column needs the semantic without transcript archaeology.

---

## Amendment A4 · Step 8 grep verification breadth — include action names

v1 §5 "Drop-migration verification" lists schema-name greps:
> Grep entire codebase for `quoteSkus`, `packagingInputs`, `productionInputs`, `quoteSkuTiers`, `quoteSkuTierTargets`. Zero hits in `src/` outside the actions/lib/components being deleted.

**v2 amendment:** also grep for ACTION names that callers might still reference:

- `addPackagingLine`
- `updatePackagingTierCell`
- `updatePackagingLineMetadata`
- `revertMarkupToDefault`
- `deletePackagingLine`
- `movePackagingLine`
- `copyTierValueToAllTiers`
- `countPackagingLinesForQuote`
- `upsertProductionInputs`
- `updateSkuProductionPolicy`
- `countProductionCellsWithDataForQuote`
- `updateSellPriceOverride`
- `updateClientTarget`

Catches any non-Setup caller (admin tooling, dev scripts, smoke test fixtures, action-result helper imports) that still references the deleted actions. Specifically:

- `scripts/seed-psr-fixtures.mjs` — write paths that use OLD-action helpers? CC inventories during Step 8.
- `scripts/seed-sample-order.mjs` — already NEW-model-only (PR #61). No grep hits expected.
- Admin pages or tooling — CC inventories.
- Any test fixtures that test against the action surface — CC inventories.

Step 8 verification gate extends: **zero grep hits for any of the 13 action names** before drop migrations land.

---

## Amendment A5 · `retail_benchmark` deferral — Slice 11 PDF audit cross-reference

v1 §8 currently banks `quote_skus.retail_benchmark` to v1.1+ "if PM demand surfaces." CA flagged that the customer-view PDF render (Round 3 designer notes + data-source map — original Slice 11 work, queued for audit AFTER Slice 11.5) consumes `retail_benchmark` in the SKU rendering shape.

**v2 amendment:** add explicit cross-reference banking note to §8:

> **Cross-reference banked: original Slice 11 PDF audit.** When the original Slice 11 scope audit runs (queued behind Slice 11.5), CC re-evaluates `retail_benchmark` deferral:
> - If PDF render genuinely needs `retail_benchmark` → add `assemblies.retail_benchmark` to that audit's schema scope OR pull into Slice 11.5 v3 amendments (if audit lands before Slice 11.5 merges)
> - If PDF render gracefully degrades (NULL renders as empty per Pattern 45 customer-facing-render data-source verification) → v1.1+ deferral holds
>
> No action required in Slice 11.5 itself — just a banking note so the original Slice 11 audit catches it. Future-CC scoping that audit reads §8 of THIS brief and pattern-matches.

Carries the dependency thread cleanly between slices.

---

## Amendment A6 · Step 5 explicit CB drilldown walk

v1 §6 Step 5 currently reads:
> `src/components/costs/*` — verify drilldowns work against new data shape (likely no changes needed; data shape constant through the adapter)

"Likely no changes needed" is the right architectural read, but verification requires an empirical pass.

**v2 amendment:** extend Step 5 with explicit CB-walk surface:

- PM opens Costs page on the re-seeded sample order
- Each drilldown section expands cleanly:
  - **Packaging drilldown** — per-line cell-edit affordances render; markup % pill renders; supplier text field renders
  - **Production drilldown** — per-tier service-fee inputs render; raws-mode selector renders; customer-ships-raws toggle renders
  - **Freight drilldown** — multi-leg journey renders (already NEW-model-compatible per scoping inventory §1); per-leg-tier cost edit works
- Inline cell edits propagate through to the new action layer (not Setup-only)
- Margin recomputes; classifier verdict band updates on adjacent Pricing surface
- Smoke covers the existing drilldown affordances against NEW backend

Step 5 closure gate: drilldown render verification PASS on each section. Already covered indirectly by MIG-2/3/4 — v2 makes it explicit so CC doesn't skip it.

---

## Amendment A7 · Action audit name consistency check

v1 §4 §"Action audit names" listed 7 names:

- `assembly_leaf_input_cell_updated`
- `assembly_leaf_input_line_updated`
- `assembly_leaf_input_line_added` / `_deleted`
- `assembly_production_input_updated`
- `assembly_production_policy_updated`
- `assembly_leaf_sell_override_updated`
- `assembly_leaf_client_target_updated`

CA verified these are consistent (Slice 9.2 namespace convention) and read cleanly.

**v2 amendment:** add a Step 4 implementation-time check: when CC implements each action, the corresponding audit name lands in the codebase per the v1 §4 list. Drift flagged + reverted before commit. No new amendment to the LIST itself; just enforcement at action implementation time.

Audit name list also banks into CLAUDE.md "audit_log action namespace" section as part of Step 8 documentation updates (mirrors Phase A.1 v2 + canonical-scenario-create slice pattern).

---

## §2 · Affirmations (no amendment needed; banking for record)

These items in v1 are already correct; CA's critique confirmed them. Banking the affirmations so future-CC reading v2 doesn't think they're undecided:

### §3 math-layer architectural commitment — bank verbatim in CLAUDE.md

CC's wording in v1 §3 captures the insight cleanly:

> The math layer (`computeQuoteCosting`) consumes `QuoteCostingInput` as **data**, not table references. Slice 11.5's job is to rebuild the input shape from NEW-model sources WITHOUT touching the math. Future schema migrations of the underlying cost data do not require math changes — only adapter changes.

**Step 8 documentation gate:** the EXACT v1 §3 wording lands verbatim in CLAUDE.md under a new section header (suggested: "Math layer is the load-bearing surface; future cost-data migrations don't touch it"). Future-CC pattern-matching on this commitment depends on the exact phrasing being retrievable via grep.

### §5 freight cascade verification — confirmed clean

CC's §0.5 architectural verification (v1) verified that freight tables (R6.2 model: `freight_leg_groups`, `freight_legs`, `freight_leg_tiers`, `freight_customer_arranges_meta`) FK to `quotes.id`, NOT `quote_skus.id`. Step 8 DROP of `quote_skus` cascades cleanly — freight tables UNAFFECTED.

CC verified during scoping (§1 of scoping doc) + during brief v1 §0.5 schema verification. Affirmation banked.

### 8-step plan staging — clean

Schema migration (Step 2) → adapter (Step 3) → write actions (Step 4) → UI verify (Step 5) → sample re-seed (Step 6) → verification (Step 7) → OLD drop (Step 8). Each step is independently smoke-walkable; rollback boundaries clear at every step. No re-sequencing needed.

---

## §3 · §0.5 ledger update

- Slice 11.5 catches from v1: **#A15 / #A16 / #A17** (all dispositioned via this v2 doc)
- No new §0.5 catches surfaced during v2 amendments
- Cumulative across slices: **68 across 14 slices** (unchanged from v1 brief authoring)

Pattern 22 §0.5 standing protocol: CC's discipline of running schema + architectural verification BEFORE the brief drafts surfaced all 3 catches pre-v1; CA review caught zero additional architectural gaps; v2 amendments are pure polish (no catches surfaced). Pattern works as designed.

---

## §4 · Summary of v2 changes

| # | Amendment | v1 impact |
|---|---|---|
| 0 | §0.5 catch + open-question dispositions | Inline dispositions on v1 §0.5 + §9 |
| 1 | Q3 escalation protocol locked | v1 §9 Q3 → §1 of this doc |
| A1 | MIG-2 wording fix ("identical to pre-migration" → "matches fixture values") | v1 §5 MIG-2 |
| A2 | Step 6 margin curve spec (3-tier curve replaces flat T2-only) | v1 §6 Step 6 |
| A3 | `line_group_id` semantics explicit | v1 §2 schema + Step 2 |
| A4 | Step 8 grep extends to action names (13 names) | v1 §5 Drop verification |
| A5 | `retail_benchmark` cross-reference to Slice 11 PDF audit | v1 §8 Out-of-scope |
| A6 | Step 5 explicit CB drilldown walk | v1 §6 Step 5 |
| A7 | Action audit name implementation check (Step 4) | v1 §4 §"Action audit names" |

### Net effect

v1 architecture + 8-step plan + math-layer insulation principle stand verbatim. v2 sharpens demo intent (margin curve), tightens verification gates (action-name greps, drilldown walk), adds cross-reference (PDF audit), and locks the Q3 escalation protocol.

**Step 0 verification kickoff is unblocked once v2 merges + Edward signals.**

---

## Authorization

CC reads canonical set as **v1 + v2** with v2 taking precedence on conflicts.

CA reviews v2 + Edward signals kickoff → Step 0 verification begins (NULL-safe consumer audit per Q4 v1 + escalation protocol per Q3 §1 v2).

Once Step 0 closes clean (or with surfaced extension per Q3 protocol), Slice 11.5 Step 1 kicks off.

CA standing by for v2 review.
Edward standing by for kickoff signal post-v2 lock.
CC standing by for Step 0 verification once kickoff signaled.

---

**End of v2 amendments.** Canonical brief set: **v1 + v2**. v2 takes precedence on conflicts.
