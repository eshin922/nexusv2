# Leaf-Detach Micro-Slice v1 Brief

**Audience:** CC (implementation) — CD design review optional per disposition below
**Slice:** v1 — Leaf-detach + Type-conversion + Cost-build validation + orphaned-data cleanup
**Sequencing:** v1 release-critical path; queued between rest-of-app sweep PR and R6.2 freight implementation
**Scope:** Five tightly-coupled sub-items shipped as a single micro-slice
**Design discipline:** Pattern 25 (§0.5 schema-verification gate pre-approval); Pattern 22 (column-name verification before encoding)
**Estimated lift:** 1-1.5 days CC + dry-run review cycle with Edward

**Status (revised 2026-05-14 post-Pattern-25 verification):** Schema
verification pass complete; four mismatches surfaced (enum case,
column name `target_sku_id` → `quote_sku_id`, no `bulk_raw_inputs`
table, production_inputs auto-create gate) and CA-dispositioned;
Q1-Q7 product dispositions locked per recommendations. Brief
patched inline; ready for Edward final approval before §11
implementation kickoff.

---

## 1. Background & Context

The Setup surface's leaf/assembly type model expresses quote structure: leaf SKUs are HubSpot-backed products with cost data; assembly SKUs are Nexus-local structural compositions of leaves. (DB enum `sku_role` carries values `'leaf'` / `'assembly'`; UI chip labels render uppercase "LEAF" / "ASY" as design vocabulary.) The architectural commitment is **"costs are strictly inherited from leaves"** — cost inputs live on the Costs surface organized by section (Packaging / Production / Freight), not per-SKU on Setup, and only leaf SKUs are valid cost-input targets. Bulk raw cost is a fourth conceptual cost-input source but rolls UP into `production_inputs.bulk_raw_cost` at the per-SKU level rather than living as a separate per-SKU table; bulk raw travels with production reparenting through the smart-migrate flow.

This commitment was established and ratified during a prior architectural conversation. Implementation has not yet fully enforced it. The five sub-items in this slice close the enforcement gap.

---

## 2. The Problem — Operational Risk

Three distinct workflow gaps surfaced during smoke testing:

### Gap 1 — No way to detach a leaf from its parent

Once a LEAF is assigned as a child of an ASY, there is currently no UI affordance to disconnect it. PM workarounds (delete + recreate) are destructive — they lose per-SKU notes, retail bench data, drawer state, and sort order. Common workflows that hit this gap:
- PM mistakenly assigns a leaf to the wrong parent
- Customer pivots and a leaf needs to move from Assembly A to Assembly B
- Parent assembly gets deprecated but its child leaves should survive as standalone SKUs

### Gap 2 — Type toggle silently mutates state in destructive ways

Two type-conversion scenarios currently fail-quietly or fail-destructively:

**assembly → leaf on an assembly with children:** Currently no-ops silently. PM can't convert without first manually detaching every child (a workflow that doesn't exist per Gap 1 — circular dependency).

**leaf → assembly on a leaf with cost data:** Currently allows the conversion, which orphans the cost data on the now-ASY SKU. Cost-build section rows reference a SKU type that architecturally shouldn't carry cost data. Audit query found 12 such orphaned rows on the current dev/seed state (1 quote × 1 ASY SKU × 4 tiers × 3 sections — Packaging + Production + Freight).

### Gap 3 — Cost build accepts assembly SKUs as cost-input targets

Section-row pickers on the Costs surface (Packaging / Production / Freight / Bulk Raw) currently accept any SKU type as the cost-input target. Architecturally invalid — only leaf SKUs should be addressable as cost-input targets per the "strictly inherited from leaves" commitment. Without validation, the Gap 2 leaf → assembly orphaning pattern can re-emerge whenever someone toggles type or assigns the wrong target.

---

## 3. The Decision — v1 Commitment

All three gaps are v1 blockers. Reasons:
- Destructive workarounds (delete + recreate) lose real PM-entered data
- Silent state mutations during type conversion violate user expectations
- Orphaned cost data already exists in dev/seed and will propagate to production without cleanup + validation gates

