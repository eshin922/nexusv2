# CC Comm — Packaging duplicate-line delete wipe: diagnosis (no fix yet)

**To:** CA (+ Edward)
**From:** CC
**Re:** Root-cause investigation — I cannot reproduce the DB-level wipe.
Requesting original observation details before proposing a fix.
**Date:** 2026-07-27
**Status:** Diagnosis gate per your memo — surfacing findings for
review; no code change yet.

---

## §1 · TL;DR

- **DB layer is safe.** Verified via action-level SQL repro on a
  throwaway fixture (`Alt 1 v1` in the SAMPLE — Aurora Botanica
  project — Nexus-only, draft, 2 assemblies, 9 leaves, 0 existing
  packaging lines).
- **Live prod data has zero cross-leaf `line_group_id` collisions.**
  53 lineGroupIds, 53 leaves, 53 distinct (leaf, line) pairs across
  150 rows — every group scoped to exactly one leaf.
- **Only one code path deletes from `assembly_leaf_inputs`** —
  `deleteAssemblyLeafInputLine` in `src/app/actions/assembly-leaf-inputs.ts:343`.
  It targets by `line_group_id`, and every insert path uses a fresh
  `crypto.randomUUID()` (or a correctly-scoped reuse in tier-
  preset/tier-add carry-forward + scenario clone lineGroupIdMap).
- I cannot produce a reproducer that wipes a sibling at the DB or
  action layer. The wipe (if real) is above the DB — most likely in
  the UI/state layer — but I need PM observation details to
  reproduce it.

**Requesting:** original CB smoke observation — when was it first
seen, what was the click sequence, what did "sibling cost disappears"
look like on screen, does it survive reload?

---

## §2 · What I checked

### Schema

- `assembly_leaf_inputs`:
  - PK `id uuid`
  - `assembly_leaf_id → assembly_leaves(id) ON DELETE CASCADE`
  - `tier_id → quote_tiers(id) ON DELETE CASCADE`
  - `line_group_id uuid NOT NULL` (**not** a FK)
  - **UNIQUE index** on `(assembly_leaf_id, line_group_id, tier_id)` — one row per (leaf, line, tier)
  - Non-unique index on `line_group_id` alone
- No trigger, no cascade path from `line_group_id` to any other table.
- No RLS bypass path; no Realtime write side-effect.

### DB corpus scan

Live prod data (150 rows):

| metric | value |
|---|---|
| total rows | 150 |
| distinct `line_group_id`s | 53 |
| distinct `assembly_leaf_id`s | 53 |
| distinct (leaf, line) pairs | 53 |
| cross-leaf `line_group_id` collisions | **0** |
| unique-index (leaf, line, tier) violations | **0** |

Interpretation: every leaf currently has exactly ONE line group.
The reported multi-line-per-leaf scenario is not persisted at any
scale today.

### Action-layer paths (all writers to `assembly_leaf_inputs`)

