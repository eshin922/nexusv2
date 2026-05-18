# Pricing reframe v1 — Brief

**Slice position:** v1 release-critical path, item 2 (first slice after autosave focus-stability sweep)
**Slice type:** UX reframe + new telemetry schema + tier-aware suggestion engine
**Status:** Retroactive brief — slice was approved in prior CA session, CD design and dispositions complete. This brief synthesizes existing artifacts (designer notes, data-source map, kickoff comm, unbundled source) into the canonical CA brief format. Architect §0.5 verification dispositions baked in (Disposition A: SET NULL on `violation_tier_id`; Disposition B: per-kind `diff_json.source` namespace values).

---

## 1. Background & context

The Pricing surface had been treating blended margin as both a sanity check AND a target. This conflation hides per-tier risk. Three operational facts drive the reframe:

1. **Blended margin is mathematically an average.** Sum of (sku × tier units × margin) divided by sum of (sku × tier units). It is not a forecast of realized margin.
2. **Customer picks one tier ~95% of the time.** The realized margin in production is the picked tier's margin, not the blended average.
3. **PMs have been working around this informally.** Eyeballing tier columns, doing mental math, occasionally missing risks. The tool was making them work harder to make right decisions.

The reframe surfaces per-tier reality explicitly and tools the PM to handle it deliberately rather than implicitly. **PM agency with better information, not workflow change.**

Three paths were considered before locking on Path 3:

- **Path 1 (minimal safety net):** Show per-tier numbers but keep blended dominant. Rejected — too timid; doesn't actually change decision-making.
- **Path 2 (recommended-tier primary verdict):** Promote recommended tier to primary verdict; blended becomes tertiary. Conceptually right but depends on recommended-tier reliability data we don't have. **Deferred to v1.1**, gated on workflow telemetry from v1.
- **Path 3 Hybrid (locked):** Blended preserved as primary verdict (mental-model continuity); per-tier compliance added as equal-weight secondary surface; tier-aware suggestion engine; ★ Recommended marker surfaces tier-of-interest without claiming it.

## 2. The problem — operational risk

**Symptom (the trigger scenario):** A quote where blended margin reads 38.7% (above 35% target), but T1 sits at 32.8% (below target). The PM looks at blended, sees green, prepares to send — implicitly assuming the customer will pick a healthy tier. Customer actually picks T1 (it has the lowest unit price, customers gravitate to lower volumes for first orders), and the realized margin lands at 32.8% — 2.2pp under target. The tool surfaced the deal as sendable when per-tier reality flagged real risk.

**Why fixing it matters now:**

Once the Quote umbrella ships (v1 path item 4), the customer's tier choice gets recorded explicitly in the Tier Selection sub-tab and feeds directly into the NetSuite SO push. Pricing's per-tier compliance becomes pre-flight intelligence for an operational outcome that's only one or two PM clicks downstream. The reframe lands with more leverage in the upcoming architecture than it would have had alone.

## 3. The decision — scope and v1.1 carry-forward

**Path 3 Hybrid scope:**

- Blended preserved as primary verdict with stronger caption — *"Blended is the per-tier average — your realized margin is the tier the customer picks."*
- Per-tier compliance block surfaced as equal-weight secondary; collapsed when all tiers at target, expanded with inline callouts when any tier is below target
- Tier-aware suggestion engine — surgical, global, accept-risk options ranked by context
- ★ Recommended marker on tier label (driven by `quote_tiers.recommended`)
- Risk callouts inline for below-target; separate FloorBlock above per-tier compliance for floor breaches
- Apply suggestion writes to existing `quote_tiers.tier_price_adj_pct` (Slice 9.2 carry-forward)
- New `pricing_events` telemetry table — single table, 5 event types

**v1.1 carry-forward (architecture preserved):**

- TierComplianceBlock remains usable as secondary surface when Path 2 promotes recommended-tier to primary verdict
- Suggestion engine's tier-aware option set remains valid under Path 2
- Risk callouts remain meaningful regardless of which verdict is primary
- ROOM-state recompute logic doesn't change between paths

