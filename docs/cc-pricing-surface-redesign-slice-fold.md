# slice-pricing-surface-redesign — Pattern 27 cumulative fold + §0.5 Pattern 22 ledger

**Branch:** `slice-pricing-surface-redesign` · **Commits:** 13
(Steps 0-9 + patch rounds 1-3 + final-stretch close-out) ·
**Surface:** Pricing (`/pricing`)

Single artifact that consolidates every per-commit fidelity manifest
(Pattern 27 two-layer) and every pre-build schema/code-architecture
catch (Pattern 22 §0.5) from the slice. Read alongside the smoke
guide (`docs/cc-pricing-surface-redesign-smoke-guide.md`).

## Final-stretch close-out summary (2026-06-16)

Four actions per CA close-out comm + slice-fold update:

| Action | Status | Verification |
|---|---|---|
| **1 · ANOMALY-1** sub-copy denominator | ✓ patched (commit 13) | sub-copy now reads `state.tiers.filter(t => t.status === 'below_target').length` matching state-line lead |
| **2 · Re-seed PSR-6** to BLOCKED | ✓ executed | seed script idempotent re-run; all 6 fixtures back to scripted shapes |
| **3 · PSR-8 + PSR-14** gated walks | ✓ classifier-simulated | DB toggle smoke + invariant verifier scenarios `s08`/`s14` cover the gated-flag + inert-action shape |
| **4 · Gate-C audit log** SQL verification | ✓ confirmed | 4 surgical apply rows (`source: pricing_suggestion_surgical`) + 1 manual GPA row (no source flag) in 24h window |

**PSR-2 / PSR-7 / PSR-9 / PSR-12** banked DEFERRED per CA disposition
— coverage completeness, not architectural risk. Classifier
predicate-layer behavior verified via invariant verifier.

---

## §A · Pattern 27 cumulative fold

Per-commit manifests reorganized by surface dimension. STRUCTURAL =
what the brief contracts the slice to ship. POLISH = visual treatment
+ copy verbatim per CD designer notes + prototype. DEFERRED = scope
the slice explicitly punts. NOT-IN-ANY-STEP = items that didn't have
a step home (none for this slice — everything in scope had a home).

### STRUCTURAL MATCHED (whole-slice consolidation)

**Step 1 · Kickoff + CSS path determination + perf baseline**
- Path B-default determined (36 `.psr-*` prefix-clean selectors —
  Pattern 30 path-B-default eligible)
- All 19 design tokens verified present in `design-tokens.css`
- Server-side perf baseline: 211-213ms (auth-redirect floor; route
  itself sub-50ms)
- 9-step plan locked (Steps 2-9 sequenced + dependencies)

**Step 2 · Schema migration**
- `firm_settings.allow_override` BOOL NOT NULL DEFAULT TRUE
- `firm_settings.allow_accept_risk` BOOL NOT NULL DEFAULT TRUE
- Migration `0033_firm_settings_policy_gates.sql` named-consistently
  (renamed from auto-generated `0033_groovy_vampiro`)
- `versionedFirmSettingsUpdate` helper extended to carry both new
  columns forward on every update (Pattern from Slice RI.7
  versioned-table carry-forward audit)

**Step 3 · Classifier implementation**
- `src/lib/pricing-classifier.ts` (640 LOC) — pure
  `(quote, policy) → QuoteState` contract
- Mode enum 3-valued (`sendable` / `suggestion_led` / `blocked`);
  StateLineStatus 4-valued (provisional as status modifier per Q8)
- All 6 Edward round-2 fixes encoded: per-cell status classifier-
  owned, projected_blended_after_apply on Action,
  calculating_suggestion fallback path, override_unavailable inert
  action kind, data_incomplete qualifier in blocked mode,
  accept_risk_unavailable flag derivation
- `TARGET_TOLERANCE = 0.001` discipline inherited from
  `pricing-predicates.ts` (Bug #D float-precision fix carries
  forward — predicates remain the single comparator source)
