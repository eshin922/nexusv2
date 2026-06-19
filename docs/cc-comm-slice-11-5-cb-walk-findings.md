# CC Comm — Slice 11.5 CB Walk Findings (MIG-4/5/6/8 Investigations)

**Driver:** CA comm 2026-06-18 — MIG-4/5/6 cannot-verify +
MIG-8 realtime FAIL. CC investigated each independently.
**Status:** All four resolved. None block Slice 11.5 close.
MIG-8 + MIG-4/5/6 cleanup absorbed into Slice 11.5.1 brief v2
(A2 + A3 amendments).
**Date:** 2026-06-18

This file is a historical investigation artifact. The
disposition lives in the canonical Slice 11.5.1 brief
(`docs/cc-comm-slice-11-5-1-brief.md`) + the v2 amendments
changelog (`docs/cc-comm-slice-11-5-1-brief-v2-amendments.md`).

---

## MIG-8 — Realtime FAIL (CONFIRMED; fold into Slice 11.5.1)

### Investigation

`src/components/costing-store-provider.tsx` and
`drizzle/manual/0001_supabase_realtime_publication.sql` both
hold the Slice 8.5 realtime wiring.

**Current subscription targets (`costing-store-provider.tsx`
lines 247-336):**

- `quotes` ✓ (still valid post-Slice 11.5)
- `quote_skus` ✗ **OLD** — should be `assemblies` +
  `assembly_leaves`
- `quote_tiers` ✓ (still valid)
- `packaging_inputs` ✗ **OLD** — should be `assembly_leaf_inputs`
- `production_inputs` ✗ **OLD** — should be
  `assembly_production_inputs`
- `freight_leg_groups` / `freight_legs` / `freight_leg_tiers` /
  `freight_customer_arranges_meta` ✓ (model-agnostic)

**Missing in OLD AND NEW:** the override + target tables
(`quote_sku_tiers` / `quote_sku_tier_targets` OLD,
`assembly_leaf_overrides` / `assembly_leaf_targets` NEW) were
never wired to realtime. Per-cell override + target edits don't
propagate cross-tab today; they get refreshed via the quotes-
table updated_at coalesce.

**Publication membership (`drizzle/manual/0001_supabase_realtime_publication.sql`):**
- Currently includes OLD tables: `quote_skus`,
  `packaging_inputs`, `production_inputs`, `freight_inputs`
  (already dropped R6.2), `quote_tiers`, `quotes`,
  `firm_settings`, `markup_defaults`
- Missing NEW tables: `assemblies`, `assembly_leaves`,
  `assembly_leaf_inputs`, `assembly_production_inputs`,
  `assembly_leaf_overrides`, `assembly_leaf_targets`,
  `quote_leaves`

### Disposition — fold into Slice 11.5.1 §A2

Per CA disposition: this is the same architectural axis as
Slice 11.5.1's existing scope (5-file migration + table drops).
Slice 11.5.1 brief v2 §A2 absorbs realtime extension.

See canonical brief §2 + §4 (Step 4) for the full migration
spec, cutover sequencing, and bonus catch (per-cell override +
client-target realtime subscriptions come online for the first
time).

---

## MIG-4 — Sell-price override CANNOT VERIFY

### Investigation

Grep `RequiredSellCell\b\|<RequiredSellCell` across src/:

```
src/components/required-sell-cell.tsx  (self-reference only)
```

**Zero active imports.** The component is **orphan-on-disk** —
exists in src/, was wired by Slice 11.5 Step 4 to call
`updateAssemblyLeafOverride`, but is not rendered by any active
page.

### Root cause

PR #54 era PSR (Pricing Surface Redesign) shipped a different
shape: `src/components/pricing-surface/` (state-zone, action-
zone, detail-zone, pricing-surface-shell). PSR is a READ-ONLY
display surface — surfaces existing override state (OVR chip
in `detail-zone.tsx:278`) but does NOT provide an inline cell-
click input affordance.