What changes in v1.1: blended demotes from primary headline to tertiary surface; TierComplianceBlock becomes a sibling not a subordinate. Nothing in this slice blocks that move.

## 4. Solution architecture

Five components plus scenario state machine. All components in `dist/pricing.jsx`; fixtures in `dist/pricing_data.js`; styles in `dist/pricing_styles.css`.

### 4.1 BlendedHeadline

Primary headline. Renders:
- Blended margin value (derived: `sum(sku × tier units × margin_pct) / sum(sku × tier units)`)
- Stronger caption — locked wording: *"Blended is the per-tier average — your realized margin is the tier the customer picks."*
- ROOM-state verdict pill — copy derives from `belowFloor` and `belowTarget` counts (NOT from `blended_state` alone):
  - `ALL TIERS AT TARGET · SENDABLE` (all healthy)
  - `BLENDED SENDABLE · N TIER RISK` (blended above target; N tiers below target)
  - `BLENDED BELOW TARGET · N TIER RISK` (blended itself below target; N tiers below)
  - `BLOCKED · BELOW FLOOR` (any floor breach)
  - `AWAITING INPUT` (empty quote)
- ROOM-state line — copy adapts per state
- Target / Floor meta from `firm_settings.target_margin_pct` and `.floor_margin_pct`
- "↻ Recomputed live" indicator

**Pill copy + ROOM-state line derive from computed state**, not from stored fixture strings. This was the scenario ③ self-caught bug — stored strings drifted from computed truth. Rule applies to production code as well as fixtures.

### 4.2 TierComplianceBlock

Equal-weight secondary surface. Two states:

**Collapsed (all tiers at target, per Q4 disposition):** Single summary line `✓ All N tiers at target · T1 X% · T2 Y% · T3 Z% · T4 W%`. Full per-tier margins visible inline; PM still sees the numbers, just doesn't get the row treatment.

**Expanded (any tier below target):** One row per tier with:
- Tier label + ★ Recommended marker (if `quote_tiers.recommended`)
- Units count
- Inline risk callout for below-target tiers (per Q5 disposition) — `"If customer picks Tn, realized margin = X% (Δpp under target)"`
- Margin value with `at-target` / `below-target` / `below-floor` color treatment (margin_pct **derived per-tier from costing computation**, not persisted)
- Sell-per-unit with weighted display (sell_per_unit **derived per-tier from costing computation**, not persisted)
- Just-changed delta chip (post-apply state ⑦)

**Q4 rejected alternative:** PM-toggleable expand/collapse with sticky preference. Rejected because surface state should track data state; sticky preference invites the "PM collapsed it once and never sees risk again" failure mode.

### 4.3 FloorBlock

Separate prominent block, rendered ABOVE TierComplianceBlock when any tier is below floor (per Q5 disposition — below-target gets inline callout; below-floor gets escalated visual treatment).

Renders:
- Eyebrow `Below floor · deal-blocking`
- Head `Tn below the X% floor by Y.Ypp` (computed)
- Description (full risk callout)
- "Request override" CTA routing to R3 admin-override flow

**Both inline and FloorBlock surfaces exist because they answer different questions.** Below-target = "PM should know this is risky." Below-floor = "PM cannot send this without intervention." Different consequences → different visual weight.

### 4.4 SuggestionEngine

Auto-fires when any tier is below target. Context-aware ranking per Q3 disposition:

| Context | Recommended (★) | Reason |
|---|---|---|
| One tier below target | `surgical` first | Touch only what needs touching; preserves tier ratios on healthy tiers |
| Multiple tiers below target | `global` first | Surgical works tier-by-tier; global lifts the floor coherently |
| Below floor | `surgical` first | Lifts the breached tier above the gate; global may not reach |

