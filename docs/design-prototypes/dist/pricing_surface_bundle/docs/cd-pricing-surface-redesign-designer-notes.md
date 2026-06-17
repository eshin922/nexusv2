# Pricing Surface Redesign · Designer notes

**Author:** CD (Claude Design)
**Round:** Pattern 30 · prototype ship
**Status:** Draft 1 — open for CA review per round cadence
**Files:** `Nexus_Pricing_Surface_Redesign.html`, `app/pricing_surface/{classifier.js, data.js, pricing_surface.jsx, styles.css}`

---

## 1 · The diagnosis (validating + extending CA's read)

CA counted 12 competing surfaces and three problems on the current Pricing surface. My read agrees on shape but I undercount differently and add two problems CA didn't surface explicitly.

### 1.1 The duplication is worse than 12 surfaces

The same alarm strings repeat across surfaces:

- **Blended margin 47.1%** appears 2× as a card (top + middle), plus implied in cost-stack subtotals across 5 tier columns, plus in per-SKU "ALL TIERS" sparklines. **~5 surfaces reading the same number.**
- **Tier 1 –41.9%** appears in 6 explicit places: top blended subtitle, deal-blocking callout, per-tier compliance row, cost-stack T1 footer ("BELOW FLOOR · –41.9%"), each per-SKU breakdown card, and bottom 3-tile callout.
- **"Below floor"** appears as pill, callout, row label, banner explanation, per-SKU UNDERPRICED chip. **5 repetitions of the same alarm.**

The real failure mode is **repetition saturation**, not just duplication. A PM scanning the page sees the same alarm 6× before reaching an action. The brain reads it as anxious decoration, not as one critical state requiring one action.

### 1.2 Two problems CA undercounted

**Problem 4 — The "Your next move" CTA is state-blind.** When the quote is below floor, the next move is NOT "Preview quote PDF" — it's "Request override" or "Apply Surgical." CA's "preserve the CTA pattern" is right; the implementation needs to be state-aware. The current page surfaces a generic Preview affordance regardless of whether the quote can ship.

**Problem 5 — Cost stack is dual-purpose and doing neither well.** Two jobs in one section:

- *Diagnose cost composition* → expand cost stack, see PKG/PROD/FRT/D+T contributions
- *Read margin per tier* → glance at per-tier compliance

Both jobs in one section forces both readouts to always be visible, which makes the per-tier compliance table redundant. **Fix: cost stack lives in DETAIL only; per-tier margins live in STATE/DETAIL split. Don't merge them.**

---

## 2 · The redesign shape

**Principle:** *Page grows in proportion to consequence.* When the quote is fine, the page is almost empty. When it's blocked, the page commits to the alarm.

Three zones, mode-aware:

```
[STATE]   — what's happening
[ACTION]  — what to do  
[DETAIL]  — drill in (collapsed by default)
```

### 2.1 Per-mode layouts

| Mode             | STATE                 | ACTION                                                                                | DETAIL    |
|------------------|-----------------------|---------------------------------------------------------------------------------------|-----------|
| **sendable**     | state line (1 row)    | `SendableSummary` (composition) + Preview PDF CTA                                     | collapsed |
| **suggestion-led** | state line + warn callout | `SuggestionCard` (★ Recommended) + demoted Preview CTA                              | collapsed |
| **blocked**      | state line + full state CARD | Ranked actions: ★ Apply Surgical + Request Override (+ accept-risk banner if blocked) | collapsed |

The STATE zone literally gets bigger as consequence escalates: one line → one callout → full card.

### 2.2 What the state line carries

**Status only. No margin number.** Per Edward's resolution (locked):

```
[SENDABLE pill] All tiers above target                                        ← sendable
[REVIEW pill]   1 tier below target                                           ← suggestion-led
[BLOCKED pill]  1 tier below floor · mixed status · per-SKU view in detail    ← blocked
```

The blended margin number lives in:
- **sendable** → `SendableSummary` card (composition, not status)
- **suggestion-led** → state callout
- **blocked** → state CARD's right rail

State line and summary card share **zero numeric overlap**. State line answers *"is the quote okay?"*. Summary card answers *"what am I sending?"*. Two surfaces, two jobs.

### 2.3 SendableSummary — explicitly new component

**This is a new component.** The "no new components" soft constraint is violated here. We're being honest about it — the alternative (one-line state with no summary card) tested as too sparse on a wide viewport and reads as half-shipped.

Spec:
- Renders only when `mode === "sendable"`
- 4 cells: scope (SKU/tier count), recommended tier (id + qty), order value at recommended tier, blended margin
- Low-chrome treatment, monospace numerics, no status semantics (status lives above in state line)
- Composes with the primary CTA card immediately below