- Cost-stack pass-through per cell (Q6 disposition; math-layer
  rollup TODO banked at classifier header + DetailCostStack
  bucket-formation site)
- `scripts/verify/pricing-classifier-invariants.ts` — 16 scenarios
  (14 CD + 2 calculating_suggestion extras), 7 invariants per
  brief §15. Hooked into `npm run prebuild` gate.

**Step 4 · STATE zone components + canonical CSS adoption**
- `src/styles/r-psr-pricing.css` adopted verbatim (Pattern 30
  path-B-default; 770 LOC). 4 review-chrome rule blocks dropped
  at header per Pattern 31 (`.psr-shell`, `.psr-strip`,
  `.psr-topbar`, `.psr-scenario-head`).
- `globals.css` `@import "../styles/r-psr-pricing.css"` added
  between `r-library-modal.css` and `r3-shared.css`.
- `src/components/pricing-surface/format.ts` — shared formatters
  mirroring CD prototype `fmtPct/fmtPct0/fmtUsd/fmtUsd2/fmtQty`.
- `src/components/pricing-surface/state-zone.tsx` — StateLine
  (always rendered; takes optional `justUpdated` prop), StateCallout
  (suggestion_led mount), StateCard (blocked mount). Each consumes
  QuoteState fields verbatim; no re-derivation.

**Step 5 · ACTION zone components**
- `src/components/pricing-surface/action-zone.tsx` (359 LOC):
  - `SendableSummary` — NEW component per CD §2.3 (only net-new
    component in the slice). Reads `state.summary_card`. 4-cell
    grid: Scope · Recommended tier · Order value · Blended margin.
  - `ActionCard` — generic ranked-action shell; reads one Action
    object; handles 7 ActionKind variants + disabled state. Inert
    kinds (`override_unavailable`, `calculating_suggestion`) render
    explainer without CTA button.
  - `SuggestionCard` — suggestion_led mode; 3 branches (calculating,
    apply_surgical preview, apply_global preview). Reads recommended
    Action's `projected_blended_after_apply` (classifier-owned per
    Edward fix #2).
  - `AcceptRiskBanner` — blocked + `!policy.allow_accept_risk`
    discoverability per round-2 disposition.

