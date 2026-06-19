# CC Comm — Slice 11.5 CB Walk Findings (MIG-4/5/6/8 Investigations)

**Driver:** CA comm 2026-06-18 — MIG-4/5/6 cannot-verify + MIG-8 realtime FAIL. CC investigated each independently.
**Status:** All four resolved. None block Slice 11.5 close.
**Date:** 2026-06-18

---

## MIG-8 — Realtime FAIL (CONFIRMED; fold into Slice 11.5.1)

### Investigation

`src/components/costing-store-provider.tsx` and
`drizzle/manual/0001_supabase_realtime_publication.sql` both
hold the Slice 8.5 realtime wiring.

**Current subscription targets (`costing-store-provider.tsx`
lines 247-336):**
- `quotes` ✓ (still valid post-Slice 11.5)
- `quote_skus` ✗ **OLD** — should be `assemblies` + `assembly_leaves`
- `quote_tiers` ✓ (still valid)
- `packaging_inputs` ✗ **OLD** — should be `assembly_leaf_inputs`
- `production_inputs` ✗ **OLD** — should be `assembly_production_inputs`
- `freight_leg_groups` / `freight_legs` / `freight_leg_tiers` /
  `freight_customer_arranges_meta` ✓ (model-agnostic)

**Missing in OLD AND NEW:** the override + target tables
(`quote_sku_tiers` / `quote_sku_tier_targets` OLD,
`assembly_leaf_overrides` / `assembly_leaf_targets` NEW) were
never wired to realtime. Per-cell override + target edits don't
propagate cross-tab today; they get refreshed via the quotes-
table updated_at coalesce.

**Publication membership (`drizzle/manual/0001_supabase_realtime_publication.sql`):**
- Currently includes OLD tables: `quote_skus`, `packaging_inputs`,
  `production_inputs`, `freight_inputs` (already dropped R6.2),
  `quote_tiers`, `quotes`, `firm_settings`, `markup_defaults`
- Missing NEW tables: `assemblies`, `assembly_leaves`,
  `assembly_leaf_inputs`, `assembly_production_inputs`,
  `assembly_leaf_overrides`, `assembly_leaf_targets`,
  `quote_leaves`

### Disposition — fold into Slice 11.5.1

Per CA disposition: this is the same architectural axis as
Slice 11.5.1's existing scope (5-file migration + table drops).
Slice 11.5.1 brief v2 absorbs realtime extension.

**Scope addition:**

**Step 5 (new): Realtime subscription + publication migration**
- Drizzle manual SQL: new file
  `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql`
  - `ALTER PUBLICATION supabase_realtime DROP TABLE` for OLD
    tables (quote_skus, packaging_inputs, production_inputs)
    — sequenced AFTER subscribers stop using them
  - `ALTER PUBLICATION supabase_realtime ADD TABLE` for NEW
    tables (assemblies, assembly_leaves, assembly_leaf_inputs,
    assembly_production_inputs, assembly_leaf_overrides,
    assembly_leaf_targets, quote_leaves)
- `src/components/costing-store-provider.tsx`: subscription
  targets updated to NEW table names. Filter logic preserved
  (client-side filter by quote membership stays the same shape;
  just routes through new event payloads).
- **Bonus catch fixed alongside:** add subscriptions for
  `assembly_leaf_overrides` + `assembly_leaf_targets` — the
  per-cell override + target edits gain cross-tab propagation
  for the first time. Slice 8.5 originally omitted these
  because they were sparse-row tables with no realtime
  consumer; Slice 11.5.1 brings them online.

**Cutover sequencing (critical):**

The publication and subscription changes must be coordinated
because they're cross-deploy boundaries:

1. **Pre-merge:** publication ADD NEW tables (idempotent; no
   consumer yet). Verify dev + prod publications both include
   NEW table names.
2. **Merge + deploy:** code change updates subscriber to NEW
   tables. Brief gap when prod app has merged but PMs haven't
   refreshed (their loaded clients still subscribe to OLD
   tables). This gap is benign — OLD tables aren't written
   anymore post-Slice-11.5 Step 4, so missing OLD subscription
   events doesn't lose data. NEW table writes go through fine
   on next page load.