**Accept-risk gating:**
- Available only when **(a)** at least one tier is below target AND **(b)** the recommended tier is above target
- When `quote_tiers.recommended` is unset, gating defaults permissive (Pushback 3 disposition — `★ suggestion not directive` framing already explicit; user override is the safety mechanism)
- Below floor: accept-risk **unavailable**, admin override is the path
- T2+ recommended not healthy: accept-risk **unavailable**, with reason surfaced below suggestions list in dashed-border explainer

**Apply behavior:** Writes `quote_tiers.tier_price_adj_pct` via existing Slice 9.2 mutation path. Per-source disambiguation via `diff_json.source` (Disposition B):

- **Surgical (single-tier apply):** `diff_json.source = 'pricing_suggestion_surgical'`. Single audit row.
- **Global (N-tier apply):** `diff_json.source = 'pricing_suggestion_global'`. Cascade audit pattern — one root audit row plus N derived rows pointing via `caused_by_audit_id`. Matches existing cascade audit semantics from cascade-delete pattern.
- **Future suggestion kinds** (accept-risk apply, custom adjustments, etc.) get new per-kind source values. Pattern: `pricing_suggestion_<kind>` namespace.

Per-kind source values future-proof per Slice 9.4b precedent (`apply_client_target_solve_tier_adj` got source `client_target_solve`) — filtering analytics is dead simple, and new suggestion kinds don't require re-architecting.

### 4.5 Per-tier preview tiles

Each suggestion option carries per-tier preview tiles showing projected new margin + delta. Tiles use constrained mono-font register so PM can scan all four projections in one glance.

- Tiles with `delta_pp = 0` show `·` rather than `+0.0pp` — keeps unchanged tiers visually quiet
- Delta on changed tiers uses `good` color when change moves tier toward target

### 4.6 ApplyToast (scenario ⑦ post-apply)

Renders after suggestion apply succeeds:
- ✓ glyph + message format (`Applied · `prefix in `ink`)
- Audit ref (`audit_id=a_…` in mono small caps from `audit_log.id`)
- Position at top of page
- `good`-tinted bg + 3px left edge
- **Persistence:** persist-until-next-action; no fade-out timer (CD disposition)

### 4.7 Scenario state machine (7 scenarios)

Fixtures in `dist/pricing_data.js` cover the full state space:

| # | Scenario | State signature |
|---|---|---|
| ① | All tiers above target | Blended `good`, TCB collapsed, no suggestions |
| ② | One tier below target (Edward's trigger) | Blended `good` with `· N TIER RISK` pill suffix; TCB expanded; inline callout on T1; suggestions surgical-first |
| ③ | Multiple tiers below target | Blended `warn` (now `BELOW TARGET` pill copy); TCB expanded; inline callouts on T1+T2+T3; suggestions global-first; accept-risk unavailable (T2 recommended below target) |
| ④ | One tier below floor | Blended `warn` with `BLOCKED · BELOW FLOOR` pill; separate FloorBlock above TCB; TCB shows `bad` row; suggestions present, accept-risk unavailable |
| ⑤ | Empty quote | Blended renders `—` with `AWAITING INPUT` pill; TCB hidden; empty-state card guides PM to Cost build |
| ⑥ | Applying suggestion (transient) | Affected tier row shows `APPLYING…` chip + grayed margin value; suggestions disabled-by-implication; ROOM state holds steady |
| ⑦ | Post-apply | Toast shows successful application + audit ref; affected tier shows `changed` tint with delta chip; blended recomputes to new value |

### 4.8 Stacked / narrow-viewport variant (Q7 disposition)

Tier rows collapse to cards on viewports < 720px:
- Tier label + units stack with chip in top-right
- Margin scales up to 22px (headline of each card)
- Inline callout drops below as separate row with dashed top-border
- Sell-per-unit lives in bottom-right
- Suggestion options also stack (apply button drops below description)

v2 backlog territory but ships in v1 styles so it's not a separate redesign later.

## 5. Schema verification gate (Pattern 25)

### New schema commitment — `pricing_events` table

Telemetry surface for v1.1 Path 2 promotion analysis + ★ Recommended reliability tracking. Single table, five event types.

```sql
create table pricing_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  event_type text not null check (event_type in (
    'surgical_apply',
    'request_override',
    'recommended_fired',
    'recommended_accepted',
    'recommended_overridden'
  )),
  violation_tier_id uuid references quote_tiers (id) on delete set null,
  suggestion_target_tier_ids uuid[],
  floor_breach_pp numeric(4,2),
  override_reason text,
  created_at timestamptz not null default now()
);

create index pricing_events_quote_event_created_idx
  on pricing_events (quote_id, event_type, created_at);

create index pricing_events_event_created_idx
  on pricing_events (event_type, created_at);
```

**FK on-delete semantics (Disposition A):**
- `quote_id` → CASCADE (consistent with sibling tables `quote_tiers`, `quote_skus`)
- `user_id` → SET NULL (consistent with `audit_log.user_id` precedent; preserves historical telemetry)
- `violation_tier_id` → SET NULL (telemetry survives tier deletion for cohort analysis; v1.1 Path 2 promotion analysis on event_type + timing doesn't need tier identity to survive)

**Event-type validation:** `text + CHECK` constraint per `quote_warnings` precedent (avoids rigid-enum migration foot-gun).

**Index strategy:** Two composite indexes covering the expected query patterns:
- `(quote_id, event_type, created_at)` — per-quote analytics
- `(event_type, created_at)` — cohort analysis across quotes

**RLS policies:** Aligned with quote ownership — read access mirrors `quotes` RLS; insert restricted to authenticated users.

**`suggestion_target_tier_ids uuid[]` FK enforcement note:** Postgres array columns can't enforce per-element FK constraints (LOW-4 from §0.5). Pattern 32 pre-prod tolerance applies — document in migration comment that array elements should reference valid `quote_tiers.id` values; application-layer validation enforces.

### Schema reads (carry-forward; one corrected classification)

Per data-source map (corrected), this slice reads from existing schema. **Critical correction:** `quote_tiers.margin_pct` and `quote_tiers.sell_per_unit` are NOT persisted columns — they're computed in `costing.ts` from (revenue - cost) / revenue per leaf cell, rolled up per tier. Read paths consume `getCostingBundle.tiers[].marginPct` and `tierBreakdown` — already first-class. Phantom-column classification in CD's original data-source map was corrected as part of §0.5 patches.

| Field | Owner | Persisted vs derived | Used for |
|---|---|---|---|
| `quote_tiers.label, .qty, .recommended` | Slice 9.x | ✅ persisted | Per-tier rows + ★ marker |
| `quote_tiers.tier_price_adj_pct` | Slice 9.2 | ✅ persisted | Suggestion-apply write target |
| `quote_tiers.margin_pct` (via `getCostingBundle.tiers[].marginPct`) | costing.ts | 🔧 derived | Per-tier compliance + suggestion math |
| `quote_tiers.sell_per_unit` (via `tierBreakdown`) | costing.ts | 🔧 derived | Per-tier display + suggestion preview tiles |
| `firm_settings.{target_margin_pct, floor_margin_pct}` | R5 | ✅ persisted | Target / floor thresholds |
| `quote_warnings.*` | Slice 9.5 | ✅ persisted | Drives auto-fire of suggestion engine |
| `audit_log.*` | R5 | ✅ persisted | Captures every apply + accept-risk decision |

**No other new schema. No new write paths.** Suggestion-apply writes through existing `tier_price_adj_pct` mutation. Accept-risk doesn't write; it's an in-session decision captured by audit log via `gate_overridden` action when PM hits Send. (Note: `gate_overridden` action lands in Quote umbrella slice, item 4; not blocking for Pricing reframe.)

### Audit-log namespace check (Disposition B)

When PM applies a suggestion, the existing `tier_price_adj_pct` mutation fires AND a `pricing_events` row writes.

**`diff_json.source` namespace values (per-kind, Disposition B):**

- `pricing_suggestion_surgical` — surgical (single-tier) apply paths. Single audit row.
- `pricing_suggestion_global` — global (N-tier) apply paths. Cascade audit pattern: one root audit row + N derived rows pointing via `caused_by_audit_id`. Each derived row represents one tier write within the global apply.

Per-kind source values future-proof per Slice 9.4b precedent. v1.5+ may add `pricing_suggestion_accept_risk`, `pricing_suggestion_custom`, etc.; each gets its own source value without re-architecting.

**No collision** with existing audit-log source values (verified at §0.5): `system_suggestion`, `client_target_solve`, `add_product_modal_phase1`, `cascade_from_role_conversion`, `add_assembly_button`.

## 6. Workflow scenarios to test against

The 7 scenarios in `dist/pricing_data.js` cover the full state space. Smoke pass verifies:

**Per-scenario render correctness:**
- ① All-healthy → blended pill green, TCB collapsed, no suggestions
- ② One below target → pill amber with `1 TIER RISK`, TCB expanded with T1 callout, surgical first
- ③ Multi below target → pill amber with `BLENDED BELOW TARGET · 3 TIER RISK`, global first, accept-risk unavailable with explainer
- ④ Below floor → red FloorBlock above TCB, surgical first, accept-risk unavailable with admin-override explainer
- ⑤ Empty → blended `—`, empty-state card visible
- ⑥ Applying → `APPLYING…` chip on T1, grayed margin
- ⑦ Post-apply → toast visible, delta chip on T1, blended recomputed

**Cross-scenario invariants:**
- ROOM-state pill copy derives from computed `belowFloor` + `belowTarget` counts; toggle between scenarios verifies pill updates correctly without stale fixture strings (the ③ self-caught bug must not regress)
- Accept-risk gating respects recommended-tier health: ② accept-risk available; ③ accept-risk unavailable (T2 recommended below); ④ accept-risk unavailable (below floor)
- Suggestion ranking respects context: surgical-first when one tier below; global-first when multiple; surgical-first when below floor
- Telemetry events fire on apply with correct tier-context fields populated
- Apply paths emit correct `diff_json.source` values: surgical → `pricing_suggestion_surgical` (single row); global → `pricing_suggestion_global` (root + N cascade rows)

**Pattern 47 interaction:**
- Pricing surface has zero `<input>` elements in this design (verified at §0.5); suggestion-apply is a button (carve-out applies). No new tier-input affordances introduced in this slice; Pattern 47 applies forward but isn't exercised by new pricing-side code.
- Existing tier-input affordances on `tier-row.tsx` (Setup-side) remain Pattern 47-compliant.

**Customer-view boundary guard (Pattern 45 forward-compat):**
- `pricing_events` table, suggestion engine state, ROOM-state pill copy, per-tier compliance state, audit fields — all internal-only
- Build-time enforced boundary: `<PdfPage>` and descendants import zero modules from costing or pricing-events surface
- Pre-launch review (final v1 path item) catches any boundary leak via Pattern 45 audit

## 7. Discovery questions (Pattern 41 analogue) — all dispositioned

Q1-Q7 dispositioned in prior CA session + CD pushback rounds. Surfacing for §0.5 verification context:

**Q1: Should suggestion engine auto-fire or require explicit "show suggestions" click?**
Disposition: **Auto-fire** when any tier below target. PM doesn't have to opt-in to see operational guidance.

**Q2: Should accept-risk write to audit log immediately, or only when PM hits Send?**
Disposition: **Only on Send** via existing `gate_overridden` action. Accept-risk in-session is a decision; the commitment is at Send.

**Q3: Suggestion engine ranking — fixed order or context-aware?**
Disposition: **Context-aware**. Surgical-first when one tier below; global-first when multiple; surgical-first when below floor; accept-risk gated on recommended-tier health.

**Q4: TierComplianceBlock collapse threshold?**
Disposition: **Collapsed only when all tiers at target.** Any below-target tier expands the block. Surface state tracks data state, not PM preference.

**Q5: Risk callout severity treatment?**
Disposition: **Below-target inline within tier row** (warn tint); **below-floor escalated to separate FloorBlock above TCB** (deal-blocking treatment).

**Q6: Blended caption strength — soft or strong?**
Disposition (post-Pushback 1): **Strong.** Final wording: *"Blended is the per-tier average — your realized margin is the tier the customer picks."*

**Q7: Stacked / narrow-viewport variant — ship in v1 or defer?**
Disposition: **Ship in v1 styles** so it's not a separate redesign later. v2 may iterate.

**Three additional pushback dispositions (CD round):**

- **Pushback 1 (blended caption strength):** ACCEPTED · stronger framing shipped (Q6 disposition above)
- **Pushback 2 (Scenario ④ telemetry):** ACCEPTED · `surgical_apply` + `request_override` events bank with tier-context fields
- **Pushback 3 (★ Recommended reliability hedge):** ACCEPTED · permissive default when recommended unset + `recommended_fired/accepted/overridden` telemetry banks

**Two §0.5 dispositions:**

- **Disposition A — `pricing_events` FK on-delete semantics:** SET NULL on `violation_tier_id` (telemetry survives tier deletion); CASCADE on `quote_id`; SET NULL on `user_id`.
- **Disposition B — Apply-path `diff_json.source` namespace shape:** Per-kind source values (`pricing_suggestion_surgical`, `pricing_suggestion_global`) with cascade audit pattern for global.

## 8. Pattern 30 deliverables

**Complete. All five artifacts shipped:**

| Artifact | Path |
|---|---|
| Bundled HTML | `docs/design-prototypes/dist/Nexus Pricing Reframe v1.html` |
| Designer notes | `docs/pricing-reframe-designer-notes.md` |
| Data-source map | `docs/pricing-reframe-data-source-map.md` |
| Unbundled JSX | `dist/pricing.jsx` |
| Unbundled data | `dist/pricing_data.js` |
| Unbundled CSS | `dist/pricing_styles.css` |

**Scenario ⑥/⑦ token-level specs** included in designer notes addendum (chip placement, opacity treatment, row tint, toast styling, delta chip styling, persistence-until-next-action).

**Scenario ③ fixture corrections** applied — pill copy derives from computed state, not stored strings (the CD self-caught bug). Description, blended_warning, and T3 risk_callout all reconciled to "3 tiers below target."

**§0.5 patches applied** as part of this brief landing:
- Data-source map: phantom column classification fixed (margin_pct, sell_per_unit reclassified 🔧 derived)
- Designer notes: DDL gains ON DELETE clauses, CHECK constraint, indexes
- Designer notes: `diff_json.source` namespace specified per Disposition B with cascade audit pattern note

## 9. Open items — all closed

All Section-9-style items dispositioned in prior CA session, CD pushback rounds, and §0.5 verification. No open items at brief landing time.

**Seven items previously listed as open (all closed):**

1. Approve Path 3 Hybrid (over Path 1 minimal or Path 2 recommended-primary) — ✅ approved
2. Approve exhaustive scenario coverage (7 states including transient ⑥ + ⑦) — ✅ approved
3. Approve `pricing_events` telemetry table commitment — ✅ approved
4. Approve sequencing as v1 path item 2 (after autosave) — ✅ approved
5. Confirm: any schema beyond `pricing_events`? — ✅ no; pricing math reads carry-forward from Slice 9.x (margin_pct + sell_per_unit are derived, not persisted)
6. **Disposition A** — `pricing_events` FK on-delete semantics — ✅ SET NULL on `violation_tier_id`; CASCADE on `quote_id`; SET NULL on `user_id`
7. **Disposition B** — Apply-path `diff_json.source` namespace shape — ✅ per-kind source values with cascade audit pattern for global

## 10. Connections to other slices

- **Autosave focus-stability sweep (item 1, ✅ shipped)** — Pattern 47 just landed. Pricing reframe has zero `<input>` elements (verified at §0.5); no new tier-input affordances introduced. Pattern 47 applies forward but isn't exercised by new pricing-side code. Existing tier-input affordances on `tier-row.tsx` (Setup-side) remain Pattern 47-compliant.
- **Leaf-detach micro-slice (item 3)** — ships after. No direct interaction; different surface (Setup leaf hierarchy).
- **Quote umbrella + NetSuite finalization (item 4)** — ships after. The "Send to customer" CTA on Pricing surface stays unchanged in THIS slice; Quote umbrella slice updates the navigation target to Quote > Preview Quote sub-tab. Pricing's per-tier compliance feeds into Tier Selection sub-tab downstream (operational continuity preserved). `pricing_events` telemetry continues to bank; Quote umbrella may add lifecycle event surfaces but `pricing_events` stays separate. `gate_overridden` audit action referenced in data-source map lands in Quote umbrella slice; not blocking for Pricing reframe.
- **Slice 11 PDF customer-facing data bindings (item 5)** — ships after Quote umbrella. Customer-view boundary guard verifies no Pricing surface state leaks to PDF. Pre-launch review (item 7) catches any boundary slip.
- **Microsoft OAuth (item 6)** — sequentially independent.
- **Pre-launch review (item 7)** — Pattern 45 verification on customer-facing surfaces catches any pricing-internal-only state leak.

## 11. Sequencing within the slice

17 steps (Step 1 = §0.5 re-verification on corrected bundle):

**Pre-impl:**

1. Architect Pattern 22 §0.5 re-verification against corrected bundle (this brief with Disposition A/B baked in + corrected data-source map + corrected designer notes DDL). Should PASS.

**Implementation:**

2. `pricing_events` table migration — new table per §5 DDL (FK semantics per Disposition A, CHECK constraint per LOW-5, two composite indexes); follow established migration numbering + naming
3. Pricing surface UI refresh per CD Path 3 Hybrid design — BlendedHeadline, TierComplianceBlock, FloorBlock, SuggestionEngine, ApplyToast
4. Scenario state rendering — all 7 scenarios; ROOM-state pill copy derives from computed `belowFloor` + `belowTarget` counts (NOT static fixture strings — the ③ lesson)
5. Tier-aware suggestion engine — context-aware ranking logic per §4.4
6. Telemetry instrumentation — write `pricing_events` rows for all 5 event types; tier-context fields populated; FK semantics respected
7. Apply path audit-log discipline — `diff_json.source = 'pricing_suggestion_surgical'` for single-tier apply (single audit row); `diff_json.source = 'pricing_suggestion_global'` for N-tier apply (cascade audit pattern with `caused_by_audit_id`)
8. Scenario ⑥ APPLYING transient state — chip placement, opacity treatment, row tint per designer notes token specs
9. Scenario ⑦ post-apply state — toast, delta chip, `changed` row tint, persistence-until-next-action
10. Inline callout treatment + FloorBlock separation per Q5 disposition
11. Stacked / narrow-viewport variant per Q7 disposition (collapses to cards on viewports < 720px)
12. **Strip prototype review chrome** — `pr-state-strip` review chrome in `pricing.jsx` + `pricing_styles.css:12-30` MUST NOT ship (LOW-6 from §0.5; CLAUDE.md R-round prototype framing convention)

**Close-out:**

13. Edward smoke pass — verify scenarios ①-⑦, suggestion ranking per context, telemetry events with tier-context, accept-risk gating, below-floor admin override path, apply paths emit correct `diff_json.source` values
14. Audit findings disposition (standard Step 10 format)
15. Designer audit — CD reviews implementation against Pattern 30 deliverables
16. Architect verification at impl completion — pattern coverage check (Pattern 47 forward-compat, Slice 9.2 namespace per Disposition B, Slice 9.4b helper naming, customer-view boundary guard, action-result, revalidateQuoteTree, cascade audit pattern for global-apply)
17. PR to main

## 12. Notes for CC at kickoff

1. **The bundle is the source of truth.** This brief + designer notes + data-source map + unbundled source together cover the slice. Brief covers scope + sequencing + dispositions. Designer notes cover design decisions + Q1-Q7 dispositions + pushback resolutions. Data-source map covers schema bindings field-by-field. Unbundled source covers visual + behavioral specification. If artifacts conflict, surface to CA before resolving.

2. **Scenario ③ fixture lesson — apply to production code.** Pill copy + description strings DERIVE from computed state (`belowTarget` count, etc.) — do NOT store as static strings that could drift from computed truth. This was CD's self-caught bug; the rule applies to production code as well as fixtures.

3. **Pricing surface "Send to customer" CTA stays unchanged.** Don't touch its target URL, wording, or behavior. The Quote umbrella slice (item 4) updates the navigation target. Keeping concerns separate keeps slices clean.

4. **Telemetry tier-context capture is load-bearing.** v1.1 Path 2 promotion analysis depends on capturing which tier had the violation and which tier was the suggestion target. Don't ship telemetry without those fields populated.

5. **★ Recommended reliability hedge.** When `quote_tiers.recommended` is unset, accept-risk gating defaults permissive. Pushback 3 disposition; don't tighten during impl. v1 observation feeds v1.1 reliability analysis.

6. **margin_pct and sell_per_unit are derived, not persisted.** Read via `getCostingBundle.tiers[].marginPct` and `tierBreakdown` — already first-class. Don't write to these "columns"; they don't exist. CD's original data-source map had phantom-column classification; corrected as part of brief landing.

7. **Apply-path audit-log discipline (Disposition B):**
   - Surgical (single-tier): `diff_json.source = 'pricing_suggestion_surgical'`, single audit row
   - Global (N-tier): `diff_json.source = 'pricing_suggestion_global'`, cascade audit pattern (root audit row + N derived rows via `caused_by_audit_id`)
   - Future suggestion kinds get new per-kind source values per Slice 9.2 namespace convention

8. **Strip prototype review chrome (LOW-6).** `pr-state-strip` review chrome in `pricing.jsx` + `pricing_styles.css:12-30` is design-review-only and MUST NOT ship. CLAUDE.md R-round prototype framing convention — chrome lives in prototype, not in production code.

9. **Pattern coverage at impl (Architect verifies at Step 16):**
   - **Pattern 47** forward-compat (no new inputs in this slice; verify suggestion-apply button carve-out)
   - **Slice 9.2 `diff_json.source` namespace** for apply paths per Disposition B
   - **Cascade audit pattern** for global-apply (N tier writes; one root + N derived rows)
   - **Slice 9.4b single-concern helper naming** if any new helpers (e.g., `applySurgicalAdj`, `applyGlobalAdj` — not generalized `applyPricingSuggestion(kind, ...)`)
   - **Customer-view boundary guard** — no Pricing surface state leaks to PDF render
   - **Action result pattern** for new server actions
   - **revalidateQuoteTree** for quote-mutating actions

10. **Designer audit (Step 15) precedes Architect verification (Step 16).** CD reviews fidelity to design; Architect verifies pattern coverage. Different concerns, sequenced not bundled.

11. **Smoke discovery rate.** Typical 1-2 days of follow-up commits on a slice this size. Plan accordingly. Findings batch in standard Step 14 disposition format.

12. **Architect MEMORY.md updates expected post-impl.** Bank as project entries:
    - Pricing reframe v1 conventions (`pricing_events` table shape with FK semantics, telemetry event field discipline, tier-context capture pattern)
    - ROOM-state pill copy derivation rule (compute from state, not stored strings — the ③ lesson)
    - Suggestion engine context-aware ranking convention (surgical/global/accept-risk gating logic)
    - Per-kind suggestion source namespace (pricing_suggestion_*) — extension of Slice 9.2 audit source convention
    - Cascade audit pattern applied to multi-tier writes (extends existing cascade-delete cascade audit precedent)

13. **This brief is grandfathered as retroactive.** Pricing reframe was approved in a prior CA session before formal CA brief workflow was established. Going forward (Quote umbrella, Leaf-detach, all future slices) maintain "every slice has a CA brief" precedent established by autosave brief (PR #31) and Quote umbrella brief (PR #34).
