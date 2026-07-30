# Round 2 — Designer notes

Round 2 went deep on Cost Build and Costing Sheet. Everything else (Project, Quote setup, Customer view, Mark Accepted) is explicitly out of scope and waiting for Round 3+.

## Round 2 sign-off — three wishful items confirmed in scope, plus presence committed

Per CD review, the three items I flagged as wishful in the data-source map are now committed:

- **System-suggested GPA computation** ships with Slice 9.2. The "system suggests +X% to land blended at target" affordance on the Costing Sheet stops being a prototype trick and becomes part of the slice.
- **Deep-link URL contract** ships as part of the redesign or Slice 13.5. The "Demo · focus aluminum collar" button on Cost Build represents the intended behavior — notification emails and audit-log links land in a focused cell.
- **Allocated-fee provenance** logged for Slice 13.5. `production_inputs` gets an `allocation_source` field (or sibling table) so the "$5,250 setup ÷ 25k units" caption is data-backed, not display-only.

And separately confirmed:

- **Multi-user presence is committed, not wishful.** The "Live · X here" panel on Project view and the per-section presence chips on Cost Build (e.g. "Wei viewing freight · 4m") are committed product, not visual fiction. Build slice: a per-quote presence channel, throttled to ~5s updates, surfaced as the avatar cluster + per-user current-section indicator. Lives in the redesign-implementation slice, or earlier if the design ships ahead of it.

### Round 3 scope

**Customer-facing quote view + Mark-Accepted flow.** Constraint per CD: **Option A — PM-internal preview surface that becomes the PDF.** No hosted customer-facing web surface in this round.

Reasoning behind the call: today's Excel flow ends in PDF; send-PDF-get-reply is the familiar customer pattern; a hosted link adds auth, telemetry, and link-rot complexity for marginal gain. Reversible — if Slice 17 user testing surfaces real customer demand for a hosted view, we add it then.

Design constraint that follows from Option A:

- **The PM previews exactly what the PDF will be.** No interactive elements in the preview surface, no live data feeds, no hover affordances that won't print. Print-preview metaphor, not hosted-page metaphor.
- **Mark Accepted is an internal action against the PDF that was sent.** No customer-side interactivity to design — acceptance comes back via email/Slack/HubSpot and the PM logs it.

The four standing structural carries-forward apply:

- **NULL-as-empty-signal** across the customer view too — pricing tables show "—" for tiers that don't apply, never $0.00.
- **Internal-vs-customer visual grammar** enforced as a guard: if the customs/duty/CBM zone ever renders in the customer-view component tree, that's a build-time bug.
- **Helper text, not narration** — the customer view should describe nothing; it should price.
- **Verdict-as-room-organizer, flipped** — the customer view's room is the unit price + tier table, not the margin. Same compositional move, different anchor.

## Round 2.5 close-out — multi-tier mechanics

Standalone addendum file (`Nexus Round 2.5.html`) — kept separate from the Round 2 main file because the sparkline vocabulary and per-row drawer pattern are reusable enough across surfaces that they earn their own home for future reference.

What landed:

- **Tier-spread sparkline** on every cost row. Four ticks (T1·T2·T3·T4); height encodes value; empty/dashed for NULL; shape-caption underneath (`flat` / `step↓` / `2/4` / `no costs`). Scannable across a list of 30 packaging lines without opening any of them.
- **Per-row drawer** opens inline below the row on click. Four tier cells, tab-traversable, NULL by default. Each empty cell shows `↩ same as Tn`; the footer has `⤓ apply Tn ($x.xx) to all tiers` for the common-flat case.
- **Two scenario states** demoed via top-bar switcher: ① apply-to-all (60% of packaging lines, no real volume break) and ② supplier-quote-sheet (40%, four genuinely different prices).

### Three discipline points carried forward

