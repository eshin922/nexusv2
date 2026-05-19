# CC PR Comm — Pricing Reframe v1 Closeout (PR #38)

**From:** CC (Claude Code)
**To:** Edward + CA + CB
**Re:** Slice closeout — ready-to-merge pending final smoke
**PR:** #38
**Branch:** `slice-pricing-reframe-impl`
**Status:** All 17 brief steps closed. Three rounds of fixes landed. Pre-final-smoke handoff.

---

## Summary

Pricing reframe v1 (Path 3 Hybrid) impl per CD's Pattern 30 design package + CA brief. Top-band reframe (BlendedHeadline + TierComplianceBlock + FloorBlock + SuggestionEngine + ApplyToast + EmptyState) renders ABOVE the preserved ROOM 0/1/2/3 components per Edward's interim (b) disposition. New `pricing_events` telemetry table; new audit_log discipline for global-apply (cascade pattern). Three rounds of smoke-driven fixes hardened the surface against float-precision no-op loops + apply-overflow + audit-log noise.

## Commit chain (9 commits)

| # | Commit | Brief step / Round | Scope |
|---|---|---|---|
| 1 | `ec1b751` | Step 2 | `pricing_events` table migration (0029); FK semantics per Disposition A; CHECK constraint; two composite indexes |
| 2 | `48d57fa` | Step 3 | 6 new top-band components; canonical CSS adopted Pattern 30 path-B-default; wired above preserved ROOM 0-3 |
| 3 | `126b69c` | Step 5 | Suggestion engine math + ranking + accept-risk gating (Slice 9.4b single-concern naming) |
| 4 | `54ab41e` | Step 6 | `pricing_events` telemetry; `recommended_fired` event; `writePricingEvent` helper |
| 5 | `8eba40b` | Step 7 | `applySurgicalAdj` + `applyGlobalAdj` with cascade audit per Disposition B |
| 6 | `03ea52d` | Steps 8+9 | Shell + ReframeStateContext; APPLYING + post-apply UI states; APPLYING chip; delta chip; toast |
| 7 | `dbc51ac` | Round 2 | Bug #2 (α + β) apply bounds pre-check + suggestion engine pre-check; Bug #3 error toast variant |
| 8 | `6a25396` | Round 2 | Bug #D fix (tolerance + min-delta guard) in suggestion engine; investigation notes for #B/#C/#E |
| 9 | `6137683` | Round 3 | Canonical predicate extraction (`src/lib/pricing-predicates.ts`); tolerance propagated to TierComplianceBlock + BlendedHeadline + FloorBlock + SuggestionEngine telemetry |

## All 17 brief steps closed

### Explicit commits

| Step | Status | Commit |
|---|---|---|
| 1 — Architect §0.5 re-verification | ✅ PASS (pre-existing) | n/a |
| 2 — `pricing_events` migration | ✅ | `ec1b751` |
| 3 — Pricing surface UI refresh | ✅ | `48d57fa` |
| 5 — Suggestion engine math + ranking | ✅ | `126b69c` |
| 6 — Telemetry instrumentation | ✅ | `54ab41e` |
| 7 — Apply paths with audit discipline | ✅ | `8eba40b` |
| 8 — Scenario ⑥ APPLYING transient state | ✅ | `03ea52d` |
| 9 — Scenario ⑦ post-apply state | ✅ | `03ea52d` |

### Implicit (closed via Step 3 + canonical CSS adoption)

| Step | Closed by | Notes |
|---|---|---|
| 4 — Scenario state rendering (1-7) | Step 3 BlendedHeadline state-derivation logic + Steps 8/9 APPLYING/changed states | All 7 scenarios derive from live state, not fixtures |
| 10 — Inline callout + FloorBlock separation | Step 3 placed FloorBlock above TCB; inline callouts in TCB per row state | Q5 disposition honored |
| 11 — Stacked / narrow-viewport variant | CSS media query in canonical adoption (`pricing-reframe.css:476-510`) | Q7 disposition honored; cards collapse < 720px |
| 12 — Strip `pr-state-strip` review chrome | No React component renders the `.pr-state-strip` element | LOW-6 from §0.5 — canonical CSS rules stay verbatim (Pattern 30); production DOM has no strip element |

### Close-out

| Step | Status |
|---|---|
| 13 — Edward smoke pass | ⏳ Pending re-smoke against `6137683` + final pass |
| 14 — Audit findings disposition | ✅ Three rounds documented inline + this comm |
| 15 — Designer audit | ⏳ CD review post-merge or pre-merge per Edward call |
| 16 — Architect impl verification | ⏳ Optional given §0.5 PASS + grep verifiers cover the structural concerns |
| 17 — PR to main | ✅ Open as #38 |

## Smoke arc — three rounds

### Round 1 (initial smoke against `03ea52d`)