The five sub-items are shipped as **a single micro-slice** rather than separately because they share architectural concerns (audit log integration, action-layer mutations, schema constraints) and benefit from being landed together with a coherent test surface.

---

## 4. Solution Architecture

Five sub-items. Implementation sequence below is recommended; Pattern 25 schema-verification gate covers all five before commits begin.

### Sub-item 1 — Leaf detach from parent assembly

**Affordances (two entry points, both implemented):**
- **Parent's drawer child-SKU list** — per-row "✕ Detach" or "Remove from assembly" action on each child row. PM detaches from the parent side.
- **Leaf row's ⋯ overflow menu** — conditional "Detach from {parent name}" menu item, present only when leaf has a parent. PM detaches from the leaf side.

**Action:** `detachLeafFromParent(skuId)` writes `parent_sku_id = NULL` on the child SKU row.

**Confirmation gate:**
- If leaf has notes OR retail bench data OR drawer-tracked sort_order: confirmation modal: "Detach this leaf from {parent}? Notes, retail bench, and drawer state will be preserved on the standalone leaf."
- If leaf is empty of preservable data: silent detach (no modal).

**Visual changes after detach:**
- Tree-line connector removed from leaf row
- QtyPerParentInline widget removed from leaf row
- Leaf row becomes a standalone register (matches existing standalone-leaf visual treatment)
- Parent's drawer child count decrements; if zero children remaining, drawer renders empty-state copy

**Audit:** action `sku_detached_from_parent` with payload `{skuId, formerParentSkuId, detachedAt, actorId}`.

### Sub-item 2 — assembly → leaf conversion warning with cascade-detach

**Trigger:** PM clicks Type badge on an ASY row to toggle to LEAF.

**Three scenarios:**

| Scenario | Children present | Behavior |
|---|---|---|
| A | 0 children | Silent toggle (no modal) — same as existing standalone-leaf → assembly behavior |
| B | ≥1 children | Confirmation modal: "Convert {sku} to leaf? {N} children will be detached as standalone leaves (their notes, retail bench, and data preserved)." [Cancel] [Convert and detach children] |
| C | This ASY is itself a child of another ASY | Type change does NOT affect parent relationship. Children-of-this-row cascade-detach per Scenario B; parent relationship unaffected. To detach this ASY from ITS parent, PM uses Sub-item 1 affordances separately. |

**Cascade-detach action:** On confirm in Scenario B, atomic transaction:
1. For each child SKU, write `parent_sku_id = NULL`
2. Update assembly → leaf type on original SKU
3. Fire audit actions: `sku_type_changed_assembly_to_leaf` for the original SKU; `sku_detached_from_parent` N times for the detached children

**Failure handling:** if the transaction fails, no partial state — original SKU stays ASY, children stay attached. Error band on the modal surfaces the failure.

### Sub-item 3 — leaf → assembly smart-migrate with auto-create child

**Trigger:** PM clicks Type badge on a LEAF row to toggle to ASY.

**Two scenarios:**

| Scenario | Cost data on this SKU | Behavior |
|---|---|---|
| A | No cost data | Silent toggle (no modal) — standalone LEAF becomes empty ASY |
| B | Has cost data in any Cost-build section | Confirmation modal: "Convert {sku} to assembly? Cost data on this leaf will be moved to a new child leaf '{auto-name}' (auto-created, all cost lines preserved). You can rename the new child after." [Cancel] [Convert and migrate cost data] |

**Auto-naming convention:** `{ORIGINAL-SKU}-CMP` (e.g., `DPS-LIP-001` → `DPS-LIP-001-CMP`).

**Collision handling:** If `{ORIGINAL-SKU}-CMP` already exists (rare but possible), append numeric suffix: `-CMP-2`, `-CMP-3`, etc. First non-colliding name wins.

**Cost-line distribution:** Single new child leaf holds ALL cost lines across the three per-SKU cost-input tables (`packaging_inputs`, `production_inputs`, `freight_inputs`). Bulk raw cost (`production_inputs.bulk_raw_cost` field) travels with the production row — no separate handling. PM splits later if needed via separate workflow.

