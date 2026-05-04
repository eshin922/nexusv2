# Slice 9.5 brief — Validation engine + `quote_warnings`

**Status.** Pre-redesign-implementation prerequisite. Ships after Slice 9.4c (quote-level client target) and before redesign-implementation slice.

**Effort estimate.** ~5-7 build days. Three sub-steps: schema + engine; surfacing UI on existing surfaces; persistence + audit-logging integration.

**Dependencies.** Slice 8.5 multi-user realtime (shipped). Slice 9.4 family (shipped). Optimistic store (shipped). Action result pattern (shipped). Cascade audit pattern (shipped). No new architectural patterns needed; this slice is pattern-application work.

**Scope.** Build the validation engine, the `quote_warnings` table, the action-layer integration that creates/resolves warnings on input changes, and the UI surfaces that show warnings inline + in summary form. Does NOT include the "What's my move" inbox surface (Round 4 deferred until ≥80% signal coverage validates this engine).

---

## 1. Frame — what this slice is and isn't

**What it is.** The validation engine — a system that watches cost-input data as PMs enter it and flags issues that would otherwise slip through to PDF or HubSpot writeback. Two categories of issue:

1. **Completeness gaps** — data that's missing where it should be present. Examples: tier coverage mismatch (3 tiers defined but packaging only entered for 2), missing customs on pass-through freight, SKU with no cost data at all.
2. **Anomalies** — data that's present but smells wrong. Examples: flat-fee setup costs that vary across tiers (should be tier-invariant — likely a typo), customs percentages that aren't identical across tiers for the same SKU (the customs rate is per-SKU, not per-tier, so cross-tier variance is suspicious), markup overrides that look extreme (>5× the firm default).

The engine produces structured warnings that PMs see at three points: inline next to the suspicious field, in a per-page summary panel, and aggregated on the Costing Sheet. PMs can fix the issue or accept the warning with a reason.

**What it isn't.**

- **Not a hard gate.** Mark-Accepted has its own gates (UNDERPRICED, BELOW FLOOR — Slice 12). Slice 9.5 warnings are informational + advisory. A blocking severity tier exists (`severity = 'action_required'`), but blocking applies to the Mark-Accepted action only, not to inline editing.
- **Not the inbox surface.** Round 4 designed a "What's my move" inbox in the deal organizer that consumes `quote_warnings` for cross-project surfacing. That ships post-redesign-implementation, after this engine validates ≥80% signal coverage on real PM use.
- **Not anomaly detection beyond rule-based + statistical.** Slice 9.5 ships a rule-based engine (per-field validation rules) plus simple statistical sanity (5× outlier detection). ML-based pattern recognition or learned anomaly detection is post-MVP.
- **Not a complete validation rewrite.** Existing client-side validation (range checks, type validation, required-field enforcement) stays where it is. Slice 9.5 layers on top — semantic warnings for data that passes client-side checks but is suspicious at the workflow level.

---

## 2. Schema — `quote_warnings` table

```sql
CREATE TABLE quote_warnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  
  -- Scope: line-level vs quote-level
  scope           TEXT NOT NULL CHECK (scope IN ('line', 'quote')),
  
  -- Targeting: which row, which field, which tier (NULL when scope = 'quote')
  table_name      TEXT,            -- 'packaging_inputs' | 'production_inputs' | 'freight_inputs' | 'quote_skus' | 'quote_tiers' | NULL
  row_id          TEXT,            -- mirrors audit_log.entity_id posture: UUID-as-text for genuine row warnings;
                                   --   synthetic composite key for cross-row warnings (e.g., "sku:<sku_id>:col:setup_fee_total"
                                   --   when warning targets a per-SKU pattern across tiers).
                                   --   NULL when scope = 'quote'.
  field_name      TEXT,            -- column name on the row (e.g., 'unit_cost', 'duty_pct'), NULL when warning is row-level rather than field-level
  tier_id         UUID REFERENCES quote_tiers(id) ON DELETE CASCADE,
                                   -- NULL when warning is tier-agnostic
  
  -- Classification
  kind            TEXT NOT NULL,   -- enum-ish; see kinds below
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'review', 'action_required')),
  
  -- Status lifecycle
  status          TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'accepted', 'auto_resolved')),
  
  -- Acceptance trail (when status = 'accepted')
  accepted_by_user_id  UUID REFERENCES users(id),
  accepted_at          TIMESTAMPTZ,
  accept_reason_kind   TEXT,       -- 'vendor_moq_break' | 'customer_specific_pricing' | 'special_handling_fee' | 'custom' | NULL
  accept_reason_text   TEXT,       -- free-form when accept_reason_kind = 'custom'
  
  -- Auto-resolve trail (when status = 'auto_resolved')
  auto_resolved_at     TIMESTAMPTZ,
  
  -- Surface metadata for human-readable display
  message              TEXT NOT NULL,  -- "Setup fee differs by tier · this is usually flat" or similar
  detail_json          JSONB,          -- structured data for the UI to render Fix/Accept actions
  
  -- Lifecycle timestamps
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quote_warnings_quote_active_idx
  ON quote_warnings(quote_id, status) WHERE status = 'active';
CREATE INDEX quote_warnings_quote_scope_idx
  ON quote_warnings(quote_id, scope);
CREATE INDEX quote_warnings_row_idx
  ON quote_warnings(table_name, row_id) WHERE table_name IS NOT NULL;
```

