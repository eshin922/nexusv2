# Slice 11.5 — Step 0 verification

Branch: `slice-11-5-step-0-verification` (off main @ 18ac227, PR #64
merge — brief v2 amendments).

Step 0 closes the gate between the v2-amended brief and Step 1
schema-extension work. Two passes were locked at v2:

1. **§0.5 schema verification** — every entity the brief references
   exists in `src/db/schema.ts` at the column/index granularity
   committed during scoping.
2. **Q4 NULL-safe consumer audit** — four surfaces consume tables
   that ship empty in the NEW model under Path B / v1.1+ posture
   (bulk_raw_*, cost_section_deposits). Each must handle the
   empty/null state without crashing.

Both passes are walked below.

---

## §0.5 schema verification

OLD-model surfaces Slice 11.5 will migrate read paths against (Path B
schema extension; OLD tables stay until Slice 12 ships):

| Entity                       | schema.ts line | Status |
|------------------------------|----------------|--------|
| `quote_skus`                 | 478            | ✓      |
| `quote_sku_tiers`            | 546            | ✓      |
| `quote_sku_tier_targets`     | 614            | ✓      |
| `packaging_inputs`           | 749            | ✓      |
| `production_inputs`          | 810            | ✓      |

NEW-model surfaces Slice 11.5 will extend (Path B — schema additions
on the NEW tables; carry-forward audit per the "Versioned-table
carry-forward audit" CLAUDE.md entry):

| Entity                       | schema.ts ref  | Status |
|------------------------------|----------------|--------|
| `assemblies`                 | present        | ✓      |
| `assembly_leaves`            | present        | ✓      |
| `quote_leaves`               | present        | ✓      |
| `leaves`                     | present        | ✓      |

Slice 11.5 v1.1+ deferred tables (Q4 disposition — present in schema
but NEW-model writers don't populate; consumers must NULL-safe):

| Entity                       | schema.ts line | Status |
|------------------------------|----------------|--------|
| `bulk_raw_section_meta`      | 1329           | ✓      |
| `bulk_raw_categories`        | 1348           | ✓      |
| `bulk_raw_ingredients`       | 1373           | ✓      |
| `cost_section_deposits`      | 1419           | ✓      |

No phantom references; no notation errors; no missing columns. Path B
schema-extension work in Step 1 starts from a known surface.

---

## Q4 NULL-safe consumer audit

Four surfaces consume the v1.1+ deferred tables. Each was walked
against the empty-state code path; all four are NULL-safe.

### 1. BulkRawDrilldown — CLEAN

`src/components/costs/bulk-raw-drilldown.tsx`

- **Gate:** lines 116-127 render the empty-drawer message
  ("Bulk raw inputs only apply when raws mode is DPS sources") when
  `rawsMode !== "dps_sources"`. The NEW-model default is
  `cm_sources` (no DPS-source raw rows), so the gate fires before
  any consumer of `bulk_raw_*` tables runs.
- **Empty-state:** lines 127-147 render the "No raw categories
  yet" empty state when `categories.length === 0`. Even if
  `rawsMode === "dps_sources"` somehow triggers (it can't on
  NEW-model data, but defense in depth), the empty list renders
  cleanly.

No crashes on empty arrays. Verdict: clean.

### 2. cost-stack-header RAW row — CLEAN

`src/components/costs/cost-stack-header.tsx`

- **Gate:** line 155 `const showRaw = rawsMode === "dps_sources"`.
- **Composition:** lines 160-162 build the components array
  including `"raw"` only when `showRaw === true`. On NEW-model
  data (rawsMode = cm_sources), the RAW row is excluded from the
  composition entirely — not just hidden via CSS, structurally
  absent.

No empty-row footprint. Verdict: clean.

### 3. Deposits chip — CLEAN

`src/components/costs/section-with-drilldown.tsx`

- **Prop shape:** `deposit?: DepositRow` — optional.
- **Lookup:** `deposits.find(...)` in page.tsx returns `undefined`
  when no `cost_section_deposits` row matches; the optional prop
  receives that undefined cleanly.
- **Render guard:** line 174-178 uses
  `deposit && deposit.depositStatus !== "none"` short-circuit
  guard. With `deposit = undefined`, the chip never renders.
- **DepositChip component:** line 311+ destructures only when
  reached; the guard prevents the component from rendering on
  empty data.

No crashes on `undefined`. Verdict: clean.

### 4. Production "services billed separately" — CLEAN

`src/components/costs/production-drilldown.tsx` +
`src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx`

- **Early returns:** lines 163-178 (no tiers) and 180-188 (no leaf
  SKUs) of production-drilldown.tsx render warn-or-empty drawer
  before any `production_inputs` consumer runs.
- **Default policy fallback:** lines 190-195
  `sectionPolicy = policyBySku.get(firstLeaf.id) ?? {
   customerShipsRaws: false, allocateServiceFeesToCost: true,
   notes: null }`. When no `production_inputs` policy row exists
  for the first leaf SKU (NEW-model assemblies have no
  production_inputs rows at all), the default fallback applies
  `allocateServiceFeesToCost: true` — matching the NEW-model
  assumption that services are bundled into cost.
- **Indicator chip suppression:** page.tsx `productionIndicatorChip`
  (lines 602-615) returns `undefined` when `rows.length === 0`. No
  "services billed separately" chip surfaces at the section header
  on empty input data — correct behavior since the chip's purpose
  is to warn when the majority is billed separately, and an empty
  set has no majority.

No crashes on empty `production_inputs`. Verdict: clean.

---

## Step 0 closes clean

All §0.5 entities present at the brief-committed granularity. All
four Q4 NULL-safe consumer audit surfaces handle empty-state cleanly
under the NEW-model default. No schema-extension surprises queued
for Step 1; no consumer-side blockers queued for Step 1.

**Q3 escalation protocol NOT invoked.** Per brief v2 §Q3, the
protocol fires only when a surface breaks under empty-state — no
surface broke. Step 1 (Path B schema extension) is ready to kick
off on CC + CA + Edward greenlight.

**Adjacent observation banked for Step 1.** Production's default
fallback policy assumes `allocateServiceFeesToCost: true` (services
inside cost bucket). The NEW-model assembly path persists
`unit_cost` as already-allocated; Step 1's adapter design should
either:

(a) Treat NEW-model `unit_cost` as authoritative; ignore policy
    fallback for assembly-derived production rollups, OR

(b) Synthesize a default policy row at adapter time so the
    cost-stack section consumes a consistent shape.

CA + Edward disposition during Step 1 brief refinement. Not a Step 0
blocker; flagged here so the Step 1 author sees it on first read.

---

## Reference

- Slice 11.5 brief v1: `docs/cc-comm-slice-11-5-brief.md` (PR #63)
- Slice 11.5 brief v2 amendments: `docs/cc-comm-slice-11-5-brief-v2-amendments.md`
  (PR #64)
- Slice 11.5 scoping inventory: `docs/cc-slice-11-5-scoping.md` (PR #62)
- Pattern 22 §0.5 standing protocol: `CLAUDE.md` "Design docs may make
  wishful schema assumptions" section.