The OLD per-cell `RequiredSellCell` component was orphaned at
the PSR redesign. PR #54 moved the override-set workflow into
the action-zone (classifier-driven `request_override` action
button) and removed inline cell editing.

### Disposition — NOT a Slice 11.5 regression

The orphan state predates Slice 11.5. PR #54 (predates Slice
11.5) shipped PSR + left `RequiredSellCell` orphaned. Slice
11.5 Step 4 wired the orphan component's action call to NEW
`updateAssemblyLeafOverride` for forward-compatibility, but
the component was never on the user-facing page.

**Folded into Slice 11.5.1 §A3** as Step 3 orphan delete scope.

**Open question deferred:** did PSR move the override
affordance to action-zone (Hypothesis A) or remove it without
replacement (Hypothesis B)? Banked for Slice 11 audit pre-brief
inventory; verification runs in parallel during Slice 11.5.1
work.

---

## MIG-5 — Client target benchmark CANNOT VERIFY

### Investigation

Grep `ClientTargetCell\b\|<ClientTargetCell` across src/:

```
src/components/pricing/client-target-cell.tsx  (self-reference only)
```

**Zero active imports.** Same Hypothesis B pattern as MIG-4.
The component is orphan-on-disk; wired by Slice 11.5 Step 4 to
call `updateAssemblyLeafTarget` for forward-compat; not
rendered.

### Root cause

Same as MIG-4: PSR redesign moved the client-target workflow
out of inline cell editing. The PSR detail-zone displays
existing targets (`client_target_unit` flag at
`detail-zone.tsx:494`) and OVER_CLIENT_TARGET states
(`detail-zone.tsx:503`), but doesn't provide an inline input.

The `ReverseSolveDialog` (still imported by orphan
`client-target-cell.tsx`) is the workflow modal that wraps
client-target entry + reverse-solve. In PSR architecture, this
likely fires from the action-zone or a detail-zone affordance,
NOT from inline cell click.

### Disposition — NOT a Slice 11.5 regression

Same disposition as MIG-4: orphan state predates Slice 11.5.
**Folded into Slice 11.5.1 §A3** alongside
`required-sell-cell.tsx` + (conditional)
`reverse-solve-dialog.tsx` deletes.

---

## MIG-6 — Multi-tier active-tier switching

### Investigation

Grep `ActiveTierSelector\b\|<ActiveTierSelector` across src/:

```
src/components/costs/cost-stack-header.tsx  (Costs page — active)
src/components/pricing/active-tier-selector.tsx  (self-reference)
```

`ActiveTierSelector` IS rendered, but only on the Costs
surface (cost-stack-header). The PSR pricing surface shell
(`pricing-surface-shell.tsx`) does NOT import it.

Pricing surface tier handling: `ActiveTierUrlSync` (sibling
component) handles URL ↔ store sync for tier selection, but
provides NO visible UI — just bi-directional URL sync.

### CB walker resolution

CB walker located the tier-switching affordance on Pricing
surface: detail-zone tier column cards with `role="tab"` and
`aria-label="Select XK as active tier"`. The blue left-border
on the active column is the visual indicator. URL sync
functional; ARIA-correct.

**MIG-6 PASS ✓.** Banked as UX discoverability concern for
Slice 11 audit (affordance is subtle — blue left-border vs.
explicit chip), not a Slice 11.5.1 fix.

### Disposition — preserve component

`active-tier-selector.tsx` is preserved in Slice 11.5.1 §A3
(NOT in orphan delete scope) because Costs surface still
imports it. Pricing surface uses different mechanism (column
cards in detail-zone).

---

## Summary table