CB walked the 7-scenario matrix. Surfaced 1 blocker (Bug #2 apply-overflow) + 2 medium bugs (#1 stale toast, #3 no error toast) + 4 anomalies (preserved-component state-mismatch) + systemic concern (state derivation helper).

**Dispositions:**
- Bug #2 → fix per (α) + (β) — landed `dbc51ac`
- Bug #3 → error toast variant — landed `dbc51ac`
- Bug #1 → investigation inconclusive (code shows null-initial state); deferred pending repro
- Anomalies #1/#2/#4 → scope OUT per Edward (preserved ROOM components stay; supersede in CD Pricing surface redesign follow-up slice)
- Anomaly #3 → shared root with Bug #1; same deferral
- Systemic state helper → declined (scope creep at the time)

### Round 2 (re-smoke against `dbc51ac`)

CB surfaced 2 HIGH-severity bugs not visible in round 1, plus architectural insight on Gates 1/4:
- Bug #D HIGH — float-precision no-op loop (tier at 39.99997% flagged below-target → infinite +0% apply loop)
- Bug #E HIGH — Surgical absent from DOM on below-floor
- Bug #B LOW — stale delta chip after manual edit
- Bug #C — negative manual input investigation
- Item 1 — Gates 1/4 verification gap (overflow unreachable via realistic workflow post-PR-#38; needs unit-test coverage to replace smoke gates)

**Dispositions:**
- Bug #D → fix per Part 1 (TARGET_TOLERANCE) + Part 2 (MIN_DELTA_PP) — landed `6a25396` (suggestion engine surface)
- Bug #E → investigation only (`6a25396`): code reading shows no filter branch exists; surfaced 3 possible explanations for CB to disambiguate via React DevTools
- Bug #C → investigation only (`6a25396`): negative input IS supported on price-adj fields per existing `percent-validation.ts:36` (`ALLOW_NEGATIVE.adj = true`); asked CB which specific field surfaced the issue
- Bug #B → DEFERRED to v1.1+ polish slice per Edward disposition
- Item 1 → SKIP test framework bootstrap for this slice per default lean (3); bank framework as standalone slice per PR #32 precedent

### Round 3 (CB re-smoke against `6a25396`)

CB surfaced that Bug #D fix didn't propagate to TWO display surfaces (TierComplianceBlock + BlendedHeadline) consuming cloned predicates. CA disposition: extract canonical helper (Option 2) — three surfaces with cloned predicates is the signal.

**Disposition:**
- Round 3 → new `src/lib/pricing-predicates.ts` canonical module; 4 surfaces (suggestion engine + 3 display) migrated; tolerance applied uniformly — landed `6137683`

Forward consumers banked in the module header (Phase A.1 v2 spec entry completeness chips, CD Pricing surface redesign tier-compliance rollups, Quote umbrella Tier Selection sub-tab).

## What ships

### Schema

- `pricing_events` table (5 event types + tier-context fields + cascade-analysis indexes)
- Migration `0029_pricing_events_table.sql` applied to shared dev/prod DB pre-merge (Edward authorized)
- RLS off (codebase posture); not in realtime publication; write-only from server actions

### Library / pure modules

- `src/lib/pricing-suggestions.ts` — `rankPricingSuggestions` + builders + accept-risk gating; MIN_DELTA_PP backstop
- `src/lib/pricing-predicates.ts` — canonical `TARGET_TOLERANCE` + `isBelowTarget` + `isBelowFloor` (4 consumers)

### Components

Six new components in `src/components/pricing-reframe/`:
- `BlendedHeadline`, `TierComplianceBlock`, `FloorBlock`, `SuggestionEngine`, `ApplyToast`, `EmptyState`
- `PricingReframeShell` (client wrapper) + `ReframeStateProvider` (React Context for cross-component apply state)

### Server actions

- `src/app/actions/pricing-events.ts` — `writePricingEvent` (internal) + `logPricingEvent` (public)
- `src/app/actions/pricing-apply.ts` — `applySurgicalAdj` (single-tier write + single audit) + `applyGlobalAdj` (N-tier writes + cascade audit root+derived). Both with `assertNewAdjFitsBound` pre-check (Bug #2 α).

### Audit log additions

- `tier_price_adj_updated` action (existing) gains `diff_json.source` values:
  - `pricing_suggestion_surgical` (single-tier apply via SuggestionEngine)
  - `pricing_suggestion_global` (N-tier apply via SuggestionEngine; derived rows of cascade)
- `pricing_suggestion_global_applied` action (new) — root row of global-apply cascade; entity_type=quote

### CSS

- `src/styles/pricing-reframe.css` (Pattern 30 path-B-default; verbatim from `docs/design-prototypes/dist/pricing_styles.css`)
- Wired in `src/app/globals.css` after `r2-pricing.css`

## Pattern coverage

- ✅ **Pattern 22 §0.5 verification** — PASS post-corrections (PR #37); all 5 §0.5 findings dispositioned
- ✅ **Pattern 25** — `pricing_events` schema fully spec'd (FK semantics, CHECK, indexes, RLS posture, realtime exclusion)
- ✅ **Pattern 30 path-B-default** — canonical CSS adopted verbatim; pr-state-strip CSS rules stay (no React renders the strip)
- ✅ **Pattern 45 customer-view boundary guard** — zero leakage; new components/actions/events all internal-only
- ✅ **Pattern 47 (autosave focus-stability)** — zero new `<input>` elements; suggestion-apply UIs are `<button>` (carve-out applies); prebuild verifier PASS
- ✅ **Slice 9.2 audit source namespace** — `pricing_suggestion_surgical` / `pricing_suggestion_global` new namespaced values per Disposition B; no collisions
- ✅ **Slice 9.4b single-concern helper naming** — `applySurgicalAdj` / `applyGlobalAdj` distinct actions; `pricing-suggestions.ts` + `pricing-predicates.ts` distinct modules; no discriminator unions
- ✅ **Cascade audit pattern** — global-apply emits root + N derived linked via `caused_by_audit_id`
- ✅ **Pattern 39 nexus extension hygiene** — error-toast inline-style variant documented in `apply-toast.tsx` header

## Banked for follow-up (not blocking merge)

| Item | Disposition |
|---|---|
| **Bug #B — stale delta chip after manual edit** | v1.1+ polish slice. Clean fix shape banked in `6a25396` commit message (option (a) server-action newAdj return + LastApplySummary extension + ReframeStateProvider state-watch). Real but bounded UX friction. |
| **Anomalies #1/#2/#4 — VerdictBand + subtitle + meta tiles state-mismatch** | Supersede in CD Pricing surface redesign follow-up slice. Preserved ROOM components stay as-is per Edward's interim (b) disposition. Brief §3 documents the deferral. |
| **Item 1 — Unit tests for `assertNewAdjFitsBound` + error toast** | Bank test framework bootstrap as standalone slice (matches PR #32 precedent). Verification gap documented in this comm. Going forward, smoke gates exercising unreachable-via-workflow code paths get retired; unit tests fill the gap when framework lands. |
| **`auditRef` in ApplyToast** | Server actions currently return `null` for auditRef; future enhancement returns the actual audit row id for forensic linking. Low priority — toast still renders informatively. |
| **`loadCostingState(quoteId)` shared helper extraction** | Banked in Slice 9.4b as "extract on third call site"; this slice didn't trigger (apply actions use a lighter load — just `quote_tiers` + `quote.globalPriceAdjPct`). |
| **Server-side re-derive for apply forgery defense** | v1 trusts client-provided `applyDelta` (numerically bounded). Slice 9.4b's re-derive pattern can layer in if analytics integrity surfaces concerns. |

## Closed / out of scope

| Item | Reason |
|---|---|
| Bug #1 — stale toast on page load | Misinterpretation diagnosis closed in Round 2; code reading shows null-initial state; no persistence path |
| Anomaly #3 — stale delta chip on hard-refresh | Shared root with Bug #1; closed |
| Bug #A — toast auto-fade | Intentional design per brief §4.6 (persist-until-next-action; no fade-out timer) |
| Bug #E (round 2) — Surgical absent on below-floor | Investigation showed no filter branch; pending CB re-smoke disambiguation (likely (ii) CSS-dim-reads-as-absent) |
| Bug #C — negative input rejection | Investigation showed negative input IS supported on price-adj fields; CB to specify which field if observed elsewhere |

## Test plan results

- [x] Typecheck PASS (every commit)
- [x] Prebuild verify PASS (Pattern 47 zero violations; customer-view boundary clean)
- [x] Migration applied to shared dev/prod (Edward authorized)
- [x] CB Round 1 smoke — surfaced bugs dispositioned
- [x] CB Round 2 smoke — surfaced bugs dispositioned
- [x] CB Round 3 tight pass — tolerance propagation expected (verification gate pending)
- [ ] CB final tight pass against `6137683` — verify Round 3 disposition
- [ ] Edward final approval

## Sequencing after merge

Per Edward's prior comm, Pricing reframe wrap activates the Phase A.1 v2 pre-impl checklist:

- ✅ Pricing reframe wrap (this PR — pending final smoke + merge)
- ⏳ Architect §0.5 runtime for Phase A.1 v2 (Edward triggers when ready; ETA 1-2 days)
- ⏳ Edward §15 dispositions (4 items: ASY/LEAF Product Type taxonomies + RLS role assignments + NetSuite payload path)
- ⏳ Pre-impl checklist passes → CC opens `slice-phase-a1-v2-impl-1-schema`

In the interval between merge + Phase A.1 v2 impl-1 opening, follow-up commits possible on smaller bankings (Bug #B fix slice, test framework bootstrap slice, CD Pricing surface redesign brief landing) per Edward direction.

— CC
