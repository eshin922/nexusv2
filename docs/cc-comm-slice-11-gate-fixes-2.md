# Slice 11 gate — #5.1 fix + sharpened Cluster-1 ask

**To:** CA + Edward + CB
**From:** CC
**Re:** #5.1 reclassified as Slice 11 gate — root cause found + fixed;
plus a sharper CB diagnostic for Cluster 1.
**Status:** ready to merge; CB restarts §3 charges + unpriced tier
verify + Cluster 1 evidence capture after deploy.

---

## §1 · #5.1 (production cost-line persistence) — root cause + fix

**Symptom:** PM types a value on the production drilldown (per-tier
fee columns: setup, tooling, R&D, other, filling, cm-assembly,
bulk-raw), value shows in the input, PM navigates away, comes
back, value is gone. DB row's fee column stays null.

**Root cause: Pattern 70 cross-consumer audit shape, 4th instance
in the Slice 11 chain.**

The Section-level toggle fix (commit `fff95b6`, in PR #118 recovery)
already renamed `SectionToggles.leafSkus` → `assemblies` and
swapped `leaf.id` for `assembly.id` when calling
`updateAssemblyProductionPolicy`. That fix covered the toggle path
only. **The per-cell path (`ProductionTierCell.fireSave`) was
missed** — it still sent `sku.id` (leaf ID) as `quoteSkuId` to
`upsertAssemblyProductionInputs`, whose first step is:

```ts
const { quote } = await quoteForAssembly(assemblyId);
```

`quoteForAssembly(leafId)` finds no row in `assemblies` → throws
`ActionGuardError(ERR.NOT_FOUND, "Assembly not found")` →
`runAction` returns `{ ok: false, error: {...} }`. The UI fires
the action in a `startTransition` without checking the return
value, so the error is silently swallowed. PM sees no
error; nothing persists.

**Secondary bug (same site):** `fireSave` also had `if (!row)
return;` — silently discarding the FIRST typed value for any
(assembly, tier) cell that didn't yet have an
`assembly_production_inputs` row. The server action's INSERT
branch was designed to handle "no row exists," but the UI never
reached it.

**Fix:**
- `fireSave` now uses `sku.parentSkuId` (assembly ID) instead of
  `sku.id` (leaf ID) for `quoteSkuId`
- `fireSave` no longer early-returns when `row` is undefined —
  null-guards `row?.X` reads throughout; the action's INSERT
  branch creates the row on first-typed value

**File:** `src/components/costs/production-drilldown.tsx`

Adjacent side ticket from CB (**Packaging duplicate-line deletion
wipes sibling's cost**) is NOT touched by this fix — that's a
separate action-level bug in the packaging path, distinct from
production's ID-mismatch shape. Bank as its own ticket.

**§0.5 bank on close** — Pattern 70 4th instance in Slice 11:
when a migration renames the entity key at ANY action layer,
grep ALL callers of the OLD naming throughout the codebase. The
Section-toggle fix on this same file caught 1 of 2 code paths;
the per-cell path was missed even though it was 300 lines below.
Slice-scoped audits need to grep every action name touched by
the migration, not just the surface most recently touched.

---

## §2 · Sharpened Cluster-1 ask (for CB)

Test quote: `smoke-matrix-pure-0727` · `071486be-e1a6-4475-8df6-2a2b78a21b58`
· `tier_table × turnkey_only` mode · non-recommended tier (Tier 2,
qty 5000) card.

**The diagnostic that cracks it:** distinguish **clipping** from
**wrong data.**

### Step A · Get the raw DOM text of the "3" element

Preview iframe → right-click Tier 2's card → **Inspect** →
select the exact `<div>` or `<span>` element containing the "3"
→ read the raw text content.

- If raw text = **"$1,083"** → the DOM has the correct value; the
  "3" you SAW is a CLIPPING artifact (layout / negative-margin /
  overflow issue)
- If raw text = **"$3"** or **"$3.00"** → the value produced by
  `money()` is genuinely 3; this is a DATA path bug
- If raw text = **something else** (e.g., "$1,000" with the "83"
  hidden) → still clipping-shape, but the value story shifts

Also grab:
- The parent `<div>`'s computed `width` in pixels
- Any `overflow` / `text-overflow` CSS on the ancestors
- Whether the recommended card (Tier 1) visually overlaps Tier 2's
  card at all (screenshot with browser zoom > 200% to see the
  edges clearly)

### Step B · Vary the tier config to see if the value moves

Create a NEW throwaway quote with:
- Tier 1 qty **2000** (recommended)
- Tier 2 qty **8000** (not recommended)
- Same 1 SKU, same packaging cost setup

Repro `tier_table × turnkey_only`. Screenshot Tier 2's card.

- If it now shows a DIFFERENT wrong value (e.g., "8" or bare "0"
  from "$8,000") → confirms clipping (trailing/leading digit
  shown, related to card width) OR digit-count-dependent bug
- If it now shows something like "$1,776" correctly → confirms
  the original "3" was data-specific to the previous quote
- If it still shows "3" specifically → very odd; would suggest a
  specific value in the render tree we haven't identified

### Step C · Refresh with cache-bust

Ctrl+Shift+R on the iframe URL to bust any stale PDF cache. If
the "3" only reproduces on a stale build, this is a false alarm.

Report all three back (A/B/C outputs) — the combination is what
lets us diagnose without needing to reproduce locally.

---

## §3 · Re-smoke plan (after this fix + Cluster-1 evidence)

Per Edward's disposition:

1. **CHARGES quote (`93a5d4bb-…`)** — re-enter setup $150 + tooling
   $75 on production drilldown; save; hard-refresh; confirm values
   persist post-reload → §3 charges combo can now be verified
2. **CHARGES quote unpriced Tier 2** — verify #125 fix landed:
   "quote on request" / "from $X" / "total on request" (not $0.00)
3. **PURE quote Cluster 1** — Step A/B/C evidence above
4. If all clean → CB continues into §4 addendum / §5 affordances /
   §7 CD fidelity spot-check
5. Slice 11 closes on full matrix clean → merge #124 (linkage) →
   merge #122 (close-out)

---

## §4 · Verification

- `tsc --noEmit` clean
- All 5 prebuild verifiers green
- Production cell fix visually identical to Section-toggle fix
  pattern (same file, adjacent code) — behavior:
  - PM types a value → local input state updates immediately
    (existing `setValue`)
  - Store optimistic update runs when row exists (unchanged)
  - After 500ms debounce, `fireSave` sends assembly ID + all
    field values; action UPSERTs
  - On INSERT (no prior row), server writes the new row with all
    fields; reconcile picks it up; store gets populated; UI
    re-renders with confirmed values
  - On UPDATE (prior row exists), server writes the diff; reconcile
    picks up the change

---

## §5 · Standing queue

- **This PR** — merge → fresh preview
- CB re-smokes per §3
- Side ticket **packaging duplicate-line deletion wipes sibling
  cost** — separate ticket, not gating (per Edward's original
  disposition; still non-blocking since matrix uses single-line
  configs)
- PR #124 (linkage) + PR #122 (close-out) still queued for
  post-matrix-clean merge

If matrix walks clean, Slice 11 closes with 3 banked §0.5 catches
in this final push:
- C2-A (divergent isMissing at adapter seams — Pattern 50 analog)
- C2-B (over-permissive OR gate copy)
- #5.1 (Pattern 70 4th instance — audit ALL callers of an entity
  key rename, not just the most-recently-touched surface)
