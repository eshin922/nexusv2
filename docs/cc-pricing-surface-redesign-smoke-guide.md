# slice-pricing-surface-redesign — PM smoke guide (PSR-1 … PSR-14)

**Branch:** `slice-pricing-surface-redesign` · **Commits:** 1-8 · **PR:** opened against `main`
**Surface under test:** Pricing — `/projects/[id]/quotes/[quoteId]/pricing`
**Composer:** `<PricingSurfaceShell>` (single host; legacy reframe-shell
+ ROOM 0/1/2/3 + Mark-Accepted CTA torn down in Step 8)

The classifier (`src/lib/pricing-classifier.ts`) is the single source
of truth for state-bearing surfaces — mode + state-line + action
ranking + per-cell status all flow from `classify(quote, policy)`.
Smoke verifies that the production data path (CostingStore →
PricingSurfaceShell adapter → classifier → STATE/ACTION/DETAIL
zones) produces the same shape CD's 14 prototype scenarios specify.

---

## §0 · Pre-walk DB sanity (run before any PSR scenario)

The classifier reads two new firm-policy gate columns added in Step 2.
Confirm they exist in production and have the expected current values
before opening the Pricing route.

```sql
-- 1. Schema check — Step 2 columns landed
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'firm_settings'
   AND column_name IN ('allow_override', 'allow_accept_risk');

-- expect 2 rows:
--   allow_override      boolean    true    NO
--   allow_accept_risk   boolean    true    NO

-- 2. Current row values — production default (both true)
SELECT id, effective_from, effective_until,
       allow_override, allow_accept_risk,
       target_margin_pct, floor_margin_pct
  FROM firm_settings
 WHERE effective_until IS NULL
 ORDER BY effective_from DESC
 LIMIT 1;

-- expect: allow_override = TRUE, allow_accept_risk = TRUE
-- (production default preserves current behaviour;
-- PSR-8 + PSR-14 require admin temporarily flipping these
-- for scenario verification — see those gates below)
```

**Versioned-table carry-forward sanity (Pattern from Slice RI.7):**
the `versionedFirmSettingsUpdate` helper in
`src/app/actions/firm-settings.ts` extends to carry both new columns
forward on every update. Confirmed in Step 2 commit (b5bc7a8).

---

## §1 · Scenario walk-throughs (PSR-1 … PSR-14)

Each scenario references the CD prototype's data block at
`docs/design-prototypes/dist/pricing_surface_bundle/app/pricing_surface/data.js`.
Quote ids on PM-test fixtures should be seeded with margin shapes
that approximate the prototype's margin grids (exact match not
required — classifier behaviour depends on margin vs. policy
thresholds, not specific cell values).

PM-test posture: read the **mode** + **state-line** + **action
ranking** for each scenario. If all three match expected, the
classifier is delivering the contract. Don't pixel-audit individual
margin numbers — that's the classifier invariant verifier's job
(passes 16 scenarios in `scripts/verify/pricing-classifier-invariants.ts`).

### Cluster A — Sendable (80% case)

The thesis: page is almost empty when the quote is fine. State line
+ SendableSummary card + collapsed DetailZone toggle. No action card
list crowding the surface.

#### PSR-1 · s01 — Sendable · vanilla (5 tiers, 5 SKUs)

- **Setup:** any 5-tier 5-SKU quote where every cell sits above
  target. Production target ≈ 35%, floor 25%; CD's prototype uses
  margins 0.46–0.53.
- **Expected mode:** `sendable`
- **Expected state-line lead:** `"All tiers above target"` ·
  status pill `sendable`
- **Expected ACTION zone:** one ActionCard kind `preview_pdf`,
  primary, label `"Preview quote PDF"`, no sublabel