**Smart-migrate action sequence (CA-approved step ordering, Observation 1 from §0.5 verification):** Atomic transaction. **Preferred (approach a):** reparent per-SKU cost tables FIRST, then create child SKU last so the auto-create logic (which fires `production_inputs` rows on new leaf creation per `schema.ts:743-745`) finds rows already at `(quote_sku_id, tier_id) = (newChild.id, tier.id)` and skips. **Fallback (approach b) if Drizzle's two-phase-ID approach proves awkward:** create child first → DELETE auto-created `production_inputs` rows for the new child → reparent originals. CC's call on implementation feasibility; intent stays the same.

Approach (a) sequence:
1. Pre-allocate child SKU ID (UUID generated in app layer)
2. Reparent `packaging_inputs`, `production_inputs`, `freight_inputs` rows: rewrite `quote_sku_id` from `{original.id}` to the pre-allocated `{newChild.id}` across all three tables
3. Update original SKU's `sku_role` from `leaf` to `assembly`
4. Create new leaf SKU row with the pre-allocated ID: `sku_label = '{ORIGINAL-SKU}-CMP'`, `parent_sku_id = {original.id}`, `qty_per_parent = 1`, `sort_order = 0`, empty notes / retail bench. (Auto-create logic for `production_inputs` per-tier rows on new leaf SKU now no-ops because rows already exist at those `(quote_sku_id, tier_id)` tuples from step 2.)
5. Fire audit actions: `sku_type_changed_leaf_to_assembly`, `sku_created_auto_for_cost_migration` (with `{originalSkuId, newChildSkuId, autoNamedFrom}`), `cost_data_reparented` (with `{originalSkuId, newChildSkuId, costLinesReparented: [{section, rowCount}]}`)

Original SKU's notes + retail bench stay on the now-assembly row as customer-facing reference for the finished product; child inherits empty notes + empty retail bench.

**Failure handling:** atomic transaction; partial failure rolls back entirely.

### Sub-item 4 — Cost build section assignment validation (leaf-only)

**Per-section behavior split** (Mismatch 4 from §0.5 verification — production_inputs is auto-created per `(leaf SKU × tier)` per `schema.ts:729-746`, NOT PM-picked):

**Packaging + Freight (PM-added per line):**
- Section-row SKU picker filters available options to `sku_role = 'leaf'` SKUs only
- Assembly SKUs do not appear in the picker
- If existing section rows reference assembly SKUs (legacy orphaned state surfaced by the cleanup pass below): row renders with `.warn-band` primitive (Pattern 30 cross-surface primitive, banked from §6.b sweep): *"This cost line is attached to an assembly — needs to move to a leaf SKU."*
- **Action-layer enforcement:** server-side validation rejects `packaging_inputs` / `freight_inputs` mutations where the target SKU's `sku_role !== 'leaf'`. Frontend filter is defense-in-depth, not the sole gate.

**Production (auto-created):**
- No SKU picker exists on this surface — `production_inputs` rows are auto-generated per `(quote_sku_id, tier_id)` tuple by the SKU/tier creation flows in `actions/quotes.ts`
- **Enforcement gate at auto-create logic:** the loop that iterates `quote_skus` to populate `production_inputs` rows skips any SKU with `sku_role = 'assembly'`. New ASY SKUs (including those promoted via Sub-item 3 smart-migrate) never get auto-generated production rows
- **No warning band needed for legacy orphans** — Sub-item 5 cleanup pass reparents existing assembly-attached production rows to auto-created child leaves; post-cleanup, no production rows reference assembly SKUs.

**Pattern 22 verification CLEAR per §0.5 pass.** Confirmed column names + enum values:
- Section-row tables: `packaging_inputs.quote_sku_id` (`schema.ts:689`), `production_inputs.quote_sku_id` (`:750`), `freight_inputs.quote_sku_id` (`:842`). No fourth table — bulk raw cost rolls up into `production_inputs.bulk_raw_cost` (`:780`)
- Type column: `quote_skus.sku_role` enum with lowercase values `'leaf'` / `'assembly'` (`:92`, `:440`)
- Parent column: `quote_skus.parent_sku_id` nullable self-FK (`:436`)

