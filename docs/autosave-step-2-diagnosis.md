# Autosave focus-stability sweep — Step 2 diagnosis

**Slice:** v1 release-critical path item 3.
**Brief:** `docs/autosave-focus-stability-brief.md`.
**Step:** 2 — diagnose tier-6 symptom (this doc).
**Status:** Diagnosis complete. **Edward + CA checkpoint required before Step 3** (draft Pattern 47 unified definition).

---

## TL;DR

Root cause of the Aisha-demo tier-6 symptom is a **4th category** not in the brief's original three hypotheses:

> **Category 4 — `disabled={... || pending}` on the input element itself.**
> The autosave fires inside `startTransition`, which toggles `pending=true` while the save is in flight. The input's `disabled` attribute is bound to `disabled || pending`. When `pending` flips true, the browser drops focus on the now-disabled input. User input mid-keystroke is lost.

Categories 1 (hook race), 2 (registration gap), and 3 (snapshot-prop re-render) are **NOT firing** on this surface. The fix is structural and not specific to dynamically-added tiers — affects ALL pricing per-tier inputs.

**Slice 8 Architectural Rule 1 (`costing-store.ts:41-52`) is PRESERVED.** The fix doesn't require optimistic add operations or any inversion of canonical optimistic-store discipline. Pattern 47's "Rule 1 interaction clause TBD" placeholder resolves cleanly to "preserves Rule 1; no inversion needed."

---

## 1. End-to-end flow trace (Pricing tier add → type per-tier adjustment)

| T+ | What happens | Code path |
|---|---|---|
| 0ms | PM clicks "+ Add tier" | `add-tier-button.tsx:28` `handleClick()` |
| 0ms | `startTransition(async () => addTier(fd))` runs | `add-tier-button.tsx:32-35` |
| 0–700ms | Server `addTier` runs: INSERT `quote_tiers`, seed `packaging_inputs`, `production_inputs`, `freight_leg_tiers`, audit log, `revalidateQuoteTree` | `actions/quotes.ts:1956-2110` |
| ~700ms | Next.js re-renders route; new snapshot prop arrives at `CostingStoreProvider` | `pricing/page.tsx:180` |
| ~700ms | `scheduleReconcile(snap)` → 100ms initial debounce → wait-for-quiet (defers if user editing) | `costing-store-provider.tsx:21-67` |
| ~750ms | Tier 6 column appears in pricing tree; per-tier adjustment input renders | `tier-price-adj-input.tsx:128` |
| ~750ms+ | PM clicks into tier 6's per-tier-adj input cell; cell receives focus | Browser focus |
| ~750ms+ | PM types `5` | `onChange` (`tier-price-adj-input.tsx:95`) |
| keystroke | `setValue("5")`, `updateLocal(tierId, ...)` (store), `scheduleSave("5")` (500ms timeout) | `tier-price-adj-input.tsx:97, 105, 106` |
| keystroke+500ms | Debounce fires → `fireSave("5")` → `startTransition(...)` | `tier-price-adj-input.tsx:80` |
| keystroke+500ms | **`pending = true`** (via `useTransition`) → React re-render | `tier-price-adj-input.tsx:62` |
| keystroke+500ms | Input element re-renders with `disabled={disabled \|\| pending}` → `disabled = true` → **browser drops focus** | `tier-price-adj-input.tsx:133` |
| keystroke+500ms+~50ms | Server `updateTierPriceAdj` returns; `pending = false` → re-render | (server action) |
| keystroke+550ms | Input re-enables → but focus is already gone | `tier-price-adj-input.tsx:133` |

PM sees: typed first digit, focus snapped away, can't type more without re-clicking. Exactly the Aisha-demo symptom.

## 2. Three hypothesized categories — which are firing?

### Category 1 — Hook race on first render
**NOT firing.** TierPriceAdjInput has no separate autosave hook to race. The autosave logic is inline in the component: `useState` + `useEffect` for cleanup + an `onChange` handler that calls `scheduleSave` directly. No useEffect-mounted-hook to race against first keystroke. (Same shape for TierRow on Setup.)

### Category 2 — Registration gap on dynamic IDs
**NOT firing.** The autosave uses `tierId` which is passed as a prop. By the time TierPriceAdjInput renders for the new tier, the server `addTier` action has completed and the new tier's UUID is real. No optimistic add path; no temp ID; no registration gap. (Slice 8 Architectural Rule 1 is structurally preventing this category from existing.)

### Category 3 — Add-affordance mutation yanks focus (snapshot-prop re-render)
**Could fire on subsequent saves, but mitigated by wait-for-quiet.** When the user types and triggers a server save, the action completes with `revalidateQuoteTree` → new snapshot prop → `scheduleReconcile(snap)` → wait-for-quiet pattern defers reconcile if `lastUserEditAt` is within 800ms. Per `costing-store-provider.tsx:21-67`, reconcile is properly deferred during active typing. **Even if the reconcile fires, controlled inputs with stable React keys do not lose focus on parent re-render.** The wait-for-quiet pattern was specifically designed to prevent this; it's holding.

