# Autosave focus-stability sweep + Pattern 47 promotion — Brief

**Slice position:** v1 release-critical path, item 3 (before Pricing reframe v1)
**Slice type:** Behavioral pattern sweep (analogue of rest-of-app fidelity sweep, but for behavioral patterns instead of design fidelity)
**Status:** Draft for Edward approval; pending Architect verification post-restoration

---

## 1. Background & context

Nexus already has two CLAUDE.md patterns that together define correct autosave behavior:

- **Form pattern** — controlled inputs + useActionState; never uncontrolled forms with onBlur. Save handlers receive new value as explicit parameter, not via stale ref reads.
- **Optimistic computation pattern (Slice 8)** — Zustand store with per-quote factory instances. User edits update store immediately (<16ms); server saves debounced; reconcile-from-server-truth uses wait-for-quiet pattern (defer until user has been idle 800ms).

These patterns are correct individually but exist as separate entries. Together they describe a single behavioral invariant — **autosave focus-stability** — that every editable field in Nexus must satisfy. The split has allowed coverage gaps to persist silently: the patterns were applied where the original implementing slice touched code, but propagation to other surfaces and to dynamically-generated fields has been inconsistent.

This sweep unifies the patterns under a single explicit standard (Pattern 47), verifies coverage across all editable surfaces and add-affordances, and surfaces gaps for fix.

## 2. The problem — operational risk

**Symptom witnessed during stakeholder demo.** During Edward's May 15 2026 1:1 with Aisha Manjra (ops analyst), Edward added a new tier (tier 6) on the Pricing surface and attempted to type a value into the new column. Focus was yanked mid-typing — most likely caused by the save firing or a re-render after the add-tier action — preventing effective number entry.

This is friction that erodes stakeholder confidence during tool rollout. Aisha is a planned v1 user; experiencing input failure during the demo undermines adoption.

**Pattern coverage gap.** Edward's diagnostic hypothesis (worth respecting; pending CC verification): the original autosave fix was applied to existing fields that were rendered at the time the fix landed. Tier 6 in this case was generated from code as part of an add-tier action — that newly-generated input may not inherit the autosave rule that statically-rendered fields do.

**Three plausible root cause categories** for the dynamic-field failure mode (CC should instrument all three during diagnosis, not commit to one in advance):

1. **Pattern hook race on first render** — newly-added field renders before its useEffect mounts the autosave hook; first keystroke hits a component without the hook attached.
2. **Registration gap on dynamic IDs** — the autosave hook depends on a stable identifier (tier ID, SKU ID) that the store doesn't know about until after the first server save returns; first keystroke fires before the ID is registered.
3. **Add-affordance mutation yanks focus** — the add-tier action triggers a `router.refresh()` (per the Mutation→UI refresh pattern) which re-renders the column tree and drops focus before the user can type.

**Why this matters now.** Pricing reframe v1 (item 4 on v1 path) touches the highest-density tier input surface in the app. Landing Pricing reframe on a foundation where dynamically-added tier inputs fail autosave focus-stability would propagate the bug to the most visible surface in the product. Sequencing this sweep before Pricing reframe is load-bearing.

## 3. The decision — v1 commitment + scope boundary

**v1 commits to autosave focus-stability as a foundational invariant across all editable surfaces.** Pattern 47 promoted to standing on first instance because the symptom is stakeholder-visible and the coverage gap is wider than a single bug.

**Scope IN:**
- Every editable input that triggers autosave (text, number, select, toggle, slider)
- Every add-affordance that introduces new input components dynamically (add tier, add SKU, add cost row, add freight line, add assembly, add child leaf, etc. — CC catalogs the complete list)
- Pattern 47 unified definition promoted to CLAUDE.md as the authoritative standing pattern; Form pattern + Optimistic computation pattern entries preserved as "see Pattern 47" cross-reference stubs (original framing retained for grep-discoverability of "useActionState," "wait-for-quiet," "Zustand," etc.)

**Scope OUT:**
- Ephemeral controls (modal forms with explicit submit) — these don't autosave
- Customer-facing render fields (no editing affordance)
- Admin-only fields (low-volume; lower priority; audit separately in v1.5+ if needed)
- New behavioral patterns beyond focus-stability (this is not a general behavioral audit)