**Step 6 · DETAIL zone components**
- `src/components/pricing-surface/detail-zone.tsx` (700 LOC):
  - `DetailZone` — toggle wrapper; sessionStorage-persisted via
    key `psr.detail.open.{quoteId}` (Catch #5 + hydration-safe
    effect-read).
  - `DetailGlobalAdjust` — writable input bound to
    `quote.global_price_adj_pct` (real production field name per
    Catch #7 — NOT prototype's "global_lift_pct").
  - `DetailTierTable` — per-tier compliance from `state.tiers[]`;
    status badges + OVR chip.
  - `DetailCostStack` — Q6 inline rollup with TODO at bucket-
    formation site for math-layer extension.
  - `DetailPerSku` — per-SKU card grid; component-local expand
    state per `sku.id`.
  - `SkuBreakdown` — per-tier rows for one SKU; cell.status +
    cell.client_target_delta consumed verbatim from classifier.
  - `DetailMetaTiles` — reference tiles (most-headroom-tier,
    client-benchmark-count) folded into DETAIL per CD §4.3
    disposition.

**Step 7 · Page composer + recompute pipeline + mode-transition flash**
- `src/components/pricing-surface/pricing-surface-shell.tsx`
  (615 LOC):
  - Subscribes to CostingStore via granular selectors
    (`selectFirmSettings`, `selectGlobalAdj`, `selectQuoteRollup`,
    `selectSkuRollups`, `selectQuoteSummary`).
  - Pure adapter `buildClassifierInputs` builds QuoteInput +
    QuotePolicyInput; tier id remap UUID ↔ numeric stable across
    renders.
  - `classify()` runs per render via `useMemo` on adapter outputs.
  - Per-mode mount predicates per CD §2.1 (StateCallout · StateCard
    · SendableSummary mutually exclusive).
  - Mode transition: `previousModeRef` tracks prior render; effect
    fires `setJustUpdatedAt(Date.now())` + 30s timer on transition;
    StateLine reads `justUpdated` prop. `JUST_UPDATED_MS = 30_000`.
    DETAIL state preserved (composer never touches DetailZone's
    sessionStorage).
  - Apply paths reuse Slice 9.4b server actions per Pattern 28:
    `applyGlobalAdj`, `applySurgicalAdj`, `updateQuoteGlobalPriceAdj`.
    `request_override` + `preview_pdf` + `tighten_to_target` ship
    as no-op placeholders (banked v1.1+ / Slice 11).
- `pricing/page.tsx` — fetches firm-policy gates via parallel
  `isNull(effectiveUntil)` read alongside `quoteTiers`;
  PricingSurfaceShell mounted ABOVE legacy reframe shell + ROOM
  0/1/2/3 (Q10 disposition — tear-down deferred to Step 8).

**Step 8 · Legacy tear-down**
- 11 file deletions / ~3,089 LOC removed:
  - `src/components/pricing-reframe/` × 8 components
  - `src/styles/pricing-reframe.css` (510 LOC)
  - `src/app/.../pricing/sku-summary-row.tsx` (819 LOC)
  - `src/app/.../pricing/sku-breakdowns.tsx` (460 LOC)
- `@import "../styles/pricing-reframe.css"` removed from
  `globals.css`.
- `pricing/page.tsx` reduced to: PricingPageHead +
  non-editable-banner + PricingSurfaceShell.
  CostingStoreProvider wrapping retained.
- `pricing-page-head.tsx`: `<ActionCluster>` +
  `<MarkAcceptedCluster>` + `CustomerAcceptToggle` import +
  `tiers` prop removed per R7a IA grammar + Quote umbrella canon.
  `.actions` slot kept empty (grid register preservation).
- Pre-flight grep verified zero cross-surface consumers for every
  deletion candidate; shared primitives preserved per Catch #5.
- Comment-debt sweep: pricing-predicates.ts doc header refreshed
  (pricing-classifier replaces pricing-reframe consumers);
  costing-store.ts stale `sku-breakdowns.tsx` ref updated to
  PricingSurfaceShell.

**Step 9 · Smoke guide + slice fold + PR open**
- This artifact + smoke guide; no implementation changes this step.

### POLISH MATCHED (whole-slice consolidation)

**Visual treatment (CD designer notes + prototype HTML):**
- `.psr-*` register adopted verbatim — every JSX className in
  STATE/ACTION/DETAIL zone components matches the prototype
  selector 1:1. Pattern 30 path-B-default discipline.
- StateLine pill class register (`sendable` / `review` / `blocked`
  / `provisional`) — 4-value enum closed per Q8 disposition.
- StateCard 96px display blended margin number (right rail).
- StateCallout warn-accent left border + glyph "!".
- SendableSummary 4-cell grid · numeric register · mono sub-caps.
- ActionCard chrome: `.primary`, `.recommended`, `.demoted`,
  `.soft`, `.disabled`, `.override-unavailable`, `.calculating`
  classes mapped from Action object fields.
- SuggestionCard: title + sublabel + stats grid (margin before
  → after delta · curve shape · blended after apply) preserved
  verbatim from CD prototype.
- AcceptRiskBanner: `.psr-accept-risk-banner` chrome with
  `⌧` glyph + explainer copy verbatim.
- DetailZone: `.psr-detail` + `.psr-detail-toggle` + `.psr-detail-body`
  expand grammar; `▸` twirl glyph; meta-row format `"{N} SKUs
  · {M} tiers · cost stack · per-SKU breakdown"`.
- DetailTierTable: per-row pill class includes `t.status` →
  `.row-pill.{above_target|below_target|below_floor|unknown}`;
  OVR chip when `t.has_override`.
- "↻ just updated" hint chrome: `<span className="psr-just-updated">`
  + `<span className="glyph">↻</span>` + literal copy `"just
  updated"` per CD §4.6 / §9.2 pushback 2.

**Copy verbatim (CD designer notes §X.Y + prototype):**
- StateLine leads:
  - sendable: `"All tiers above target"`
  - suggestion_led: `"{N} tier{s} below target"` (pluralization
    via classifier)
  - blocked: `"{N} tier{s} below floor"`
- StateLine qualifiers (joined): `"{N} cells awaiting raws"`,
  `"{N} SKUs over client target"`, `"override unavailable · firm
  policy"`, `"mixed status · per-SKU view in detail"`.
- StateCard sub: `"{N.N}pp below the {floor}% floor · {N} cell{s}
  affected. Resolve below — admin override or surgical lift."`
- StateCallout head: `"Tier {N} at {N.N}%"` (worst tier);
  sub: `"Blended {N.N}% — under the {target}% target. Apply the
  recommended lift below, or preview & send acknowledging the
  risk."`
- SendableSummary heading: `"What you're sending"`; cell labels
  Scope · "Recommended tier" · "Order value · T{N}" · "Blended
  margin". Sub-captions per CD prototype.
- ActionCard CTA copy via `CTA_COPY` map: `"Preview PDF →"`,
  `"Apply →"`, `"Request →"`, `"Tighten →"`.
- SuggestionCard apply_surgical title: `"Lift Tier {N} by +{N}%
  sell price"` · sub: `"Surgical adjustment — only Tier {N} sell
  price changes. Other tiers stay where they are. Brings the
  worst SKU on Tier {N} to {N.N}% margin (above target)."`
- SuggestionCard apply_global title: `"Lift all tiers by +{N}%
  sell price"` · sub: `"Global adjustment — proportional lift
  across all tiers preserves the volume curve. Use when multiple
  tiers are below target; surgical would compound the curve and
  likely produce inverted volume incentives."`
- SuggestionCard calculating: `"Calculating suggestion…"` · sub:
  `"The suggestion engine is computing a lift path for this
  quote. The recommended action will appear here in a moment;
  refresh if it doesn't."`
- AcceptRiskBanner: `"Accept-risk is unavailable on this quote.
  Firm policy prohibits below-floor sends on margin-protected
  accounts. Use admin override or apply the recommended lift."`
- DetailZone toggle: `"Show pricing detail"` + meta `"{N} SKUs ·
  {M} tiers · cost stack · per-SKU breakdown"`.
- DetailGlobalAdjust head: `"Global price adjustment"` + meta
  `"Tuning lever · applies across all tiers"`; lab: `"Lift all
  tiers proportionally to recover margin without distorting the
  volume curve."` + hint: `"Surgical (single-tier) lives on the
  per-tier table below."`
- Override-unavailable explainer: `"Admin override unavailable
  on this account"` + sub: `"Firm policy prohibits below-floor
  overrides. Surgical lift is the only send path."`
- Pricing page H1 preserved verbatim per R2 grammar:
  `"Tune <em>price</em> & review."` (italic-em on "price").
- Sub-copy bound to blendedMarginStatus preserved verbatim from
  existing surface (3 branches: GOOD / BELOW_TARGET / BELOW_FLOOR).

### DEFERRED (whole-slice consolidation)

- **request_override action wiring** → v1.1+ admin override
  request workflow; no UI/server endpoint exists yet. Inert CTA
  in v1 per classifier `kind: 'request_override'` shape.
- **preview_pdf action wiring** → Slice 11 Preview Quote sub-tab
  (Quote umbrella).
- **tighten_to_target action wiring** → v1.1+ soft affordance;
  PMs manually adjust prices today.
- **Cell-level cost_stack rollup** → Q6 disposition; costing math
  layer extension TODO banked at DetailCostStack bucket-formation
  site + classifier header comment.
- **Recompute memoisation profile-tuning** → only if profile
  data ever shows classifier >10ms per render. Pattern 32
  pre-prod engineering tolerance.
- **Orphan-on-disk cleanup pass** (LinesRequiringReview,
  VerdictBand, PerTierOverrideCard, PricingSectionHead,
  active-tier-selector, ClientTargetCell, CompetitiveIndicator,
  CustomerAcceptToggle) → v1.1 polish slice if post-Step-9 smoke
  confirms zero remount need.
- **Redesigned per-SKU drawer** that re-mounts MarginSparkline /
  TwoAxisVerdictPair / ReverseSolveDialog → v1.1+ follow-up.
- **PSR-2 / PSR-7 / PSR-9 / PSR-12 overlay walks** → coverage
  completeness via overlay setup on existing fixtures (PSR-2 =
  headroom variant of PSR-1; PSR-7 = per-SKU diversity overlay on
  PSR-6; PSR-9 = client-target overlay on PSR-1; PSR-12 =
  client-target overlay on PSR-4). Classifier predicate-layer
  behavior verified via invariant verifier scenarios + the
  `tighten_to_target` + `mixed status · per-SKU view in detail`
  qualifier code paths. Visual walks deferred to v1.1+ polish
  slice if PM demand surfaces. CA disposition per CB final-stretch
  close-out comm (2026-06-16): not architectural risk, coverage-
  completeness items.

### NOT-IN-ANY-STEP

None. Every visual primitive + structural commitment + polish
element from CD's prototype + designer notes + data-source map
landed in a numbered step.

---

## §B · Pattern 22 §0.5 catch ledger

**Slice cumulative running total post-final-stretch close-out:**
50 catches across 12 slices since pattern adoption (April 2026).

**This slice contributed 17 catches across pre-approval verification
+ CB walk patch rounds 1-3 + final-stretch close-out (per the
updated §0.5 protocol — verification BEFORE Edward + CA approve,
not after).** Two were BLOCKERs that would have required mid-build
escalation if the §0.5 pass hadn't run; one was a REGRESSION
caught at patch round 1 → 2 transition.

Catches #1-8 were §0.5 pre-build (pre-Edward-approval brief
verification). Catches #9-17 were post-build catches across
patch rounds 1-3 + final-stretch close-out — Pattern 22 lineage
extended to "any structural mismatch where re-derivation surfaces
drift from classifier output."

