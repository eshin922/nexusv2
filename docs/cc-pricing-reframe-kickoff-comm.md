# CC kickoff comm — Pricing reframe v1

**CC — Pricing reframe v1 kickoff. v1 path item 2; first slice after autosave focus-stability sweep merges. Brief approved + Pattern 30 deliverables complete; ready for Pattern 22 §0.5 verification → kickoff.**

## Pre-kickoff readiness checklist

| Item | State |
|---|---|
| Autosave focus-stability sweep | ✅ merged (PR #32) |
| Canon revision PR | ✅ merged (5→6 reverted to 4 + Quote sub-structure; Operations reframed as wrapper) |
| Pricing reframe brief | ✅ approved (substance distributed across designer notes + data-source map + this kickoff comm — no standalone CA brief artifact; Architect §0.5 verifies against the bundle). **Workflow exception — Pricing reframe is grandfathered. Forward precedent: every slice has a CA brief per autosave (PR #31) and Quote umbrella (PR #34).** |
| CD design deliverables | ✅ complete — Pattern 30 package, all 3 pushbacks dispositioned, scenario ③ fixture corrections applied |
| Pattern 30 deliverable check | ✅ confirmed — bundled HTML at `docs/design-prototypes/dist/Nexus Pricing Reframe v1.html`; unbundled source (`dist/pricing.jsx`, `dist/pricing_data.js`, `dist/pricing_styles.css`); designer notes + data-source map at `docs/pricing-reframe-{designer-notes,data-source-map}.md` (moved to docs/ root per single-canonical-location convention) |
| Architect Pattern 22 §0.5 verification | ⏳ pending — run against post-canon-revision state |
| Edward dispositions on 5 Section-9 items | ✅ all dispositioned with CA recommendations accepted |

## What kicks off

Implementation of Pricing reframe v1 (Path 3 Hybrid). Brief substance distributed across the artifact bundle (this kickoff comm + designer notes + data-source map + unbundled source); no standalone CA brief artifact (workflow exception — grandfathered). Design deliverables at `docs/design-prototypes/dist/` (bundled HTML + unbundled source files) and `docs/design-prototypes/dist/docs/` (designer notes + data-source map).

## What ships in this slice

Scope per the approved brief:

- **Pricing surface UI refresh** per CD's Path 3 Hybrid design — blended caption with stronger framing ("Blended is the per-tier average — your realized margin is the tier the customer picks"), per-tier compliance block (collapsible when all tiers at target), tier-aware suggestion engine (surgical / global / accept-risk with context-aware ranking)
- **7 scenario states** per designer notes: ① all tiers above target, ② one tier below target, ③ multiple tiers below target, ④ one tier below floor, ⑤ empty/no tier data, ⑥ applying suggestion (transient state), ⑦ post-apply (delta chip + tint)
- **ROOM-state pill copy** derives from `belowFloor` and `belowTarget` counts (not from `blended_state` alone). Pill format: `BLENDED [STATE] · N TIER RISK` with state-appropriate substitutions
- **Tier-aware suggestion engine** with context-aware ranking (per brief §4.4 / designer notes table)
- **Accept-risk gating** — permissive default; accept-risk available only when at least one tier is below target AND recommended tier is above target (per Pushback 3 disposition)
- **`pricing_events` telemetry table** (new schema) — single table, 5 event types: `surgical_apply`, `request_override`, `recommended_fired`, `recommended_accepted`, `recommended_overridden`. Schema per designer notes "One feature commitment for v1" section
- **Scenario ⑥/⑦ token-level specs** per designer notes (added in CD's follow-up addendum) — `APPLYING…` chip styling, post-apply toast, `changed` row tint, delta chip styling, persistence-until-next-action behavior
- **Pricing surface "Send to customer" CTA** stays unchanged in THIS slice (visual + behavior + wording). Navigation target update to Quote > Preview Quote sub-tab is implemented in the Quote umbrella slice (item 4), not here. Don't touch the CTA in this slice.

## What does NOT ship in this slice

- Quote umbrella sub-tab restructure (item 4 on v1 path; separate slice)
- Tier Selection sub-tab UX (Quote umbrella slice scope)
- Mark Accepted sub-tab dissolution (Quote umbrella slice scope)
- NetSuite SO push (Quote umbrella slice scope)
- HubSpot deal stage push (Quote umbrella slice scope)
- Frame doc (`docs/post-pricing-flow-ia-frame.md`) — CA work, separate artifact, runs in parallel
- Pattern 47 retroactive application to Pricing tier inputs — already covered by autosave focus-stability sweep (PR #32). Verify at impl time that new tier-input affordances in this slice respect Pattern 47.

## Pre-impl steps

### 1. Architect Pattern 22 §0.5 verification

Run against the four-artifact bundle (Pricing reframe brief substance distributed across these, not a single artifact):

- This kickoff comm (`docs/cc-pricing-reframe-kickoff-comm.md`) — scope + sequencing + pattern coverage + dispositions
- Designer notes (`docs/pricing-reframe-designer-notes.md`) — design decisions, pushback dispositions, schema commitments, Q1-Q7 dispositions, scenario ⑥/⑦ token-level specs addendum
- Data-source map (`docs/pricing-reframe-data-source-map.md`) — every UI field traced to schema
- Unbundled source at `docs/design-prototypes/dist/` (`pricing.jsx`, `pricing_data.js`, `pricing_styles.css`) and bundled prototype (`Nexus Pricing Reframe v1.html`) — visual/behavioral spec
- `pricing_events` table schema commitment (per designer notes)
- Post-canon-revision CLAUDE.md state (4 peer surfaces, Quote umbrella sub-structure documented)

Expected verification scope:
- Schema entity match for all `quote_tiers.*` and `firm_settings.*` fields referenced in design
- New `pricing_events` table schema (column types, FK shapes, index strategy for cohort analysis queries)
- Audit-log namespace check — confirm new event values (`surgical_apply`, etc.) are collision-safe; confirm `diff_json.source` naming follows Slice 9.2 convention (likely `system_suggestion` for ★ Recommended apply path, per existing precedent)
- Pattern 47 interaction — confirm tier-input affordances on Pricing surface respect autosave focus-stability after recent sweep
- Pattern 25 verification on `pricing_events` schema (FK semantics, RLS policies, index strategy)

Surface any findings before kickoff. CA dispositions if substantive.

### 2. After Architect PASS

Open implementation branch from main (suggested: `slice-pricing-reframe-impl`). Proceed with implementation per the design package + brief.

## Sequencing within the slice

1. **`pricing_events` table migration** — new table, no data backfill, follow established migration numbering + naming convention
2. **Pricing surface UI refresh** — Path 3 Hybrid design per CD package (blended caption, per-tier compliance block, suggestion engine, accept-risk gating)
3. **Scenario state rendering** — all 7 scenarios per designer notes; ROOM-state pill copy derives from computed `belowFloor` + `belowTarget` counts (NOT from static fixture strings — this was the scenario ③ bug CD self-caught)
4. **Tier-aware suggestion engine** — context-aware ranking logic per brief §4.4 / designer notes table
5. **Telemetry instrumentation** — write `pricing_events` rows for all 5 event types; tier-context fields populated per Pushback 2 disposition
6. **Scenario ⑥ APPLYING transient state** — chip placement, opacity treatment, row tint per designer notes token specs
7. **Scenario ⑦ post-apply state** — toast, delta chip, `changed` row tint, persistence-until-next-action per designer notes token specs
8. **Inline callout treatment** — risk callouts inline within tier rows (per Q5 disposition); floor breach as separate FloorBlock above TierComplianceBlock
9. **Stacked/narrow-viewport variant** — per Q7 disposition; collapses to cards on viewports < 720px
10. **Edward smoke pass** — verify scenarios ①-⑦ render correctly, suggestion engine ranking correct per context, telemetry events fire with correct tier context, accept-risk gating respects recommended-tier health, below-floor cases block accept-risk and surface admin override path
11. **Audit findings disposition**
12. **Designer audit** — CD reviews implementation against R5 Pattern 30 deliverables; findings batch in standard Step 10 format
13. **Architect verification at impl completion** — pattern coverage check (Pattern 47 on tier inputs, Slice 9.2 audit source namespace on suggestion-apply events, Slice 9.4b helper naming if any new helpers introduced)
14. **PR to main**

## Pattern coverage at impl

Architect verifies at impl completion. Key patterns to verify:

- **Pattern 47 (autosave focus-stability)** on any new tier-input affordances. Should pass cleanly since autosave sweep just landed; this slice is the first to consume Pattern 47 at scale.
- **Slice 9.2 `diff_json.source` namespace** for suggestion-apply server actions. Per existing precedent (`system_suggestion`), use namespaced source values for ★ Recommended apply paths.
- **Slice 9.4b single-concern helper naming** if any new helpers introduced (e.g., `applySurgicalAdj`, `applyGlobalAdj`, `acceptRiskSendAsIs` — not a generalized `applyPricingSuggestion(kind, ...)`).
- **Customer-view boundary guard** — verify NONE of the new Pricing surface state leaks into customer-facing PDF render. Specifically, `pricing_events`, suggestion engine state, ROOM-state pill copy, per-tier compliance state, audit fields — all internal-only. Pattern 45 verification at customer-view side will catch any leakage.
- **Action result pattern** for new server actions (suggestion-apply, telemetry-write).
- **revalidateQuoteTree** for any quote-mutating actions.

## Architect MEMORY.md updates expected

After impl completes, Architect MEMORY.md gains entries for:

- Pricing reframe v1 conventions — `pricing_events` table shape, telemetry event field discipline, tier-context capture pattern
- ROOM-state pill copy derivation rule (compute from state, not from stored strings — the scenario ③ lesson CD surfaced)
- Suggestion engine context-aware ranking convention (surgical when one tier below; global when multiple; accept-risk gated on recommended-tier health)

Bank as project entries similar to `slice_9_2_patterns.md` and `slice_9_4b_patterns.md`.

## Notes for CC at kickoff

1. **The brief substance is distributed across the artifact bundle** (this kickoff comm + designer notes + data-source map + unbundled source) — there's no standalone CA brief artifact for this slice (workflow exception; grandfathered). Designer notes + this comm carry scope + pattern coverage + dispositions; data-source map carries field-to-schema traceability; unbundled source carries visual + behavioral spec. If they conflict, surface to CA before resolving.

2. **Pattern 30 deliverable bundle is comprehensive.** Designer notes, scenario screenshots (5 prototype states), token-level specs for ⑥/⑦, data-source map, prototype source files. Reference the unbundled source files at `docs/design-prototypes/dist/` (`pricing.jsx` / `pricing_data.js` / `pricing_styles.css`) for visual specification when designer notes are ambiguous.

3. **Scenario ③ fixture lesson.** Pill copy + description strings DERIVE from computed state (`belowTarget` count, etc.) — do NOT store as static strings that could drift from computed truth. This was CD's self-caught bug; the rule applies to production code as well as fixtures.

4. **Telemetry tier-context capture is load-bearing.** v1.1 Path 2 promotion analysis depends on capturing which tier had the violation and which tier was the suggestion target. Don't ship telemetry without those fields populated.

5. **★ Recommended reliability hedge.** When `quote_tiers.recommended` is unset, accept-risk gating defaults permissive. This is the documented Pushback 3 disposition — don't tighten it during impl. v1 observation feeds v1.1 reliability analysis.

6. **Architect is active per slice.** Architect verifies at brief Pattern 22 §0.5 (pre-impl) and at pattern coverage check (impl completion). Don't skip either — both gate the PR.

7. **Designer audit (Step 12) precedes Architect verification (Step 13).** CD reviews fidelity to R5 design; Architect verifies pattern coverage. Different concerns, sequenced not bundled.

8. **The "Send to customer" CTA stays as-is in this slice.** Don't touch its target URL, wording, or behavior. The Quote umbrella slice (item 4) updates the navigation target to Quote > Preview Quote sub-tab. Keeping concerns separate keeps slices clean.

9. **Smoke discovery rate on a slice this size is typically 1-2 days of follow-up commits.** Plan for it. Findings batch in standard Step 10 disposition format.

10. **Pre-launch review (final v1 path item) covers customer-facing render verification.** Pricing surface is internal-facing; customer-view boundary guard is the load-bearing concern. Pattern 45 verification at pre-launch covers any boundary slip.

---

## Sequencing summary

1. Verify pre-kickoff readiness checklist (above) — all green except Architect §0.5
2. Architect runs §0.5 verification on the brief + design package + new schema
3. Disposition any §0.5 findings (Edward + CA + Architect three-way per established workflow)
4. Open implementation branch from main
5. Proceed with implementation per the 14-step sequencing above
6. Standard Step 9-14 close-out (smoke, audit, Architect impl verification, PR)
7. PR review + merge
8. Next slice: Leaf-detach micro-slice (v1 path item 3)

Standing by for Architect §0.5 result and Edward authorization to open impl branch.