**Notes on schema:**

- **Two scopes** (line vs quote) — line-level warnings target a specific row + field + tier; quote-level warnings target the whole quote (e.g., "no SKUs have cost data yet").
- **`table_name` + `row_id` + `field_name` + `tier_id` is the addressing tuple.** Engine and UI both use this tuple to identify which warning maps to which UI cell. `row_id` is TEXT (not UUID) to support both genuine row warnings (UUID-as-text) and cross-row pattern warnings (synthesized composite text keys like `"sku:<sku_id>:col:setup_fee_total"`). Mirrors `audit_log.entity_id` posture.
- **Severity tiers**:
  - `info` — surfaced ambiently (small icon, no count chip), informational only
  - `review` — counted in summary panels ("3 warnings"); doesn't block actions
  - `action_required` — counted; blocks Mark-Accepted in Slice 12; visually emphasized
- **Status lifecycle**:
  - `active` — warning is currently surfaced
  - `accepted` — PM explicitly suppressed with a reason (`accept_reason_kind` + optional `accept_reason_text`)
  - `auto_resolved` — underlying data changed such that the warning no longer fires; engine flips status automatically
- **Acceptance reason enum** matches the four options designed in Round 1-2 backlog: vendor MOQ break, customer-specific pricing, special handling fee, custom (free-form). Custom requires `accept_reason_text`; others optional.
- **`message` is human-readable summary**, populated by engine. **`detail_json` carries structured data** for the UI to render Fix/Accept actions (e.g., for a "tier mismatch" warning, detail_json includes the expected vs actual values per tier so the UI can show a one-click "copy from Tier 1" action).
- **`last_evaluated_at`** lets the engine re-evaluate stale warnings without redundant work.

**Migration sequencing.** Migration 16 (or whatever number is next) — clean addition; no existing data. Verification script: round-trip insert + soft-delete (set status to accepted) + auto-resolve flow.

---

## 3. Validation engine architecture

**Location.** `src/lib/validation.ts` (new module).

**Engine shape.** Pure functions that take a quote bundle (the same shape Slice 8 builds for the costing computation) and return an array of warning specs. Engine never writes; the action layer wraps engine output and does the persistence.

**Why pure functions.** Same reason `costing.ts` is pure: client + server run the same code. Optimistic store fires validation on every input change client-side; warnings appear immediately (no server roundtrip; no DB write). Action layer re-runs validation server-side **on action commit** (insert/update/delete completion) and persists authoritative warning state to `quote_warnings`.

**Persistence asymmetry from costing.** Costing computation is keystroke-debounced and persists per-debounce. Validation is NOT keystroke-debounced for persistence — it runs many times client-side (free, in-memory) for inline warning display, but persists only when an action commits a row mutation. Warnings are persistent state with audit trail; keystroke-aligned persistence would create write storms and orphan audit rows. Different write semantics from costing intentionally.

**Engine signature:**

```typescript
type WarningSpec = {
  scope: 'line' | 'quote';
  table_name: string | null;
  row_id: string | null;
  field_name: string | null;
  tier_id: string | null;
  kind: WarningKind;
  severity: 'info' | 'review' | 'action_required';
  message: string;
  detail_json: object;
};

export function validateQuote(bundle: CostingBundle): WarningSpec[] {
  // pure; runs client + server identically
  return [
    ...checkCompleteness(bundle),
    ...checkAnomalies(bundle),
  ];
}
```