### Sub-item 5 — One-time automated cleanup pass

**Scope:** 12 known orphaned cost rows from the earlier audit query (1 quote × 1 ASY SKU × 4 tiers × 3 sections — Packaging + Production + Freight). Pattern matches stale dev/seed data from early testing before Sub-item 4's validation gate existed.

**Five-step process:**

1. **CC writes the cleanup query** — find all `quote_skus` where `sku_role = 'assembly'` AND has any joined rows in the three per-SKU section tables (`packaging_inputs` / `production_inputs` / `freight_inputs`). No `bulk_raw_inputs` table exists; bulk raw cost rides along on `production_inputs.bulk_raw_cost` and reparents transparently when the production row reparents.
2. **Dry-run output** to `docs/orphaned-cost-data-audit.md` — listing per-SKU what would be migrated:
- Affected quote ID + ASY SKU ID + ASY SKU name
- Section rows that would be reparented (count per section)
- Proposed auto-generated child leaf name (per Sub-item 3 naming convention)
- Audit action sequence that would fire
3. **Edward reviews dry-run** — spot-checks naming + line distribution; surfaces any cases that need manual handling rather than automated smart-migrate
4. **On Edward approval, CC runs cleanup** — applies Sub-item 3 smart-migrate logic on each orphaned ASY, with audit entries per row
5. **Post-cleanup re-query** — confirms zero remaining orphans; logs cleanup completion

**Failure handling:** if any individual smart-migrate transaction fails during the cleanup pass, log the failure with full context, skip that SKU, and continue. Post-pass report lists any skipped SKUs for manual disposition.

---

## 5. Pre-Approval Schema Verification Gate (Pattern 25) — COMPLETE 2026-05-14

Verification pass completed against `src/db/schema.ts` post-rest-of-app-sweep merge. Five assumptions confirmed; four mismatches surfaced + CA-dispositioned + patched inline above. Brief is schema-clear for implementation kickoff.

### 5.a — Column names on `quote_skus` ✓ ALL VERIFIED

| Brief assumption | Schema reality | Status |
|---|---|---|
| `parent_sku_id` nullable self-FK | `parent_sku_id: uuid()` references `quote_skus.id` (`schema.ts:436`) | ✓ |
| `qty_per_parent` nullable number | `qty_per_parent: numeric(10,4)` (`:441`) | ✓ |
| Type column name + enum values | `sku_role` pgEnum `["leaf", "assembly"]` (`:92`, `:440`) — **lowercase**, not "LEAF"/"ASY" | ⚠ **Mismatch 1** — patched: brief uses `sku_role` column + lowercase enum values throughout; UI display labels stay uppercase |
| `sort_order` integer NOT NULL default 0 | `sort_order: integer().notNull().default(0)` (`:430`) | ✓ |

### 5.b — Column names on section input tables ✓ VERIFIED (with corrections)

| Brief assumption | Schema reality | Status |
|---|---|---|
| `packaging_inputs.target_sku_id` | `packaging_inputs.quote_sku_id` (`:689`) | ⚠ **Mismatch 2** — patched: `target_sku_id` → `quote_sku_id` throughout |
| `production_inputs.target_sku_id` | `production_inputs.quote_sku_id` (`:750`) | ⚠ patched |
| `freight_inputs.target_sku_id` | `freight_inputs.quote_sku_id` (`:842`) | ⚠ patched |
| `bulk_raw_inputs.target_sku_id` (fourth table) | **`bulk_raw_inputs` table does NOT exist.** Bulk raw is organized as `bulk_raw_categories` (`:1186`) + `bulk_raw_ingredients` (`:1211`) — quote-level, not per-SKU. Bulk raw cost rolls up via `production_inputs.bulk_raw_cost` (`:780`) at the SKU level. | ⚠ **Mismatch 3** — patched: scope reduces to 3 per-SKU tables; bulk raw travels with production reparenting; Sub-item 4 + 5 scoped to 3 tables |
| Production rows are PM-picked | **Production rows are AUTO-CREATED per `(leaf SKU × tier)` per `schema.ts:729-746` comment + unique index `(quote_sku_id, tier_id)`.** SKU creation / assembly→leaf promotion fans out one row per existing tier. | ⚠ **Mismatch 4** — patched: Sub-item 4 split by section — Packaging + Freight = picker filter, Production = auto-create skip-on-assembly gate |