3. **Post-merge:** publication DROP OLD tables — sequenced
   AFTER Step 1's table drops (you can't `DROP TABLE` while it's
   in a publication).

The Step 1 schema-drop migration may need to coordinate with
publication DROP: drizzle migrations can't include `ALTER
PUBLICATION` (manual SQL only). Sequence in Step 5 SQL file:
- (a) `ALTER PUBLICATION supabase_realtime DROP TABLE OLD;`
- (b) drizzle migration runs `DROP TABLE OLD`
- (c) Verify clean

**§0.5 catch:** "when migrating tables, audit all consumers —
not just queries but realtime subscriptions, publication
membership, background jobs, audit projections." Banked in
brief v2 amendments + future Pattern 22 §0.5 extension.

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

**Walk spec disposition:** MIG-4 walk spec written against
pre-PSR vocabulary (inline cell click). PSR's actual override
workflow is via the action-zone's `request_override` action
button — surface in SUGGESTION-LED or BLOCKED classifier
modes. PSR action-zone is the correct affordance.

**CB re-walk per updated spec:** force sample order into
SUGGESTION-LED mode (override one cell to drive blended below
target), open Pricing surface, observe action-zone's primary
action button. Click `request_override` → workflow opens.

If the action-zone affordance works → MIG-4 PASS with caveat
(walk spec was wrong vocabulary; not a Slice 11.5 issue).

If the action-zone affordance is broken → that's a PSR
regression independent of Slice 11.5; bank for Slice 11 audit.

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

Same disposition as MIG-4: orphan state predates Slice 11.5;
walk spec written against pre-PSR vocabulary.

**CB re-walk per updated spec:** explore PSR action-zone +
detail-zone for client target affordance. If none visible,
that's a PSR coverage gap independent of Slice 11.5.

**Slice 11.5.1 cleanup:** delete the two orphan components
(`required-sell-cell.tsx` + `client-target-cell.tsx`) plus
`reverse-solve-dialog.tsx` if it's also orphan, alongside the
other cleanup work. Confirms orphan removal pattern from Step 8.

---

## MIG-6 — Multi-tier active-tier switching CANNOT VERIFY

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

### Root cause

Same pattern as MIG-4/5. PSR redesign refactored the tier-
switching interaction. Tier selection on PSR may be:
- URL-driven only (paste URL with `?tier=...`)
- A header rail / toolbar control I haven't found
- Inside detail-zone's per-tier compliance table (column
  headers might be clickable)
- Via the action-zone's surgical-tier-adjust action

Without a CB walk to confirm, the actual PSR tier-switching
affordance location isn't pin-down-able from code alone.

### Disposition — NOT a Slice 11.5 regression

Same conclusion: pre-existing PSR architecture; Slice 11.5
didn't touch the tier-switching UI.

**CB re-walk per updated spec:** explore PSR surface for tier
selection control. Check detail-zone tier table headers (most
likely candidate). If none found, bank for Slice 11 audit as
UX discoverability concern.

---

## Summary table

| MIG | Class | Slice 11.5 regression? | Disposition |
|---|---|---|---|
| MIG-1 vanilla render | Path B resmoke pending | No | Path B fixes |
| MIG-2 packaging edit | Path B resmoke pending | No | Path B fixes |
| MIG-3 production edit | Path B resmoke pending | No | Path B fixes |
| MIG-4 sell-price override | Walk vocabulary issue | **No** | PSR action-zone re-walk; orphan delete in 11.5.1 |
| MIG-5 client target | Walk vocabulary issue | **No** | PSR action-zone re-walk; orphan delete in 11.5.1 |
| MIG-6 tier switching | Walk vocabulary issue | **No** | Locate PSR tier control; CB walk spec update |
| MIG-7 Mark-Accepted | PASS ✓ | No | clean |
| **MIG-8 realtime** | **Real catch** | **Yes (incomplete migration)** | **Fold into Slice 11.5.1 (new Step 5)** |
| MIG-9 NULL-safe | PASS ✓ | No | clean |

### What this means for Slice 11.5 close gate

**No Slice 11.5 close blockers** beyond Path B (already merging
in PR #75).

MIG-4/5/6 are walk-spec / UX-discoverability concerns from PSR
redesign, NOT Slice 11.5 regressions. Banking for Slice 11
audit or 11.5.1 orphan cleanup.

MIG-8 is a real incomplete-migration catch. Architecturally
the same axis as 11.5.1's existing scope; folding into 11.5.1
brief v2 as Step 5 (already-scoped slice absorbs it cleanly).

**Close gate evaluation:**
- Path B verification (zero EMAXCONNSESSION post-deploy) →
  Slice 11.5 closes formally
- 11.5.1 brief v2 amendments absorb realtime extension
  scope before kickoff

---

## Slice 11.5.1 brief v2 amendments (delta vs prior v2)

In addition to the C1-C4 + A1 amendments from
`cc-comm-slice-11-5-1-brief-v2-amendments.md`:

### A2 — MIG-8 realtime extension (CC fold from 11.5 close-out)

Step 5 (new):
- Drizzle manual SQL `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql`:
  - `ALTER PUBLICATION supabase_realtime DROP TABLE` OLD tables
    (sequenced AFTER Step 1 schema drops via separate apply)
  - `ALTER PUBLICATION supabase_realtime ADD TABLE` NEW
    cost-data tables + the override + target tables
    (assemblies, assembly_leaves, assembly_leaf_inputs,
    assembly_production_inputs, assembly_leaf_overrides,
    assembly_leaf_targets, quote_leaves)
- `src/components/costing-store-provider.tsx` subscription
  targets updated to NEW table names. Per-quote filter logic
  preserved.
- Cutover sequencing: publication ADD NEW first → code merge →
  publication DROP OLD → drizzle DROP OLD tables. Step 1
  schema migration may need to wait for the publication DROP.

### A3 — Orphan-on-disk PSR cleanup (CC fold from 11.5 close-out)

Step 3 expansion (orphan delete scope):
- `src/components/required-sell-cell.tsx` (orphan since PSR;
  Slice 11.5 Step 4 wired NEW action calls; never rendered)
- `src/components/pricing/client-target-cell.tsx` (same)
- `src/components/pricing/active-tier-selector.tsx` (orphan
  for PSR Pricing surface; STILL USED by Costs surface's
  cost-stack-header — preserve)
- `src/components/pricing/reverse-solve-dialog.tsx` (audit;
  delete if only consumer was the orphan client-target-cell)

Delete the actually-orphan files; preserve `active-tier-
selector.tsx` for cost-stack-header consumer.

### A4 — CB walk spec update (CC fold from 11.5 close-out)

Update walk spec to reflect PSR vocabulary:
- MIG-4: action-zone `request_override` workflow (not inline
  cell click); requires SUGGESTION-LED or BLOCKED classifier
  mode state-prep
- MIG-5: PSR detail-zone client-target display + action-zone
  workflow (not inline cell click)
- MIG-6: locate PSR tier-switching control (header rail or
  detail-zone tier-table); update spec with the actual location

Walk spec update is comprehensive CB test suite work
(final launch gate per CLAUDE.md v1 release-path item 11);
banked for that effort. Not blocking 11.5.1.

---

**§0.5 ledger:** +1 catch for the realtime omission.

> When migrating tables, audit ALL consumers — not just queries
> but realtime subscriptions, publication membership, background
> jobs, audit projections, anything referencing the table schema.

Cumulative: 69 → 70 across 15 slices.

(MIG-4/5/6 are NOT §0.5 catches — they're pre-existing PSR
discoverability artifacts, not architectural mismatches Slice
11.5 introduced.)

---

## Sign-off

**CC:**
- ✓ MIG-8 root cause confirmed + scope addition drafted for
  Slice 11.5.1 brief v2 (A2 amendment above)
- ✓ MIG-4/5/6 confirmed as orphan-on-disk PSR-superseded
  components — NOT Slice 11.5 regressions
- ✓ Slice 11.5.1 cleanup scope expanded with orphan PSR
  components (A3 amendment) + CB walk spec update banked
  (A4 amendment)

**Edward + CA:**
- Disposition Slice 11.5 close gate per Path B verification
  outcome
- If clean, Slice 11.5 closes
- Slice 11.5.1 brief v2 amendments ship (C1-C4 + A1-A4) →
  kickoff