## 4. Solution architecture

### 4.1 Pattern 47 unified definition

> **Pattern 47 — Autosave focus-stability**
>
> Every editable field in Nexus that triggers autosave requires:
>
> (a) **Controlled input** — value bound to React state or store; no uncontrolled inputs with onBlur-only save
> (b) **Optimistic store update** at <16ms — keystroke updates the local store before any network call
> (c) **Debounced server save** — server action fires after user pause (typically 300-500ms), not on every keystroke
> (d) **Wait-for-quiet reconcile** — server-truth reconciliation defers until user has been idle 800ms; never interrupts active typing
>
> Pattern applies to BOTH statically-rendered fields AND dynamically-generated fields. Add-affordances (add tier, add SKU, add cost row, add freight line, add assembly, add child leaf, etc.) verify pattern attachment before permitting user input.
>
> Verified at brief time (Architect) and at impl completion (Architect or CC self-audit + Edward review if Architect not yet restored).

### 4.2 Two-pass audit shape

**Pass 1 — Static field coverage.** CC catalogs every editable input surface in the app. For each, verifies Pattern 47 (a)-(d) compliance. Output: coverage matrix in `docs/autosave-audit-pass-1.md` with findings (compliant / non-compliant / partial; if non-compliant, which sub-pattern fails).

**Pass 2 — Dynamic affordance coverage.** CC catalogs every "add" affordance in the app. For each, runs the canonical scenario "click add → immediately type → verify focus persists and value commits." Output: coverage matrix in `docs/autosave-audit-pass-2.md` with findings.

Pass 2 is where the tier 6 symptom lives. Pass 1 may surface additional gaps but is the easier sweep.

### 4.3 Diagnostic instrumentation

For each non-compliant dynamic affordance, CC instruments the three suspected root cause categories (hook race / registration gap / mutation yank) to identify which is firing. Diagnosis output documents the root cause per affordance so the fix path is targeted.

### 4.4 Fix application

Root cause fixes applied per affordance:
- **Hook race** → ensure useEffect mounts before first render OR initialize hook state synchronously in the component (`useState(() => initializer())` pattern)
- **Registration gap** → optimistic store registration of new tier/SKU/row at add-action time, before server response returns; server reconciles after wait-for-quiet
- **Mutation yank** → eliminate `router.refresh()` from add-affordance actions; rely on optimistic store update + Zustand subscribers to surface the new affordance without full tree re-render

Fixes propagate to all affected surfaces; verification runs the canonical scenario against each.

### 4.5 Regression coverage

Lightweight Playwright (or equivalent) test suite covering the canonical add-affordance scenarios. Prevents future regressions when slices add new affordances. Tests live in `tests/autosave-focus-stability.spec.ts`.

## 5. Schema verification gate (Pattern 25)

This sweep is largely behavioral. Most likely no schema changes required.

**Possible schema touches** (CC verifies during diagnosis; surfaces if any apply):
- If the fix path requires persisting "tier registration" state before user input, that might need a flag on `quote_tiers` — unlikely but flag if it surfaces
- If the optimistic store needs a `pending_creation` state on new entities, that's client-state only; no schema change
- If regression tests require fixture data, fixtures live in `tests/fixtures/`; no production schema change

**Pattern 25 verification at brief approval:** CC confirms whether any new schema touches are required. Most likely answer: none. If schema touches surface during diagnosis, brief gets a schema-verification amendment before fix application proceeds.

**Audit-log namespace convention (Amendment A, May 2026).** If the fix path introduces new server actions writing columns with existing manual write paths (e.g., new optimistic-registration actions writing to `quote_tiers` or `quote_skus`), follow the Slice 9.2 `diff_json.source` namespace convention. Architect's MEMORY.md `slice_9_2_patterns` entry documents the discipline: reuse the manual `audit_log.action` value; add a namespaced `source` key to disambiguate origin; absence = manual; new `source` values for new origins (don't reuse `system_suggestion`). For optimistic-registration actions, candidate source values: `optimistic_registration` (CC chooses at brief-verification time; Architect signs off).