Flagged for CC scope-in. Component spec in `app/pricing_surface/pricing_surface.jsx` → `SummaryCard`.

---

## 3 · The classifier is the single source of truth

**Every state-bearing surface in the redesign reads from one classifier output object per render.** No surface computes its own state.

`PSR.classify(quote)` returns `QuoteState` containing:

- `mode` — `"sendable" | "suggestion_led" | "blocked"`
- `state_line` — `{ lead, status, qualifiers[] }` (pre-composed strings)
- `summary_card` — populated only when `mode === "sendable"`
- `flags` — `{ over_client_target, data_incomplete, override_applied, accept_risk_unavailable, ... }`
- `tiers[]` — per-tier rollup (status, min margin, blended margin, override flag)
- `skus[]` — per-SKU rollup for diversity surfacing
- `actions[]` — ranked actions with `recommended: true` markers
- `cells[]`, `below_floor[]`, `below_target[]`, `over_client_target[]` — raw cell sets for detail surfaces

**The §1 fix is structural, not layout.** The meta-tile contradiction (CA's original "all 3 to DETAIL" vs "keep lines-needing-review") was a source-of-truth failure: three surfaces each computed their own version of "what needs review." The fix is one classifier, one render pass, all surfaces consume.

For CC handoff: model `QuoteState` as a value type, not a derivation scattered across components. The classifier is the contract between schema and UI.

---

## 4 · Dispositions on the six closes

### 4.1 State line vs state card — one-line + summary card

**Locked.** State line carries status only; summary card carries scope + numbers; zero numeric overlap. See §2.2.

### 4.2 Source-of-truth statement — structural

**Explicit in §3 above.** The classifier is the contract.

### 4.3 Over-client-target — flag, composes with mode

**Not a mode. A flag.** Composes per the rules below:

| Mode             | Compound with `over_client_target` |
|------------------|------------------------------------|
| sendable         | Sendable + soft "Tighten to client benchmark" affordance in ACTION + qualifier on state line |
| suggestion-led   | Suggestion still primary; over-target chip in DETAIL only |
| blocked          | Blocked dominates; over-target chip in state-card meta-row + DETAIL |

The principle: **mode determines page shape; flags decorate within zones.** Fixing the floor takes precedence over harvesting headroom.

### 4.4 Missing data — provisional, never silently fine

Classifier never silently treats unknown margin as sendable. If any cell is unknown:

- **blocked stays blocked** (known floor breach is decisive)
- **suggestion-led stays suggestion-led**
- **sendable becomes "sendable_provisional"** — state line shows asterisk + qualifier (`2 cells awaiting raws`), CTA renders **visible but inert** with explainer text

Future enhancement: `worst_plausible_margin()` helper to decide whether the unknown cells *could* cross floor once data lands. v1: simpler rule — any unknown = inert CTA on otherwise-sendable.

### 4.5 Action ranking — locked heuristic

When multiple actions exist in ACTION zone:

| Mode             | Recommended action | Secondary |
|------------------|--------------------|-----------|
| blocked          | Apply Surgical (lifts above floor) | Request Override |
| suggestion-led, 1 tier below | Apply Surgical (single-tier lift) | demoted Preview PDF |
| suggestion-led, 2+ tiers below | Apply Global (proportional, preserves curve) | demoted Preview PDF |
| sendable         | Preview PDF | Tighten to benchmark (if over-target flag) |

**Rule:** Exactly one action carries `★ Recommended` per render. The recommended marker is rendered by the card chrome — not a separate component — so it can't drift from the classifier's `recommended: true` field.

### 4.6 Mid-edit transitions — specified

PM editing global adjustment, value crosses below-floor threshold mid-keystroke:

1. Field stays focused; PM keeps typing
2. State line + state card / callout re-render **in place** (no scroll, no modal)
3. Recommended action updates if applicable
4. DETAIL's expanded/collapsed state is preserved across re-renders
5. **No auto-expand on escalation** — if DETAIL was collapsed and the quote escalates to blocked, DETAIL stays collapsed. PM sees the state change, decides to drill in. No surprise expansion.

The transitions don't navigate — they re-render in place. Scenario ⑪ demonstrates blocked → sendable post-Apply Surgical with the `psr-transition-note` flash to signal the change.

### 4.7 Cost stack at 5+ tiers

**Known R6 territory; out of scope for this redesign.** When tier count exceeds 4, cost-stack columns get tight regardless of zoning. Documented as a separate ticket; not blocking this slice.

For v1 of this redesign, cost stack only renders inside DETAIL, expanded on demand. The columns-too-tight problem at 5+ tiers persists but is no longer competing for primary attention — the PM only sees it when they've explicitly expanded the diagnostic.

---

## 5 · Out-of-scope (separate CC tickets)

Logged from pixel-pass of current state:

1. **Test fixture names** visible in screenshots (Test-123-ABC, TEST MAKEUP BAG, etc.) — impl-time leak
2. **"If customer picks Tier 1" conditional language** in cost-stack T1 column — Pricing reframe v1 shipped the unconditional language; cost stack didn't get the update
3. **Sparkline data-point legend / hover** — current sparklines render dots without tier labels; per-SKU breakdown in this redesign uses labeled bars instead
4. **SHOW BREAKDOWN visual register** — currently reads as a label not a button; replaced with disclosure twirl in this redesign
5. **Cost stack tier-column horizontal bars** — currently unlabeled; either remove (data is in dollars next to them) or label as proportional contribution

---

## 6 · Scenario inventory (11 scenarios · 6 clusters)

| #   | Cluster                          | Key                                  | Purpose |
|-----|----------------------------------|--------------------------------------|---------|
| ①   | A · Sendable                     | `s01_sendable_vanilla`               | Default sendable; 5 SKUs × 5 tiers; ~empty page |
| ②   | A · Sendable                     | `s02_sendable_headroom`              | 53% blended; same minimal layout — no headroom callout in primary attention |
| ③   | A · Sendable                     | `s03_sendable_2tier`                 | Narrowest credible quote — layout doesn't feel emptier |
| ④   | B · Suggestion-led               | `s04_suggestion_surgical`            | One tier below target → Surgical wins ranking |
| ⑤   | B · Suggestion-led               | `s05_suggestion_global`              | Three tiers below target → Global wins (surgical would compound) |
| ⑥   | C · Blocked                      | `s06_blocked_one_tier`               | Full state card; ranked ★Apply Surgical + Override |
| ⑦   | C · Blocked                      | `s07_blocked_per_sku_diversity`      | Worst SKU dominates; per-SKU view in DETAIL |
| ⑧   | C · Blocked                      | `s08_blocked_accept_risk`            | Accept-risk unavailable banner — preserves discoverability |
| ⑨   | D · Compound                     | `s09_sendable_over_client_target`    | Mode + flag composition: sendable + soft Tighten |
| ⑩   | E · Data state                   | `s10_provisional_missing_raws`       | Asterisk on state line; CTA visible-but-inert |
| ⑪   | F · Transition                   | `s11_post_surgical_applied`          | Mode re-renders in place after Apply Surgical (recovery) |
| ⑫   | D · Compound                     | `s12_suggestion_over_client_target`  | Suggestion-led + over-target — flag stays in DETAIL only |
| ⑬   | F · Transition                   | `s13_escalation_below_floor`         | Mid-edit escalation — no surprise expansion; persistent hint |
| ⑭   | C · Blocked                      | `s14_blocked_no_override`            | `allow_override: false` — inert override-unavailable action |

CA spec'd 10–14; we ship 14. Coverage spans all 3 modes, both compound-flag compositions, both data-state edges, and **two** transition directions (recovery + escalation).

---

## 7 · Considered + rejected

- **One-master toggle for DETAIL vs per-section toggles.** Master toggle wins. PMs going diagnostic want the full context; per-section adds 3 affordances for a 1-affordance job.
- **State card on sendable mode (scaled-down current treatment).** Rejected. Re-inflates visual weight; contradicts the "page grows with consequence" thesis. One-line state + summary card carries the weight.
- **Always-expanded cost stack for active reviewers (per-PM preference).** Over-engineering for v1. Discoverability of "Show pricing detail" handles it; muscle memory after first session. Revisit v1.5+ if real workflow data shows pain.
- **"Most headroom" / "Client benchmark" / "N lines need review" tiles in primary attention.** All three move to DETAIL. The lines-need-review count folds into the state line copy (where it belongs — it IS the status).

---

## 8 · Pushbacks remaining

Surfaced for CA disposition at re-review:

- **Provisional-with-might-cross-floor.** v1 ships a simpler rule (any unknown cell = inert CTA on sendable). The `worst_plausible_margin()` helper is unspecced. If real data shows PMs frequently waiting on raws that obviously won't cross floor (e.g., one cell missing on a SKU with 60% margin elsewhere), the rule degrades trust. Worth instrumenting.
- **Mode-transition discoverability.** Scenario ⑪ shows a green flash banner ("Applied Surgical · Mode transitioned blocked → sendable in place. DETAIL state preserved."). PMs unfamiliar with the new pattern may miss that the page didn't navigate. Worth a usability check.
- **Accept-risk unavailable as inert affordance vs hidden.** v1 shows the banner; an argument exists for hiding it entirely (no affordance = no expectation). Banner wins because PMs onboarding to the firm need to know the path *exists* on accounts that allow it.

---

## 9 · Re-review · disposition (round 2)

Edward's prototype-ship review came back with five fixes + three scenarios + pushback dispositions. All landed in this revision.

### Five fixes landed

| # | Fix | Where |
|---|-----|-------|
| 1 | **Classifier discipline** — per-cell status now classifier-owned; `DetailPerSku` + `SkuBreakdown` consume `cell.status` instead of re-deriving | `classifier.js` (per-cell loop) + `pricing_surface.jsx` (SkuBreakdown reads `cell.status`, `cell.client_target_delta`, `cell.over_client_target`) |
| 2 | **Post-apply projection** — `projected_blended_after_apply` is now a property of the recommended action; `SuggestionCard` consumes it | `classifier.js` `projectBlended()` helper attached to action objects |
| 3 | **`data_incomplete` qualifier in blocked mode** — surfaced on state line | `classifier.js` blocked-branch state-line composition |
| 4 | **Missing-suggestion guard** — classifier checks `quote.suggestions?.surgical/.global` exists; falls back to a `calculating_suggestion` action rendered as an inert pending card | `classifier.js` action ranking + `pricing_surface.jsx` `SuggestionCard` calculating branch |
| 5 | **`allow_override: false` fallback** — classifier emits an inert `override_unavailable` action when blocked + policy disallows override; state line carries an `override unavailable · firm policy` qualifier | `classifier.js` blocked branch + new scenario `s14_blocked_no_override` exercises the case |

### Three scenarios added

| # | Key | Purpose |
|---|-----|---------|
| ⑫ | `s12_suggestion_over_client_target` | Suggestion-led + over-client-target compound. Verifies the disposition: suggestion stays primary; over-target chip in DETAIL only; no competing "Tighten" action |
| ⑬ | `s13_escalation_below_floor` | Any → blocked escalation transition (suggestion-led → blocked via mid-edit global adjust). Verifies the "no surprise expansion" rule visually + the persistent state-line hint |
| ⑭ | `s14_blocked_no_override` | Exercises fix #5: blocked + override unavailable. Shows the inert action card + the state-line `override unavailable · firm policy` qualifier |

The 2-tier non-trivial case (4th candidate) is **deferred** per Edward's lower-priority call. `s03_sendable_2tier` covers layout adaptation at the trivial case; deferring the 2-tier-blocked variant to v1.5 unless real-data evidence shows the small-quote blocked state is materially different.

### Pushback dispositions (round 2)

- **Provisional-with-might-cross-floor.** v1 simple rule ships. Instrument inert-CTA frequency in production for v1.5 decision. Notes-as-spec.
- **Mode-transition discoverability.** Flash banner one-shot + **persistent "just updated" hint on state line for 30s** (added — `psr-just-updated` class, fades via CSS animation). Richer tweens deferred to v1.5+.
- **Accept-risk unavailable banner.** Stand. Discoverability for cross-firm onboarding is the deciding factor; banner stays.

### CC handoff explicit notes

- **`SendableSummary` is a new component.** Reads only existing schema fields (sku count, tier count, recommended tier id+qty, blended margin). Scope into CC queue as new chrome; no DB changes.
- **`QuoteState` is the contract.** Model it as a value type (TS interface in `docs/cd-pricing-surface-redesign-data-source-map.md` §Classifier output contract). Components consume the type; nothing inside a component derives status, mode, or any other state-bearing field. This is the structural §3 fix codified for impl.
- **Suggestion projection is classifier-side.** `projected_blended_after_apply` is computed in `classifier.js`. CC's suggestion engine should populate `quote.suggestions.{surgical,global}` with `new_margin` / `new_blended` so the classifier can project. If a suggestion isn't available at render, the classifier emits the inert `calculating_suggestion` fallback — no fabricated numbers.
- **Test-fixture name swap** is CC's job. Project fixtures here (Brookfield Lifestyle Co., Cotton tote · natural, etc.) are realistic and ship-ready. The legacy test-fixture leak (Test-123-ABC, TEST MAKEUP BAG) is a separate impl ticket.

### Re-review

Per Pattern 30 cadence, next re-review is at CC's impl-brief draft. Open questions resolved; design is shipping-ready.