**Reconciliation pattern.** Engine output is the desired state of `active` warnings. Action layer compares engine output to currently-active rows in `quote_warnings`:
- New specs → INSERT new warning rows (`status = 'active'`)
- Existing rows where engine no longer fires → UPDATE `status = 'auto_resolved'`, set `auto_resolved_at`
- Existing rows where engine still fires → UPDATE `last_evaluated_at`
- `status = 'accepted'` rows → never auto-resolve; PM-explicit suppression sticks until either (a) PM manually re-activates the warning via UI affordance OR (b) the underlying row is deleted (FK CASCADE handles cleanup). Engine does NOT compare accept-time data snapshots against current state; the schema has no `accept_data_snapshot` column. This is conservative MVP posture — accepted warnings could go stale if data shifts under them, but the failure mode is benign (warning stays accepted when it possibly shouldn't) and surfaces during smoke + iteration. Manual re-activate affordance is a UX_BACKLOG candidate; not 9.5 blocking. Forward path is additive — `accept_data_snapshot` can be added via ALTER if smarter behavior is needed later.

**Audit logging.** Per CLAUDE.md cascade audit pattern + Round 5 cascade tagging commitment:
- Single audit row per user action that triggers re-validation; cascading warning lifecycle changes (created / auto-resolved / re-activated) captured in `diff_json` under `cascaded_warnings_*` keys
- When user explicitly accepts a warning, that action gets its own audit row with `caused_by_audit_id` linking back to the input change that surfaced the warning (when applicable)

**Realtime sync.** Slice 8.5 realtime subscriptions extend to `quote_warnings`. Other PMs viewing the same quote see warning state update in real-time when one PM accepts/fixes. Coalesce same-coarse pattern as Slice 8.5.

---

## 4. Validation rules — what the engine checks

### 4.1 Completeness gaps

**Quote-level:**

- **No SKUs with cost data.** Quote has tiers + SKUs but zero cost inputs across packaging/production/freight. Severity: `info`. Message: "No cost data yet · open Cost build to begin."
- **All SKUs have packaging but no production.** Suggests workflow stuck at first input page. Severity: `info`. Message: "Production cost not yet entered for any SKU."
- **No tiers defined.** Edge case — quote should always have at least one tier from Slice 4. Severity: `action_required`. Message: "Quote has no tiers · add tiers in Setup."

**Line-level (per SKU):**

- **Tier coverage mismatch.** SKU has packaging entered for some tiers but not all. Severity: `review`. Message: "Packaging cost is set for Tier 1 but not Tier 2." detail_json: `{ missing_tiers: ['T2'], expected_tiers: ['T1', 'T2', 'T3'], copy_from_tier: 'T1' }` — UI surfaces "Copy Tier 1 → Tier 2" action.
- **Production but no packaging** (or vice versa). One side complete, other side empty. Severity: `review`. Message: "Production cost set without packaging · partial cost may render as $0."
- **Missing customs on pass-through freight.** Freight line has `freight_treatment = 'pass_through'` but `cbm_per_unit / duty_pct / tariff_pct` are NULL on at least one SKU on the line. Severity: `action_required`. Message: "Pass-through freight needs CBM, duty, and tariff to compute landed cost · 2 SKUs missing values."
- **SKU with retail benchmark but no cost.** SKU has `retail_benchmark` populated but no contribution cost. Probably an in-progress quote. Severity: `info`. Message: "Retail benchmark is set but cost is empty."

### 4.2 Anomalies

**Per-field rules (rule engine):**

- **One-time charges should be tier-invariant.** Five `production_inputs` columns are flat-by-design and should not vary across tiers for the same SKU: `setup_fee_total`, `tooling_artwork_total`, `rd_total`, `other_service_total`, `cm_assembly_total`. Engine checks each column independently. If values vary across tiers for the same SKU on any of these five columns, flag. Severity: `review`. Message: "Setup fee differs by tier ($5,250 / $5,400 / $5,250) · setup is usually flat across tiers." detail_json includes per-tier values + suggested fix (apply Tier 1 to all). **Explicit exclusions: `fillingBlendingCost` and `bulkRawCost` are volume-scaling per-tier and SHOULD vary across tiers — DO NOT include in this rule.** Architect verified these five columns have no legitimate reason to vary across tiers.

- **CBM cross-tier variance.** `freight_inputs.sku_total_cbm` is per-(SKU, tier, freight-line); cross-tier variance for the same SKU is detectable AND meaningful, BUT only flag when `units_in_shipment` matches across the rows being compared. Yield-mismatch (different `units_in_shipment` per tier) is a legitimate reason for `sku_total_cbm` to vary — don't flag those. Severity: `review`. Message: "CBM differs by tier on [SKU] · same units shipped per tier; CBM should match." detail_json includes per-tier CBM values + units_in_shipment values to confirm yield is consistent.

- *(Customs % cross-tier rule REMOVED.)* `quote_skus.duty_pct` and `tariff_pct` are stored per-SKU at the schema level — there's only one row per SKU, not duplicated per tier. Cross-tier variance is structurally impossible. Architect caught this error in CA's original brief; rule struck.

- **Markup overrides above firm default × 5.** When line-level markup override exceeds 5× the firm default (e.g., firm default 40%, override 250%+), flag. Severity: `review`. Message: "Markup of 280% on [line] is unusually high (firm default 40%)."

- **Negative cost values.** Any negative cost input. Severity: `action_required`. Message: "Cost cannot be negative." (Likely caught by client validation already; engine catches edge cases that bypass.)

- **Zero cost on populated row.** Row has data entered but unit_cost = 0. Severity: `review`. Message: "Cost is $0 on populated row · is this intentional?" detail_json includes accept-reason "special handling fee" pre-suggested.

- **Markup is uniform unless line has explicit override.** When PM enters a markup override at line level, engine doesn't flag uniformity. When markup defaults to firm category default, engine doesn't flag. Engine flags when line has implicit markup that's neither default nor explicit override (suggests stale data from a previous markup change cascade).

**Statistical sanity (>5× outlier rule):**

- For each component category (packaging, production, freight), engine computes the median per-unit cost across all SKUs in the quote. Any single SKU's cost > 5× median for that category → flag. Severity: `review`. Message: "Aluminum collar cost is 8× higher than other packaging components in this quote · is this intentional?" — gives PM a quick sanity-check surface.

- This rule is intentionally simple. Real outlier detection (per-category historical norms, vendor-specific baselines) is post-MVP. The 5× rule catches typos; learned baselines catch subtler issues but require data accumulation.

### 4.3 Severity assignment guidance

- `info` — informational only; doesn't count in summary chip; surface ambiently
- `review` — counted in summary; doesn't block; PM acknowledges via Fix or Accept
- `action_required` — counted; blocks Mark-Accepted in Slice 12; visually emphasized with red treatment

Most warnings start at `review`. `info` is reserved for "FYI" patterns (no SKUs entered yet). `action_required` is reserved for cases that would produce broken output (negative cost, missing customs on pass-through where the PDF would render zero or wrong values).

---

## 5. UI surfaces — where warnings appear

**Three surfaces; not all redesign-implementation Tier 1 surfaces touch them.**

### 5.1 Inline warning icon next to suspicious field

**Where.** Adjacent to any input field that has an active warning targeting that field.

**Visual treatment.** Small icon (warning triangle for `review`, exclamation circle for `action_required`, info dot for `info`). Color per severity. Hover shows the warning message in a small popover. Click opens an action popover with Fix and Accept buttons.

**Behavior.**
- Hover delay: 400ms (per existing tooltip patterns)
- Click → popover with: warning message + suggested Fix action (when engine provided one in detail_json) + Accept dropdown (with reason picker)
- Accept reason picker: vendor MOQ break / customer-specific pricing / special handling fee / custom (free-form text)
- Fix action: applies suggested fix from detail_json (e.g., copy Tier 1 to Tier 2; clear suspicious value; etc.) — uses normal action layer + audit pattern

**Implementation.** This adds to existing input row components on Cost Build sub-pages (packaging, production, freight). Slice 9.5 ships the warning surfacing on TODAY'S surfaces (current Slice 8 + Slice 9.x layout). Redesign-implementation slice picks up the warning components and re-applies them in the rebuilt Cost Build single-page architecture per Round 6.

### 5.2 Per-page summary panel

**Where.** Top-right corner of each Cost Build sub-page (packaging, production, freight) and the Costing Sheet.

**Visual treatment.** Small chip showing "N warnings" colored by highest severity present. Click expands a dropdown panel listing each warning with link-to-cell + Fix / Accept buttons.

**Behavior.**
- Chip count = active warnings on this page (filtered to relevant rows)
- Expanded panel shows each warning with: severity icon + message + link to specific cell + Fix button (when applicable) + Accept dropdown
- "Accept all" affordance at top of panel (with confirmation: "Accept N warnings?")
- Empty state: panel hidden when zero warnings

**Implementation.** New component `<WarningSummaryPanel>` rendered on each input page. Subscribes to optimistic store's warning state.

### 5.3 Costing Sheet aggregation

**Where.** Costing Sheet, replacing or augmenting the existing "Lines requiring review" placeholder.

**Visual treatment.** Same panel pattern as 5.2 but aggregates ALL warnings across all input pages for the quote. Severity-grouped (action_required at top, then review, then info).

**Behavior.**
- Same Fix / Accept / Accept-all affordances as 5.2
- Link-to-cell navigates to the relevant input page + scrolls to + highlights the relevant cell
- This panel is what Mark-Accepted (Slice 12) reads to determine whether to gate

**Implementation.** Reuses `<WarningSummaryPanel>` with `aggregate=true` prop.

---

## 6. Schema implications for downstream slices

- **Slice 12 (Mark-Accepted)** reads `quote_warnings WHERE status = 'active' AND severity = 'action_required'` to determine whether to gate. Quote-level gate (`blended_below_floor_override_*` per Round 3 commitment) is separate; warning-based gate adds a third dimension (line-level UNDERPRICED + quote-level BELOW FLOOR + line-level action_required warnings).
- **"What's my move" inbox surface** (deferred post-redesign-implementation) reads `quote_warnings` aggregated across projects, filtered by severity + status. The five signal types per Round 4 inbox design map to warning kinds in this engine.
- **Audit log read view** (Slice 16, supplanted by redesign-implementation §3.12) shows warning lifecycle events (created, accepted, auto-resolved) as audit feed entries.

**UX_BACKLOG candidate:** manual re-activate affordance for accepted warnings. Per architect's option (iii) on re-activation: PM-explicit suppression sticks until manual re-activate or row deletion. The manual re-activate UI affordance is not 9.5 blocking — accepted-but-stale warnings are tolerable failure mode for v1. Add as UX_BACKLOG entry to revisit when PM use surfaces the need (likely Slice 17 real-user test or post-MVP polish).

---

## 7. Smoke-test scope

For Edward to verify before merging Slice 9.5:

1. **Schema migration applies cleanly.** Verification script round-trips warning lifecycle: insert → accept → re-insert (after data change) → auto-resolve.
2. **Engine produces warnings on canonical test cases:**
   - Tier mismatch: enter packaging on T1 only with 3 tiers defined → expect tier-coverage warning on T2 + T3
   - Setup fee variance: enter $5,000 / $5,200 / $5,000 across tiers → expect anomaly warning
   - Customs % variance: enter different duty_pct on different tiers for same SKU → expect anomaly warning
   - Pass-through freight + missing customs: set freight to pass-through, leave customs empty on a SKU → expect action_required warning
   - 5× outlier: aluminum collar at $8 when median packaging is $1 → expect outlier warning
3. **Engine auto-resolves correctly.** Fix the underlying data → warning flips to `auto_resolved`.
4. **Acceptance flow.** Accept a warning with reason → status changes to `accepted` → audit log captures intent. Re-trigger by changing data → new active warning created (acceptance doesn't suppress future re-occurrences when underlying data changes).
5. **Realtime sync.** Two browser windows on same quote; PM 1 accepts a warning; PM 2 sees the chip count update within Slice 8.5 coalesce window.
6. **UI surfacing on existing pages.** Inline icons appear; summary chips show counts; Costing Sheet aggregation lists all warnings.
7. **Performance.** Engine runs in <50ms on a typical quote (12 SKUs × 4 tiers × 3 cost categories = ~150 rows). Validate on a worst-case quote (40+ SKUs).
8. **Audit pattern compliance.** Cascade audit rows correct (single audit per user action; cascaded warning changes in diff_json). `caused_by_audit_id` set when accepted warnings are caused by an upstream input change being re-evaluated.

---

## 8. Open questions

**Q1. Does the engine fire on EVERY input change or batched? — RESOLVED by architect.**

Architect verdict: client-side fires on every input change (free, in-memory, immediate inline warning display); server-side persists only on action commit (insert/update/delete completion), not per keystroke. This is a meaningful asymmetry from costing computation (which IS keystroke-debounced for persistence). Warnings are persistent state with audit trail; keystroke-aligned persistence would create write storms and orphan audit rows. Documented in §3.

**Q2. Severity assignment for "tier coverage mismatch" — review or info?**

Three tiers entered, packaging filled for 2 of 3. Is this `review` (counted, surfaced as warning) or `info` (FYI ambient)?

Recommendation: `review`. The PM may have intentionally not entered Tier 3 (still in negotiation), but partial completeness is exactly what the engine is meant to catch. PM can accept with reason "still in negotiation" if intentional.

**Q3. Should "Accept all" warn when accepting `action_required` items?**

If a PM clicks Accept-all on a panel containing 3 review + 1 action_required, do we warn before suppressing the action_required?

Recommendation: yes, confirmation dialog: "Accepting will suppress 1 action-required warning. Are you sure?" Costs one extra click; protects against accidental suppression of blocking warnings.

**Q4. How are statistical baselines for outlier detection initialized?**

The 5× outlier rule needs a per-quote median to compare against. On a 1-SKU quote, median is just that SKU's cost; outlier rule effectively disabled. On a 2-SKU quote, median is the average of two values; rule fires if one is 5× the other (which means ratio > ~10×).

Recommendation: outlier rule only fires when N ≥ 4 SKUs in the relevant category. Below 4, statistical baseline is too noisy. Document this in code.

**Q5. Where do warnings surface during Slice 9.5 → Slice 10 transition?**

Slice 9.5 ships the engine + warnings on existing surfaces. Slice 10 starts customer view, doesn't change input surfaces. Redesign-implementation rebuilds Cost Build into single-page Round 6 architecture.

Order: 9.5 → 10 → redesign-implementation. Warnings ship on current 3-page Cost Build, then carry forward into new single-page architecture during RI.4 (Cost Build unification). CC explicitly migrates warning surfacing into new components during RI.4.

---

## 9. Sub-step plan

**9.5.1 — Schema + engine (1.5-2 days)**
- Migration for `quote_warnings`
- `src/lib/validation.ts` with completeness + anomaly + outlier rules
- Pure-function tests (input bundle → expected warning specs)
- Verification script for migration

**9.5.2 — Action layer integration + persistence (1-1.5 days)**
- Wrap engine output in action layer; reconciliation pattern (active / accepted / auto_resolved)
- Acceptance action with reason capture
- Audit log integration (cascade pattern + caused_by_audit_id)
- Realtime subscription extension to `quote_warnings`
- Action-layer tests

**9.5.3 — UI surfaces (2-2.5 days)**
- Inline warning icon component
- Per-page summary panel component
- Costing Sheet aggregation
- Optimistic store integration (warnings update immediately on input change)
- Smoke tests across canonical scenarios

**9.5.4 — Smoke + polish (0.5-1 day)**
- Edward walks all canonical test cases
- Performance verification
- Audit log spot-check
- Final commit + PR

---

## 10. Frame for CC

Slice 9.5 is pattern-application work, not architectural-novelty work. The patterns it uses are all established:

- Pure-function engine matching `costing.ts` shape
- Optimistic store integration matching Slice 8 patterns
- Action layer + ActionResult + cascade audit + caused_by_audit_id (Round 5 commitment retroactively applied here as a fresh slice — easier than retrofitting)
- Realtime subscription matching Slice 8.5 pattern
- Form-state pattern + percent-display convention preserved on acceptance forms

Architect signs off on the engine signature + reconciliation pattern. CA reviews the warning rules + severity assignments. Edward smokes the canonical scenarios.

The brief does NOT prescribe exact wording for warning messages. CC drafts; CA reviews. Round 1-2 backlog established the four acceptance reasons; those are canonical. Severity tier mapping to UI treatment: CD didn't design this surface specifically, so visual treatment on warning icons + summary panel uses CD's existing chip + status conventions (info / review / action_required color treatment matches existing chip system: muted gray / amber / red).

When Slice 9.5 merges, redesign-implementation follows. The warning components built here get rewrapped during RI.4 (Cost Build unification) — same components, new container. CC plans for this re-application during 9.5 implementation.
