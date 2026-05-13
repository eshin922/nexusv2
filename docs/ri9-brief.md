# RI.9 — Navigation IA implementation · Slice brief

**Status:** Ready to spawn. R7a + R7b deliverables landed; this brief is the canonical scope document CC builds against.

**Companion docs:**
- `docs/r7a-designer-notes.md` — R7a canon (5 rules, action cluster grammar, eyebrow/breadcrumb registers, three pushbacks dispositioned)
- `docs/r7a-data-source-map.md` — R7a schema commitments (`user_surface_visits` DDL) + surface-routes table + surface-render rules table
- `Nexus Round 7a.html` — R7a prototype (all 5 quote-scoped surfaces + Home, in `dist/`)
- `docs/ri8-navigation-audit-findings.md` — 4 structural findings dispositioned via R7a
- `docs/ri9-brief-skeleton.md` — predecessor skeleton (this brief supersedes it as canonical)

---

## §1 · Scope

RI.9 implements the navigation IA primitives canonized in R7a as a **foundation slice**. §6.b (Setup wholesale redesign) inherits these primitives and is queued behind RI.9 per sequencing decision (foundation dependency + smoke isolation).

**Surfaces touched (6):** Home (Resume card + What's my move inbox integration), Setup, Cost build, Costing, Customer view, Mark Accepted.

**In scope:**
- 7 implementation primitives from R7a canon (§3 below)
- Three CD pushback dispositions baked as implementation refinements (§4)
- Two new affordances surfaced during R7a build (§5)
- One new schema commitment (`user_surface_visits` with UPSERT pattern, §3.7)

**Out of scope (defer to §6.b or later):**
- Setup wholesale redesign — defers to §6.b (this slice ships only the Setup page-head primitives, not the SKU/Tier table redesign)
- Inline preview pane for Customer-facing notes — R7c carry-forward candidate (telemetry-driven)
- Multi-drawer mode on Customer view edit-notes — R7c candidate
- `Pull from Inventory` affordance — defers to its own slice once scope resolved (which inventory / what filter / carry-back semantics)

---

## §2 · Structural findings dispositioned

Four findings from `docs/ri8-navigation-audit-findings.md` (F-5, F-8, F-11, F-13) plus action cluster grammar pulled out of F-5 are all resolved by R7a's five rules. This slice implements those rules.

| Finding | R7a rule | Disposition |
|---|---|---|
| F-5 (breadcrumb standardization) | Rule D | One IA signal per surface. Breadcrumb appears only when inner rail is shed (Customer view today). |
| F-8 (Home re-entry) | Rule A | Resume card on Home; resumes the *surface* last touched, not the project. |
| F-11 (rail visibility) | Rule B | Surface metaphor drives rail visibility. Working surfaces keep rail; Customer view sheds (print-preview); Mark-Accepted keeps (confirmation sub-states). |
| F-13 (no forward affordance) | Rule C | Per-surface next-move + Home inbox. Both. Different intents (in-flow vs cross-project triage). |
| F-5 action cluster grammar | Rule E | Primary right · secondary middle · back left of vertical divider. |

---

## §3 · Implementation primitives (R7a canon)

### 3.1 `<Eyebrow>` component

- **Always present** on quote-scoped + admin surfaces
- **Never navigable** (label, not path)
- **Separator:** `·`
- **Examples:** `Lumen & Co. · Primary · v3`, `Admin · Audit log`, `Tuesday morning · last visit 5:14 PM Friday`
- **Visual register:** `.r2-eyebrow`

### 3.2 `<Breadcrumb>` component

- **Conditional render:** only when `rail.visible = false` (Customer view today; future shed-surfaces inherit the same rule)
- **Navigable:** every segment except the last is a link
- **Separator:** `›` (right-pointing chevron, signaling traversal)
- **Examples:** `Setup › Cost build › Costing › Customer view`
- **Visual register:** `.r2-eyebrow` (same visual token as Eyebrow, distinct semantic component)
- **XOR rule:** `<Breadcrumb when rail.shed /> ⊕ <Eyebrow otherwise>` — never both, never neither. Encode as a single function: `shouldShowBreadcrumb(surface) = !shouldShowRail(surface)`.

### 3.3 `<YourNextMoveBanner>` component — three states

| State | Visual | Behavior |
|---|---|---|
| **Default · prominent** | Accent-bordered, full-width, CTA right | Shows on every working surface; CTA = `surfaceMeta.next_move.label` |
| **Gated** | Same prominence, CTA = resolution path | CTA reads `surfaceMeta.next_move.gated_label` (fallback to `.label`) when gate is active. Example on Costing-below-floor: "Resolve override before sending →" instead of "Preview Quote PDF →" |
| **Terminal · muted** | Neutral border, no CTA | Mark-Accepted post-acceptance. Text: "Terminal surface — return via Home or rail." Explicit silence, not missing affordance. |

Banner is **structurally always present** for vertical-rhythm consistency. Visual adapts per state.

### 3.4 Action cluster grammar primitive

- **Right (primary):** forward-pointing action (Save draft, Send to customer, Mark Accepted, Confirm acceptance)
- **Middle (secondary):** non-forward, non-back actions (+ New scenario, View as customer, Customer accepted (manual), Preview, ↓ Download PDF, Edit notes, Request admin override)
- **Left of vertical divider (back):** back-direction affordances. Vertical divider visually separates back from current-flow actions.
- **Back-direction label grammar (Pushback 3 disposition):** destination-only. `← Cost build` (correct), `← Resume Cost build` (incorrect — verb-laden, drops to destination per Pushback 3).

### 3.5 Surface-routes table

| Surface key | Route | Forward-to | Backward-to |
|---|---|---|---|
| `setup` | `/projects/:id/quotes/:qid` | `cost_build` | — |
| `cost_build` | `/projects/:id/quotes/:qid/cost-build` | `costing` | — |
| `costing` | `/projects/:id/quotes/:qid/costing` | `customer_view` | — |
| `customer_view` | `/projects/:id/quotes/:qid/customer-view` | `mark_accepted` | `costing` |
| `mark_accepted` | `/projects/:id/quotes/:qid/mark-accepted` | — (terminal) | `cost_build` (override flow) |

Implement as a config table or code constant. Single source of truth for surface routing — Resume card CTAs + Home inbox Next-move jumps + breadcrumb segments all derive from this map.

### 3.6 Surface-render rules table

| Surface | `rail.visible` | `breadcrumb.visible` | Primary | Secondary | Back |
|---|---|---|---|---|---|
| Setup | true | false | Save draft | + New scenario | — |
| Cost build | true | false | Save draft | View as customer · + New version | — |
| Costing | true | false | Mark Accepted *(gated)* | Customer accepted (manual) · Preview | — |
| Customer view | **false** | **true** | Send to customer | ↓ Download PDF · Edit notes | — |
| Mark-Accepted | true | false | Confirm acceptance *(gated)* | Request admin override | ← Cost build |

Encode as a config object keyed by surface. Drives `<Eyebrow>` vs `<Breadcrumb>` selection, action cluster slot population, banner state.

### 3.7 `user_surface_visits` schema

```sql
create table user_surface_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  quote_id uuid references quotes(id),
  surface_key text not null,
  visited_at timestamptz not null default now(),
  unique (user_id, project_id, quote_id, surface_key)
);

create index on user_surface_visits (user_id, visited_at desc);
```

**Schema note (CC + CA disposition, May 2026):** `scenario_id`
dropped from the DDL — there is no `scenarios` table in current
schema (scenarios denormalized onto `quotes` per
`schema.ts:1158` Slice 14 todo). Each quote row IS a scenario
version; `quote_id` is the natural FK target. Resume card reads
`quotes.scenario_label` via JOIN for display. Slice 14
normalization may re-key to `(scenario_id)` later.

**Pattern: UPSERT** (CA refinement of CD's append + trim recommendation):
- Unique constraint on `(user_id, project_id, quote_id, surface_key)`
- Write path: `INSERT … ON CONFLICT (user_id, project_id, quote_id, surface_key) DO UPDATE SET visited_at = NOW()`
- **No cron trim job needed** — table size bounded by user × surface combinations (~5 surfaces × N quotes per user).
- Cleaner growth model than append + trim.

**Trade-off accepted:** loses per-surface visit history beyond latest. If R7c surfaces a "recent activity" use case requiring history, can revisit append-style schema. v1: UPSERT is right.

**Write trigger:** every quote-scoped page-load on the server side.

**Read path (Resume card):** `SELECT … FROM user_surface_visits WHERE user_id = me ORDER BY visited_at DESC LIMIT 1`.

---

## §4 · Implementation refinements (CD pushback dispositions)

### 4.1 Pushback 1 — Resume + inbox priority signal

**Problem:** Resume card and What's my move inbox sit side-by-side on Home. PM has to choose which to read first. CD's proposed rule: `now`-tier inbox items dominate; Resume wins for `today`-tier and below.

**CA refinement — surface-level signal in addition to behind-scenes priority:** when `now`-tier inbox items exist, the Resume card carries a visible affordance:

> "But check inbox first — {N} now-tier items"

Don't rely on PM to scan both cards and figure out the priority themselves. Behind-scenes priority + visible PM signal = the actual UX.

**Implementation:** small chip or callout strip inside the Resume card. Conditional on `now`-tier inbox count > 0. Links to inbox. Hides when count = 0.

### 4.2 Pushback 2 — Edit notes inline drawer/modal

**Problem:** CD's pushback noted Customer view's rail-shed makes "go back to Setup to edit notes" a breadcrumb-click instead of zero.

**CA disposition:** Implement "Edit notes" on Customer view as an **inline drawer/modal**, not a jump-to-Setup. PM stays on Customer view for edit-and-send loop.

**Scope:** edit `quote_meta.customer_facing_notes` only (the audience that renders on the Customer view artifact). Internal notes + per-SKU notes are not editable from Customer view (Setup-anchored per Gate 3).

**Pattern:** drawer or modal overlay; autosave on blur or Enter (R6 Blur+Enter pattern); close affordance returns to Customer view (no breadcrumb shuffle, no IA arc bypass).

### 4.3 Pushback 3 — Back-direction label grammar

**CA disposition:** Destination-only. `← Cost build` (correct), `← Resume Cost build` (incorrect — verb-laden ceremony, redundant with the arrow).

Encoded in surface-render rules table §3.6 — Mark-Accepted back-direction is `← Cost build`, not `← Resume Cost build`.

---

## §5 · New affordances to canonize

Two affordances surfaced during R7a build that need explicit implementation:

### 5.1 "View as customer" — Cost build secondary action

- Renders in Cost build action cluster, middle (secondary).
- Routes to Customer view directly (Cost build → Customer view jump, bypassing Costing).
- **Not a forward affordance** — it's a sideways glance: "does this still read right after my last cost change?" Pre-send.
- Doesn't replace the banner's `Review Costing →` forward next-move.
- Back via breadcrumb on Customer view (which is rail-shed per Rule B).

### 5.2 "Customer accepted (manual)" — Costing secondary action

- Renders in Costing action cluster, middle (secondary).
- **Not the same as Mark-Accepted.** Two-step deliberately:
  1. "Customer accepted (manual)" flips `quotes.customer_accepted: true` — records the customer's verbal yes
  2. "Mark Accepted" (downstream, on Mark Accepted surface) writes the snapshot — locks the acceptance
- **Use case:** PM records customer's verbal "yes, T2 works" without navigating to Customer view first.
- **Gate behavior:** enables the Mark Accepted primary downstream (Mark Accepted is gated until `customer_accepted = true` OR admin override).

---

## §6 · Sequencing (12 steps, parallel to RI.8 §11 pattern)

| Step | Work | Owner |
|---|---|---|
| 0 | Schema migration: `user_surface_visits` table + unique constraint + index | CC |
| 1 | Implementation primitives — `<Eyebrow>`, `<Breadcrumb>`, `<YourNextMoveBanner>` components | CC |
| 2 | Surface-routes table + surface-render rules table as canonical config | CC |
| 3 | Action cluster grammar primitive applied to all 5 quote-scoped surfaces | CC |
| 4 | Home Resume card — fetch from `user_surface_visits`, render last-change from audit_log | CC |
| 5 | Home inbox `Next move` derivation via surface-routes table | CC |
| 6 | Pushback 1 refinement — Resume card "Check inbox" signal when `now`-tier exists | CC |
| 7 | Pushback 2 implementation — "Edit notes" inline drawer/modal on Customer view | CC |
| 8 | New affordances — "View as customer" (Cost build), "Customer accepted (manual)" (Costing) | CC |
| 9 | `user_surface_visits` write path on every quote-scoped page-load (UPSERT) | CC |
| 10 | Edward smoke pass | Edward |
| 11 | Designer agent audit — focused R7a primitives pass (scope in §9) | CC + Designer |
| 12 | Fix audit findings + PR-to-main | CC + Edward approval |

---

## §7 · Dependencies

- **Existing R5 firm settings** (`firm_settings.target_margin_pct`, `.floor_margin_pct`) — Resume card margin pip classification reuses this.
- **Existing R6 scenario state** (margin pill, draft-after-send count) — inner rail consumes; unchanged.
- **Existing audit_log table** (`summary` column) — Resume card last-change line reads from here. Same string rendered on Audit log surface (R5).
- **New `user_surface_visits` migration** — Step 0 prerequisite for steps 4 + 9.

---

## §8 · Risks + open edge cases

- **First-time PM with no `user_surface_visits` rows.** Resume card empty state needed (e.g., "No recent activity. Pick a project to get started."). Designer agent should verify the empty state matches R7a fixture intent — R7a prototype shows the populated state only.
- **Scenario or quote deleted between visit and resume.** Resume card needs graceful fallback — if `last_visit` references a deleted scenario/quote, surface "Last activity unavailable" and fall through to inbox.
- **Banner-state transitions.** Default → gated → terminal-muted should animate smoothly. May need polish work in designer audit if jarring.
- **Performance of `user_surface_visits` UPSERT on every page-load.** Cost is negligible (single statement, indexed unique key, no JOINs). Worth verifying under realistic load before §6.b stacks Setup write-paths on top.
- **R7A SURFACE tab strip is review chrome, not production UI.** The top tab strip in R7a's prototype (`R7A SURFACE · HOME · RULE TOUR · SETUP · COST BUILD · COSTING · CUSTOMER VIEW · MARK ACCEPTED`) is a CD review aid — same convention as R7b's state strip (Pattern 21). RI.9 implementation does NOT ship this tab strip. Surfaces are navigated via inner rail + breadcrumb per surface-render rules.

---

## §9 · Step 11 Designer audit scope

Focus: R7a primitives fidelity. Designer agent walks:

1. All 5 quote-scoped surfaces (Setup, Cost build, Costing, Customer view, Mark Accepted) + Home
2. Eyebrow register matches R7a prototype (typography, spacing, separator `·`, non-navigable)
3. Breadcrumb register matches R7a prototype (typography, spacing, separator `›`, only renders on Customer view, navigable except last segment)
4. XOR rule holds — no surface has both eyebrow + breadcrumb
5. Banner three states (default · gated · terminal-muted) match R7a fixture (visual + copy + CTA behavior)
6. Action cluster grammar — right-primary · middle-secondary · left-of-divider back
7. Vertical divider treatment matches R7a (specifically Mark-Accepted's `← Cost build` placement)
8. Resume card matches R7a fixture (last-edit timestamp, last-change line, margin pip, status, CTA)
9. Pushback 1 signal renders correctly when `now`-tier inbox items exist (smoke with synthetic now-tier data)
10. New affordances ("View as customer" on Cost build, "Customer accepted (manual)" on Costing) render in correct cluster slots
11. Resume card empty state (first-time PM) — verify against R7a fixture intent if available, otherwise flag as new dimension for canon
12. R7A SURFACE tab strip is NOT shipped (Pattern 21 compliance check)

This is a **smaller-scope audit** than slice-ri.8 step 11 (fewer surfaces touched, tighter rubric). Designer agent invocation should be focused and fast.

---

## §10 · Methodological patterns expected

Slice-ri.8 banked patterns 1-21 (CLAUDE.md). RI.9 expected to exercise:

- **Pattern 1: Source-first authoritative** — R7a docs + HTML prototype + data-source map as the source of truth. Designer agent compares against these, not against assumption.
- **Pattern 8: Snapshot-vs-live discipline** — Resume card last-change is a LIVE read from audit_log, not a snapshot. If the audit log entry changes after the visit, the Resume card reflects the latest. Verify this is correct semantic.
- **Pattern 9: Surface naming canon** — Setup/Costs/Pricing/Quote — preserved (RI.8 established). Note: surface-routes table uses `cost_build` / `costing` / `customer_view` / `mark_accepted` surface keys, but display labels follow surface canon.
- **Pattern 11: Design illustrative; real data needs different proportions** — R7a prototype uses mock data; production data may stress different column widths (esp. project names, deal names, last-change strings).
- **Pattern 18: Region-scope vs trigger-scope** — if smoke surfaces multiple banner-related issues, scope the banner region not individual triggers.
- **Pattern 19: Defer-with-rationale beats forcing uniformity** — if a surface diverges, document rationale rather than force-fit.
- **Pattern 20: Audit rubric coverage gap signaling** — bank any new audit dimensions that emerge (e.g., Resume card empty state if R7a didn't fixture it).
- **Pattern 21: R-round prototype state strips are review aids, not production UI** — applies to R7a's surface tab strip (see §8 risk).

---

## §11 · Approval status

- [x] R7a + R7b deliverables landed and signed off
- [x] Brief drafted by CA (this doc)
- [ ] Edward review + approval
- [ ] Brief committed to `docs/ri9-brief.md` (Edward or CC)
- [ ] CC kicks off RI.9 implementation per §6 sequencing

Once Edward approves and commits, RI.9 is unblocked. §6.b queues behind.