## 6. Workflow scenarios to test against

**Static field scenarios:**
- Type rapidly into a static input field — focus persists; all values commit; no race with debounced save
- Type into one field while another tab's save fires — focus persists; no race
- Type into a field during admin firm_settings refresh — focus persists; no race with revalidate
- Type and pause; verify wait-for-quiet reconcile fires after 800ms; verify no focus interruption

**Dynamic affordance scenarios (canonical):**
- Add tier on Pricing → immediately type per-tier qty in new column → focus persists, value commits
- Add SKU on Setup → immediately type units_per_pack in new row → focus persists, value commits
- Add cost row in Costs (packaging) → immediately type unit cost → focus persists, value commits
- Add cost row in Costs (production) → immediately type → focus persists
- Add cost row in Costs (freight) → immediately type rate → focus persists
- Add freight line → immediately type total freight → focus persists
- Add assembly on Setup → immediately type qty_per_parent on first child → focus persists
- Add child leaf to assembly → immediately type bench unit qty → focus persists
- (CC catalogs any remaining add-affordances during Pass 2)

**Race scenarios and edge cases — explicit dispositions required at brief verification, not implementation-time guesses (Slice 9.4b edge-case-enumeration discipline):**

1. **Add tier → server save of add fails → optimistic value disposition: retain with retry surface (CA rec).** Losing user input is the worse failure; optimistic value persists; auto-retry with backoff OR user-triggered retry via UI. Consistent with how wait-for-quiet pattern handles field-edit save failures.
2. **Add tier while another tier save in flight → queue order: FIFO (CA rec).** Tiers added in order; saves complete in order. Coalesce would batch but breaks per-action `audit_log` granularity.
3. **Add affordance double-click / rapid retrigger → disable add button while previous add save in flight (CA rec).** UI affordance prevents the race honestly; no time-window debounce needed. Button shows it's busy.
4. **Add affordance during component unmount → cancel optimistic registration if no save fired yet; complete save if fired; reconcile-or-discard on remount (CA rec).** Don't leak in-flight saves; don't orphan optimistic state.
5. **Add affordance on offline state → fail visibly with offline indicator (CA rec).** Don't silently queue (confusing). Surface "Cannot add while offline" or equivalent; user retries when online.

Plus the original scenarios:

- Add tier → type into new column → ALSO add another tier while typing → original input focus persists OR is gracefully transferred
- Add tier on slow network → typing into new column before server response returns → optimistic value preserved on reconcile

## 7. Discovery questions (Pattern 41 analogue)

Briefs for redesigns use Pattern 41 (design discovery questions). For behavioral sweeps, the analogue is diagnostic discovery questions. CA recommendations included.

**Q1: Should diagnosis be exhaustive across the codebase or symptom-driven?**
- CA rec: **exhaustive.** Symptom-driven misses silent gaps. This is a sweep, not a bug fix.

**Q2: Should Pattern 47 replace Form pattern + Optimistic computation pattern entries in CLAUDE.md, or sit alongside them as a unification reference?**
- CA rec (original): **replace.** Pattern 47 is the unified pattern; keeping all three creates ambiguity about which is the source of truth.
- **REFINED (May 2026, post-Architect MEMORY surface): preserve with cross-reference.** Architect's `pattern_destination_heuristic` MEMORY entry argues "discoverability beats minor duplication." Pattern 47 is promoted as the authoritative standing pattern in CLAUDE.md; Form pattern + Optimistic computation pattern entries are preserved with their original framing intact (grep-discoverability of `useActionState`, `wait-for-quiet`, `Zustand`, etc. retained), each with a one-line `See Pattern 47 (Autosave focus-stability) for the unified pattern this is part of.` cross-reference. Pattern 47 is authoritative; prior entries are navigation aids.

  Reference cross-reference shape (Form pattern entry):

  > **Form pattern** — controlled inputs + useActionState; never uncontrolled forms with onBlur. Save handlers receive new value as explicit parameter, not via stale ref reads.
  >
  > See Pattern 47 (Autosave focus-stability) for the unified pattern this is part of.

  Same shape for Optimistic computation pattern entry. Brief content unchanged; one-line cross-reference added.