### 5.c — Audit log action keys (new) ✓ VERIFIED — free-string column

- `audit_log.action: text("action").notNull()` (`schema.ts:1055`) — free-string, NOT enum-constrained. New action keys add without schema migration.
- Banked new keys: `sku_detached_from_parent`, `sku_type_changed_assembly_to_leaf`, `sku_type_changed_leaf_to_assembly`, `sku_created_auto_for_cost_migration`, `cost_data_reparented`.

### 5.d — Transaction support ✓ VERIFIED

- Drizzle `db.transaction(async (tx) => {...})` pattern is well-established. 10+ existing call sites across `actions/users.ts`, `actions/markup-defaults.ts`, `actions/quotes.ts`.
- Rollback semantics: any thrown error inside the transaction callback rolls back the entire transaction; rollback semantics are atomic per Postgres + Supabase.

### 5.e — Observation 1: production_inputs unique-index collision in smart-migrate (CA-dispositioned)

- `production_inputs` has `uniqueIndex("production_inputs_quote_sku_id_tier_id_idx")` on `(quote_sku_id, tier_id)`.
- Sub-item 3's smart-migrate creates the new child leaf (which auto-creates `production_inputs` rows at `(newChild.id, tier.id)`) AND reparents the original `production_inputs` rows from `(original.id, tier.id)` to `(newChild.id, tier.id)`. Naive ordering hits the unique constraint.
- **CA-approved step ordering (approach a):** pre-allocate child SKU ID; reparent first; create child SKU last (auto-create no-ops because rows already exist at the target tuples). Fallback (approach b) — create child → delete auto-created rows → reparent originals — left to CC's discretion if (a) proves awkward in Drizzle.
- Sub-item 3 sequence above already reflects approach (a).

### 5.f — Observation 2: `quote_skus.hubspot_product_id` ✓ NULLABLE

- `hubspot_product_id: text("hubspot_product_id")` without `.notNull()` (`schema.ts:422`).
- §10 HubSpot integration boundary recommendation (auto-created child has NULL `hubspot_product_id`) is schema-compatible.

---

## 6. Workflow Scenarios to Test Against

CC implementation should be validated against these eight scenarios:

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | PM detaches a leaf from parent (leaf has no notes / retail bench) | Silent detach; row becomes standalone register |
| 2 | PM detaches a leaf from parent (leaf has notes + retail bench) | Confirmation modal; on confirm, data preserved on standalone leaf |
| 3 | PM toggles assembly → leaf on assembly with 0 children | Silent toggle |
| 4 | PM toggles assembly → leaf on assembly with 3 children | Modal warning; on confirm, all 3 children detach as standalone leaves; type changes |
| 5 | PM toggles leaf → assembly on leaf with no cost data | Silent toggle; empty assembly |
| 6 | PM toggles leaf → assembly on leaf with packaging + freight cost data | Modal warning; on confirm, new child `{SKU}-CMP` created; cost data (including production_inputs + its bulk_raw_cost field) reparented to new child; original becomes assembly |
| 7 | PM tries to assign an assembly as cost-input target in Cost build's packaging/freight pickers | Picker doesn't surface assemblies; if attempted via direct mutation, action-layer rejects |
| 7b | New assembly SKU is created or leaf-promoted to assembly via Sub-item 2 cascade-detach | Production auto-create loop in `actions/quotes.ts` skips this SKU; no `production_inputs` rows generated for assembly types |
| 8 | Cleanup pass dry-run reviewed by Edward; approved; cleanup runs | All 12 orphaned rows reparented to auto-created child leaves; post-pass re-query returns zero |

---

## 7. Pattern 41 Discovery Questions

All Q1-Q7 dispositions LOCKED 2026-05-14 per CA approval (all recommendations adopted). Section preserved for audit trail.