### Catches contributed by this slice

| # | Type | Surface | Description | Disposition |
|---|---|---|---|---|
| 1 | **BLOCKER · architectural** | `firm_settings` | Brief assumed `allow_override` BOOL column existed; schema didn't carry it. Classifier `policy.allow_override` field has no source. | Add schema column via Step 2 migration; carry-forward in `versionedFirmSettingsUpdate`. |
| 2 | **BLOCKER · architectural** | `firm_settings` | Brief assumed `allow_accept_risk` BOOL column existed; schema didn't carry it. Classifier `policy.allow_accept_risk` field + AcceptRiskBanner mount predicate have no source. | Add schema column via Step 2 migration; same carry-forward path. |
| 3 | Architectural | cost-stack rollup | Brief data-source map referenced cell-level `cost_stack: { pkg, prod, frt, dt }` 4-bucket primitives. Production `QuoteCostBreakdown` exposes the 4 buckets at tier-level (`packagingMarkupSum` etc.), NOT pre-rolled per-cell. | Q6 disposition: classifier passes through verbatim from input; v1 supplies `null` per cell; DetailCostStack handles null with inline rollup fallback; costing math layer extension banked for follow-up. |
| 4 | Cross-surface | CostStackHeader | Brief implied tear-down deletes `CostStackHeader`. File is consumed by Costs surface (`costs/page.tsx:355`). | Catch #4 disposition: file STAYS; remove only the Pricing import + mount in Step 8. |
| 5 | Cross-surface | shared primitives | Brief implied tear-down deletes per-SKU breakdown chain (`SkuSummaryRowList` + `sku-breakdowns`). They consume `MarginVerdictPill` (Quote umbrella consumer), `MarginSparkline`, `TwoAxisVerdictPair`, `ReverseSolveDialog`. | Catch #5 disposition: preserve shared primitives as orphan-on-disk per Pattern 30 hygiene; natural reuse candidates for redesigned per-SKU drawer (v1.1+ follow-up). |
| 6 | Naming collision | EmptyState | Brief proposed component name `EmptyState`. Existing `pricing-reframe/empty-state.tsx` (about to be deleted) would orphan-collide; future-CC reading new code might import the wrong one if both existed mid-slice. | Catch #6 disposition: SendableSummary as the net-new name; classifier's `summary_card` field drives. |
| 7 | Field-name mismatch | global price adj | Prototype field name `global_lift_pct`; production schema field is `quotes.global_price_adj_pct` (numeric(5,4); decimal not percent). DetailGlobalAdjust binding has no source if classifier expects the prototype shape. | Catch #7 disposition: DetailGlobalAdjust reads via `(state.quote as { global_price_adj_pct?: number }).global_price_adj_pct`; adapter writes the production field; UI sends percent display value (integer); `updateQuoteGlobalPriceAdj` action layer divides by 100 at the boundary. |
| 8 | API contract shape | `quote.suggestions` | Classifier consumed `QuoteSuggestionsInput.surgical.lift_pct` and `.new_margin` directly from input; brief implied a single `suggestions` object owned by classifier. Production-side suggestion engine (`rankPricingSuggestions`, Slice 9.4b helper) returns ranked options with `applyDelta` (multiplicative revenue lift), not pre-computed `new_margin`. | Catch #8 disposition: adapter computes closed-form `new_margin` per surgical target tier and `new_blended` per global from `applyDelta`; classifier consumes via input.suggestions verbatim; no math fork. Pattern 28 scope discipline preserved (reuse Slice 9.4b math; don't fork). |
| 9 | Catalogue error | MarginVerdictPill | Slice fold §B Catch #5 claimed MarginVerdictPill was consumed by Quote umbrella via `quote-summary-card.tsx:167`. Pre-flight grep on Step 9 patch revealed `quote-summary-card.tsx` has zero JSX mount anywhere in `src/app`. The pill chain is orphan-on-disk; PSR `DetailTierTable` `.row-pill.*` carries the per-tier verdict chrome. | CB Step 9 re-walk patch documentation correction; no code change. Pattern 22 catch banked because surface-claim brief checks need a "is the consumer actually mounted?" sub-step, not just an import grep. |
| 10 | **REGRESSION** | `pricing-page-head.tsx` parallel predicate chain | Patch round 1 (commit `761f5bf`) fixed BUG-2 sub-copy/banner via `isBelowFloor`/`isBelowTarget` against per-leaf-per-tier marginStatus + belt-and-suspenders `summary.blendedMarginPct` fallback. Zero-SKU sendable edge case (Epicuren Alt 1/Alt 4) regressed — head's chain said BLOCKED while classifier said SENDABLE. | Patch round 2: lift classifier to page-level provider (`PricingClassifierProvider`); head + composer become consumers of `usePricingClassifier()`. §3 source-of-truth structurally enforced; no parallel derivation possible. |
| 11 | Schema edge | `quotes.version_number` | Seed script INSERT on `quotes` failed: `version_number INTEGER NOT NULL` has no default. CC seed used minimal INSERT pattern. | Patch 2: explicit `version_number=1` in seed script. Durable seed-script discipline (any new versioned table column without a default needs explicit value). |
| 12 | META · seed math | per-quote target reference | Patch 2 seed script assumed firm_settings target=0.35; production drift had it at 0.40. PSR-1's 37.5%-margin cells (intended sendable) read as below-target → fixture rendered REVIEW. | Patch round 3 BUG-E: per-quote `target_margin_pct='0.3500'` on every fixture (Slice 9.2 column). Fixtures own their reference target; smoke walks against 35% regardless of firm-policy drift. |
| 13 | STRUCTURAL · mount predicate | composer ★ dual-render | Patch 2 composer mounted both `<SuggestionCard>` (suggestion_led mode) AND `<ActionCard>` for the recommended action — two ★ markers per render. | Patch 3 BUG-C: composer filters recommended action from ActionCard list when `state.mode === 'suggestion_led'`. §3 invariant extended to mount predicates: each classifier action surfaces in exactly ONE component per render. |
| 14 | STRUCTURAL · parallel derivation | YOUR NEXT MOVE banner | Banner derived label from static `SURFACE_META.costing.nextMove` regardless of classifier mode. On suggestion_led/blocked the banner showed "Preview quote PDF →" while the page wanted "Apply Surgical →" / "Apply Global →". | Patch 3 BUG-D: banner reads `state.actions.find(a => a.recommended) ?? .find(a => a.primary)`. Per-mode href routing: sendable→customer_view, suggestion_led→`#psr-suggestion-card`, blocked→`#psr-actions`. Anchor IDs added to composer. Eliminate-parallel-derivation pattern (same shape as Catch #10). |
| 15 | SEMANTIC · math layer | sell_price_override TERMINAL | Initial seed used per-cell `sell_price_override` for precise margins. `applySurgicalAdj` writes `tier_price_adj_pct`, which feeds the `computedSell` chain. Cells with override BYPASS computedSell entirely (`requiredSell = cellOverride`), so surgical lift has zero effect → PSR-11 Apply Surgical no-op. | Patch 3 BUG-A side-effect of BUG-E: switch seed math from sell_price_override to `packaging_inputs.markup_pct`. Cells respond naturally to tier_price_adj_pct lifts; surgical recovery works end-to-end. Verified via direct-DB simulation: tier_price_adj_pct=0.282 → 16.7%→35.0% margin recovery on T1. |
| 16 | WIRE · prematurely banked | DetailGlobalAdjust onPreview | Patch 2 removed `onPreviewGlobalAdjust` handler from composer + DetailZone forward, banking as v1.1+. CD prototype semantic: "Preview →" IS the commit affordance for PSR-13 escalation walk. With the wire gone, PSR-13 PSR walk had no commit path. | Patch 3 BUG-B: re-instate `onPreviewGlobalAdjust(liftPct)` calling `updateQuoteGlobalPriceAdj`; DetailZone forwards `onPreviewGlobalAdjust` prop to DetailGlobalAdjust. Naming-mismatch (Preview-as-commit) banked v1.1+ per Pattern 28 copy verbatim. |
| 17 | POLISH · denominator | sub-copy "lines" vs state-line "tiers" | Patch round 2 sub-copy read `state.below_target.length` (cell count). State-line lead read tier count. PSR-4 (1 tier below × 3 SKUs) surfaced "1 tier below target" + "3 lines below target". Both truthful; counted different objects; PMs perceived disagreement. | Final-stretch ANOMALY-1: sub-copy switches to `state.tiers.filter(t => t.status === 'below_target').length`. Same denominator as state-line. §3 invariant extended to plural-form denominator selection. |

### BLOCKER-class catches (pre-build escalation prevented)

Catches #1 and #2 are BLOCKER-class because the classifier's
mount predicates depend on those fields:
- `state.flags.accept_risk_unavailable = mode === "blocked" &&
  !policy.allow_accept_risk` → controls AcceptRiskBanner mount in
  Step 7 composer.
- `state.flags.override_unavailable = mode === "blocked" &&
  !policy.allow_override` → controls action ranking:
  `request_override` vs inert `override_unavailable` card in
  classifier §6.

Without those fields landing in Step 2, Steps 3-7 build paths would
have failed compile (`policy.allow_*` undefined) or shipped silently
broken (default `true` everywhere, masking the gated-account use
cases). The §0.5 pre-approval pass surfaced both before any Drizzle
schema work, before any classifier types existed, before any UI
code touched the new fields. Mid-slice schema work would have cost
at least one full step-cycle of rework + brief amendment.

### Cumulative slice tally — Pattern 22 instances since adoption

Per the "Pattern 22 promoted to standing protocol — §6.b Step 5 prep
(7th Pattern 22 instance)" entry in CLAUDE.md:

```
Pre-§6.b   : 7 instances across RI.9 + §6.b
§6.b       : (subsequent catches continued through §6.b
              implementation; pattern paying for itself)
slice-fr12 : (further catches per FR-12 brief verification)
slice-pricing-reframe : (Bug #2/#D float-precision catches were
                         §0.5-adjacent — verifier coverage)
slice-rest-of-app : (Path-B-namespace-scoped + token coverage
                     catches; Pattern 22 extended to code
                     architecture per §6.b refinement)
slice-canonical-scenario-create : multiple architectural catches
                                  (scenario_dropped scope,
                                   recommended pin invariant)
slice-fr12-copy-operations : architecture catches on Cloneable/
                              Inherited/Reset field-bucket
                              integrity + legacy quote_skus chain
                              decision
... cumulative running total approaching ~33 pre-this-slice
this slice : 8 catches (2 BLOCKER + 6 architectural / cross-surface
             / naming / field-name / API-contract)
CUMULATIVE POST-STEP-9 : 41 catches across 12 slices
```

The pattern continues to pay for itself. Catches #1 and #2 alone
saved an estimated full step-cycle of rework (Drizzle migration +
brief amendment + Edward + CA disposition cycle); catches #3-#8
prevented 6 distinct mid-implementation escalation cycles.

---

## §C · Implementation commit log (this branch)

```
9323045  Step 8 — Legacy tear-down (11 file deletions; ~3,089 LOC)
591b645  Step 7 — Page composer + recompute pipeline + mode-
         transition flash (615 LOC PricingSurfaceShell)
91bdf7f  Step 6 — DETAIL zone components (700 LOC; DetailZone
         session-storage + Catch #7 field binding + Q6 fallback)
cb1a5f4  Step 5 — ACTION zone components (359 LOC;
         SendableSummary net-new + Edward fixes #2/#4/#5 inert
         action kinds)
2bbd80b  Step 4 — STATE zone components + canonical CSS adoption
         (770 LOC `r-psr-pricing.css` Path B-default; 3 STATE
         components + shared formatters)
1c9c040  Step 3 — Classifier impl + QuoteState contract + invariant
         verifier (640 LOC classifier; 16-scenario verifier wired
         into prebuild gate)
b5bc7a8  Step 2 — firm_settings policy gates migration +
         carry-forward extension (resolves 2 §0.5 BLOCKER catches)
5d12f14  Step 1 — Step 0 CD bundle staged + Step 1 kickoff
         (Path B-default determined; perf baseline 211-213ms;
         9-step plan locked)
```

Step 9 (this commit) adds the smoke guide + slice fold artifacts;
no implementation changes.

---

## §D · Verifier gates (pre-PR-open)

```bash
npx tsc --noEmit                                  # → exit 0
npm run verify:pricing-classifier-invariants      # → ✓ 16 scenarios
npm run verify:autosave-focus-stability           # → ✓ Pattern 47 (e)
```

All three pass post-Step-8. Re-run post-PR-rebase if needed before
merge.

---

**End of slice fold.** Smoke per `cc-pricing-surface-redesign-smoke-guide.md`;
PR description references this artifact for the audit trail.