| MIG | Class | Slice 11.5 regression? | Disposition |
|---|---|---|---|
| MIG-1 vanilla render | Path B resmoke | No | Path B PR #75 (max:3) + Path A pool_size 40 |
| MIG-2 packaging edit | Path B resmoke | No | Path B PR #75 + Path A pool_size 40 |
| MIG-3 production edit | Path B resmoke | No | Path B PR #75 + Path A pool_size 40 |
| MIG-4 sell-price override | Walk vocabulary / orphan | **No** | PR #54 PSR artifact; Slice 11.5.1 §A3 orphan delete |
| MIG-5 client target | Walk vocabulary / orphan | **No** | PR #54 PSR artifact; Slice 11.5.1 §A3 orphan delete |
| MIG-6 tier switching | Found post-CB-walk | **No** | Column cards `role="tab"`; UX discoverability bank for Slice 11 audit |
| MIG-7 Mark-Accepted | PASS ✓ | No | clean |
| **MIG-8 realtime** | **Real catch** | **Yes (incomplete migration)** | **Folded into Slice 11.5.1 §A2** |
| MIG-9 NULL-safe | PASS ✓ | No | clean |

### What this means for Slice 11.5 close gate

**No Slice 11.5 close blockers** beyond Path B (shipped via PR
#75) + Path A (Edward Supabase pool_size 15 → 40). Both landed
2026-06-18.

MIG-4/5/6 are walk-spec / UX-discoverability concerns from PSR
redesign, NOT Slice 11.5 regressions. Banked for Slice 11
audit or 11.5.1 orphan cleanup.

MIG-8 is a real incomplete-migration catch. Architecturally
the same axis as 11.5.1's existing scope; folded into 11.5.1
brief v2 §A2.

**Close gate cleared.** Slice 11.5 closed 2026-06-18 PM.

---

## Slice 11.5.1 brief v2 amendments (delta vs prior C1-C4 + A1)

In addition to CA's original C1-C4 + A1, CB walk findings drove
three more amendments:

### A2 — MIG-8 realtime extension

Step 5 (subsequently renumbered Step 4 in canonical brief):
- Drizzle manual SQL
  `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql`:
  - `ALTER PUBLICATION supabase_realtime DROP TABLE` OLD tables
    (sequenced AFTER Step 1 schema drops via separate apply)
  - `ALTER PUBLICATION supabase_realtime ADD TABLE` NEW
    cost-data tables + the override + target tables
- `src/components/costing-store-provider.tsx` subscription
  targets updated to NEW table names. Per-quote filter logic
  preserved.
- Cutover sequencing: publication ADD NEW first → code merge →
  publication DROP OLD → drizzle DROP OLD tables.

### A3 — Orphan-on-disk PSR cleanup

Step 3 expansion (orphan delete scope):
- `src/components/required-sell-cell.tsx` (orphan since PSR;
  Slice 11.5 Step 4 wired NEW action calls; never rendered)
- `src/components/pricing/client-target-cell.tsx` (same)
- `src/components/pricing/reverse-solve-dialog.tsx` (audit;
  delete if only consumer was the orphan client-target-cell)

Preserve: `active-tier-selector.tsx` (Costs-surface consumer).

### A4 — CB walk spec update

Bank for comprehensive CB test suite work (v1 release-path
item 13). Captures:
- State-prep steps for state-gated affordances (force
  classifier mode for MIG-4 walk)
- Affordance location specifications (PSR detail-zone tier
  column cards for MIG-6; action-zone for MIG-4/5 workflows)
- Pre-walk connection-budget verification (avoid wasting CB
  time on infrastructure issues)

---

**§0.5 ledger:** +1 catch for the realtime omission.

> When migrating tables, audit ALL consumers — not just queries
> but realtime subscriptions, publication membership, background
> jobs, audit projections, anything referencing the table schema.

Cumulative: 69 → 70 across 15 slices (post-Slice 11.5 close).

(MIG-4/5/6 are NOT §0.5 catches — they're pre-existing PR #54
PSR discoverability artifacts, not architectural mismatches
Slice 11.5 introduced.)