**Q3: Should fixes prefer hook-level changes (smallest surface) or store-architecture changes (broadest fix)?**
- CA rec: **hook-level first.** Escalate to store-architecture only if hook-level doesn't generalize. Smaller blast radius; lower regression risk.

**Q4: Should add-affordance actions explicitly register new entities (tier, SKU, row) in the optimistic store BEFORE the server response returns?**
- CA rec: **yes.** Optimistic registration is the canonical pattern; server confirmation reconciles after wait-for-quiet. This matches how the optimistic store already works for value edits. The registration-gap root cause category disappears if optimistic registration is universal.

**Q5: Should the sweep include a lightweight regression test suite for the canonical scenarios?**
- CA rec: **yes.** Playwright (or equivalent) covering add-affordance scenarios. Prevents future regressions when slices introduce new affordances. Architect (once restored) verifies tests cover all known affordances at slice impl time.

**Q6: When should the Pattern 47 promotion land in CLAUDE.md — at brief approval, after diagnosis, or after fixes ship?**
- CA rec: **after diagnosis, before fixes.** Diagnosis may reveal that the unified pattern needs refinement (e.g., a subpattern for add-affordances explicitly). Land the definitive Pattern 47 once diagnosis confirms the right framing, then apply it during fix work.

## 8. Pattern 30 deliverables

**Not applicable.** This is a behavioral/code sweep, not a visual or UX redesign. No CD design touch required.

If diagnosis surfaces a UX implication (e.g., loading state on add-affordance, pending indicator on new tier before server confirmation), CA flags to Edward for separate UX decision. Not expected.

## 9. Open items / pending Edward dispositions

1. **Approve Pattern 47 promotion in CLAUDE.md with preserve-with-cross-reference posture** (REFINED disposition, May 2026 post-Architect MEMORY surface; was originally "replace"). Pattern 47 is authoritative standing pattern; Form pattern + Optimistic computation pattern entries preserved as `See Pattern 47` cross-reference stubs with original framing retained for grep-discoverability. See Section 7 Q2 for cross-reference wording template.
2. **Approve exhaustive audit scope** (CA rec: yes — APPROVED)
3. **Approve lightweight regression test suite addition** (CA rec: yes — APPROVED)
4. **Approve sequencing as new item 3 on v1 path, before Pricing reframe** (Edward already disposed: yes — APPROVED)
5. **Confirm: any schema touches expected, or purely client-side?** (CA expectation: purely client-side; CC verifies during diagnosis; Architect §0.5 confirms — APPROVED expectation, verification pending)

## 10. Connections to other slices