### Q1 — Auto-naming: deterministic silent vs. PM-confirmable

**Locked: A — Deterministic silent.** Modal shows the auto-name `{ORIGINAL-SKU}-CMP` as info; PM clicks confirm and the name is used as-is. Minimizes modal cognitive load; PM can always rename later via standard rename flow. The `-CMP` suffix is a clear convention signal.

### Q2 — Cleanup pass: automatic on deploy vs. manual admin trigger

**Locked: B — Manual admin trigger post-deploy.** Slice ships with Sub-items 1-4 live + Sub-item 5 dry-run committed but not executed. Edward triggers cleanup via admin action after smoke verification on production. Lower-risk; confirmed-good state before any data migration fires. Slice still ships in one merge cycle.

### Q3 — Detach affordance copy

**Locked: CC drafts; CD optional review.** Default copy:
- Drawer child-SKU list per-row action: **"✕ Detach"**
- Overflow menu item: **"Detach from {parent name}"** (renders parent name dynamically)

### Q4 — Cascade-detach data preservation messaging

**Locked: CC drafts; CD optional review.** Default copy preserved as written in Sub-item 2: *"Convert {sku} to leaf? {N} children will be detached as standalone leaves (their notes, retail bench, and data preserved)."*

### Q5 — Smart-migrate vs. PM-controlled split

**Locked: A — Single-child smart-migrate for v1.** ALL cost lines move to a single auto-created child leaf. Multi-child PM-controlled split deferred to v1.1+ if real PM workflow demands it. Avoids over-engineering; single child is the simplest mental model.

### Q6 — Warning band on existing assembly-attached cost rows

**Locked: `.warn-band` primitive** (Pattern 30 cross-surface primitive banked from §6.b Finding 18 extraction; lives in `r7b-primitives.css`). Sub-item 4's warning-band copy renders within the `.warn-band` primitive register; no ad-hoc styling.

### Q7 — Drawer empty-state copy

**Locked: "Add components to define this assembly"** (actionable third option). Gestures at next-step workflow.

---

## 8. Pattern 30 / CD Design Touch

**Recommendation: no full CD design round required.**

Reasons:
- Affordances reuse existing R7b drawer pattern + existing modal primitives (cross-surface `.modal-*` from §6.b)
- No new visual language introduced — all components are extensions of existing R7b vocabulary
- Confirmation modal copy is the only design-adjacent surface; CC can draft against existing modal-copy conventions, with optional CD copy review

**Optional CD touch-up (Edward call):**
- Confirmation modal copy + treatment for Sub-items 1, 2, 3 (three different modals; share component primitive)
- Warning band treatment on legacy assembly-attached cost rows (Sub-item 4) — Q6 locked: use the `.warn-band` primitive

If Edward chooses CD touch-up, scope is half-day max — copy review + spec confirmation on warning band. No prototype required; no Pattern 30 deliverables expected.

---

## 9. Open Items — RESOLVED 2026-05-14

