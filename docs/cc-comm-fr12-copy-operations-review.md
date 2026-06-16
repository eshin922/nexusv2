# FR-12 copy operations slice · CC review

**Brief:** `docs/cc-comm-fr12-copy-operations-brief.md` (CA draft,
2026-06-15).
**Branch (when kicked):** `slice-fr12-copy-operations`.
**Status:** Brief draft. CC review per Pattern 22 §0.5 standing
protocol — verification pass against current code architecture
before Edward + CA approve.
**Date:** 2026-06-15.

---

## §1 — Verdict

Brief's INTENT is sound — activate the disabled copy radios CSF
left visible-disabled; enforce FR-12 field bucket semantics;
persist `copied_from_quote_id` for lineage.

**Two load-bearing schema-architecture mismatches block approval
as-written:**

1. **Cost-input cloneable graph anchored to legacy `quote_skus`
   chain** (Catch #4) — `packaging_inputs`, `production_inputs`
   reference dead schema for v1 ASY/LEAF quotes. Brief plans to
   clone tables that produce no rows on new quotes.

2. **`freight_inputs` table doesn't exist** (Catch #5) — replaced
   by `freight_leg_groups` + `freight_legs` + `customs` JSONB in
   R6.2.

These two flip the Cloneable bucket scope. Re-anchoring the brief
to the ASY/LEAF + freight_legs model is mandatory before Step 1
opens.

Other catches are notation fixes + open questions. Brief is
approvable after a re-write of the Cloneable bucket section + 4
open question dispositions.

---

## §2 — Pattern 22 §0.5 verification ledger

Seven catches dispositioned below.

### Catch #1 — `copied_from_quote_id` already exists [NOTATION]

Brief §"Schema additions · Migration 1" plans:
```sql
alter table quotes add column copied_from_quote_id uuid ...
```

**Verified:** `schema.ts:294` already declares
`copiedFromQuoteId: uuid("copied_from_quote_id")`. Self-FK
declared at `schema.ts:410-414` with `onDelete: "set null"`.

What's MISSING: the partial index `quotes_copied_from_idx`
proposed in the brief.

**Disposition (CC lean):** drop Migration 1 entirely. The index
isn't load-bearing at v1 scale (~12 PMs; lineage lookup is rare;
sequential scan over a few hundred quotes is fine). Bank the
index as a v1.1+ candidate if lineage query patterns surface.

### Catch #2 — `scenario_status` enum has 3 values, not 4 [NOTATION]

Brief's `loadScenarioCopyPicker` return type references:
```ts
scenarioStatus: 'active' | 'dropped' | 'accepted' | 'archived';
```

**Verified:** `schema.ts:49-53` declares the enum:
```ts
pgEnum("scenario_status", ["active", "dropped", "accepted"])
```

NO `archived` value.

**Disposition (CC lean):** drop `'archived'` from the picker
type signature. Brief's "Within-project source filter" already
banks archived to v1.1+ via the deferred "Show archived" toggle,
so removing it from the type matches the bank.

### Catch #3 — `scenario_drop_reason` already has `superseded_by_copy` [CONFIRMATION]

Brief notes Migration 2 "verify" — and dispositions correctly
("already exists. No migration needed").

**Verified:** `schema.ts:138-144`:
```ts
pgEnum("scenario_drop_reason", [
  "superseded_by_copy", "draft_at_accept", "accept_sibling",
  "manual", "other",
]);
```

`superseded_by_copy` confirmed. No catch; brief's lean is
correct.

### Catch #4 — Cost-input clone graph references legacy quote_skus chain [BLOCKER · ARCHITECTURAL]

Brief's Cloneable bucket lists:
- "All `packaging_inputs` rows (supplier, unit_cost, markup,
  markup_pct_source, category, qty_per_sellable_unit,
  inventory_eligible, notes)"
- "All `production_inputs` (CM fees, setup, tooling, R&D,
  allocate_service_fees, policy fields)"

**Verified:** `packagingInputs.quoteSkuId` (`schema.ts:733`) and
`productionInputs.quoteSkuId` (`schema.ts:794`) BOTH reference
`quoteSkus.id` — the **LEGACY `quote_skus` tree** chain.

The canonical-scenario-create-flow Step 3 comment at
`src/app/projects/[id]/quotes/[quoteId]/page.tsx:252-256`
confirms:

> Every quote routes to the new ASY/LEAF tree; loadAssemblyTree
> always returns non-null (empty tree on zero-assembly state...).
> The legacy quote_skus render path is removed in this slice.