- **Expected SendableSummary card:** 4 cells — Scope (SKUs/tiers),
  Recommended tier (T# · qty), Order value · T#, Blended margin %
  (with target/floor caption)
- **PASS gate:** no StateCallout, no StateCard, no SuggestionCard,
  no AcceptRiskBanner. DetailZone collapsed by default (or
  whichever the session-storage carries — see PSR-11/13 for
  preservation discipline).

#### PSR-2 · s02 — Sendable · with headroom

- **Setup:** 5-tier 3-SKU; all margins comfortably above target
  (CD prototype: 0.51–0.59).
- **Expected mode:** `sendable` (same shape as PSR-1).
- **PASS gate:** layout identical to PSR-1 — no "headroom callout"
  in primary attention. Diagnostic context lives in DetailZone
  only (per CD §2 thesis — page doesn't grow for non-decisions).

#### PSR-3 · s03 — Sendable · 2-tier quote

- **Setup:** 2-tier 2-SKU minimal quote.
- **Expected mode:** `sendable`. SummaryCard tier-count reads
  "2 tiers"; rest of layout identical.
- **PASS gate:** one-line state + summary card holds at low data
  density. Page doesn't feel emptier than the 5-tier case — that's
  the design grammar working.

### Cluster B — Suggestion-led (page grows for decision)

#### PSR-4 · s04 — Suggestion-led · Surgical (1 tier below)

- **Setup:** exactly 1 tier below target; others fine. CD: T1 at
  0.38–0.40 (well below 0.35 target — actually shows T1 dragging
  toward below-floor; production seed should target T1 ≈ 0.30 to
  keep within `below_target` band).
- **Expected mode:** `suggestion_led`
- **Expected state-line lead:** `"1 tier below target"` ·
  status pill `review`
- **Expected ACTION ranking:** ★ ActionCard kind `apply_surgical`
  recommended + primary, label `"Apply Surgical · lift Tier 1 to
  target"`, sublabel mentions "offending tier only · other tiers
  unchanged"; demoted `preview_pdf` follow-on.
- **Expected SuggestionCard:** Tier 1 margin before → after delta;
  "Other tiers · unchanged"; Blended after apply with +Npp delta.
- **PASS gate:** Surgical wins ranking when exactly one tier below
  (Global would compound — verified in classifier §6 action
  ranking).

#### PSR-5 · s05 — Suggestion-led · Global (3 tiers below)

- **Setup:** 3 tiers (T1, T2, T3) below target.
- **Expected mode:** `suggestion_led`
- **Expected state-line lead:** `"3 tiers below target"` ·
  status `review`
- **Expected ACTION ranking:** ★ `apply_global` recommended +
  primary, label `"Apply Global · lift all tiers proportionally"`,
  sublabel `"3 tiers below target · surgical would compound"`;
  demoted `preview_pdf`.
- **Expected SuggestionCard:** all-tier lift_pct preview;
  "Curve shape · preserved"; blended-after-apply with delta.
- **PASS gate:** mode-aware ranking flipped — Global wins when ≥2
  tiers below (classifier §6 rule).

### Cluster C — Blocked (full state card)

The state escalates: full StateCard replaces StateCallout. PMs
must resolve before sending.

#### PSR-6 · s06 — Blocked · single tier below floor

- **Setup:** T1 at 0.26 margin (vs 25% floor → 26.4% reads as
  below_floor in classifier's TARGET_TOLERANCE = 0.001 register).
- **Expected mode:** `blocked`
- **Expected state-line lead:** `"1 tier below floor"` ·
  status pill `blocked`
- **Expected StateCard:** seal "!", "Cannot send" pill,
  lead "Tier 1 at 26.X%", sub `"N.Npp below the 25% floor · M cells
  affected · Resolve below — admin override or surgical lift"`,
  right rail 96px display blended margin.
- **Expected ACTION ranking:** ★ `apply_surgical` recommended +
  primary, followed by `request_override` (allow_override=true).
- **PASS gate:** **StateCallout absent** (only blocked surfaces
  StateCard); SendableSummary absent; no AcceptRiskBanner
  (allow_accept_risk=true by default).

#### PSR-7 · s07 — Blocked · per-SKU diversity

- **Setup:** one SKU has T1 below floor; another SKU sendable
  across all tiers; a third SKU priced over client target.
- **Expected mode:** `blocked` (worst-case wins).
- **Expected state-line qualifiers:** `"mixed status · per-SKU
  view in detail"` (classifier §7 blocked qualifier when
  `over_client_target > 0`).
- **PASS gate:** mode-arbitration discipline visible — page
  reflects worst case at the top, full per-SKU heterogeneity
  available in DetailZone (DetailPerSku grid).

#### PSR-8 · s08 — Blocked · accept-risk unavailable [CRITICAL]

- **Pre-walk DB tweak:** admin temporarily sets
  `allow_accept_risk = false` on current firm_settings row
  (via `/admin` UI or direct UPDATE preserving carry-forward).
- **Setup:** quote below floor on T1.
- **Expected mode:** `blocked`
- **Expected ACTION ranking:** same as PSR-6 — `apply_surgical` +
  `request_override` (override still allowed; only accept-risk
  is gated).
- **Expected `<AcceptRiskBanner>`:** renders below the action
  list. Copy: `"Accept-risk is unavailable on this quote.
  Firm policy prohibits below-floor sends on margin-protected
  accounts. Use admin override or apply the recommended lift."`
- **PASS gate:** `state.flags.accept_risk_unavailable === true`;
  banner visible; **no accept-risk CTA anywhere on the page**
  (inert affordance per round-2 fix #5 discoverability
  disposition).
- **Cleanup:** restore `allow_accept_risk = true` after smoke.

#### PSR-14 · s14 — Blocked · override unavailable [CRITICAL]

- **Pre-walk DB tweak:** admin flips BOTH gates to false on
  current firm_settings row:
  `allow_override = false`, `allow_accept_risk = false`.
- **Setup:** quote below floor on T1.
- **Expected mode:** `blocked`
- **Expected ACTION ranking:** ★ `apply_surgical` recommended +
  primary, followed by **inert** `override_unavailable` card —
  label `"Admin override unavailable on this account"`, sublabel
  `"Firm policy prohibits below-floor overrides. Surgical lift
  is the only send path."`, NO CTA button rendered.
- **Expected state-line qualifier:** `"override unavailable · firm
  policy"` (classifier §7 blocked qualifier when
  !policy.allow_override).
- **Expected `<AcceptRiskBanner>`:** ALSO renders (both gates
  closed).
- **PASS gate:** PMs can see `override_unavailable` card but
  cannot click it (no `<button>` rendered, only the explainer);
  state-line carries the firm-policy qualifier so PMs know
  this is account class, not a bug. Surgical is the only path.
- **Cleanup:** restore both gates to true.

### Cluster D — Compound (flag composes with mode)

#### PSR-9 · s09 — Sendable + over client target

- **Setup:** all tiers above target; 2 SKUs priced above the
  client's stated `quote_sku_tiers.client_target_price_per_unit`.
- **Expected mode:** `sendable`
- **Expected state-line:** lead `"All tiers above target"` ·
  status `sendable` · qualifier `"2 SKUs over client target"`
- **Expected ACTION:** primary `preview_pdf` + soft `tighten_to_target`
  affordance, sublabel `"Pricing above client's stated target —
  leaving headroom on the table"`. `recommended: false` — never
  marked recommended when the quote is healthy.
- **PASS gate:** mode stays `sendable`; over-target is a flag,
  not a mode. CTA stays primary; tighten is `soft: true`.

#### PSR-12 · s12 — Suggestion-led + over client target

- **Setup:** 1 tier below target AND 2 SKUs over client target.
- **Expected mode:** `suggestion_led`
- **Expected state-line lead:** `"1 tier below target"` · status
  `review` · qualifier `"2 over client target"`
- **Expected ACTION:** ★ `apply_surgical` recommended + primary;
  demoted `preview_pdf`. **NO `tighten_to_target` card.**
- **PASS gate:** suggestion takes precedence over harvesting
  headroom (classifier §6 — over_client_target promotes to
  `tighten_to_target` ONLY in sendable mode). Over-target chip
  surfaces in DetailZone only, not as a competing action.

### Cluster E — Data state

#### PSR-10 · s10 — Provisional · missing raws

- **Setup:** 2 cells with `missing = true` (`margin_pct = null`);
  other cells above target.
- **Expected mode:** `sendable` (no known below-target/floor)
- **Expected state-line:** lead `"All tiers above target"` ·
  status **`provisional`** (4th status modifier per Q8 — mode
  stays 3-valued, status is 4-valued) · qualifier `"2 cells
  awaiting raws"` · trailing asterisk on the pill: `"provisional *"`.
- **Expected ACTION:** primary `preview_pdf`, **`disabled: true`**,
  `disabled_reason: "2 cells awaiting raws · margin unknown"`.
- **PASS gate:** classifier never silently treats unknown as fine
  (round-2 fix discipline). CTA visible but inert — no false
  green light.

### Cluster F — Transition (mode re-renders in place) [CRITICAL]

The Step 7 mode-transition pipeline (previousModeRef + 30s
justUpdated timer + DETAIL preservation) is the visible
correctness of "render in place, never navigate, no surprise
expansion." PSR-11 and PSR-13 are the dedicated transition
gates.

#### PSR-11 · s11 — Post-Surgical applied (blocked → sendable) [CRITICAL]

- **Setup:** start in scenario PSR-6 (T1 below floor, blocked).
  Open DetailZone (sessionStorage key `psr.detail.open.{quoteId}`
  = "1"). Confirm StateCard rendering. Click ★ Apply Surgical.
- **Expected server effect:** `applySurgicalAdj` server action
  writes T1's `quote_tiers.tier_price_adj_pct`. Audit row:
  `action = "tier_price_adj_updated"`,
  `diff_json.source = "pricing_suggestion_surgical"`. Telemetry
  rows: `surgical_apply` + `recommended_accepted`.
- **Expected mode after reconcile:** transitions `blocked →
  sendable` in place. No navigation.
- **Expected StateLine chrome:** **"↻ just updated" hint visible
  for 30s** (CD §4.6 / §9.2 pushback 2 disposition; Step 7
  `JUST_UPDATED_MS = 30_000`).
- **Expected DetailZone state:** **STAYS expanded** (sessionStorage
  preserved per CD §4.6 "No auto-expand on escalation" —
  composer doesn't touch DetailZone's persistence).
- **PASS gate (mandatory):**
  1. StateCard disappears (blocked surface)
  2. SendableSummary appears (sendable surface)
  3. StateLine still rendered; `pill.sendable` class active
  4. "↻ just updated" chrome visible for 30s, then disappears
  5. DetailZone still expanded (open from before the apply)
  6. URL unchanged (render in place verified)
  7. Audit log row landed with the source namespace

#### PSR-13 · s13 — Escalation · mid-edit drop below floor (suggestion_led → blocked) [CRITICAL]

- **Setup:** start in PSR-4 shape (one tier just below target,
  suggestion_led). DetailZone **collapsed** (close it explicitly
  in sessionStorage).
- **Trigger:** open DetailGlobalAdjust → lower the global price
  adjustment by 8pp (e.g., from +5% to −3%). Click Preview.
- **Expected server effect:** `updateQuoteGlobalPriceAdj` writes
  `quotes.global_price_adj_pct`. Audit row:
  `action = "global_price_adj_updated"` (no source flag — manual
  edit, not system suggestion).
- **Expected mode after reconcile:** transitions `suggestion_led
  → blocked` in place. No navigation.
- **Expected StateLine chrome:** "↻ just updated" hint visible
  for 30s.
- **Expected DetailZone state:** **STAYS COLLAPSED** (no surprise
  expansion on escalation — CD §4.6 + Step 7 composer never calls
  `setOpen` on DetailZone).
- **PASS gate (mandatory):**
  1. StateCallout disappears
  2. StateCard appears
  3. "↻ just updated" hint visible for 30s
  4. **DetailZone stays collapsed** — auditing this is the
     primary PSR-13 reason. If it auto-expanded, Step 7
     composer is touching DetailZone state it shouldn't.
  5. URL unchanged

---

## §2 · CRITICAL CROSS-CUTTING GATES

These survive every scenario walk and must pass for the slice to
ship. Read these EXPLICITLY during smoke even if all 14 scenarios
above pass individually.

### Gate-A · Mark accepted CTA ABSENT from Pricing header (R7a regression check)

Step 8 removed `<ActionCluster>` + `<MarkAcceptedCluster>` +
`<CustomerAcceptToggle>` from `pricing-page-head.tsx`. Quote
umbrella structure (post-canon-revision May 2026) puts Mark
Accepted as a Quote sub-tab, not a peer Pricing affordance.

**PASS gate:**
- Pricing page header (`.r7b-head`) renders ONLY: eyebrow,
  italic-em H1 ("Tune <em>price</em> & review."), sub-copy,
  empty `.actions` slot (right column reserved for grid
  register).
- YOUR NEXT MOVE banner below the head still renders
  ("Preview quote PDF →" default / "Resolve override before
  sending →" gated / silent terminal).
- **NO "Mark accepted" button anywhere on the Pricing page.**
- **NO "Customer accepted (manual)" toggle anywhere on the
  Pricing page** (CustomerAcceptToggle deleted from header;
  surface relocated to Quote umbrella sub-tab per canon
  revision).

### Gate-B · Cross-surface preserves intact (Catch #4/#5 verification)

Step 8 deleted 11 files but pre-flight grep verified these
shared primitives still have consumers and MUST work post-slice:

**Costs surface (`/projects/[id]/quotes/[quoteId]/costs`):**
- `<CostStackHeader>` mounts at `costs/page.tsx:355` — open
  Costs, confirm the R6 cost stack panel still renders fully
  (multi-tier columns, R6 cost-component rows, drilldown sections).
- `<ActiveTierUrlSync>` mounts at `costs/page.tsx:23` — confirm
  the URL `?tier=` ↔ store active-tier sync still wires up
  (click a tier column header on Costs cost-stack, URL gains
  `?tier={tierId}`).

**Quote umbrella (`/projects/[id]/quotes/[quoteId]`):**
- `<MarginVerdictPill>` mounts via `quote-summary-card.tsx:167`
  — open Quote umbrella view (or any surface that renders
  `<QuoteSummaryCard>`), confirm the margin pills render
  (GOOD / BELOW_TARGET / BELOW_FLOOR registers).

### Gate-C · Audit log entries on every Apply path

Every apply path through Step 7's composer fires a server action
that handles its own audit logging (Slice 9.2/9.4b audit-source
convention; composer does NOT add a parallel audit call).

Walk each path and confirm one audit row per click:

| PSR-scenario apply | Server action | Expected audit `action` | `diff_json.source` |
|---|---|---|---|
| PSR-4 SuggestionCard Apply Surgical | `applySurgicalAdj` | `tier_price_adj_updated` | `pricing_suggestion_surgical` |
| PSR-5 SuggestionCard Apply Global | `applyGlobalAdj` | root: `pricing_suggestion_global_applied`; per-tier derived: `tier_price_adj_updated` with `caused_by_audit_id` | `pricing_suggestion_global` |
| PSR-11 / PSR-13 ActionCard Apply | (same as above by `kind`) | (same) | (same) |
| DetailGlobalAdjust Preview | `updateQuoteGlobalPriceAdj` | `global_price_adj_updated` | (absent — manual edit) |

**PASS gate:** one query against the dev DB after each apply:

```sql
SELECT action, diff_json, caused_by_audit_id, created_at
  FROM audit_log
 WHERE entity_id IN (<quote_id>, <tier_id>)
 ORDER BY created_at DESC
 LIMIT 5;
```

Confirm the expected `action` + `diff_json.source` shape per the
table above.

---

## §3 · Browser console clean check

Walk through PSR-1, PSR-6, PSR-11 (one per cluster) with the
browser console open. Expect:
- Zero React warnings (key prop, hydration mismatch, etc.)
- Zero classifier errors / null-pointer surprises
- Zero CSS warnings (Path-B-default `r-psr-pricing.css` selectors
  all resolve; no `.psr-*` rules dropped on the floor)

---

## §4 · Verifier ledger (run from project root)

Before opening the PR / after merging:

```bash
npx tsc --noEmit                                  # → exit 0
npm run verify:pricing-classifier-invariants      # → ✓ 16 scenarios
npm run verify:autosave-focus-stability           # → ✓ Pattern 47 (e)
```

All three should pass with no output beyond the green check marks.

---

## §5 · What's NOT in scope for this smoke

These are explicitly Pattern 32 pre-prod tolerance / banked v1.1+
work; don't flag if missing during smoke:

- **`request_override` action wiring** — admin override request
  workflow doesn't exist yet (banked v1.1+). Inert CTA on
  Pricing.
- **`preview_pdf` action wiring** — Slice 11 Preview Quote
  sub-tab lands the real preview-PDF generation.
- **`tighten_to_target` action wiring** — no automation; PMs
  manually adjust prices today.
- **Cost-stack rollup in DetailCostStack** — Q6 disposition;
  costing math layer surfaces rolled-up shape in a follow-up
  commit / slice. Today: `cost_stack: null` per cell; inline
  rollup fallback renders.
- **Orphan-on-disk cleanup** (LinesRequiringReview, VerdictBand,
  PerTierOverrideCard, PricingSectionHead, active-tier-selector,
  ClientTargetCell, CompetitiveIndicator, CustomerAcceptToggle)
  — v1.1 polish pass if zero remount need confirmed.
- **Redesigned per-SKU drawer** that re-mounts MarginSparkline /
  TwoAxisVerdictPair / ReverseSolveDialog → v1.1+ follow-up.

---

**End of smoke guide.** Edward walks the 14 scenarios + 3 cross-
cutting gates + verifier ledger. If all pass, the slice ships.