| action | shape | risk |
|---|---|---|
| `addAssemblyLeafInput` (`assembly-leaf-inputs.ts:129`) | `lineGroupId = crypto.randomUUID()` per call; inserts N tier rows sharing it | safe |
| `updateAssemblyLeafInputLineMeta` (`:189`) | `UPDATE WHERE line_group_id = X` (metadata fields only; not `unit_cost`) | safe if lineGroupIds are unique per line |
| `deleteAssemblyLeafInputLine` (`:343`) | `DELETE WHERE line_group_id = X` (no leaf scoping) | **only bug shape possible**: if two lines EVER shared a lineGroupId across leaves, this would delete both — but no code path produces that |
| `updateAssemblyLeafInputCell` (`:389`) | `UPDATE WHERE id = rowId` (unique PK) | safe |
| `applyTierPreset` (`quotes.ts:1039`) | `selectDistinctOn([lineGroupId])` → reseeds with SAME lineGroupIds across new tiers | safe (reuses correctly, doesn't collide) |
| `addTier` carry-forward (`quotes.ts:651`) | dedup by lineGroupId, seed new tier rows with existing lineGroupId | safe |
| scenario clone (`quotes.ts:2048`) | explicit `lineGroupIdMap` remaps old → new UUIDs | safe |
| sample seed (`scripts/seed-sample-order.mjs:414`) | fresh `randomUUID()` per (leaf, line) | safe |

### Action-layer proof (throwaway fixture)

Executed via SQL matching the actions' semantics 1:1:

```
Setup: leaf "Glass bottle · 30ml · amber" under "Hydra-Glow Serum · 30ml"
       3 tiers (5K, 15K, 50K)
Step 2: Line A inserted (fresh UUID) — 3 tier rows
Step 3: Line A cost = $1.11 across all tiers
Step 4: Line B inserted (fresh UUID) — 3 tier rows
Step 5: Line B cost = $2.22 across all tiers
Step 6: BEFORE delete — 6 total rows, 3 per line ✓
Step 7: DELETE FROM assembly_leaf_inputs WHERE line_group_id = <B>
Step 8: AFTER delete:
  ✓ KEY ASSERTION — Line A survived intact (3 rows)
  ✓ Line B deleted (0 rows)
  ✓ KEY ASSERTION — Line A unit_cost preserved at $1.11 on every tier
Step 9: cleaned up test rows (fixture pristine)
```

Fixture pristine post-test (0 rows on the leaf).

### Client-side / store layer

`src/components/costs/packaging-drilldown.tsx`:
- `handleDelete` at line 418: fire-and-forget `startTransition` on
  `deleteAssemblyLeafInputLine(fd)`. **Silently swallows** any
  `{ok: false, ...}` error return. Fits the Slice 11 close-out §0.5
  bank shape ("silent-failure amplifier") but is a fail-to-delete,
  not sibling-wipe.
- No client-side optimistic delete mutator in the store —
  `costing-store.ts` has no `removePackaging` / `deleteLine` — the
  delete goes DB → revalidate → reconcile, nothing intermediate.

`src/lib/costing-store.ts`:
- `updatePackagingCell(rowId, fields)` — keys by unique PK `rowId`. safe.
- `updatePackagingLineMeta(lineGroupId, fields)` — spreads fields
  across all rows sharing lineGroupId. Safe if lineGroupIds are
  unique per line (they are, per corpus scan).
- `reconcile(snapshot)` — replaces `s.packaging` entirely with server
  truth (`snapshot.packaging`); deferred by wait-for-quiet (800ms
  window since `lastUserEditAt`) to avoid clobbering optimistic
  edits mid-typing.

I ran through several race scenarios (typing on Line A within the
500ms debounce while deleting Line B, etc.) but the
`scheduleReconcile` + latest-snapshot pipe + wait-for-quiet
combination correctly serves the latest server truth and doesn't
appear to produce a wipe on Line A. Traces below available if
useful.

---

## §3 · Hypotheses status

| hypothesis | status |
|---|---|
| Shared identity (delete drops multiple rows via shared PK) | **ruled out** — DB corpus has zero cross-leaf lineGroupId collisions; every insert uses fresh UUID or correctly-scoped reuse |
| Delete-by-wrong-key (delete targets `sku_id` + section, catches sibling) | **ruled out** — delete targets by `line_group_id`, no other scope |
| Unintended cascade (DB CASCADE reaches sibling) | **ruled out** — only cascade paths are `assembly_leaf_id` (per-leaf) and `tier_id` (per-tier), both fan OUT, not sideways |
| Optimistic-store desync (fire-and-forget mis-target of the delete) | **ruled out for sibling wipe** — no optimistic delete mutator; DB path is authoritative. Still relevant as a **separate failure class**: fire-and-forget `startTransition` on `handleDelete` swallows any `{ok: false, ...}` error — but that's fail-to-delete, not sibling-wipe |
| **Perception artifact** (cost data appears missing on-screen but is intact in DB — a rendering/reconcile mismatch, not real loss) | **candidate** — but I don't have a click sequence that produces it |
| **Scenario I haven't found** (a click path or a specific data shape I can't derive without seeing the original observation) | **need CA/Edward input** |

---

## §4 · What I need before I can propose a fix

Per your memo's "fix must be correct, not merely plausible":

1. **Original observation details.** When was it first reported?
   Under what click sequence? Was the report "cost is 0 in the
   drilldown after delete" or "cost is gone even after reload"? The
   *reload* aspect is critical — without a reload, the observation
   is UI-layer; with a reload persisting the wipe, it's DB-layer.
2. **The quote it was observed on** (if known). Even just the deal
   name — I can inspect its packaging history in the audit_log.
3. **Was it observed once or reproducibly?** Every attempt I've
   made to construct a reproducer at the DB or action layer has
   failed to reproduce a wipe.

If it's reproducible, ideally I want you or Edward to record the
click sequence (or capture a screen) so I can bind it to a specific
code path. My inability to reproduce it doesn't mean it isn't real
— it means the trigger conditions are outside what my static
analysis + DB probe surfaced.

---

## §5 · Adjacent finding worth banking regardless

`handleDelete` in `packaging-drilldown.tsx:418` is fire-and-forget
via `startTransition`. If `deleteAssemblyLeafInputLine` returns
`{ok: false, ...}` (e.g., quote not draft, guard failed), the UI
silently discards the error — same shape as the production cost
persistence bug from Slice 11 (Pattern 70 #4 / silent-failure
amplifier). Not the sibling-wipe cause, but a real UX gap.

If the diagnosis pivots (or the observation turns out to be a
reload-persisting wipe I can't reproduce), the error-surfacing
work belongs on the §3 error surfacing ticket, not folded here.

---

## §6 · Next step

Standing by for the original observation details. If you can:
- Point me at the CB smoke transcript / screenshot / quote where
  it was observed
- Attempt a live repro so I can capture the exact click sequence

…I'll pattern-match against my hypothesis matrix and either pin
the root cause or expand the search. Not writing code until we
have a reproducer + agreed root cause.
