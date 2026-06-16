# slice-fr12-copy-operations · Step 1 kickoff

**Branch:** `slice-fr12-copy-operations`
**Step:** 1 (kickoff + Pattern 22 §0.5 verification + step plan
lock)
**Date:** 2026-06-15
**Companion docs:**
- Brief: `docs/cc-comm-fr12-copy-operations-brief.md` (LOCKED;
  CA-drafted + Edward + CC dispositions inline)
- Review: `docs/cc-comm-fr12-copy-operations-review.md` (CC,
  2026-06-15; verification + 7 catches + Q5-Q11 dispositions)
**Predecessor:** PR #52 (slice-library-modal-polish) merged
`6a806a5`. This slice activates the disabled copy radios shipped
by PR #49 CSF.

---

## §1 — Slice purpose

Activate the two copy paths in the canonical scenario-create-
flow modal (PR #49). PMs gain:

1. **Within-project copy** — branch off an active scenario to
   explore an alternative
2. **Cross-project copy** — Beija Flor reorder template clone
   (SPEC v1 success criterion: "PM can clone a Beija Flor
   reorder template into a new project in one minute")

Both paths enforce SPEC FR-12 field bucket semantics:
Cloneable / Inherited / Reset. `copied_from_quote_id` set on
every copy for lineage traceability.

UI + server-action + loader work. No schema migrations
(column + enums already in place per Catches 1+3).

---

## §2 — Locked dispositions (Catches 1-7 + Q1-Q11)

All 18 confirmed verbal Edward + CA 2026-06-15. Brief contains
the full disposition table; reproduced here so the kickoff is
self-contained.

### §0.5 catches (cumulative count 26 → **33**)

| # | Catch | Disposition |
|---|---|---|
| 1 | `copied_from_quote_id` column + FK already exist | Drop Migration 1 |
| 2 | `scenario_status` enum is 3 values, not 4 | Drop `'archived'` from picker type |
| 3 | `superseded_by_copy` enum value confirmed | No action |
| **4** | **Cost-input cloneable graph anchored to legacy `quote_skus`** | **Re-anchor per ASY/LEAF model (Cloneable bucket re-written)** |
| **5** | **`freight_inputs` table dropped in R6.2** | **Use `freight_leg_groups` + `freight_legs`** |
| 6 | Permission gate posture — quote actions use only `ensureUser()` | No gate v1 (consistent) |
| 7 | CSF modal copy radios already in place | Confirmation |

### Open questions Q1-Q11

| Q | Disposition |
|---|---|
| Q1 | Picker shape: simpler search + dropdown (two-pane v1.1+) |
| Q2 | Copy from accepted scenarios: YES |
| Q3 | Permission scope: no gate v1 (Catch #6 confirms) |
| Q4 | Default scenario label: "Alt N" (scratch path consistent) |
| Q5 | Per-cell `quote_sku_tiers` clone: SKIP per Pattern 32 (FK to legacy `quoteSkus.id`; orphan for v1 ASY/LEAF quotes) |
| Q6 | Copy from accepted: YES (Q2 confirms; no schema gate) |
| Q7 | Cross-project picker: ASY/LEAF-tree-having quotes only (Pattern 32) |
| Q8 | Cross-project picker chrome: simpler search + dropdown (matches Q1) |
| Q9 | Rename `loadCrossProjectCopyPicker` → `loadCopySourceProjects` (clearer semantic) |
| Q10 | Audit namespace: single `scenario_copied` action with `diff_json.source_type` discriminator (`'within_project'` \| `'cross_project'`). Slice 9.2 source-namespace convention. |
| Q11 | Default scenario label on copy: "Alt N" (Q4 confirms) |

---

## §3 — Cloneable graph (LOCKED · re-anchored to v1 ASY/LEAF + R6.2 freight)

### Cloneable

| Table | Scope |
|---|---|
| `assemblies` | New IDs; same commercial fields (`sku`, `name`, `pack_label`, `product_type_id`, `description`, `url`, `image_url`, `unit_price`, `unit_cost`, `margin_pct`, `markup_pct`, `tax_schedule_id`, `owner_id`, `fsc_claim`, `fsc_status`, `supplier_verified`, `internal_notes`, `position`) |
| `assembly_leaves` | New IDs; same `leaf_id` references (library leaves NOT cloned); same `quantity`, `position`, `parent_assembly_leaf_id` (single-level v1 invariant = NULL) |
| `quote_tiers` | New IDs; same `label`, `sort_order`; `qty` RESET to null |
| `freight_leg_groups` | New IDs; same `label`, `display_order` (quote-keyed; FK to quotes.id directly) |
| `freight_legs` | New IDs; clone POLICY columns: `direction`, `label`, `origin`, `destination`, `crosses_international_border`, `treatment`, `mode`, `carrier`, `incoterm`, `freight_markup_pct`, `duty_markup_pct`, `tariff_markup_pct`, `customs` JSONB, `display_order` |
| `quotes` columns | `global_price_adj_pct`, `target_margin_pct`, `scenario_label` (overridden by PM input) |

### Inherited (from TARGET project)

- `project_id`, `hubspot_deal_id`, `deal_name`, `client_name`,
  `sales_rep_user_id`, `pm_user_id`

### Reset

- `id` (new UUID), `version_number = 1`, `status = 'draft'`,
  `accepted_at`, `sent_at`, `pdf_url`, `hubspot_quote_id`,
  `customer_facing_notes`, `internal_notes`, `valid_until`,
  `retail_benchmark`
- All `quote_tiers.qty` (target-specific)
- All `freight_legs` SHIPMENT dates: `cargo_ready_date`,
  `vessel_etd`, `vessel_eta`, `actual_delivery_date`
- `scenario_label = 'Alt N'` (PM input), `scenario_status =
  'active'`
- `copied_from_quote_id = source.id`

### Dropped from scope (Pattern 32 tolerance)

`packaging_inputs`, `production_inputs`, `quote_sku_tiers`,
`quote_sku_tier_targets` — all FK to legacy `quoteSkus.id`
chain; orphan for v1 ASY/LEAF quotes.

---

## §4 — Step plan (locked)

8 steps. Per-commit Pattern 27 two-layer manifest required.

1. ✅ **Step 1** — Kickoff (this commit bundle: brief + review +
   kickoff)
2. **Step 2** — CLAUDE.md audit namespace updates:
   `scenario_copied` action + `scenario_dropped.source =
   'fr12_copy_supersede'` extension. NO schema migration.
3. **Step 3** — `copyScenarioWithinProject` action: ASY/LEAF-
   aware transactional clone (assemblies + assembly_leaves +
   quote_tiers (qty reset) + freight_leg_groups + freight_legs
   (policy + customs JSONB; shipment dates reset)) + audit emit
4. **Step 4** — `copyQuoteFromProject` action: reuse Step 3's
   transactional clone helper + project context swap; no
   drop-current option (cross-project)
5. **Step 5** — Loaders: `loadScenarioCopyPicker` (within-
   project) + `loadCopySourceProjects` (cross-project per Q9)
   with ASY/LEAF-tree-having filter
6. **Step 6** — CSF modal: remove warning banner + flip
   `copyPathSelected` gates + mount within-project picker UI
7. **Step 7** — CSF modal: cross-project picker UI (search +
   scenario dropdown per Q1/Q8)
8. **Step 8** — Smoke guide FR12-1..FR12-9 + cumulative Pattern
   27 fold + §0.5 ledger

---

## §5 — Pre-merge gates

- [ ] Typecheck PASS every commit (`npx tsc --noEmit`)
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (this kickoff)
- [ ] Pattern 27 two-layer manifest per implementation commit
- [ ] Pattern 45 customer-view boundary clean (no PDF tree
      impact; CSF modal is PM-internal)
- [ ] CB end-of-phase smoke walk (merge gate)

---

## §6 — Carry-forwards (banked, NOT in this slice)

From brief §"Carry-forwards" + review §6:

- Lineage indicator chip on scenario cards — v1.1+ visual polish
- Field bucket preview disclosure in modal — v1.1+
- "Show archived" project toggle on cross-project picker — v1.1+
- Tier remap UI (source 4 → target 3 preserve-hidden) — v1.1+
- Save-as-template / templates library — v2 per SPEC non-goal
- Bulk copy — v1.5+
- Copy-from-accepted preview (read-only source view) — v1.1+
- `quotes_copied_from_idx` partial index — v1.1+ if lineage
  query patterns surface
- Per-cell `quote_sku_tiers` clone — v1.1+ once ASY/LEAF per-cell
  override architecture lands
- Cross-project picker SKU-label search — v1.1+
- `can_create_scenarios` permission gate — v1.1+ if per-role
  isolation requested

---

## §7 — Predecessor state inherited

PR #52 merged 2026-06-15 (`6a806a5`). On `main`:

- LibraryBrowseModal CD redesign (Pattern 30 path-B-default
  canonical CSS adoption); preserved unchanged this slice
- `restoreLeaf` action + `leaf_restored` audit namespace
- `loadLibraryBrowse` extended return shape with `clientName` +
  `libraryTotalActive` — preserved unchanged
- `r-library-modal.css` + `r-a1v2-overrides.css` — unchanged
- Heap bump `a09ecb8` from PR #50 era — ongoing benefit

CSF modal infrastructure from PR #49 (canonical-scenario-create-
flow) lives at `src/components/scenario-create/canonical-modal.tsx`
with the copy radios already rendered. Step 6/7 flip the gates +
mount picker UI.

---

## §8 — Standing by

Step 1 PASS. Cleared to proceed to Step 2 (CLAUDE.md audit
namespace updates) on Edward's next directive.

Step 2 is the load-bearing namespace work (audit-log doc-only;
no code changes). Step 3 is the heaviest implementation step
(transactional clone helper covers all Cloneable bucket tables).

— CC, 2026-06-15