- **NULL = "no cost entered at this tier"** — never "inherit from active tier." Validation engine sees the gap honestly. Materialized writes only.
- **Audit log writes only what the PM typed.** Apply-to-all writes four cells (PM's intent is "all four are this"). Empty-cell `↩ same as Tn` only writes when clicked. NULL cells never appear in the log.
- **Sparkline shape is the customer-view bridge.** The same shape that scans here derives the customer-facing tier-pricing table in Round 3. `flat` → one price. `step↓` → volume-break table. `partial` → omit or "quote on request" (Round 3 decides the visual; the data is unambiguous either way).

### One new feature commitment

**Mark-as-flat (no volume break) — committed.** The drawer's "⌐ Mark as flat" annotation is a persisted boolean on the SKU/packaging line that survives re-entries. Real use case: some SKUs structurally have no volume break (insert pulp, decals, low-cost commodity components). Small schema cost; prevents the PM from re-confronting the four-tier entry surface every time a supplier re-quotes a flat-priced line. Schema column TBD when implementation begins — likely `quote_skus.is_flat_pricing` or per-line equivalent.

### Production behavior confirmed

**Drawer closed by default per row, opens on click.** The "drawer open on first row" toggle in Tweaks is a demo affordance only — shipped behavior is closed-by-default so PM scans sparklines, clicks the row that needs entry.

### Logged as smaller follow-up rounds (not Round 3)

- **Freight `tier_alloc` allocation surface.** How freight gets allocated across tiers when a single shipment serves multiple tier orders. Adjacent to multi-tier mechanics but distinct enough to deserve its own round (Round 2.6 candidate if urgent).
- **Costing-sheet roll-up of partial-state lines.** Engine flags partial-state at the line level today; the visual treatment on the Costing Sheet when N of M packaging lines are partial needs CD input. Not blocking Round 3.

Round 2 + 2.5 closed. Round 3 begins: customer-facing quote view + Mark-Accepted flow, Option A (PM-internal preview becoming the PDF), with the sparkline-as-tier-pricing-source bridge from 2.5.

## Three pushbacks — the brief is mostly right; here's where it's not

### 1. Slice 9.3 is not a global "edit-mode toggle." It's a per-cell escape hatch.

The brief frames `sell_price_override` as switching the costing sheet into a different mode — type sell prices directly, watch margins move. I think that's a dangerous default.

The 80% case is "tune one tier because the customer pushed back on it." A global mode means three actions to fix one cell (enter mode → edit → exit + remember to exit). Worse, when a PM forgets to exit, the next session looks like every cell is overridable, which trains people to ignore the difference between computed and overridden values — exactly the discipline 9.3 is supposed to preserve.

**What I built instead:** the sell price in each per-SKU breakdown card is a click-to-override target. One click → inline editor → Enter writes `sell_price_override`; the cell badges 'OVR' and a ↺ revert appears. NULL means computed; non-NULL means overridden. Same schema, different surface. The "table mode" never gets its own page.

### 2. The "Mark Accepted" gate enforces margin discipline at the wrong moment.

When a PM clicks Mark Accepted, the customer has already verbally agreed and the deal is in motion. Hard-blocking there forces a politically expensive override conversation when the BELOW FLOOR signal has been visible for days.

**What I built instead:** the costing sheet's BELOW FLOOR state already shows the lock — Mark Accepted is visibly disabled with the admin-override path called out, and the lines requiring review are anchored at the top of the sheet so the PM resolves them *before* sending. By the time a PM is at the acceptance step, the verdict should be ratification, not arbitration. The schema doesn't change; the UI surfaces the gate days earlier.

### 3. Role-anchored editing is over-specified for 5–7 users.

The brief asks how Purchasing's view differs from PM's. My honest answer after two rounds: not very. Same screen, same layout, same math. The only difference is which cost group is write-affordable.

**What I built instead:** a single Cost Build page that takes a `viewer` param. Owned cost-groups stay editable; non-owned groups dim subtly with a "read-only · viewing as Purchasing" caption. No separate IA, no separate route, no separate component tree. (Toggle the Tweaks panel to switch viewer roles — same screen.)

## Three exploratory questions you asked — answers, with the path I'd actually take

### 1. Where do new SKUs come from in Cost Build?

Three entry points, in priority order:

- **Quote-setup spawn (90% case).** When the PM defines SKUs in setup, every (SKU × tier) cell is created with NULL costs. Cost Build never adds SKUs; it fills them in.
- **"+ Add variant" inline on the SKU rail (8% case).** The customer asks for a 75ml version mid-build. One-click duplicate of an existing SKU (carries over packaging templates, NULLs the unit costs) — keeps the PM from bouncing back to setup.
- **Bulk-import from a supplier sheet (2% case).** Drag a CSV onto the SKU rail. Defer this; it's a Slice 14+ thing.

I'd ship the first one as part of 9.x and treat the inline-add as a Round 4 conversation.

### 2. How do per-tier sell overrides interact with global price adjustment?

The schema gives us a clean two-level hierarchy:

- `tier_price_adj_pct = NULL` → tier inherits `quote.global_price_adj_pct`.
- `tier_price_adj_pct ≠ NULL` → tier ignores global; uses its own value.
- `sell_price_override ≠ NULL` → cell ignores both adjustments; uses raw override.

This is what the prototype implements — the per-tier slider shows "OVERRIDE active" when set and "inheriting global" otherwise. The "↺ inherit global" button writes NULL, which is the schema-honest way to revert. The cascade is visible: you can see at a glance which tier is doing its own thing.

### 3. What's the right shape of the audit trail for cost changes?

A row per `(cost_input_table, row_id, field, old_value, new_value, user_id, ts)`. Not a free-text comment log — structured enough that you can answer "show me every margin-affecting change in the last 7 days" with one query.

The diff dot ("fresh") on Cost Build rows is the read surface for the per-row case. A "since last visit" summary on the project page is the aggregated read surface (Round 3+). Don't build a separate "audit log viewer" until someone asks for one.

## The structure that should carry forward — what Rounds 3–5 should reuse

- **The internal-vs-customer-visible visual grammar.** The hatched purple "internal · never on customer quote" zone should appear anywhere that customs/duty/CBM math surfaces. Same border treatment, same ribbon. If Customer View ever accidentally renders one of these zones, that's a bug — and the visual difference makes the bug obvious in screenshots, in code review, in QA.
- **NULL is the empty signal, everywhere.** Cost cells, tier overrides, sell prices, client targets, quote target margin — every "absent" state is NULL, never zero, never empty string. The UI treats NULL as a first-class display state ("awaiting input" / "inheriting global" / "no client target"). This needs to hold across Quote setup, Customer view, and the audit log.
- **Verdict-as-room-organizer.** The Costing Sheet's blended margin *is* the page header. Per-SKU rows orbit it. When we build the customer-facing quote view (Round 3), the verdict role flips — the unit price and tier table become the room. Don't replicate the internal pattern as decoration; let the customer view's hierarchy reflect what the customer cares about.
- **Helper text, not narration.** Every panel that has lead copy ("Start anywhere. Most PMs begin with packaging…") earns its place by reducing a click or a question. If a sentence is just describing what's on screen, cut it. The Cost Build empty-state has one sentence + one CTA; that's the budget.

## Almost-decisions — what I built and threw away

- **A cost-completion progress bar at the top of Cost Build.** "12 of 18 fields filled · 67%". It made the page feel like a survey. Dropped — the cost stack at the bottom + per-group "complete / 2 empty" chips already convey readiness, without gamifying it.
- **A separate "quick edit" drawer for paste-from-supplier-quote workflows.** Same conclusion as last round, restated more strongly: the Cost Build screen *is* the quick-edit surface. The notification email's "edit Aluminum collar" link should land in the cell, focused, with no chrome to dismiss. The "Demo · focus aluminum collar" button on Cost Build is the proof-of-life for that flow.
- **A radial gauge for blended margin.** Looks great on a dashboard. Reads poorly when you actually need to know "am I above 35%?" The horizontal range with floor + target marks reads in one glance; the big numeric on the costing-sheet header carries the rest.
- **A per-row audit timeline modal.** Click a "fresh" dot → see every change ever made to that row. Felt like a QA tool, not a PM tool. The audit log should exist (see Q3 above); a per-row modal is not how anyone consumes it.