### Category 4 (NEW) — `disabled={disabled || pending}` on autosave input element
**FIRING.** This is the dominant root cause. Mechanism documented in §1 above. Reproducible by any sequence: focus an autosave input → type → wait 500ms (debounce) → focus dropped at the `pending=true` moment.

## 3. Code citations

**The bug locus:**
- `src/components/tier-price-adj-input.tsx:128-138` — per-tier adjustment input on Pricing. `disabled={disabled || pending}` at line 133.
- `src/components/global-price-adj-input.tsx:172-189` — quote-level GPA input on Pricing. `disabled={disabled || pending}` at line 177.

**The known-good comparison:**
- `src/components/costs/freight-drilldown.tsx` — `LegDateInput` primitive (committed during R6.2 commit 4.1) uses `disabled={disabled}` (no pending) AND commits on blur/Enter rather than per-keystroke. Same anti-pattern was caught and fixed in R6.2 for date inputs; the fix wasn't propagated to number inputs.

**Mitigating infrastructure (working as designed):**
- `src/components/costing-store-provider.tsx:21-67` — reconcile pipe with wait-for-quiet (`QUIET_PERIOD_MS = 800`). Defers re-render during active typing. Not the failure point.
- `src/lib/costing-store.ts:41-52` — Slice 8 Architectural Rule 1 (no optimistic adds). Preserved; not the failure point.

## 4. Scope of the bug

The `disabled={disabled || pending}` anti-pattern is **structural and widespread**, not specific to dynamically-added tiers:

```
src/components/tier-price-adj-input.tsx:133 — INPUT (Pricing)
src/components/global-price-adj-input.tsx:177 — INPUT (Pricing)
src/components/costs/bulk-raw-drilldown.tsx:218
src/components/costs/freight-drilldown.tsx:466,476,523,551,563,706,725,864,1280
src/components/costs/packaging-drilldown.tsx:426,464,490,529,627
src/components/costs/production-drilldown.tsx:596,700
src/components/costs/mode-selector.tsx:85
```

Pass 1 audit (Step 5) confirms which of these are INPUT elements (focus-stability-relevant) vs BUTTONS (where `disabled={pending}` is appropriate to prevent double-clicks). A first pass through the grep shows the Costs drilldowns are heavily affected.

**The Aisha-demo tier-6 symptom is one observable instance of a broader structural bug.** The "new tier" framing was incidental to the demo workflow; the bug fires equally on existing tiers when typing.

## 5. Fix shape (recommendation for Pattern 47 unified definition)

Two viable fix shapes; CC recommends **A** as the default, with **B** as the explicit-commit variant for fields where per-keystroke save is wrong UX:

### Option A — Remove `pending` from autosave input `disabled` attribute

```diff
- disabled={disabled || pending}
+ disabled={disabled}
```

Rationale:
- `pending` is for UI feedback ("saving…" label), not for blocking input.
- Debounce already serializes saves (`clearTimeout` on every keystroke). User can keep typing during in-flight save; new keystrokes cancel the previous debounce and schedule a new save.
- If a save IS in flight when user types again, the next save queues up after — non-blocking.
- Preserves per-keystroke autosave UX where it's the right pattern (per-tier adj, packaging unit cost, etc.).

### Option B — Commit on blur/Enter (LegDateInput pattern, R6.2 commit 4.1)

```tsx
<input
  value={draft}
  disabled={disabled}  // no pending
  onChange={(e) => setDraft(e.target.value)}
  onBlur={commitIfChanged}
  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }}}
/>
```

Rationale:
- Save fires only on explicit commit (blur OR Enter), AFTER focus has moved.
- `pending=true` flip happens post-commit; can't yank focus from an input that already lost it.
- Right UX for date inputs (where typing "2026" needs to be atomic, not save-each-digit) and for currency inputs where partial values are nonsense.

### Pattern 47 unified definition draft (incorporating diagnosis)