- **Pricing reframe v1 (item 4)** — touches highest-density tier input surface; must land on clean Pattern 47 foundation. This sweep is its prerequisite. Pricing reframe impl Architect-verifies new tier-input affordances against Pattern 47.
- **Leaf-detach micro-slice (item 5)** — adds detach affordance; any new input affordances introduced must apply Pattern 47. Architect verifies at impl.
- **R6.2 freight implementation (item 6 — shipped)** — any add-affordances introduced by R6.2 (e.g., add freight line, mode selector toggle) included in Pass 2 catalog. If gaps surface, fix in this sweep.
- **Slice 11 PDF customer-facing bindings (item 7)** — customer-facing render only; no editable input fields; Pattern 47 doesn't apply. No interaction.
- **Microsoft OAuth (item 8)** — config-heavy; minimal input surface; no Pattern 47 implications.
- **Mark-Accepted writebacks (item 9)** — state machine + external integration; minimal user input surface. The "accept" affordance itself must verify focus doesn't yank during writeback fire — included in Pass 2 if it has any input fields (e.g., reason for acceptance, notes).
- **Pre-launch review (item 10)** — Pattern 47 coverage spot-check on customer-facing surfaces (which shouldn't have editable autosave fields anyway). Mostly already covered by this sweep.
- **Parallel branch experiment (Pricing reframe + Leaf-detach)** — Architect restoration is the gating dependency for parallel safety; this sweep is the slice immediately before parallel kickoff. If sweep surfaces unexpected complexity, parallel pair may need to defer.

## 11. Sequencing within the slice

**Step 1: Inventory.** CC catalogs all editable input surfaces (static) and all add-affordances (dynamic). Output: `docs/autosave-audit-inventory.md`.

**Step 2: Diagnose tier 6 symptom.** CC reproduces the Aisha-demo symptom on Pricing tier add. Instruments the three root cause categories (hook race / registration gap / mutation yank). Identifies which is firing. Output: root cause documented.

**Step 3: Draft Pattern 47 unified definition.** CC drafts the unified pattern incorporating diagnosis findings. Reviews with Edward + CA. Architect (if restored) verifies against CLAUDE.md conventions.

**Step 4: Promote Pattern 47 to CLAUDE.md.** Pattern 47 lands as the authoritative standing pattern. Form pattern + Optimistic computation pattern entries gain one-line `See Pattern 47 (Autosave focus-stability) for the unified pattern this is part of.` cross-references; original framing preserved for grep-discoverability of `useActionState`, `wait-for-quiet`, `Zustand`, etc. (REFINED Q2 disposition.)

**Step 5: Static field audit (Pass 1).** CC verifies each cataloged static field against Pattern 47. Findings batched. Output: `docs/autosave-audit-pass-1.md`.

**Step 6: Dynamic affordance audit (Pass 2).** CC runs canonical scenarios against each add-affordance. Findings batched. Output: `docs/autosave-audit-pass-2.md`.

**Step 7: Fix application.** Root cause fixes applied per non-compliant surface. Hook-level first; escalate to store-architecture if needed. Each fix verifies the canonical scenario passes.

**Step 8: Regression test suite.** CC adds Playwright (or equivalent) coverage for canonical add-affordance scenarios. Tests pass against fixed surfaces.

**Step 9: Edward smoke pass.** Edward smokes the canonical scenarios manually. Tier 6 add specifically verified as the proof point. Findings batched.

**Step 10: Audit findings disposition.** Smoke findings dispositioned (fix now / fix in v1.5+ / accept-risk). Follow-up commits absorb fix-now findings.

**Step 11: Architect verification (or CC self-audit + Edward review).** If Architect restored by this point, Architect verifies Pattern 47 coverage at impl completion. If not, CC self-audits with Edward review.

**Step 12: PR to main.**

---

## Notes for CC at kickoff

1. **Diagnostic discipline.** Don't commit to a root cause hypothesis before instrumenting. Edward's hypothesis (registration gap on dynamic IDs) is plausible but unconfirmed. Instrument all three categories on the tier 6 case; let evidence pick.

2. **Pattern 47 promotion is the load-bearing artifact.** This sweep is partially a code-fix slice and partially a documentation discipline slice. The unified pattern in CLAUDE.md is what future slices will verify against. Get the framing right.

3. **Architect restoration interaction.** If Architect is restored before Step 5, route Pass 1 and Pass 2 audits through Architect for pattern-coverage verification. If Architect is still pending at Step 5, CC proceeds with self-audit; Architect picks up at Step 11.

4. **Regression test scope.** Lightweight. The goal is "future slices that add affordances don't regress this sweep." Don't gold-plate the test suite; keep it focused on add-affordance canonical scenarios.

5. **Connection to parallel branch experiment.** This sweep is the last slice before potential parallel-pair kickoff (Pricing reframe + Leaf-detach). Anything surfaced here that suggests parallel work is risky — flag to Edward via CA before parallel kickoff.

6. **Slice 9.4b single-concern helper naming applies (Amendment C, May 2026).** If diagnosis surfaces a need for new hooks or helpers (dynamic-field registration, add-affordance focus handoff, etc.), name them per-concern: `useAutosaveRegistration`, `useDynamicFieldFocus`, `useAddAffordanceGuard`. NOT generalized with discriminated unions: `useDynamicField(goal: FieldGoal, ...)`. Architect MEMORY.md `slice_9_4b_patterns` entry documents the discipline — math is shared; operational meaning + microcopy differ per goal; naming reads clearer at the call site. Extract a shared utility (e.g., `computeDynamicFieldKey`) on the second instance, not the first.
