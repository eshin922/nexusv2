# Pattern 70 5th-instance audit — VERDICT: clean

**To:** CA + Edward
**From:** CC
**Re:** §2 pre-emptive grep for a 5th Pattern-70 caller + §3 error-surfacing recommendation
**Status:** #126 unblocks CB re-smoke. No 5th instance found. §3 spec below.

---

## §1 · Pattern 70 audit — all assembly-production-inputs write callers accounted for

Grepped every `quoteForAssembly*` / `quoteForAssemblyLeaf*` guard and
every UI caller of assembly-keyed actions.

### Server-side (5 total)

| Action | Guard | Expected FormData key |
|---|---|---|
| `upsertAssemblyProductionInputs` | `quoteForAssembly(assemblyId)` | assembly.id |
| `updateAssemblyProductionPolicy` | `quoteForAssembly(assemblyId)` | assembly.id |
| `addAssemblyLeafInput` (packaging) | `quoteForAssemblyLeaf(leafId)` | assembly_leaves.id |
| `updateAssemblyLeafInputCell` (packaging) | `quoteForAssemblyLeaf` (via lookup) | assembly_leaves.id |
| `updateAssemblyLeafInputLineMeta` / `deleteAssemblyLeafInputLine` | `quoteForAssemblyLeafInputLineGroup(lineGroupId)` | synthetic lineGroupId |
| `updateAssemblyLeafOverride` (costing.ts:836) | `quoteForAssemblyLeaf(assemblyLeafId)` | assembly_leaves.id |
| `updateAssemblyLeafTarget` (costing.ts:999) | `quoteForAssemblyLeaf(assemblyLeafId)` | assembly_leaves.id |

### Client-side callers of assembly-keyed actions (2 total)

| Caller | Action | Passes | Correct? |
|---|---|---|---|
| `SectionToggles.persist` | `updateAssemblyProductionPolicy` | `sku.id` from `assemblies=skus.filter(s=>s.skuRole==="assembly")` — so `sku.id` IS assembly.id | ✅ fixed in `fff95b6` (#118 recovery) |
| `ProductionTierCell.fireSave` | `upsertAssemblyProductionInputs` | `sku.parentSkuId` (assembly.id) via leaf iteration | ✅ fixed in `#126` |

### Client-side callers of leaf-keyed actions

All under `packaging-drilldown.tsx` — pass `leafSkus[0].id` which
IS `assembly_leaves.id` per the RSC synthetic shape at
`costs/page.tsx:357` (`skus.push({ id: al.id, ... skuRole: "leaf",
parentSkuId: al.assemblyId })`). Matches `quoteForAssemblyLeaf`
signature.

### Client-side callers of override/target actions

Zero. `updateAssemblyLeafOverride` + `updateAssemblyLeafTarget`
have UI wire deferred to Part 2 (per-cell override slice).

### Verdict

**No 5th Pattern-70 caller in the current tree.** #126 completes
the leaf→assembly rename cascade for the production write path. If
CB re-enters fees post-#126 and they STILL don't persist, the bug
is elsewhere (network / auth / RSC re-render race — NOT the ID
mismatch shape).

Safe to hand back to CB for re-smoke.

---

## §2 · §3 recommendation — surface save failures (spec)

**Confirmed: yes, surface fire-and-forget save failures on the
Costs surface.** The silent-failure amplifier is a real hazard; my
lean aligns with yours. Scope as its own small ticket after the
matrix closes — bundling it here would broaden #126's scope past
the gate CB is waiting on.

### Sketch (for the eventual ticket)

**Problem:** every `startTransition(async () => { await X(fd); })`
in the Costs drilldowns silently swallows `ActionResult` failures.
`upsertAssemblyProductionInputs` returning `{ok: false}` is
invisible to the PM. Same shape in packaging + freight + tier +
notes actions (~10-15 call sites). Any downstream bug that makes
the server reject a write becomes silent data loss.

**Proposed shape:** a small helper + a Costs-surface toast.

```ts
// src/lib/action-toast.ts
"use client";
export function runWithToast<T>(
  transition: (fn: () => Promise<void>) => void,
  action: () => Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>,
  onError?: (msg: string) => void,
) {
  transition(async () => {
    const r = await action();
    if (!r.ok) {
      const msg = `Save failed: ${r.error.message}`;
      if (onError) onError(msg);
      else console.error(msg); // fallback
      // TODO: dispatch to a Costs-surface toast context
    }
  });
}
```

**Composition:**
- Costs page mounts a `<CostsToastProvider>` at the surface root
- Each drilldown consumes it via context; passes `onError` to
  `runWithToast`
- Toast shows for ~5s with the error message; PM sees the failure
  in-DOM (matches Pattern 47 discipline — no native `alert`)

**Scope estimate:** ~1-2 hours. Small.

**Sequencing:** post-Slice-11 close. Doesn't block Slice 11
matrix or the per-cell override wire (Part 2). Can slot in
before or after Part 2 depending on Edward's priority.

**Bank shape on close** (§0.5 catch #82 or wherever): "silent
save failures on customer-facing state changes are worse than
loud crashes — they erode trust, lose real work, and mask the
downstream bugs that cause them. Fire-and-forget mutations MUST
surface failures to the user (toast, banner, inline error). Bank
with Pattern 70 4th instance since the silence is what made all
four Pattern-70 instances costly."

---

## §3 · Re-smoke handoff to CB — proceed per your §1 order

CB restarts on the fresh preview (Vercel builds off #126 merge to
main):

1. **Gate step:** CHARGES quote — re-enter setup $150 + tooling $75
   on production drilldown → save → hard-refresh (Ctrl+Shift+R) →
   confirm values persist in the input fields AND appear in the
   cost stack rollup
   - If they persist → proceed to step 2
   - If they DON'T persist → report + STOP; no 5th Pattern-70
     caller exists, so failure signals a different bug shape

2. **Only after step 1 passes:** verify #125 fixes
   - Fees render as line items in the "Additional charges" block
   - Turnkey "includes" note sums to $225 (not $0.00 anymore)
   - Unpriced Tier 2 renders "quote on request" / "from $X" /
     "total on request" (not $0.00)

3. **Independent of 1-2, on PURE quote:** Cluster-1 evidence
   capture per Step A/B/C from the earlier memo (raw DOM text of
   the "3" element → clipping vs wrong-data; new 2000/8000
   quote to see if value moves; cache-bust)

4. If all three clean → CB continues §4 addendum / §5 affordances
   / §7 CD fidelity spot-check

---

## §4 · Standing queue

- **#124 (linkage)** — queued for post-matrix-clean merge
- **#122 (close-out)** — queued for post-matrix-clean merge
- **Cluster 1** — awaiting CB A/B/C evidence
- **Side ticket: packaging duplicate-line delete wipes sibling
  cost** — separate track (priority per CA memo §6 — real data
  loss)
- **Side ticket: non-anchor-SKU cost editing gap** — separate
  track (multi-SKU affordance)
- **§3 error surfacing ticket** — post-Slice-11 close, scope
  above

**Full close-out banks on Slice 11 close (5 catches from this
final push):**
1. C2-A — divergent isMissing at adapter seams (Pattern 50 analog)
2. C2-B — over-permissive OR gate copy
3. #5.1 — Pattern 70 4th instance (audit ALL callers of an entity
   key rename)
4. **NEW** — silent-failure amplifier (fire-and-forget swallows
   errors; make save failures visible)
5. F1.5 — DOM preview verification ≠ react-pdf render verification