For new v1 quotes (every quote post-CSF merge): `quote_skus` is
empty → `packaging_inputs` is empty → `production_inputs` is
empty. Cloning these tables on copy produces zero rows. The
brief's Cloneable bucket for cost inputs is anchored to dead
schema.

**Per-component cost data for v1's ASY/LEAF model:**

- **Per-ASY commercial fields:** `assemblies` table carries
  `sku`, `name`, `unit_price`, `unit_cost`, `margin_pct`,
  `markup_pct`, `internal_notes`, etc. directly
  (`schema.ts:1624-1655`).
- **Per-LEAF cost:** `leaves.unit_cost` (library-global; not
  cloned per brief's own §"Investigation ask 1"; ✓ correct).
- **Per-tier price adjustment:** `quote_tiers.tier_price_adj_pct`
  (numeric(5,4)). Verified earlier in CLAUDE.md ("Pricing reframe
  carried-forward speculative columns" note).
- **Per-quote global adjustments:** `quotes.global_price_adj_pct`,
  `quotes.target_margin_pct`.
- **Per-cell sell-price override:** `quote_sku_tiers` row
  (sparse). Brief doesn't address — does copy clone these?

**Spec-value cloneability:** brief acknowledges leaves carry
their spec_values via library reference. Confirmed —
`leaf_specs` are versioned and pinned to the quote at SEND time
(not at draft-copy time), so a draft copy just resolves the
current is_current spec for each leaf. No `leaf_specs` clone
needed at copy time.

**Disposition (CC lean):** Cloneable bucket section needs full
re-write before Step 1. Anchor to ASY/LEAF tables:

| Bucket | Tables (v1 ASY/LEAF) |
|---|---|
| Cloneable | `assemblies` (new IDs, same commercial fields per ASY) · `assembly_leaves` junctions (new IDs, same `leaf_id` references — library leaves NOT cloned) · `quote_tiers` (label + sort_order; qty RESET) · per-cell `quote_sku_tiers` (TBD per Q10) · `quotes.global_price_adj_pct` · `quotes.target_margin_pct` · `quotes.scenario_label` (overridden by PM input) |
| Inherited from TARGET project | `project_id`, `hubspot_deal_id`, `deal_name`, `client_name`, `sales_rep_user_id`, `pm_user_id` |
| Reset | `id`, `version_number = 1`, `status = 'draft'`, `accepted_at`, `sent_at`, `pdf_url`, `hubspot_quote_id`, `customer_facing_notes`, `internal_notes`, `valid_until`, `retail_benchmark`, all `quote_tiers.qty`, `scenario_status = 'active'`, `copied_from_quote_id = source.id` |

Legacy `quote_skus` / `packaging_inputs` / `production_inputs`
cloning DROPPED from scope — those rows are orphaned for v1
quotes and produce zero rows on clone (Pattern 32 tolerance).

### Catch #5 — `freight_inputs` table doesn't exist [BLOCKER · ARCHITECTURAL]

Brief Cloneable bucket: "`freight_inputs` POLICY fields only:
`freight_mode`, `freight_treatment`, `markup_pct`."

Brief Reset bucket: "All `freight_inputs` SHIPMENT-specific
fields: `total_freight`, `shipment_id`, `units_in_shipment`."

**Verified:** `schema.ts:845-850` comment:

> Slice R6.2 replaces the Slice 7 flat `freight_inputs` table
> with a [leg-based structure] … migration by dropping the
> legacy `freight_inputs` table …

`freight_inputs` no longer exists. Current freight schema:
- `freight_leg_groups` — per-quote-sku grouping
- `freight_legs` — multi-leg shipping route (direction, mode,
  carrier, incoterm, treatment, markup pcts, customs JSONB)
- `freight_inputs` table dropped in R6.2

**Disposition (CC lean):** re-write freight clone scope around
`freight_leg_groups` + `freight_legs`. Bucket split:

| Bucket | freight_* fields |
|---|---|
| Cloneable | `freight_leg_groups` shells (new IDs) · `freight_legs` POLICY columns: `direction`, `label`, `mode`, `carrier`, `incoterm`, `treatment`, `freight_markup_pct`, `duty_markup_pct`, `tariff_markup_pct`, `crosses_international_border`, `display_order` · `customs` JSONB (per-leg duty/tariff rates — policy, not shipment) |
| Reset | `cargo_ready_date`, `vessel_etd`, `vessel_eta`, `actual_delivery_date` (these are shipment-specific dates for the source quote's actual shipments) |

Note: `freight_legs` are scoped via `legGroupId` → `freightLegGroups`
→ quote_skus (legacy). For v1 ASY/LEAF, `freight_leg_groups` may
be quote-keyed (or quote_sku-keyed but dead). CC verifies during
Step 1 the linkage path and whether freight legs are usable
under ASY/LEAF.

### Catch #6 — Permission gate posture misaligned with brief Q3 [NOTATION]

Brief Q3 asks "reuse `can_create_leaves` OR new permission?" CA
lean reuse.

**Verified:** `src/app/actions/quotes.ts` uses `ensureUser()`
across all 10+ action sites. NO permission check beyond basic
authentication. Scenario / quote creation today is open to any
signed-in user.

**Disposition (CC lean):** copy paths stay ungated like
create-from-scratch (zero permission gate). Don't introduce
`can_create_scenarios` for v1; keep the create surface
consistent with scratch path. v1.1+ can add a per-role gate if
PMs request (e.g., gated by `users.role = 'admin'`). Brief Q3
re-anchors as "no gate" instead of "which gate."

### Catch #7 — CSF modal copy radios already in place [CONFIRMATION]

Brief plans to "remove the inline warning banner. Enable both
radios + form fields below."

**Verified:** `src/components/scenario-create/canonical-modal.tsx:271-298`
already renders the two copy radios + a `var(--warn-soft)` banner
with copy:

> ⏳ Copy operations ship in the next slice. For now, create
> from scratch and re-enter data manually.

`copyPathSelected` state (line 284+) gates the rest of the form
fields. Brief's plan to flip the gates + replace the banner with
source pickers is correct. No catch; this is confirmation.

---

## §3 — Open questions (CC additions to brief Q1-Q4)

### Q5 — Per-cell `quote_sku_tiers` clone? (from Catch #4)

The sparse `quote_sku_tiers` table holds per-cell sell-price
overrides + per-cell client-target prices (per the CLAUDE.md
"Three nullable columns sit in the schema" entry). These are
PM-entered cells that customize per (SKU, tier).

But — `quote_sku_tiers.quote_sku_id` references the LEGACY
`quote_skus` chain (verify). If so, same Catch #4 problem:
empty for v1 ASY/LEAF quotes.

**CC lean:** verify the FK; if legacy, drop from clone scope.
If ASY/LEAF-aware (e.g., quote_sku_tiers references leaves or
assemblies directly), include in Cloneable bucket per "sell-
price negotiation continuity from source to target" semantic.

### Q6 — Copy from accepted scenarios? (brief Q2)

Brief Q2 CA lean YES; CC concur. Verified: no schema gate
prevents reading from `scenarioStatus = 'accepted'`. The picker
can include accepted scenarios as valid templates per the Beija
Flor reorder use case (SPEC v1 success criterion).

### Q7 — Cross-project legacy quote filter (Pattern 32 tolerance)

Pre-CSF dev quotes may exist in legacy `quote_skus` state without
ASY/LEAF tree rows. Cross-project picker surfaces all
non-archived quotes — but copying from a legacy quote would
produce an empty target (no assemblies/assembly_leaves to clone).

**CC lean:** filter picker to ASY/LEAF-tree-having quotes only:
```sql
EXISTS (SELECT 1 FROM assemblies WHERE quote_id = quotes.id)
```

Excludes legacy quote_skus-only quotes from picker scope. Pattern
32 tolerance — dev data tolerance for an exposing feature
(cross-project picker) that didn't exist when those quotes were
created.

### Q8 — Cross-project picker chrome (brief Q1 reframe)

Brief Q1 — two-pane vs simpler search. CC concur with CA lean
**simpler search + scenario dropdown**. Two-pane stays v1.1+ if
PMs request richer selection chrome.

Search dimensions: project name + client name. SKU label search
per FR-12 spec — defer to v1.1+ (requires `quote_skus` or
`assemblies.sku` subquery; adds picker query weight; not
critical for first ship).

### Q9 — Loader names

Brief proposes `loadScenarioCopyPicker` + `loadCrossProjectCopyPicker`.

CC lean: rename `loadCrossProjectCopyPicker` → `loadCopySourceProjects`
(reads from PM-facing intent). The within-project loader name
is fine.

### Q10 — Audit namespace for copy + dropped pair

Brief proposes two new audit actions:
- `scenario_copied_within_project`
- `quote_copied_from_project`

Plus `scenario_dropped.diff_json.source = 'fr12_copy_supersede'`
extension for drop-on-copy path.

CC lean: rename:
- `scenario_copied_within_project` → `scenario_copied` (simpler;
  diff_json carries source_project_id + target_project_id which
  surface intra vs inter project naturally)
- OR keep separate action names for forensic filterability

CC + CA reconcile at kickoff. Pattern is well-precedented per
Slice 9.2 source-namespace convention.

### Q11 — Default scenario label on copy (brief Q4 reframe)

Brief Q4 — "Alt N" continues across all paths, OR copy default
to "{sourceScenarioLabel} (copy)"?

CC concur with CA lean **keep "Alt N"** consistent with scratch
path. PMs typically rename anyway; the source-quote lineage is
already captured in `copied_from_quote_id` + audit log. Adding
"(copy)" suffix on the label adds visual noise without
information gain.

---

## §4 — Step plan refinement

Brief's 8-step plan stays structurally sound after Catches 4+5
re-anchor the Cloneable graph. Adjusted:

1. ✅ **Step 1** — Kickoff + Pattern 22 §0.5 verification + Q1-Q11
   dispositions + ASY/LEAF cloneable graph re-anchor (this doc
   sets the foundation; Step 1 commits the kickoff doc)
2. **Step 2** — Audit namespace doc updates (CLAUDE.md) +
   `scenario_copied` + `quote_copied_from_project` entries; NO
   schema migration (Catches 1+3 — column + enum already exist)
3. **Step 3** — `copyScenarioWithinProject` action with ASY/LEAF-
   aware transactional clone of assemblies + assembly_leaves +
   quote_tiers (qty reset) + per-cell quote_sku_tiers (per Q5
   verification) + freight_leg_groups + freight_legs (policy
   columns + customs JSONB)
4. **Step 4** — `copyQuoteFromProject` action (cross-project
   variant) reuses Step 3's transactional clone helper +
   project context swap
5. **Step 5** — `loadScenarioCopyPicker` (within-project) +
   `loadCopySourceProjects` (cross-project, Q9 renamed) with
   ASY/LEAF-tree-having filter (Q7)
6. **Step 6** — CSF modal — flip the `copyPathSelected` gates +
   replace warning banner with within-project picker UI
7. **Step 7** — CSF modal — cross-project picker UI (search +
   scenario dropdown per Q8)
8. **Step 8** — Smoke guide FR12-1..FR12-8 + cumulative Pattern
   27 fold + §0.5 ledger

No structural changes vs brief's plan. Step 2's schema migration
removed; replaced by namespace-doc-only changes since column +
enum already exist.

---

## §5 — Pre-merge gates

Same shape as prior slices:

- [ ] Typecheck PASS every commit
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (this review; no
      further schema checks expected)
- [ ] Pattern 27 two-layer manifest per commit
- [ ] Pattern 45 customer-view boundary clean (no PDF tree
      impact)
- [ ] CB end-of-phase smoke walk (merge gate)

---

## §6 — Carry-forwards (banked)

Concur with brief §"Carry-forwards" verbatim. Plus from this
review:

- **`quotes_copied_from_idx` partial index** — bank as v1.1+ if
  lineage query patterns surface (per Catch #1)
- **Per-cell `quote_sku_tiers` clone if legacy-anchored** —
  defer to v1.1+ once ASY/LEAF per-cell override architecture
  lands (Q5 may surface this)
- **Cross-project picker SKU-label search** — v1.1+ per Q8
- **`can_create_scenarios` permission gate** — v1.1+ if PM
  workflow requires per-role isolation (per Catch #6)
- **Lineage indicator chip** — banked by brief; v1.1+
- **Field bucket preview disclosure** — banked by brief; v1.1+

---

## §7 — Sequencing

CC concur with brief's slot in v1 critical path: queued after
library-modal-polish merge (PR #52 done). FR-12 → Pricing
reframe v1 → Slice 12 → cleanup → MS OAuth → SPEC audit →
review → v1.

**Prereq verification:** none beyond the schema state captured
above. No predecessor migrations need to land first.

---

## §8 — Acceptance

**Brief is approvable** pending:

1. Catches #4 + #5 Cloneable-graph re-write to anchor on ASY/LEAF
   + freight_legs (CA to draft inline; CC review)
2. Catch #6 permission gate dispositioned (CC lean: no gate v1)
3. Q5-Q11 dispositioned (CC leans surfaced; Edward + CA lock)

Step 1 kicks off after the Cloneable bucket re-write lands in
the brief.

— CC, 2026-06-15
