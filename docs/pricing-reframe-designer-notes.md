# Pricing Reframe v1 — Designer notes (Path 3 hybrid)

The brief identified the right operational risk: **blended margin is a sanity-check, not a target**, and the surface had been treating it as both. Path 3 hybrid preserves blended's prominent place while adding per-tier compliance as an equal-weight secondary surface. The Pattern 41 dispositions Edward locked drive a handful of specific decisions worth documenting.

## The seven scenarios at a glance

| # | Scenario | Visual handling |
|---|---|---|
| ① | All tiers above target | Blended `good` · TierComplianceBlock **collapsed** to a single summary line · no suggestions |
| ② | One tier below target (Edward's trigger) | Blended `good` with `· 1 tier risk` pill suffix · TCB expanded · inline callout on T1 row · suggestions ranked **surgical-first** |
| ③ | Multiple tiers below target | Blended `warn` · TCB expanded · inline callouts on T1 + T2 · suggestions ranked **global-first** · accept-risk **unavailable** (T2 recommended is below target) |
| ④ | One tier below floor | Blended `warn` with `· 1 tier blocked` pill · **separate FloorBlock** above TCB · TCB shows `bad` row · suggestions present but accept-risk **unavailable** |
| ⑤ | Empty quote | Blended renders with `—` value + `AWAITING INPUT` pill · TCB hidden · empty-state card guides PM to Cost build |
| ⑥ | Applying suggestion | Affected tier row shows `APPLYING…` chip + grayed margin value · suggestions disabled-by-implication · ROOM state holds steady |
| ⑦ | Post-apply | Toast shows successful application + audit ref · affected tier shows `changed` tint with delta chip · blended recomputes to new value |

## Five design decisions worth flagging

### 1. ROOM-state pill copy adapts per per-tier compliance

The pill string is computed from `belowFloor` and `belowTarget` counts, not just from `blended_state`. Examples:
- `ALL TIERS AT TARGET · SENDABLE` (all good)
- `BLENDED SENDABLE · 1 TIER RISK` (Edward's trigger scenario — blended is above target, but one tier risks)
- `BLOCKED · BELOW FLOOR` (any floor breach)

The pill carries both the blended verdict AND the per-tier warning when they diverge. This is what makes the trigger scenario impossible to misread. (Closes **Failure Mode 3** structurally — the average can't claim "sendable" without acknowledging tier risk.)

### 2. Collapse threshold (Q4)

TierComplianceBlock collapses only when **all** tiers are at target. The collapsed state shows the full per-tier margins on one line (`✓ All 4 tiers at target · T1 36.2% · T2 38.8% · T3 40.1% · T4 41.2%`) — PM still sees the numbers, just doesn't get the full row treatment. Any below-target tier opens the block.

Rejected: PM-toggleable expand/collapse with sticky preference. We want the surface state to track the data state, not PM preference; sticky preference invites the failure mode of "PM collapsed it once and never sees the risk again."

### 3. Risk callout severity treatment (Q5)

Below-target callouts sit **inline** within the tier row, next to the compliance chip. They share the row's `warn` tint.

Below-floor breach gets a **separate FloorBlock above** the TierComplianceBlock — same component vocabulary as R3's BELOW FLOOR treatment on Costing Sheet. The block carries a "Request override" CTA that routes to the admin-override flow (R5).

Both surfaces exist because they answer different questions. Below-target is "PM should know this is risky"; below-floor is "PM cannot send this without intervention." Different consequences → different treatment.

### 4. Context-aware suggestion ranking (Q3)

The engine's three options (`surgical` / `global` / `accept_risk`) are ranked by context, not by fixed order:

| Context | Recommended | Reason |
|---|---|---|
| One tier below target | `surgical` first | Touch only what needs touching; preserves tier ratios on healthy tiers |
| Multiple tiers below target | `global` first | Surgical works tier-by-tier; global lifts the floor coherently |
| Below floor | `surgical` first | Lifts the breached tier above the gate; global may not reach |
| T2+ (recommended) not healthy | `accept_risk` **unavailable** | Customer is most likely to pick recommended tier — accepting risk on it isn't a deal-savable position |
| Below floor | `accept_risk` **unavailable** | Floor breach blocks unconditionally; admin override is the path |

The `accept_risk` option appears only when **(a)** at least one tier is below target AND **(b)** the recommended tier is above target. The reason for unavailability surfaces below the suggestions list in a small dashed-border explainer.

### 5. Suggestion preview tiles

Each ranked option carries per-tier preview tiles showing the projected new margin + delta. The tiles use a constrained mono-font register so PM can scan all four projections in one glance without losing the comparison.

Tiles with `delta_pp = 0` show `·` rather than `+0.0pp` — keeps the "unchanged" tiers visually quiet. The delta on changed tiers uses `good` color when the change moves the tier toward target.

## Three pushbacks — disposition (CD + Edward, signed off)

### Pushback 1 — Blended caption strength: ACCEPTED · stronger framing shipped

Caption updated from `blended across all SKUs × tiers · sanity check` to **`Blended is the per-tier average — your realized margin is the tier the customer picks.`** Path 3's premise (customer picks one tier 95% of the time → realized margin is per-tier) is now explicit on the headline rather than buried in technical phrasing.

### Pushback 2 — Scenario ④ telemetry: ACCEPTED · banked

Below-floor + suggestions visual stacking holds for v1; we observe via telemetry whether the noise is real. Telemetry captures **tier context** alongside the action:

- `surgical_apply` event · fields: `violation_tier_id`, `suggestion_target_tier_ids[]`, `quote_id`, `user_id`, `applied_at`
- `request_override` event · fields: `violation_tier_id`, `floor_breach_pp`, `quote_id`, `user_id`, `requested_at`

v1.1 analysis: "users surgical-apply mostly on T1" vs "uniform across tiers" drives the Path 2 promotion decision.

### Pushback 3 — ★ Recommended reliability hedge: ACCEPTED · permissive default + banked

Accept-risk gating remains permissive when `quote_tiers.recommended` is unset (default-available, PM still chooses). Suggestion appears with the existing "★ suggestion not directive" framing.

Reliability telemetry shares the same surface as Pushback 2:

- `recommended_fired` · `quote_id`, `tier_id`, `fired_at`
- `recommended_accepted` · `quote_id`, `tier_id`, `accepted_at`
- `recommended_overridden` · `quote_id`, `tier_id`, `override_reason` (free text when capturable, else null)

## One feature commitment for v1

**Pricing-surface telemetry table** (`pricing_events`):

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

One table, five event types. Feeds v1.1 Path 2 promotion analysis + ★ Recommended reliability tracking.

**FK semantics (Disposition A from §0.5):**

- `quote_id` → CASCADE (sibling-table consistency)
- `user_id` → SET NULL (`audit_log.user_id` precedent)
- `violation_tier_id` → SET NULL (telemetry survives tier deletion for cohort analysis)

**Event-type validation:** text + CHECK per `quote_warnings` precedent.

**Index strategy:** two composite indexes — per-quote analytics + cohort analysis.

**`suggestion_target_tier_ids uuid[]` FK note:** Postgres array columns can't enforce per-element FK constraints. Pattern 32 pre-prod tolerance applies; application-layer validation enforces.

**Apply-path `diff_json.source` namespace (Disposition B from §0.5):**

- **Surgical (single-tier):** `diff_json.source = 'pricing_suggestion_surgical'`. Single audit row.
- **Global (N-tier):** `diff_json.source = 'pricing_suggestion_global'`. Cascade audit pattern — one root audit row + N derived rows pointing via `caused_by_audit_id`. Matches existing cascade audit semantics from cascade-delete pattern.
- Future suggestion kinds get new per-kind source values per Slice 9.2 namespace convention.

No collision with existing audit-log source values (verified at §0.5).

## Three pushbacks (original — preserved for context)

The brief said new PMs may misread blended as a target. We shipped the soft caption (`blended across all SKUs × tiers · sanity check`) per Q6. But "sanity check" is technical-speak — a new PM probably reads it as marketing copy and skips. The harder version would be **"blended is the average — your realized margin is per-tier"** with a stronger weight (small caps mono). Edward + Maya should decide if v1 caption is strong enough; v1.1 can iterate.

### Pushback 2 · Below-floor escalation may overwhelm the page when also showing suggestions.

Scenario ④ (one tier below floor) renders: FloorBlock + TierComplianceBlock + SuggestionEngine. That's three high-density blocks vertically stacked. The PM reads "deal-blocking" then "tier compliance" then "tier-aware suggestions" — three competing actions. We could collapse SuggestionEngine when FloorBlock is present, since the override request is the load-bearing path (suggestions can't lift T1 to above-floor at reasonable adjustments without breaking the rest of the quote). I held back because the suggestion `surgical · +18% to T1 only` actually does land T1 above target — there's still a non-override path. PMs can pick. But the visual stacking is noisy; worth measuring in v1 usage data.

### Pushback 3 · Recommended-tier (★) is unreliable today.

Path 3 surfaces the recommended star on the tier label and uses it in the accept-risk gating ("only when recommended is healthy"). Path 2 (v1.1) makes recommended-tier the primary verdict. Neither works unless `quote_tiers.recommended` is reliably set. The brief notes Path 2 depends on PM workflow data validating this; Path 3 inherits the same risk in a smaller way. **If recommended isn't set, the accept-risk gating defaults to "available" — which is the safer permissive direction (PM can always not click it).** Audit log captures the choice either way. Calling out so the recommended-tier reliability question lands in v1 workflow observation, not v1.1.

## Considered and rejected

- **A "show variance under blended" mini-chart on the headline.** Sparkline showing tier-margins around the blended average. Rejected: TierComplianceBlock already shows the per-tier values explicitly. Adding a chart on the headline would compete for attention and is decorative when the numbers are right there.
- **Hide blended entirely when any tier is below target.** Tempting but breaks the brief — Path 3 explicitly preserves blended's sanity-check role. The headline stays; the pill copy adapts.
- **One-click "Surgical · apply now."** Considered making the recommended suggestion auto-apply on render. Rejected: applying is a write that goes into the audit log and changes prices. PM should commit deliberately.

## Scenario ⑥ and ⑦ — token-level specs

Both scenarios are implemented in the live prototype (toggle "⑥ Applying adjustment" / "⑦ Adjustment applied" in the state strip). Architect runs Pattern 22 §0.5 verification against docs, so the explicit specs land here.

### Scenario ⑥ — Applying adjustment (transient state)

Demonstrates the in-flight state after the PM clicks `Apply` on a suggestion. Holds until the write returns.

| Element | Treatment |
|---|---|
| `APPLYING…` chip placement | Inline on the affected tier label, immediately right of the `Tn` text + `★` star (if recommended) |
| `APPLYING…` chip styling | `font-family: var(--mono)` · `font-size: 9.5px` · `color: var(--accent-ink)` · `letter-spacing: 0.06em` · `text-transform: uppercase` · `margin-left: 6px` · no background |
| Affected row background | `oklch(from var(--accent) l c h / 0.06)` — a 6% accent wash |
| Margin number color | Falls from semantic (good/warn/bad) to `var(--ink-4)` · numerals get `opacity: 0.5` |
| Margin suffix | After the percent value, append ` → applying` in `var(--mono)`, `font-size: 10px`, `color: var(--accent-ink)`, `letter-spacing: 0.06em`, `text-transform: uppercase` |
| Other rows | Unchanged · no global page treatment |
| Suggestions panel | Hidden during apply (no recompute-then-re-recompute loop) |

### Scenario ⑦ — Adjustment applied (post-apply state)

After the write returns, the toast surfaces and the affected row carries a `changed` treatment until next interaction.

#### Toast

| Element | Treatment |
|---|---|
| Position | Top of page content, above `BlendedHeadline` |
| Background | `oklch(from var(--good) l c h / 0.08)` |
| Border | `1px solid oklch(from var(--good) l c h / 0.30)` + `3px solid var(--good)` left edge |
| Border radius | `8px` |
| Padding | `12px 18px` |
| Layout | `grid-template-columns: auto 1fr auto · gap: 14px · align-items: center` |
| ✓ Glyph | `font-family: var(--mono)` · `font-size: 14px` · `font-weight: 600` · `color: var(--good)` |
| Message body | `font-size: 13px` · `color: var(--ink-2)` · `line-height: 1.45` — bold "Applied · " prefix in `var(--ink)`, then full message |
| Audit ref | `font-family: var(--mono)` · `font-size: 10px` · `color: var(--ink-4)` · `letter-spacing: 0.04em` · `text-transform: uppercase` — e.g., `audit_id=a_2104` |

#### Changed row

| Element | Treatment |
|---|---|
| Row background | `oklch(from var(--good) l c h / 0.05)` — 5% good wash, distinct from the warn rows |
| Margin number color | `var(--good)` (overrides semantic state, since the row IS the change) |
| Delta chip placement | Inline next to the margin number, `margin-left: 8px` |
| Delta chip styling | `display: inline-block` · `font-family: var(--mono)` · `font-size: 10px` · `letter-spacing: 0.04em` · `padding: 1px 6px` · `border-radius: 999px` · `background: var(--good-soft)` · `color: var(--good)` · text format `+X.Xpp` (signed, always +) |
| Inline callout | Replaces the risk callout · `var(--mono)` glyph `✓` in `var(--good)` color · text in `var(--good)`: "Lifted to X% · within target" |

#### Persistence

Changed row treatment **persists until next interaction** (PM clicks another scenario, applies another suggestion, navigates away, or the toast is dismissed). No fade-out timer. This gives the PM unbounded time to absorb the change and read the audit ref. The toast can carry a `Dismiss` affordance in implementation (not in v1 prototype, but reasonable for production) — when dismissed, the changed-row treatment also clears.

CC implementation note: state lives on the affected tier's record as a `just_changed: true` flag + `change_delta_pp: number` field. Cleared on next mutation to any tier in the quote, or on explicit toast dismiss.



R2 carry-forward for pricing math read paths. One new table — `pricing_events` — for telemetry, scoped separately in "One feature commitment for v1" above. Path 3 reads the same fields:

- `quote_tiers.{margin_pct, sell_per_unit, recommended}` (R2 / R5 carry-forward)
- `firm_settings.{target_margin_pct, floor_margin_pct}` (R5)
- `quote_warnings.*` (Slice 9.5 — drives suggestion engine context)
- `audit_log.*` (R5 — captures every suggestion apply + accept-risk decision)

The suggestion engine's tier-aware logic is computation, not schema. It runs in the pricing pipeline and produces an in-memory options list — no persistence required.

## Carry-forward to v1.1 (Path 2)

The architecture deliberately preserves:

1. **TierComplianceBlock as a usable secondary surface** when v1.1 promotes recommended-tier to primary verdict. The collapsed state still works.
2. **Suggestion engine's tier-aware option set** stays valid in Path 2 — surgical-on-recommended becomes the dominant option.
3. **Risk callouts** remain meaningful regardless of which verdict is primary.
4. **ROOM-state recompute** logic doesn't change between paths.

What changes in v1.1: blended demotes from primary headline to a tertiary surface (sidebar pill, or below the recommended-tier verdict). TierComplianceBlock becomes a sibling, not a subordinate. Nothing here blocks that move.

## Stacked / narrow-viewport variant

Per Q7 disposition, tier rows collapse to cards on viewports < 720px:
- Tier label + units stack with chip in the top-right
- Margin scales up to 22px (since it's the headline of each card)
- Inline callout drops below as a separate row with dashed top-border
- Sell-per-unit lives in the bottom-right
- Suggestion options also stack (apply button drops below description)

This is v2 backlog territory but the stacked variant ships in v1 styles so it's not a separate redesign later.
