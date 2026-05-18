# Pricing Reframe v1 — Data-source map

Every visible field on the Pricing surface traced to schema, phase, and mutation surface.

## Page head

| UI element | Source | Phase |
|---|---|---|
| Eyebrow (`{client} · {scenario} · v{N} draft`) | ✅ `projects.client_name`, `scenarios.label`, `quotes.version_number` | v1 |
| Page title "Pricing" | static | v1 |
| Scenario description copy | UI copy (variant per scenario) | v1 |
| Back / Preview / Send actions | R7a action-cluster grammar carry-forward | v1 |

## BlendedHeadline

| UI element | Source | Phase |
|---|---|---|
| Blended margin value | 🔧 derived: `sum(sku × tier units × margin_pct) / sum(sku × tier units)` over all SKUs × tiers | v1 |
| "blended across all SKUs × tiers · sanity check" caption | UI copy (always visible, per Q6 disposition) | v1 |
| Verdict pill — `ALL TIERS AT TARGET` / `BLENDED SENDABLE · N TIER RISK` / `BLOCKED · BELOW FLOOR` | 🔧 derived from per-tier counts vs. `firm_settings` | v1 |
| ROOM-state line | 🔧 same derivation; copy adapts to belowTarget / belowFloor counts | v1 |
| Target / Floor meta | ✅ `firm_settings.target_margin_pct`, `.floor_margin_pct` (R5) | v1 |
| "↻ Recomputed live" | UI indicator | v1 |

## TierComplianceBlock

### Collapsed state (all tiers at target)

| UI element | Source | Phase |
|---|---|---|
| Summary line `✓ All N tiers at target · T1 X% · T2 Y% …` | 🔧 derived per-tier margins | v1 |

### Expanded state (any tier below target)

| UI element | Source | Phase |
|---|---|---|
| Per-tier row | ✅ `quote_tiers` (R7b carry-forward) | v1 |
| Tier label | ✅ `quote_tiers.label` | v1 |
| ★ Recommended indicator | ✅ `quote_tiers.recommended` (R4 commitment) | v1 |
| Units | ✅ `quote_tiers.qty` | v1 |
| Margin value | 🔧 per-tier computed from cost + price | v1 |
| Compliance chip — `AT TARGET` / `BELOW TARGET` / `BELOW FLOOR` | 🔧 derived from `margin_pct` vs `firm_settings` | v1 |
| Sell · unit | 🔧 derived per-tier from costing computation (weighted sum across SKUs × tier units) | v1 |
| Inline risk callout (below-target) | 🔧 computed copy `"If customer picks Tn, realized margin = X% (Δpp under target)"` | v1 |

### Applying state (scenario 6)

| UI element | Source | Phase |
|---|---|---|
| `APPLYING…` chip on affected row | UI state during write | v1 |
| Grayed margin value | UI state | v1 |

### Just-changed state (scenario 7)

| UI element | Source | Phase |
|---|---|---|
| Changed-row tint | UI state (post-write, time-decays) | v1 |
| Delta chip (`+2.9pp`) | 🔧 derived from before/after `margin_pct` | v1 |
| "Lifted to X% · within target" callout | UI copy from suggestion-apply result | v1 |

## FloorBlock (below-floor only)

| UI element | Source | Phase |
|---|---|---|
| Block visibility | 🔧 `any(tier.margin_pct < firm_settings.floor_margin_pct)` | v1 |
| Eyebrow `Below floor · deal-blocking` | UI copy | v1 |
| Head `Tn below the X% floor by Y.Ypp` | 🔧 derived | v1 |
| Description (full risk callout) | 🔧 same callout text as TCB row | v1 |
| Request override CTA | Routes to R3 admin-override flow | v1 |

## SuggestionEngine

| UI element | Source | Phase |
|---|---|---|
| Visibility | 🔧 auto-fires when any tier below target (Q1 disposition) | v1 |
| "↻ Auto-fired · context-aware ranking" indicator | UI copy | v1 |
| Surgical option | 🔧 computed: `+X% to tier_n only`, where X is smallest lift that brings tier to target | v1 |
| Global option | 🔧 computed: `+Y% to all tiers`, where Y is smallest global lift that brings worst tier to target | v1 |
| Accept-risk option | 🔧 derived: available only when below-target only AND recommended tier ≥ target (Q3 disposition) | v1 |
| Recommended-option chip (★ Recommended) | 🔧 driven by ranking: surgical-first when 1 below, global-first when 2+ below, surgical-first when below floor | v1 |
| Per-tier preview tile (`Tn · X% · +Δpp`) | 🔧 dry-run of the suggestion against current data | v1 |
| Accept-risk unavailable reason | 🔧 derived copy explaining why | v1 |
| Apply CTA | Writes `quote_tiers.tier_price_adj_pct` (R2 / Slice 9.2 carry-forward) | v1 |

## Apply toast (post-apply)

| UI element | Source | Phase |
|---|---|---|
| Toast visibility | UI state, time-decays | v1 |
| Message | 🔧 derived from applied-suggestion id + before/after margins | v1 |
| Audit reference (`audit_id=a_…`) | ✅ `audit_log.id` (R5) | v1 |

## Empty state

| UI element | Source | Phase |
|---|---|---|
| Empty card | 🔧 `quote_tiers.length === 0` | v1 |
| CTA "Return to Cost build" | R7a IA arc (Cost build → Costing) | v1 |

## Schema dependencies (all R2 / R5 / Slice 9.x carry-forward)

| Field | Owner | Used for |
|---|---|---|
| `quote_tiers.label, .qty, .recommended, .tier_price_adj_pct` | Slice 9.x / 9.2 | ✅ persisted — per-tier rows + ★ marker + suggestion-apply write target |
| `quote_tiers.margin_pct` (via `getCostingBundle.tiers[].marginPct`), `quote_tiers.sell_per_unit` (via `tierBreakdown`) | `costing.ts` | 🔧 derived — per-tier compliance + suggestion math + display |
| `firm_settings.target_margin_pct, .floor_margin_pct` | R5 | Target / floor thresholds |
| `quote_warnings.*` | Slice 9.5 | Drives auto-fire of suggestion engine |
| `audit_log.*` | R5 | Captures every apply + accept-risk decision |

## What's not in this round

- **No new schema except `pricing_events` table** (see designer notes for shape). Path 3 is a presentation reframe on existing fields plus one telemetry table for v1.1 Path 2 promotion analysis.
- **No new write paths.** Suggestion-apply writes go through existing `tier_price_adj_pct` mutation. Accept-risk doesn't write; it's an in-session decision that the audit log captures via `gate_overridden` action when the PM hits Send.
- **No persistence of "PM dismissed suggestions" state.** Suggestions re-fire on every below-target render.
- **No Path 2 (recommended-tier-primary) verdict shift.** Path 3 deliberately preserves the architecture for v1.1.