All Q1-Q7 + CD design touch dispositions LOCKED per CA approval. Slice sequencing CONFIRMED between rest-of-app sweep PR (PR #26, merged) and R6.2 freight implementation. No open items blocking implementation kickoff.

**Final disposition summary:**

1. ✓ **Q1 — Auto-naming:** A (deterministic silent)
2. ✓ **Q2 — Cleanup pass delivery:** B (manual admin trigger post-deploy)
3. ✓ **Q3 — Detach affordance copy:** CC drafts ("✕ Detach" / "Detach from {parent name}"); CD optional review
4. ✓ **Q4 — Cascade-detach modal copy:** CC drafts per Sub-item 2; CD optional review
5. ✓ **Q5 — Smart-migrate:** A (single-child for v1)
6. ✓ **Q6 — Warning band:** `.warn-band` primitive
7. ✓ **Q7 — Drawer empty-state:** "Add components to define this assembly"
8. ✓ **CD design touch:** Optional copy review only (per §8 recommendation); no full design round needed; not blocking
9. ✓ **Slice sequencing:** between PR #26 merge and R6.2 freight (confirmed)
10. ✓ **§0.5 schema verification:** complete; four mismatches patched inline (Mismatches 1-4 in §5)
11. ✓ **Implementation Observation 1:** smart-migrate step ordering — approach (a) preferred, (b) fallback at CC discretion

Brief is approval-ready. Next step: Edward final sign-off → CC implementation kickoff per §11 sequencing.

---

## 10. Connections to Other Slices

**Cost build dependency:**
Sub-item 4's section assignment validation operates on the three per-SKU cost-input tables: `packaging_inputs` + `freight_inputs` (PM-picked; section-row SKU picker filters to leaf-role SKUs only) + `production_inputs` (auto-created; loop skips assembly-role SKUs when iterating quote_skus). Bulk raw cost is quote-level (`bulk_raw_categories` + `bulk_raw_ingredients`) and not per-SKU — bulk raw cost rolls up via `production_inputs.bulk_raw_cost` field at SKU level, so it travels transparently with production reparenting. Pattern 22 verification per §5 above covers the picker's source-of-truth for SKU type.

**Mark-Accepted audit trail (v1 #7):**
The new audit action keys (`sku_detached_from_parent`, `sku_type_changed_assembly_to_leaf`, `sku_type_changed_leaf_to_assembly`, `sku_created_auto_for_cost_migration`, `cost_data_reparented`) become part of the quote's audit history. Mark-Accepted external writebacks (HubSpot deal + NetSuite SO) should account for these actions when building the audit-trail payload for downstream systems — particularly the smart-migrate actions, which restructure the quote's SKU graph in non-trivial ways.

**Pricing reframe (v1 — earlier in path):**
The new auto-created child leaves from smart-migrate appear in Pricing's per-tier compliance view. If they have no margin data (zero sell price), they may surface as BELOW_FLOOR — which is correct behavior. The Pricing reframe's per-tier compliance logic handles this naturally; no additional integration needed.

**HubSpot integration boundary:**
leaf SKUs are HubSpot-backed products with `hubspot_product_id`. assembly SKUs are Nexus-local with `hubspot_product_id = NULL`. Sub-item 3's smart-migrate creates a NEW LEAF SKU — does the auto-created child get pushed to HubSpot as a real product?

Recommend: NO HubSpot push on auto-created child. The auto-child is a Nexus-local structural artifact that holds inherited cost data; it doesn't represent a real catalog product. The original SKU stays in HubSpot as the catalog reference; the auto-child is an internal Nexus concept. Pattern 22 schema verification should confirm `hubspot_product_id` is nullable on `quote_skus` (it is, per current understanding, since assembly SKUs already use NULL).

---

## 11. Sequencing Within the Slice

Recommended commit order for CC implementation (schema verification + product dispositions already complete; pick up from step 1):

1. **Sub-item 4 first** — leaf-only validation: packaging/freight picker filter + action-layer `sku_role !== 'leaf'` rejection; production auto-create skip-on-assembly gate. Lowest risk; prevents new orphaned rows from being created during the rest of the implementation.
2. **Sub-item 1** — `detachLeafFromParent` action + dual entry points (drawer child-row Detach + leaf's overflow-menu "Detach from {parent name}")
3. **Sub-item 2** — `convertAssemblyToLeaf` cascade-detach with atomic transaction; modal warning when children present
4. **Sub-item 3** — `convertLeafToAssembly` smart-migrate with auto-create child (approach a step ordering preferred; approach b fallback at CC discretion)
5. **Sub-item 5** — cleanup-pass dry-run script + output to `docs/orphaned-cost-data-audit.md`; cleanup execution deferred until Edward approves post-deploy (per Q2 disposition)
6. **Smoke + verification** — all eight Section 6 scenarios pass
7. **PR opens for Edward smoke pass**

Total estimated CC effort: 1-1.5 days for implementation + smoke; cleanup-pass dry-run review cycle with Edward adds ~half-day wall-clock (post-deploy).

---

*Brief authored by CA, schema-verified + product-dispositioned by CC + CA 2026-05-14. All mismatches patched inline; Q1-Q7 locked; CD design touch optional. Ready for Edward final approval before CC implementation kickoff per §11 sequencing.*
