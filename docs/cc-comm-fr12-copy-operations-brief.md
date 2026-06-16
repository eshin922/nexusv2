# FR-12 copy operations slice · CC impl brief

**Slice name:** `slice-fr12-copy-operations`
**Status:** LOCKED. All dispositions confirmed verbal Edward + CA
2026-06-15.
**Date:** 2026-06-15
**Predecessor:** PR #49 CSF canonical scenario-create-flow shipped
the modal with "Copy a scenario from this project" + "Copy a quote
from another project" radios in visible-disabled state. This slice
activates those paths.

---

## Locked dispositions

| Catch / Q | Disposition |
|---|---|
| Catch #1 — `copied_from_quote_id` already exists | Drop Migration 1 from brief scope |
| Catch #2 — `scenario_status` enum is 3 values | Drop `'archived'` from picker type signature |
| Catch #3 — `superseded_by_copy` confirmed | No action needed |
| **Catch #4** — Cost-input cloneable graph anchored to legacy `quote_skus` | **Re-anchor per CC's proposed graph (Cloneable section below rewritten)** |
| **Catch #5** — `freight_inputs` table dropped in R6.2 | **Use `freight_leg_groups` + `freight_legs` (R6.2)** |
| Catch #6 — Permission gate posture | **No gate v1** (consistent with existing quote actions) |
| Catch #7 — CSF modal copy radios already in place | Confirmed |
| Q1 — Picker shape | **Simpler search + dropdown** (two-pane → v1.1+) |
| Q2 — Copy from accepted scenarios | **YES** |
| Q3 — Permission scope | **No gate v1** (Catch #6) |
| Q4 — Default scenario label | **"Alt N"** (consistent with scratch path) |
| Q5 — Per-cell `quote_sku_tiers` clone | **Skip per Pattern 32** — FK verified to legacy `quoteSkus.id` chain; orphan for v1 ASY/LEAF quotes |
| Q6 — Copy from `accepted` scenarios | **YES** (Q2 confirms; no schema gate) |
| Q7 — Cross-project picker filter | **ASY/LEAF-tree-having quotes only** (Pattern 32 tolerance; legacy quote_skus-only quotes invisible as copy sources) |
| Q8 — Cross-project picker chrome | **Simpler search + dropdown** (matches Q1) |
| Q9 — Rename `loadCrossProjectCopyPicker` → `loadCopySourceProjects` | **YES** (clearer semantic) |
| Q10 — Audit namespace shape | **Single `scenario_copied` action with `diff_json.source_type` discriminator** (`'within_project'` \| `'cross_project'`). Consistent with Slice 9.2 source-namespace convention. |
| Q11 — Default scenario label on copy | **"Alt N"** (Q4 confirms; PMs typically rename) |

CC review at `docs/cc-comm-fr12-copy-operations-review.md` carries
the full verification + rationale per disposition.

---

## Slice purpose

Activate the two copy paths in the canonical scenario-create-flow
modal. PMs can:

1. **Copy a scenario from this project** — within-project source
   picker; canonical use case is "branch off an active scenario
   to explore an alternative."
2. **Copy a quote from another project** — cross-project source
   picker; canonical use case is the Beija Flor reorder template
   (per SPEC v1 success criterion: "PM can clone a Beija Flor
   reorder template into a new project in one minute").

Both paths enforce SPEC FR-12 field bucket semantics: Cloneable /
Inherited / Reset. `copied_from_quote_id` set on every copy for
lineage traceability.

---

## Cloneable graph (LOCKED — re-anchored to v1 ASY/LEAF + R6.2 freight)

### Cloneable (carried from source)

| Table | Scope |
|---|---|
| `assemblies` | New IDs; same commercial fields (`sku`, `name`, `pack_label`, `product_type_id`, `description`, `url`, `image_url`, `unit_price`, `unit_cost`, `margin_pct`, `markup_pct`, `tax_schedule_id`, `owner_id`, `fsc_claim`, `fsc_status`, `supplier_verified`, `internal_notes`, `position`) |
| `assembly_leaves` | New IDs; same `leaf_id` references (library leaves NOT cloned per slice §"Investigation ask 1"); same `quantity`, `position`, `parent_assembly_leaf_id` (single-level v1 invariant = NULL) |
| `quote_tiers` | New IDs; same `label`, `sort_order`; `qty` RESET to null per Reset bucket |
| `freight_leg_groups` | New IDs; same `label`, `display_order` (quote-keyed; FK to quotes.id directly per R6.2 schema) |
| `freight_legs` | New IDs; clone POLICY columns: `direction`, `label`, `origin`, `destination`, `crosses_international_border`, `treatment`, `mode`, `carrier`, `incoterm`, `freight_markup_pct`, `duty_markup_pct`, `tariff_markup_pct`, `customs` JSONB, `display_order` |
| `quotes` columns | `global_price_adj_pct`, `target_margin_pct`, `scenario_label` (overridden by PM input in modal) |

### Inherited (from TARGET project, never from source)

- `project_id`
- `hubspot_deal_id`
- `deal_name`
- `client_name`
- `sales_rep_user_id`
- `pm_user_id`

### Reset (always cleared)

- `id` (new UUID generated)
- `version_number = 1`
- `status = 'draft'`
- `accepted_at`, `sent_at`, `pdf_url`, `hubspot_quote_id` → null
- `customer_facing_notes`, `internal_notes`, `valid_until`
- `retail_benchmark`
- All `quote_tiers.qty` values (qty is target-specific)
- All `freight_legs` SHIPMENT-specific dates: `cargo_ready_date`,
  `vessel_etd`, `vessel_eta`, `actual_delivery_date`
- `scenario_label = 'Primary'` (overridden by PM input — defaults
  to "Alt N" per Q4/Q11 disposition)
- `scenario_status = 'active'`
- `copied_from_quote_id` set to source quote ID

### Dropped from clone scope per Pattern 32 tolerance

- `packaging_inputs` (FK to `quoteSkus.id` legacy chain; orphan
  for v1 quotes)
- `production_inputs` (same legacy chain)
- `quote_sku_tiers` per-cell sell-price overrides (Q5 — same
  legacy chain)
- `quote_sku_tier_targets` per-cell client-target prices (same
  legacy chain)

---

## Schema additions

**NONE** — Migration 1 dropped per Catch #1 (column + FK already
exist). Migration 2 (drop_reason enum extension) was already a
verify-only step per Catch #3.

Pre-build verification gate PASS at brief-review time.

---

## Server action surface

### `copyScenarioWithinProject`

```ts
async function copyScenarioWithinProject(input: {
  sourceQuoteId: string;
  targetProjectId: string;
  newScenarioLabel: string;
  intentNote?: string;
  customerTargetTierLabel?: string;
  dropCurrentScenarioId?: string;
}): Promise<ActionResult<{ newQuoteId: string }>>
```

Behavior:
1. Validate input + auth (`ensureUser`; no permission gate per
   Catch #6)
2. Load source quote with ASY/LEAF tree + tier list + freight
   legs
3. Within DB transaction:
   - Insert new quote row (Reset fields cleared + Cloneable
     fields from source + Inherited fields from target project +
     `copied_from_quote_id = source.id`)
   - Insert new `quote_tiers` rows (label + sort_order from
     source; `qty = null` per Reset bucket)
   - Insert new `assemblies` rows for each source ASY
   - Insert new `assembly_leaves` rows pointing at SAME `leaf_id`
     references
   - Insert new `freight_leg_groups` rows for each source group
   - Insert new `freight_legs` rows (policy columns + customs
     JSONB; shipment dates RESET)
   - If `dropCurrentScenarioId` provided: update that quote's
     `scenario_status = 'dropped'` + `drop_reason =
     'superseded_by_copy'`
4. Emit audit row: `scenario_copied` action with `diff_json` =
   `{ source_quote_id, source_type: 'within_project',
     target_project_id, scenario_label, intent_note,
     dropped_source }` per Q10

### `copyQuoteFromProject`

Same shape; cross-project. No `dropCurrentScenarioId` option
(cross-project copies don't auto-drop source). Audit `source_type:
'cross_project'` per Q10.

### `loadScenarioCopyPicker`

Within-project picker source data:

```ts
{
  scenarios: Array<{
    quoteId: string;
    scenarioLabel: string;
    scenarioStatus: 'active' | 'dropped' | 'accepted'; // 3 values per Catch #2
    isRecommended: boolean;
    versionNumber: number;
    asyCount: number;
    leafCount: number;
    latestActivity: Date;
  }>;
}
```

### `loadCopySourceProjects` (renamed per Q9)

Cross-project picker source data:

```ts
{
  projects: Array<{
    projectId: string;
    clientName: string;
    dealName: string;
    quotes: Array<{ /* same shape as loadScenarioCopyPicker */ }>;
  }>;
}
```

Filter: only projects with at least one quote that has at least
one assembly (Pattern 32 tolerance per Q7 — legacy quote_skus-
only quotes invisible as copy sources).

---

## UI changes

### Activate disabled copy paths in CSF modal

1. Remove the inline warning banner from
   `src/components/scenario-create/canonical-modal.tsx:284-298`
   (banner copy `⏳ Copy operations ship in the next slice...`)
2. Enable both copy radios + form fields below (flip the
   `copyPathSelected` gates)
3. When PM selects a copy radio, additional source-picker UI
   renders inline below the radio:
   - **Within-project:** scenario dropdown with metadata per
     scenario (label · version · status · ASY count · leaf count
     · last activity)
   - **Cross-project:** simpler search (project name / client
     name) + scenario dropdown per Q1/Q8 disposition

Scenario name + intent + drop-current-scenario-choice +
`brief_attachment` upload affordances preserved across all paths
(apply to copy paths same as scratch).

### Lineage indicator post-copy

Banked v1.1+ per brief §"UI changes." `copied_from_quote_id`
persists; visual indicator on the scenario card lands later.

---

## Audit log namespace (CLAUDE.md additions)

Single action with discriminator per Q10:

```
'scenario_copied'           -- copy-paths emit one audit row per
                            -- copy. diff_json carries:
                            --   source_quote_id (UUID of source)
                            --   source_type ('within_project' |
                            --                'cross_project')
                            --   target_project_id (UUID)
                            --   source_project_id (only for
                            --                     cross_project)
                            --   scenario_label, intent_note,
                            --   customer_target_tier_label
                            --   dropped_source_quote_id
                            --     (only for within_project with
                            --      dropCurrentScenarioId)
                            -- entity_type = 'quote', entity_id =
                            --   new_quote_id.
                            --
                            -- Source-namespace convention per
                            -- Slice 9.2. Single action keeps the
                            -- audit timeline grammar legible
                            -- (one row per semantic intent: PM
                            -- copied a quote). Cross vs intra
                            -- project filtering happens via
                            -- diff_json.source_type, not by
                            -- separate action names.
```

`scenario_dropped` action gains a new `diff_json.source` value
for the drop-on-copy path:

```
'fr12_copy_supersede' — emitted when copyScenarioWithinProject
                        flips a sibling scenario to dropped via
                        the dropCurrentScenarioId option.
                        Parallel to the existing 'manual' and
                        'canonical_modal' source values per Slice
                        9.2 source-namespace convention.
```

---

## CB smoke scenarios

### FR12-1 · Within-project copy · happy path

Project with 2+ scenarios. Modal → "Copy a scenario from this
project" → picker → fill form → submit. New scenario card on
project detail; `copied_from_quote_id = source.id`; Cloneable
fields match; Reset fields cleared; tiers carried (qty null).

### FR12-2 · Cross-project copy · happy path

Project A scenario as source; Project B as target. Modal in B →
"Copy a quote from another project" → search + pick Project A →
scenario dropdown → submit. New scenario in B; Cloneable fields
match A; Inherited fields = B's values; Reset cleared.

### FR12-3 · Drop current on within-project copy

`dropCurrentScenarioId` set. Source retains data. Old current →
`scenario_status='dropped'` + `drop_reason='superseded_by_copy'`
+ `diff_json.source='fr12_copy_supersede'`. New scenario active.

### FR12-4 · Field bucket integrity

DB-level verification:
- Cloneable fields match source
- Inherited fields = target project's values
- Reset fields cleared (version=1, status=draft, accepted_at NULL,
  copied_from_quote_id NOT NULL)

### FR12-5 · ASY/LEAF graph integrity

Source quote with N assemblies × M leaves each. Post-copy:
- N new assemblies (new UUIDs)
- M assembly_leaves per ASY (new IDs; SAME `leaf_id`s)
- Spec values resolve via leaves (library; not cloned)

### FR12-6 · Freight legs clone

Source quote with M freight_leg_groups × N legs each. Post-copy:
- M new freight_leg_groups (new UUIDs)
- N freight_legs per group (POLICY columns + customs JSONB
  cloned; shipment dates NULL per Reset bucket)

### FR12-7 · Audit log entries

```sql
SELECT action, diff_json, created_at FROM audit_log
 WHERE action IN ('scenario_copied', 'scenario_dropped')
   AND created_at > now() - interval '5 minutes';
```

Expect: 1 `scenario_copied` row per copy with `source_type`
discriminator; 1 `scenario_dropped` row with `source =
'fr12_copy_supersede'` for FR12-3.

### FR12-8 · Cross-project picker ASY/LEAF filter (Q7)

Pre-CSF dev quotes in legacy quote_skus state. Cross-project
picker should NOT surface them as copy sources. Verify by
running the picker query against a known legacy quote and
confirming it doesn't appear.

### FR12-9 · Open to all signed-in users (Catch #6)

No permission gate. Confirm any signed-in user can use copy
paths (no `canCreateLeaves` or similar required).

---

## Step plan

1. **Step 1** — Kickoff + Pattern 22 §0.5 ledger (this commit
   bundle: brief + review + kickoff)
2. **Step 2** — Audit namespace doc updates (CLAUDE.md):
   `scenario_copied` action + `scenario_dropped.source =
   'fr12_copy_supersede'` extension. NO schema migration (column
   + enum already exist).
3. **Step 3** — `copyScenarioWithinProject` action with ASY/
   LEAF-aware transactional clone (assemblies + assembly_leaves +
   quote_tiers (qty reset) + freight_leg_groups + freight_legs)
4. **Step 4** — `copyQuoteFromProject` action reuses Step 3's
   transactional clone helper + project context swap
5. **Step 5** — `loadScenarioCopyPicker` (within-project) +
   `loadCopySourceProjects` (cross-project) with ASY/LEAF-tree-
   having filter
6. **Step 6** — CSF modal — flip the `copyPathSelected` gates +
   replace warning banner with within-project picker UI
7. **Step 7** — CSF modal — cross-project picker UI (search +
   scenario dropdown per Q1/Q8)
8. **Step 8** — Smoke guide FR12-1..FR12-9 + cumulative Pattern
   27 fold + §0.5 ledger

---

## Pre-merge gates

- [ ] Typecheck PASS every commit
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (this kickoff; no further
      schema checks expected)
- [ ] Pattern 27 two-layer manifest per commit
- [ ] Pattern 45 customer-view boundary clean (no PDF tree
      impact)
- [ ] CB end-of-phase smoke walk (merge gate)

---

## Carry-forwards (banked)

- Lineage indicator chip on scenario cards — v1.1+ visual polish
- Field bucket preview disclosure in modal — v1.1+ if PMs want
  forensic clarity
- "Show archived" project toggle on cross-project picker — v1.1+
- Tier remap UI (source 4 tiers → target 3 tiers preserve-hidden)
  — v1.1+ for cross-tier-count scenarios
- Save-as-template / templates library — v2 per SPEC non-goal
- Bulk copy — v1.5+ if PMs request
- Copy-from-accepted preview (read-only view of source before
  commit) — v1.1+ usability
- `quotes_copied_from_idx` partial index — v1.1+ if lineage
  query patterns surface
- Per-cell `quote_sku_tiers` clone if ASY/LEAF per-cell
  override architecture lands — v1.1+
- Cross-project picker SKU-label search — v1.1+
- `can_create_scenarios` permission gate — v1.1+ if PM workflow
  requires per-role isolation

---

## Sequencing

v1 release-path item 4. After: Pricing reframe v1 → Slice 12
Mark Accepted + NetSuite SO push → pre-launch cleanup → MS OAuth
→ SPEC audit → pre-launch review → v1 release.

---

## Status

LOCKED. Step 1 kickoff opens.

— CA + Edward + CC, 2026-06-15