> **Pattern 47 — Autosave focus-stability**
>
> Every editable field in Nexus that triggers autosave requires:
>
> (a) **Controlled input** — value bound to React state or store; no uncontrolled inputs with onBlur-only save where per-keystroke save is needed.
> (b) **Optimistic store update** at <16ms — keystroke updates the local store before any network call.
> (c) **Debounced server save** — server action fires after user pause (typically 300-500ms), not on every keystroke.
> (d) **Wait-for-quiet reconcile** — server-truth reconciliation defers until user has been idle 800ms; never interrupts active typing.
> (e) **NEW per Step 2 diagnosis: `disabled` attribute MUST NOT include `pending`.** Use `disabled={disabled}` on the input element; never `disabled={disabled || pending}` or `disabled={pending}`. The `pending` flag is for UI status indicators ("saving…" caption), not for blocking the input element. Blocking the input mid-save drops focus and breaks the autosave UX. (Buttons may still use `disabled={pending}` to prevent double-clicks — focus-stability concern doesn't apply.)
>
> Pattern applies to BOTH statically-rendered fields AND dynamically-generated fields. Add-affordances (add tier, add SKU, add cost row, add freight line, add assembly, add child leaf, etc.) verify pattern attachment before permitting user input.
>
> **For fields where per-keystroke save is wrong UX (dates, currency with mid-typing partial values),** use blur/Enter commit pattern (Option B above; LegDateInput primitive from R6.2 is the canonical example).
>
> **Slice 8 Architectural Rule 1 (`costing-store.ts:41-52`) is preserved.** Pattern 47 does NOT require optimistic add operations. Add-action focus-stability is handled by the structural fix (sub-rule e), not by inverting Rule 1.

## 6. Step 4 Pattern 47 promotion — Rule 1 interaction clause resolution

Per brief §4.1 placeholder, the Rule 1 interaction clause finalizes post-diagnosis. **Resolution:** Pattern 47 PRESERVES Slice 8 Architectural Rule 1. No supersession needed. The structural fix (`disabled` attribute discipline) is orthogonal to the optimistic-add ban.

CLAUDE.md sub-rule e wording: "Pattern 47 preserves Slice 8 Architectural Rule 1 (no optimistic adds). The focus-stability fix is in the input element's `disabled` attribute discipline; Rule 1's ban on optimistic add operations stands."

## 7. Edward + CA checkpoint — pre-Step 3 questions

Per brief sequencing, Step 2 diagnosis is the checkpoint before Step 3 (Pattern 47 draft):

1. **Confirm root cause shape:** Category 4 (`disabled` includes `pending`) is the dominant root cause. Confirm? (CC's confidence: high; mechanism is observable in source code; trivially reproducible.)
2. **Confirm Pattern 47 sub-rule (e) addition** — extend the original four-rule definition with the new structural rule from diagnosis.
3. **Confirm Rule 1 preservation** — Pattern 47 does NOT supersede Slice 8 Architectural Rule 1. The placeholder in brief §4.1 resolves to "preserved."
4. **Confirm fix-shape default (Option A)** — remove `pending` from input `disabled` attribute as the default. Option B (blur/Enter commit) reserved for fields where partial values are nonsense (dates, currency).
5. **Confirm Pass 2 scenario scope** — original 10-scenario matrix in inventory doc still stands; bug-shape just means the same scenarios will now light up the structural bug, not the originally-hypothesized hook race / registration gap.

## 8. Sequencing impact

The brief's Step 3 (draft Pattern 47) → Step 4 (promote to CLAUDE.md) → Steps 5-6 (audits) → Step 7 (fix) sequence remains valid. The diagnosis changes:

- **Step 3 Pattern 47 draft:** straightforward — incorporate sub-rule (e); Rule 1 preserved.
- **Step 4 CLAUDE.md promotion:** straightforward — no Edward + CA second-round disposition needed (the Rule 1 interaction is already resolved).
- **Step 5 Pass 1 audit:** scope likely larger than originally estimated (the `disabled={... || pending}` grep returns ~20+ INPUT instances; many components touched).
- **Step 6 Pass 2 audit:** confirms the structural fix from Step 5 transfers cleanly to dynamic affordances (tier 6 add, SKU adds, etc.).
- **Step 7 fix application:** mostly mechanical — sweep `disabled={... || pending}` on input elements and remove `pending`. Date/currency inputs may need Option B variant.

**Estimated fix scope:** 15-25 component edits, mostly one-line. Plus inventory regression test for the canonical "type after add" scenarios.

---

## Appendix — Why categories 1-3 didn't fire (defense of the diagnosis)

The brief's Notes §1 explicitly cautioned against pre-committing to a hypothesis. Per Slice 9.4b edge-case-enumeration discipline (now Pattern 28+27), I enumerated all hypotheses:

| Hypothesis | Status | Evidence |
|---|---|---|
| 1. Hook race | NOT FIRING | TierPriceAdjInput has no separate hook (autosave is inline `onChange` → `scheduleSave`). No race possible. |
| 2. Registration gap | NOT FIRING | `tierId` is a prop; real by the time the component renders for tier 6. Slice 8 Rule 1 (no optimistic adds) structurally prevents this category. |
| 3. Snapshot-prop re-render | NOT FIRING | wait-for-quiet (800ms) defers reconcile during typing. Controlled inputs preserve focus on parent re-render anyway. |
| 4. `disabled={... \|\| pending}` toggle | **FIRING** | Observable in source. Trivially reproducible. R6.2 commit 4.1 already fixed it on date inputs (LegDateInput); structural fix not propagated to number inputs. |

The brief's three categories were good hypotheses for an unknown-mechanism failure mode. The actual mechanism is simpler than any of them — and was even already partially-fixed in a prior slice (R6.2 commit 4.1's LegDateInput) without being banked as a structural pattern.

**This is exactly the kind of latent-pattern surface the sweep was designed to find.** Pattern 47 promotion + comprehensive `disabled` attribute sweep prevents this from recurring on future slices.
