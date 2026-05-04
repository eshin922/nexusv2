# Nexus IA Spec — v1 (partial)

**Status:** v1 partial — covers costing-sheet surfaces from Claude Design rounds 1-3.
**Pending:** Workspace surfaces (deal organizer, project detail, copy operations) — Round 4. Admin surfaces (firm settings, markup defaults, audit log read view) — Round 5. Both rounds blocked on CD weekly quota reset.
**Owner:** Edward Shin (The DPS)
**Last updated:** May 2026

---

## How to read this document

This is the buildable spec CC works against. It describes the information architecture of Nexus v1 surfaces — what's on each page, what each element does, what data backs it, what affordances exist, what state transitions are possible. It does NOT describe visual treatment beyond what affects IA (e.g., where margin verdict sits structurally on the page, but not what color it is in dark mode).

Visual treatment for these surfaces in v1 (Slices 9.2 onwards through Slice 17) uses current Nexus styles. Visual treatment for the redesigned versions of these surfaces lands in the redesign-implementation slice (TBD sequencing — see UX_BACKLOG "Slice 18 candidate"). The redesign-implementation slice is *visual rework only*; the IA documented here is settled and does not change between current and redesigned versions.

The behaviors, data semantics, and architectural patterns documented here ARE built in the appropriate 9.x / 11 / 12 slices, regardless of visual treatment. Functional commitments are slice work; visual commitments are redesign-slice work.

Source rounds noted on each section: R1 = Round 1, R2 = Round 2, R2.5 = Round 2.5 multi-tier mechanics, R3 = Round 3 customer view + Mark-Accepted.

---

## Surfaces covered in this spec

1. **Setup** — SKUs and tiers definition (FR-3, FR-4)
2. **Cost Build** — per-(SKU, tier) cost input surface (FR-5)
3. **Costing Sheet** — derived analytical view, gate enforcement, margin tuning (FR-6, FR-7)
4. **Customer view** — PM-internal preview surface that becomes the PDF (FR-8, FR-10)
5. **Mark-Accepted flow** — acceptance gate, override workflow, locked state (FR-9, FR-11)

Cross-cutting concerns covered after the per-surface sections.

---

## Surface 1 — Setup

**SPEC reference:** FR-3, FR-4
**Source rounds:** R1 (light treatment; the brief deferred Setup as low-frequency surface)
**Slice ownership:** Slice 4 (skeleton built); revisited on every quote create

### Purpose

Setup is the per-quote SKU and tier definition surface. Done once per quote, rarely revisited. The PM defines what they're quoting (SKUs) and at what volumes (tiers), then moves to Cost Build to enter cost data per (SKU, tier).

### Page entry

Quote creation routes here when:
- New quote is created via "New Quote" affordance from project page
- Quote has zero SKUs or zero tiers (incomplete setup state)

Once setup is complete, default page-entry shifts to Cost Build. Setup remains accessible via explicit nav.

### Page elements

**Header:**
- Project name (link back to project detail)
- Quote scenario_label · version_number (e.g., "Lumen & Co. · Primary · v1")
- Status badge: `draft`
- "Continue to Cost Build →" CTA (disabled when setup is incomplete)

**SKUs section:**
- Section header: "SKUs"
- Add SKU affordance ("+ Add SKU")
- Per-SKU row, fields:
  - sku_label (text, required)
  - product_name (text, required)
  - product_category (enum, required) — from Lists per SPEC
  - packaging_category (enum, required) — from Lists per SPEC
  - units_per_pack (int, default 1)
  - retail_benchmark (numeric, optional)
  - notes (text, optional)
- Per-SKU actions: edit row, duplicate row, delete row
- Empty state: "Define the SKUs you're quoting. Most quotes have 1-5 SKUs."

**Tiers section:**
- Section header: "Tiers"
- Tier preset selector (dropdown):
  - Packaging — Domestic (5k / 10k / 25k / 50k)
  - Packaging — Overseas (25k / 50k / 100k / 250k)
  - Soft Goods (1k / 5k / 10k)
  - Single Volume
  - Custom
- Per-tier row, fields:
  - label (text, required)
  - qty (int, required)
  - sort_order (auto-managed)
- Per-tier actions: edit row, delete row, reorder
- Empty state: "Pick a preset to get started, or define custom tiers."

### Setup completion criteria

Setup is "complete" when:
- ≥1 SKU exists with all required fields populated
- ≥1 tier exists with all required fields populated

When complete, the "Continue to Cost Build" CTA enables. PM proceeds.

### Data ownership

`quote_skus` (created on Setup save), `quote_tiers` (created on Setup save). Both tables are FK'd to `quotes.id`.

### Setup-after-Cost-Build edits

When PM revisits Setup after Cost Build has data, edits to SKUs or tiers cascade to dependent cost-input rows:
- **Add SKU**: new (SKU, tier) cost-input rows are created with NULL costs across all existing tiers
- **Delete SKU**: cascade-deletes packaging_inputs, production_inputs, freight_inputs rows (FK CASCADE) — audit captures full subtree pre-delete (per CLAUDE.md cascade audit pattern)
- **Add tier**: new (SKU, tier) cost-input rows created with NULL costs across all existing SKUs
- **Delete tier**: cascade-deletes inputs at that tier — audit captures full subtree pre-delete
- **Edit SKU/tier metadata** (label, name, qty): updates in place; existing cost-input rows preserved

Setup edits on a `sent` or `accepted` quote follow standard quote-state guards (`requireDraft`).

---

## Surface 2 — Cost Build

**SPEC reference:** FR-5
**Source rounds:** R1 (heavy), R2 (heavy), R2.5 (multi-tier mechanics)
**Slice ownership:** Slices 5 (packaging), 6 (production), 7 (freight) shipped; Slice 9.2 adds per-tier overrides

### Purpose

Cost Build is the home view for cost data entry. PM lands here for the bulk of their work on a quote. Per-(SKU, tier) cost data across three sections: Packaging, Production, Freight. Live cost stack visualization at the bottom shows how the inputs compose into Required Sell.

### Page structure

**Layout (post-redesign target, R2 finding):**
- Two-column: tier rail (left, ~280px) + work surface (center+right, flex)
- Right-column "presence panel" and "deep-link explainer" from current scaffolding are stripped — presence becomes header element, deep-link works invisibly

**Layout (current, pre-redesign):**
- Three-column: left tier rail, center cost input sections, right presence/coaching panel
- Acceptable for v1 functional ship; redesign-slice consolidates to two-column

### Page entry

PM lands here from:
- Project detail "Continue to Cost Build" CTA
- Setup completion CTA
- Deep link from notification email or audit-log entry (deep-link contract — see UX_BACKLOG)
- Cross-page nav (Costing Sheet → "Back to Cost Build")

URL pattern: `/quote/[id]/build` with optional `?focus=<section>-<row-id>` for deep-link focus

### Page header

- Breadcrumb: Pipeline / [Project name] / [Scenario] · v[N] / Cost Build
- Page title: "[Product name] · [SKU label]" with subtitle "[Pack format] · Tier [N] · [Volume] units · viewing as [User name]"
- "← All SKUs" affordance returns to SKU list view (when on individual SKU)
- "Costing Sheet →" CTA primary action — leads to derived analytical view

### Tier rail (left column)

Per SPEC FR-4, tiers are configurable per quote. Rail shows all defined tiers as click-to-switch cards.

**Per-tier card content:**
- Tier label (e.g., "Tier 2")
- Tier qty (e.g., "25k units")
- Margin badge for active SKU at this tier (computed live)
- Per-tier price adjustment indicator (when `tier_price_adj_pct` is set — see Slice 9.2)

(Tier-rail "client target indicator" was removed when migration 0016
moved the column from `quote_tiers` to per-(SKU, tier) granularity on
`quote_sku_tier_targets`. Aggregating per-cell back to tier-level for
an indicator reverse-engineers a use case that doesn't exist post-
migration. Benchmark completeness signaling — "X of Y SKUs benchmarked
in this tier" or similar — is Slice 9.5's validation engine work
(`quote_warnings` + UNDERPRICED chip pattern), NOT tier-rail.
Per-cell client target itself surfaces on the per-(leaf SKU, tier)
cell on the per-SKU summary row of the Costing Sheet — see Slice
9.4b. Leaf-only invariant; assembly rows render an empty cell.
A quote-level client target — for cases where a customer states a
single price target across the whole project — lands in Slice 9.4c
on a separate `quote_tiers` column.)

**Active tier:** visually highlighted; cost input rows below show this tier's data
**Click any tier:** switches active tier; cost inputs reload for new tier; tier rail margin badges update

### SKU rail (left column, below tiers)

When quote has multiple SKUs, SKU list appears below tier rail.

**Per-SKU card content:**
- sku_label and product_name
- Active SKU is visually highlighted

**Click any SKU:** loads that SKU's cost inputs in the work surface

### Work surface (center column)

Three sections stacked vertically: Packaging, Production, Freight. Each section is a self-contained cost-input table with section-level rollups.

**Section header (each section):**
- Section name (e.g., "Packaging")
- "Owned by [role]" badge (UX_BACKLOG owner-badge convention) — derived from static role-to-section mapping
- Section state badge: COMPLETE (all required fields filled) or "[N] EMPTY" (count of NULL fields)
- Section subtotal (sum of per-unit costs)
- Section collapse/expand toggle
- "+ add row" affordance
- Read-only treatment when viewer's role doesn't own this section ("READ-ONLY · VIEWING AS [role]")

**Per-row content (Packaging section example):**
- Component name + supplier reference (e.g., "Glass dropper bottle 50ml · Verre Pacific")
- Sub-line: category (Primary / Secondary / Tertiary / etc.)
- Markup column (e.g., "+40%") with override indicator when manually set
- Cost / Unit column (entered value or "awaiting input")
- Tier-spread sparkline (when multi-tier mechanics are enabled — see UX_BACKLOG entry #11)
- Per-row drawer affordance for multi-tier entry (click sparkline → opens drawer)
- Read-only treatment per-row when viewer can't edit

**Per-row tier-spread sparkline (UX_BACKLOG #11, Slice TBD):**
- Always-on visualization of cost variation across tiers
- Shape vocabulary: `flat` (all tiers same cost), `step↓` (volume break, costs drop monotonically), `partial` (some tiers priced, some NULL), `no costs` (all NULL)
- NULL ticks render hollow
- Active tier tick is highlighted
- Click sparkline → opens per-row drawer

**Per-row drawer (UX_BACKLOG #11):**
- All four (or N, where N = tier count) tier cells visible, tab-traversable
- Active tier prefilled with current value
- Per-cell `↩ same as T[active]` shortcut (writes active-tier value to that cell when clicked)
- Drawer footer: `↓ Apply [active tier value] to all tiers` (writes to all NULL cells)
- "↪ Mark as flat (no volume break)" annotation (UX_BACKLOG #13) — sets `is_flat_pricing` boolean
- Save closes drawer, materializes writes, sparkline updates
- Cancel discards in-drawer edits

**Section variations:**
- **Packaging:** rows are component+supplier+unit_cost+markup; per-tier qty_per_sellable_unit and purchase_qty visible per row
- **Production:** rows include allocated fees (Setup, Tooling, R&D, Other) with `allocate_service_fees_to_cost` toggle; allocated rows show provenance ("$5,250 ÷ 25k units" — UX_BACKLOG #3)
- **Freight:** rows have freight_treatment (bundled / pass-through), allocation_basis (weight/units/flat), customs/landed-cost data (duty_pct, tariff_pct, sku_total_cbm — internal, hatched purple treatment "INTERNAL — NEVER ON CUSTOMER QUOTE")

### Cost stack panel (bottom of work surface)

The "How this number is built" panel — verdict-as-room-organizer at the panel level.

**Panel structure (R2 finding, vertical stack):**
- Header: "How this number is built · LIVE · MARGIN [N]%"
- Helper text: "One row per component: solid bar = contribution cost, hatched extension = that component's markup. The global adjustment is the only thing that applies to the whole stack."
- Per-component row (Pkg, Prod, Frt, D+T, Pass):
  - Component label (left)
  - Visualization bar (middle): solid base (cost) + hatched extension (markup), with "+X%" label on the hatched portion
  - Amount column (right) showing cost · markup amount
  - Tiny-bar treatment: when bar is < 12% of max width, in-bar label suppressed; right-side amount column shows secondary inline like "$0.53 ($0.46 +15%)"
- Subtotal row: contribution cost + markup → subtotal $
- Adjustment row: "× ADJ global +[N]%" → adjustment $
- Total row: SELL /u with margin %
- Legend: ■ contribution cost · ▦ component markup (hatched) · • internal-only (D+T not on customer quote) · × adjustment (whole stack)

**Live interactivity:**
- Slider drag (global price adjustment) → cost stack bars animate to new state in real time (CSS transition on width/height, not flicker-replace)
- Input change → relevant component bar resizes smoothly
- Optimistic store fires recompute on every keystroke; cost stack subscribes and re-renders

**Margin verdict (bottom of panel):**
- Margin meter visualization with floor and target marks
- Three-state verdict label: GOOD / BELOW TARGET / BELOW FLOOR (color treatment varies)
- Position marker shows current margin against thresholds

### Page-level margin verdict (top of page)

Above the work surface, persistent across scrolling:
- Big numeric margin (large serif) for active tier
- Verdict label
- Used for at-a-glance state when scrolled into cost input sections

### Page states

1. **Day 1 / empty.** All cost-input sections empty. Cost stack shape visible with all values dashed (em-dashes). Helper text: "No costs in yet. Most quotes start with packaging — add the line items, then drop in costs as suppliers come back." CTA: "+ Seed packaging from template"
2. **Partial / mixed progress.** Some sections complete, some empty. Per-section EMPTY badges count NULL fields. Per-row "awaiting input" labels in Cost / Unit column. Cost stack reflects partial state honestly — live margin computed against what's filled in, BELOW TARGET treatment if applicable.
3. **Complete / full data.** All sections COMPLETE. Cost stack fully rendered. Margin verdict in final state.

### Read-only state

When `quote.status !== 'draft'`:
- All input fields disabled
- "+ add row" affordances hidden
- Edit affordances on rows hidden
- Read-only treatment per the action-result pattern (CLAUDE.md): action layer rejects forced edits; UI proactively disables

### Frozen state (during pending override)

UX_BACKLOG #25 — when `override_request.status='pending'` on this quote:
- All Cost Build edits frozen (same as read-only treatment)
- Banner at top: "Quote is **frozen** for editing until override resolves"
- Cancel-then-edit affordance ("If you need to tune lines, cancel the request first — that sends a 'request withdrawn' Slack reply automatically")

---

## Surface 3 — Costing Sheet

**SPEC reference:** FR-6, FR-7
**Source rounds:** R2 (heavy)
**Slice ownership:** Slice 8 (shipped functional); Slices 9.2-9.5 add adjustment overrides, client benchmarks, validation engine

### Purpose

Costing Sheet is the analytical view. PM moves here after Cost Build to tune pricing, review margin verdict, surface gate state, prepare for sending. The Costing Sheet is also where Mark-Accepted gate state lives (per R2 pushback #2 — gates surface here, days before acceptance moment).

### Page entry

PM lands here from:
- Cost Build "Costing Sheet →" CTA
- Project detail page (when quote is past initial setup)
- Direct nav from rail (when quote is active)

URL pattern: `/quote/[id]/costing`

### Page header

- Breadcrumb: Pipeline / [Project name] / [Scenario] · v[N] / Costing Sheet
- Page title: "Tune *price* & review."
- Subtitle: state-dependent, e.g.:
  - GOOD: "All margins above target — review and send."
  - BELOW TARGET: "All margins above floor — review and send."
  - BELOW FLOOR: "Below floor — admin override required to send."
- Action cluster (top-right):
  - "← Back to Cost Build"
  - "Preview customer quote" (secondary)
  - "Mark accepted" / "Mark accepted · admin override" / "Mark accepted · blocked" (primary, state-dependent)
  - "Request admin override" (sibling primary, only when gate is firing)

### Verdict surface (top of page)

The room organizer at this surface is the blended margin verdict.

**Verdict card content:**
- Header label: "BLENDED MARGIN · ALL SKUS · ALL TIERS"
- Big numeric: blended margin %
- Verdict label: GOOD / BELOW TARGET — SOFT WARNING / BELOW FLOOR — SEND BLOCKED
- Reference line: "target [N]% · floor [N]% · [N] lines below floor"

**Visual state (verdict card):**
- GOOD: green/positive treatment
- BELOW TARGET: amber/warning treatment, soft warning
- BELOW FLOOR: red/hard-block treatment, 2px red border, red borderLeft, red blended-margin number

**Admin override path sub-card (BELOW FLOOR state only):**
- Inline within verdict card
- Copy: "Send is blocked at the firm-wide floor ([floor]%). Director or above can approve below-floor send with a written reason — Slack DM goes to @nina (director) or @sales-leadership. Approval logs to the quote."
- Visual cue: dashed border around sub-card

### Global price adjustment surface (top of page, beside verdict)

- Slider: -20% to +40% range (typical), bound to `quotes.global_price_adj_pct`
- Current value display
- Helper text: "applies to every cell unless overridden"
- System-suggested adjustment banner (UX_BACKLOG #1, Slice 9.2):
  - When blended diverges from target by ≥0.3pp: "System suggests +[N]% to land blended at target ([target]%)."
  - One-click "Apply" CTA writes the suggested value to global_price_adj_pct
  - When in BELOW FLOOR state, microcopy adjusts: "lift blended above floor" instead of "land at target"

### Lines requiring review panel (when gates fire)

UX_BACKLOG #8 + R2 pushback #2 — gate state lives on Costing Sheet, not deferred to Mark-Accepted.

**Panel position:**
- BELOW TARGET state with line-level UNDERPRICED gate firing: panel below verdict card
- BELOW FLOOR state (worse): panel **above** verdict card (per R2 pushback — actionable list before score when quote is fundamentally broken)

**Panel content:**
- Header: "[N] LINES REQUIRE REVIEW" or "[N] LINES BELOW FLOOR — RESOLVE BEFORE SEND"
- Helper text: "Each line is below the [floor]% floor. Either tune up sell price, accept and request admin override, or push back on cost."
- "Anchor first underpriced cell →" deep-link affordance (jumps to first problem in Cost Build with cell focused)
- Per-line entry:
  - Line number
  - SKU label · tier label
  - Contribution cost
  - Current selling price
  - Required selling price (need column)
  - Variance: current margin % · floor threshold
  - "Fix →" per-line affordance (deep-link to that specific cell in Cost Build)

### Context cards row (below verdict surface, GOOD/BELOW TARGET states only)

Three cards, each surfacing a different signal:

1. **Most headroom card:**
   - Label: "MOST HEADROOM"
   - SKU + tier with highest margin headroom (e.g., "GLW-30 · Tier 1")
   - Margin %
   - "[X]pp above target" framing

2. **Client benchmark card (Slice 9.4):**
   - Label: "CLIENT BENCHMARK"
   - Count of leaf cells over/at/under client target
   - "vs client_target_price_per_unit · [N] of [N] leaf cells benchmarked"

3. **Lines need review card:**
   - Label: "[N] LINES NEED REVIEW" or "0 LINES NEED REVIEW"
   - State-dependent message ("You can send." when 0 lines below floor, "all margins above floor · global adj +[N]%")

### Per-SKU breakdown surface (main content)

The work surface below the verdict and context cards.

**Per-SKU breakdown header:**
- "Per-SKU breakdown · *active tier* [Tier N]"
- Tier selector (top-right): Tier 1 / Tier 2 / Tier 3 / Tier 4 — click to switch active tier displayed

**Per-tier price adjustment surface (above breakdown rows):**
- Slider: bound to `quote_tiers[active].tier_price_adj_pct` (Slice 9.1 schema, Slice 9.2 UI)
- Default: NULL (inherits global)
- "↺ inherit global" affordance (writes NULL when clicked, reverts to global)
- "inheriting global" / "OVERRIDE active" indicator
- Helper text: "applies to all cells in this tier unless overridden"

**Per-SKU breakdown row content:**
- Left column: SKU label + product_name + pack format
  - Inline UNDERPRICED chip (red treatment) when this SKU's active-tier line is below floor
  - Red left-border treatment when line is below floor
- Contribution → Required sell column:
  - Current contribution cost
  - Required sell price (with `→` arrow)
  - "retail $[N] · [N]% of retail" if `retail_benchmark` set
- Margin · Tier [N] column:
  - Margin % at active tier (large)
  - Two-axis verdict (Slice 9.4):
    - Margin verdict pill (all rows): BELOW TARGET / BELOW FLOOR / GOOD
    - Client verdict chip (leaf rows only, when client_target_price_per_unit set): direction + magnitude inline ("under target by $0.74" / "over target by $0.74"); underlying enum COMPETITIVE / OVER_CLIENT_TARGET
  - Tooltip on the client verdict chip carries the raw values being compared (Required sell / Client target) at 4-decimal precision; inline chip carries the interpretation per the verdict surfacing convention (CLAUDE.md).
- All tiers column (sparkline of margin across all tiers):
  - Tier qty labels (10k, 25k, 50k, 100k)
  - Per-tier margin % values
  - Visualization showing margin variation across tiers

### Per-cell sell-price override (Slice 9.3)

UX_BACKLOG #9 — per-cell escape hatch, NOT global mode toggle.

- Each Required sell cell is click-to-override
- Single click → inline editor → Enter writes `quote_sku_tiers.sell_price_override`
- Cell badges "OVR" when overridden
- ↺ revert affordance appears on overridden cell
- NULL = computed; non-NULL = overridden
- Override values render with subtle visual differentiation

### Page states

1. **GOOD.** Blended ≥ target. All lines above floor. Verdict card in green treatment. Context cards visible. No lines-requiring-review panel. Mark Accepted enabled.
2. **BELOW TARGET — soft warning.** Blended < target but ≥ floor. All lines above floor. Verdict card in amber treatment. Context cards visible. No lines-requiring-review panel. Mark Accepted enabled.
3. **BELOW TARGET with line-level UNDERPRICED gate firing.** Blended < target. ≥1 line below floor. Verdict card in amber, but lines-requiring-review panel surfaces below verdict. Mark Accepted disabled with "admin override" framing.
4. **BELOW FLOOR (catastrophic).** Blended < floor. Most/all lines below floor. Lines-requiring-review panel anchored ABOVE verdict card (priority flip). Verdict card in red hard-block treatment. Mark Accepted disabled with strikethrough; "Request admin override" sibling-primary action active.
5. **Pending override approval.** Override requested, awaiting director approval. Cost Build frozen (UX_BACKLOG #25). Banner at top: "Override request pending · sent [N]m ago to @[director-handle]". "Re-send DM" / "Cancel request" affordances.
6. **Read-only / accepted.** Quote accepted. All edit affordances disabled. Page renders the snapshotted state (UX_BACKLOG #22).

### Frozen Cost Build link

When `override_request.status='pending'`:
- "Back to Cost Build" affordance still works but Cost Build is frozen
- Banner on Cost Build: "This quote is frozen for editing until @[director] approves. To make changes, cancel the override request first."

---

## Surface 4 — Customer view

**SPEC reference:** FR-8, FR-10
**Source rounds:** R3 (heavy)
**Slice ownership:** Slice 11 (PDF generation, customer view component, snapshot system)

### Purpose

Customer view is the PM-internal preview surface that becomes the PDF a customer receives. Per R3 + Round 2 sign-off Option A, there is no hosted customer-facing web surface in v1.

The same React component tree the PM previews is what react-pdf renders against — single source of truth for what the customer sees.

### Page entry

PM lands here from:
- Costing Sheet "Preview customer quote" CTA
- Project detail page (when quote is `sent` or `accepted`)
- Mark-Accepted page (when reviewing pre-accept)

URL pattern: `/quote/[id]/preview`

### Visual treatment shift

Per R3 — the customer view shifts from internal-Nexus dark theme to customer-PDF light theme. This is intentional: a context shift signaling "you are viewing customer-facing artifact, not workspace." The PM-internal preview chrome (sidebar, header, send button) wraps the customer-view tree but is structurally distinct from it.

### Page header (PM-internal chrome)

- Breadcrumb: Pipeline / [Project name] / [Scenario] · v[N] / Preview
- "PM-INTERNAL PREVIEW · THIS BECOMES THE PDF" chip (top-left, persistent, purple treatment)
- Action cluster (top-right):
  - "↓ Download PDF" — saves PDF to Downloads, PM attaches to email manually
  - "↳ Download + open mail draft" — saves PDF + opens mailto: in default mail client with quote attached
  - "Send as: tier table | single tier" toggle — per-quote send-time PDF layout choice (UX_BACKLOG #24)
- "Sent [date]" indicator when previewing a sent version

### Boundary guard notice (above customer-view tree)

The build-time invariant from UX_BACKLOG #23 / R3:

- Banner: "BOUNDARY GUARD · CUSTOMER VIEW"
- Copy: "Nothing below this line is in the customer's tree. Margin, markup, cost stack, supplier names, duty %, tariff %, CBM, version_number, scenario_label — all forbidden. The component tree for `<PdfPage>` imports zero costing primitives."

This is design rhetoric for the PM. The actual enforcement is build-time: if any module under `<PdfPage>` imports from costing surface, build fails.

### Customer-view tree (the artifact)

Below the boundary guard line, the surface that renders to PDF.

**Page chrome:**
- Vendor block: "Halcyon Goods" (brand name) · "Contract manufacturing & co-packing" tagline · address
- Customer block: "Lumen & Co." · contact name · role · address
- Quotation metadata:
  - Quote number (customer-facing friendly id, e.g., "HG-2418")
  - Issued date
  - Valid until date (defaults to issued_date + 30 days)
- Section header: "TIERED PRICING" / "Per-unit pricing across volume tiers"
- Sub-header copy: state-dependent, references freight treatment and tier-pricing assumptions

**Pricing table (tier_table layout):**
- Columns: Product | Tier 1 ([qty] units) | Tier 2 ([qty] units) | Tier 3 ([qty] units) | Tier 4 ([qty] units)
- Per-SKU row:
  - Product column: product name + pack format
  - Per-tier columns: unit price, OR "—" (flat) when SKU is `is_flat_pricing`, OR "—" when tier price is NULL (partial completeness)
- "$X.XX *flat across all tiers*" treatment for SKUs with `is_flat_pricing=true` (one cell shows price, others show em-dash)
- "*quote on request*" treatment for partial-completeness SKUs at unpriced tiers
- Recommended-tier highlight (visual ring on the recommended tier)

**Pricing table (single_tier layout):**
- Single column: Unit price · [Tier qty] units · "recommended" indicator
- Per-SKU row: product name + pack format + unit price for the recommended tier only
- Helper copy: "Confirmed pricing" / "Per-unit pricing — Tier [N]"

**Charges block (when applicable):**
- Visible when `service_fees` non-empty OR `freight_treatment='pass_through'` on any line
- Section header: "Additional charges"
- Charges shown for: "[Tier N] ([qty] units). Per-tier amounts available on request."
- Per-charge row (project-scope service fees, SKU-scope service fees, pass-through freight lines):
  - Description
  - Scope/qty (e.g., "1 (per project)" / "1 (GLW-50 only)" / "Per Tier shipment")
  - Amount

**Commercial terms block (Page 2 typically):**
- Section header: "Commercial terms"
- VALID UNTIL: date
- PAYMENT TERMS: free text per quote (e.g., "Net 30 from invoice date")
- LEAD TIME: free text per quote
- INCOTERMS: derived from freight_treatment (e.g., "FOB Long Beach (bundled freight); EXW Long Beach (pass-through freight lines)")
- NOTES block: customer_facing_notes content (free text, per-quote)
- "How to accept" footer: "Reply to this email with the tier and quantity you'd like to proceed on. We'll issue a PO confirmation and production schedule within 2 business days."

**Page footer:**
- Vendor name · Quote number
- Page number

### Page states

1. **Pure tier-pricing.** Bundled freight, allocate_service_fees_to_cost = TRUE, no client benchmark, simple SKU set. Single page, no charges block. The "clean" state — most customer quotes.
2. **Pass-through freight + visible service fees.** allocate_service_fees_to_cost = FALSE, freight_treatment = pass_through on at least one line. Multi-page (typically 2 pages) with charges block, terms block on page 2.
3. **Partial completeness.** ≥1 SKU has `partial` sparkline shape (some tiers priced, some unpriced). Pricing table shows "*quote on request*" for unpriced tier cells. Optional sub-header copy notes the pricing-pending milestone (e.g., "Glow Capsule (CAP-60) Tier 1 pricing pending finalization of the formulation R&D milestone — quote available on request once raw-ingredient sourcing is locked.")

### What never appears in customer view

Enforced by boundary guard:
- Margin %, markup %, cost components, internal markups
- Supplier names (commercial confidence)
- duty_pct, tariff_pct, sku_total_cbm
- version_number, scenario_label
- audit_log fields
- Presence indicators
- Internal notes
- Slice/feature commitment labels
- Any debug or QA affordances

### PDF render path

UX_BACKLOG #21 / R3 — same component tree, two render targets:
- **Web preview:** React render to DOM with PM-internal chrome wrapping `<PdfPage>` subtree
- **PDF render:** react-pdf (or similar) renders `<PdfPage>` subtree directly; PM-internal chrome not included

Build invariant: `<PdfPage>` imports zero modules from costing surface. Failure = build error.

### Snapshot semantics

UX_BACKLOG #15 / R3 — every `sent` event writes a `quote_snapshots` row capturing the customer-view tree at send time. When PM previews a sent version, the preview reads from the snapshot, not from live tables.

Edits to the quote post-send do not change the sent-version snapshot. They create draft v(n+1).

---

## Surface 5 — Mark-Accepted flow

**SPEC reference:** FR-9, FR-11
**Source rounds:** R3 (heavy)
**Slice ownership:** Slice 11 (action contract, snapshot system, sent-version pinning), Slice 12 (HubSpot writeback, override workflow, audit pair)

### Purpose

Mark-Accepted is the action that transitions a quote from `sent` to `accepted`. Includes both gates (line-level UNDERPRICED, quote-level BELOW FLOOR), Slack admin override workflow, sibling auto-drop, and HubSpot writeback. Records the customer's acceptance against the version they were sent.

Per R3 — gate state lives on Costing Sheet days before this moment. By the time PM is here, the verdict is ratification, not arbitration.

### Page entry

PM lands here from:
- Costing Sheet "Mark accepted" primary CTA (when gates allow)
- Project detail page (when quote is sent and customer has responded)

URL pattern: `/quote/[id]/accept`

### Page header

- Breadcrumb: Costing Sheet / [Project] · [Quote ID] / Mark accepted
- State indicator strip (top-right): GOOD / BOTH GATES / PENDING APPROVAL / LOCKED — shows current state, not switchable in production (state derives from data)

### Verdict surface (top of page)

Same blended-margin verdict component as Costing Sheet. Reused, not redesigned.

**Verdict card content:**
- Big numeric blended margin
- "BLENDED MARGIN · GOOD" / "BELOW FLOOR" / etc.
- Target/Floor reference line

### Action surface (top-right)

State-dependent action cluster:

- **GOOD state:**
  - "✓ Mark accepted · Tier [N]" primary button (enabled, blue treatment)
  - "ALL GATES CLEAR · READY TO LOCK" sub-text

- **BOTH GATES FIRING state:**
  - "⚠ Mark accepted · blocked" disabled button (gray strikethrough)
  - "⚿ Request admin override" sibling primary (active, red dashed border treatment)
  - Per R3 pushback #3 — sibling-primary layout, NOT modal

- **PENDING APPROVAL state:**
  - "⌛ Mark accepted · waiting on override" disabled button
  - "SLACK DM SENT · [N]m AGO TO @[director]" sub-text

- **LOCKED state:**
  - "🔒 READ-ONLY · ACCEPTED" indicator (not a button)
  - "QUOTE LOCKED · ALL SURFACES FROZEN · CANONICAL RECORD IS THE SNAPSHOT" sub-text

### State 1 — GOOD: tier selection + Mark Accepted

**Tier selection panel:**
- Header: "TIER-SELECTION · WHICH TIER DID THE CUSTOMER ACCEPT?"
- Page title: "Pick the tier on [Customer name]'s reply"
- Per-tier radio rows:
  - Tier label (e.g., "Tier 1")
  - qty (e.g., "10,000 units")
  - Unit price for this tier
  - Total $ (qty × unit_price)
  - Margin %
- Recommended tier pre-selected (Slice 9.4 recommended-tier flag) but not forced
- PM picks the tier the customer named

**Sent-vs-draft mismatch banner (when applicable):**
- Per R3 pushback #2 + UX_BACKLOG #16
- Visible when `quote.current_version_id !== quote.last_sent_version_id`
- Banner copy: "You sent v[N] on [date] · current draft is v[N+1]"
- Detail: "The customer is responding to v[N]. The tier prices below reflect v[N] (the sent version), not the v[N+1] edits in your draft. Mark-accepted will lock against v[N] and discard v[N+1] (or save v[N+1] as a sibling scenario — your pick)."
- Affordances:
  - "View v[N] (sent) preview" — opens preview surface against the snapshotted v[N]
  - "Compare v[N] ↔ v[N+1] changes" — opens audit-log diff view (when audit-log diff surface ships)
  - "Dismiss" — collapses banner; PM has acknowledged

**"What happens when you click Mark accepted" sidebar (right column):**
- Header: "WHAT HAPPENS WHEN YOU CLICK MARK ACCEPTED"
- 6-bullet list:
  1. "Quote status: sent → accepted"
  2. "Captures: tier_id, accepted_at, your user_id"
  3. "Snapshot json stored (FR-11) — irreversible record"
  4. "Other active scenarios auto-dropped (auditable)"
  5. "HubSpot writeback fires (async)"
  6. "This page becomes read-only"

**Other active scenarios card (right column, below sidebar):**
- Header: "OTHER ACTIVE SCENARIOS"
- Per-scenario row:
  - scenario_label
  - blended margin %
  - last activity ("3d ago by Maya")
- Footer: "Both will be auto-dropped on accept."

### State 2 — BOTH GATES FIRING

Per R3 pushback #3 — sibling-primary layout, no modal.

**Verdict treatment:**
- Red treatment (BELOW FLOOR) on blended margin number
- "BLENDED MARGIN · BELOW FLOOR" label
- Target/Floor reference

**Acceptance-blocked surface:**
- Header: "ACCEPTANCE BLOCKED · TWO GATES FIRING"
- Page title: "Quote-level *BELOW FLOOR*, plus [N] line-level UNDERPRICED"

**Lines requiring review panel:**
- Same component as Costing Sheet's lines-requiring-review panel
- Per-line entries with SKU · tier · margin · rule
- Quote-level rule footer: "+ 1 quote-level: BLENDED_BELOW_FLOOR ([margin]% < [floor]%)"

**Two paths forward panel:**
- Two side-by-side cards:
  - **(a) Tune up:** "Open Cost Build → adjust the flagged lines back into range → re-Mark accepted. Roughly [N] line edits to lift blended above [floor]%." CTA: "← Back to Cost Build"
  - **(b) Admin override:** "Slack DM to @[director] (sales-leadership). Reason captured. Approval logs to the quote. Gate unlocks; Mark-accepted enables." CTA: "⚡ Request override"

**Override workflow sidebar (right column):**
- Header: "OVERRIDE WORKFLOW"
- 6-step list:
  1. "Request override (button →)"
  2. "Slack DM drafts to leadership"
  3. "Reason logged to `quote_warnings`"
  4. "Out-of-band approval"
  5. "Approval logs back via Slack reaction or button click"
  6. "Mark-accepted enables · proceeds normally"

**Override audit panel (right column, below workflow):**
- Header: "OVERRIDE IS AUDITABLE"
- Production copy: "Your reason and the approval thread are logged to the quote permanently. Anyone with quote access can see who overrode, when, and why."

### State 3 — PENDING APPROVAL

**Pending banner:**
- Header: "Override request pending · sent [N]m ago to @[director] (sales-leadership)"
- Status detail: "You'll be notified in Slack and in-app the moment approval lands; this page will refresh."
- Metadata line: "`quote_warnings.override_status = pending` · requested by you · [timestamp]"
- Affordances: "Re-send DM" / "Cancel request"

**Frozen state explanation panel:**
- Header: "WHAT YOU CAN DO WHILE WAITING"
- Page title: "The quote is *frozen* for editing until override resolves"
- Sub-panel: "COST BUILD IS READ-ONLY DURING APPROVAL WINDOW"
- Detail: "Editing during a pending override would invalidate the gate state @[director] is approving against. If you need to tune lines, **cancel the request** first — that sends a 'request withdrawn' Slack reply automatically."

**Recent activity timeline:**
- Header: "RECENT ACTIVITY"
- Per-event row (compact format):
  - Actor (you / system / @director)
  - Event description (e.g., "requested below-floor override (2 gates, reason 64 chars)")
  - Timestamp
- Examples:
  - "you · requested below-floor override (2 gates, reason 64 chars) · 14m ago"
  - "system · Slack DM dispatched to @nina · sales-leadership · 14m ago"
  - "@nina · viewed Slack DM (read receipt) · 11m ago"

**"What approval looks like" sidebar (right column):**
- Header: "WHAT APPROVAL LOOKS LIKE"
- Detail: "@[director] replies in Slack thread, or clicks the link in the DM. Either path:"
- Numbered steps:
  1. "Approval logs to `quote_warnings`"
  2. "This page refreshes; banner becomes 'Approved by @[director] · [time] ago'"
  3. "Mark-accepted button enables"
  4. "You proceed with tier selection + confirmation as normal"

### State 4 — LOCKED (post-acceptance)

UX_BACKLOG #22 — all reads on LOCKED state go through `quote_snapshots`, not live tables.

**Acceptance ribbon (top of page, green treatment):**
- "✓ Accepted [date] · Tier [N] · [qty] units"
- Sub-line: "by [user_name] · $[total] total · [margin]% margin · v[N] (sent [date])"
- Action cluster: "● HUBSPOT SYNCED [N]m AGO" / "↓ Final PDF" / "View snapshot"

**Verdict surface (preserved from prior states):**
- Big numeric margin (the accepted-tier margin)
- "BLENDED MARGIN · GOOD" (assumed, since acceptance happened)
- Target/Floor reference

**"READ-ONLY · ACCEPTED" indicator (top-right, replaces Mark Accepted button)**
- Sub-text: "QUOTE LOCKED · ALL SURFACES FROZEN · CANONICAL RECORD IS THE SNAPSHOT"

**Accepted tier card:**
- Header: "ACCEPTED TIER"
- Single tier row (the accepted tier), highlighted treatment
- Tier label, qty, unit price, total, margin

**Acceptance audit table:**
- Header: "ACCEPTANCE AUDIT"
- Rows:
  - Accepted by: user_name (with you indicator if current user)
  - Accepted at: timestamp
  - Accept source: `manual_button` (currently the only value; `email_reply_parsed` reserved for v2)
  - Sent version: v[N] (snap-v[N]-[date])
  - Draft v[N+1]: "saved as sibling, status: dropped" (when applicable)
  - Other scenarios: "[N] auto-dropped ([scenario_labels])"
  - HubSpot writeback: "Closed-Won · $[amount] · synced [N]m ago"

**"What happens next" sidebar (right column):**
- Header: "WHAT HAPPENS NEXT"
- Bullets (forward references to Round 4 surfaces):
  - "Generate PO confirmation (next-step action card on Project view)"
  - "Production schedule emails to [Purchasing user] + [Production user]"
  - "Project enters `in-production` stage on the deal organizer (Round 4)"

**"If something's wrong" sidebar (right column, below):**
- Header: "IF SOMETHING'S WRONG"
- Detail: "Acceptance is locked but not destroyed. To revert: admin can `scenario_status: accepted → active` with a reason; HubSpot writeback is rolled back. Logged to audit."
- Affordance: "Request unlock (admin)"

### Action contract

**Sent-version pinning (UX_BACKLOG #16):**
- Mark-Accepted action takes `version_id` parameter (always the sent version, never current draft)
- If quote has draft post-send, draft is preserved as sibling scenario:
  - `status='dropped'`
  - `drop_reason='draft_at_accept'`
  - `dropped_by_user_id` = accepting PM
- If quote has other active scenarios on same project:
  - Each gets `status='dropped'`
  - `drop_reason='accept_sibling'`
  - `dropped_by_user_id` = accepting PM
  - `dropped_at` = timestamp

**Snapshot generation (UX_BACKLOG #14, #15, #22):**
- Mark-Accepted writes a `quote_snapshots` row with `event='accepted'`
- Snapshot captures full customer-view tree (vendor, customer, quote, tiers, skus.tier_prices, service_fees, freight_lines)
- Foreign-keyed from `quotes.accepted_snapshot_id`
- All subsequent reads on LOCKED state go through this snapshot

**HubSpot writeback (UX_BACKLOG #18):**
- Async; does not block page transition
- Updates HubSpot Quote object: line items with `hs_cost_of_goods_sold`, deal-level `amount`, `est__revenue`, `costing_sheet`
- Sets HubSpot deal stage to Closed-Won
- LOCKED state shows sync status: "synced [N]m ago" / "syncing…" / "sync failed · retry"
- Failure is recoverable (retry button)

**Audit captures (UX_BACKLOG #17):**
- Both override pairs captured when applicable:
  - `quotes.underpriced_override_user_id`, `quotes.underpriced_override_reason` (line-level gate)
  - `quotes.blended_below_floor_override_user_id`, `quotes.blended_below_floor_override_reason` (quote-level gate, added Slice 12)
- Override workflow events written to audit_log

---

## Cross-cutting concerns

### Navigation rail (current, pre-redesign)

Today's nav rail is inherited from the current Nexus build. Production rail structure is **not yet specified** — pending Round 4. Until Round 4 IA lands:

- Use today's rail structure (whatever's in current production)
- New surfaces (Slice 9.2 work) integrate at appropriate level in current rail
- Don't redesign the rail in 9.x slices — that's redesign-implementation slice work

### Role-as-affordance (CLAUDE.md, R2)

Single page renders for everyone in a given screen. Write affordances filter by role:
- PM/Sales: writes Quote header, Quote view sell-price overrides, Mark-Accepted; reads everything else
- Purchasing: writes Packaging Inputs; reads Costing Sheet (own line context)
- Production: writes Production Costs; reads Packaging, Costing Sheet
- Accounting: reads everything; writes Inventory Movements (v2)
- Admin: writes everything

When viewer doesn't own a section, that section is dimmed with "READ-ONLY · VIEWING AS [role]" caption. Same component tree, same data fetch, affordance check is per-section.

### NULL semantics (R2.5)

NULL = "no cost entered at this tier" everywhere. Never "inherit from active tier." Materialized writes only. UX provides shortcuts (`↩ same as Tn`, "apply to all") for fast entry without inheritance logic.

Applies to: packaging_inputs.unit_cost, packaging_inputs.markup_pct, production_inputs.* (all numeric fields), freight_inputs.* (all numeric fields), quote_sku_tiers.sell_price_override, quote_tiers.tier_price_adj_pct, quote_sku_tier_targets.client_target_price_per_unit.

The exception: `freight_inputs.units_in_shipment` NULL = "fall back to tier.qty" (per CLAUDE.md, established pattern). This is the only NULL convention exception in cost-input space; documented to prevent drift.

### Customer-view boundary guard (CLAUDE.md, R3)

`<PdfPage>` and descendants import zero modules from costing surface. Build-time enforced. Failure = build error, not runtime check.

### Action result pattern (CLAUDE.md)

Server actions return `{ ok, error }` results, never throw on expected failure modes. Reserve throw for genuine bugs. Client surfaces error.message in UI; pages disable inputs proactively when status !== 'draft'.

### Form state pattern (CLAUDE.md)

All auto-saving forms use controlled inputs + useActionState. No uncontrolled forms with onBlur auto-save. Save handlers receive new value as explicit parameter, not via stale ref reads.

### Sent-version pinning (R3, action contract)

Mark-Accepted always operates against the sent version. Never the current draft. Drafts created post-send become sibling scenarios with `drop_reason='draft_at_accept'`. Sent-vs-draft mismatch surfaces inline on Mark-Accepted page.

### Snapshot semantics (R3, FR-11)

Two snapshot events per quote lifecycle:
- **Send-event snapshot:** `quote_snapshots` row with `event='sent'`, written when PM sends a version
- **Accept-event snapshot:** `quote_snapshots` row with `event='accepted'`, written when PM marks accepted

Both capture the full customer-view tree. LOCKED state reads from accept-event snapshot. Customer-view preview of a sent version reads from send-event snapshot.

### Frozen Cost Build during pending override (R3)

When `override_request.status='pending'` on a quote, Cost Build edits are frozen. Cancel-then-edit is the explicit path. Cancel automatically sends "request withdrawn" Slack reply.

---

## Pending sections (Round 4 + Round 5)

The following surfaces are NOT covered in this v1 partial spec. They land in v2 of this document after Round 4 + Round 5 design rounds complete.

### Workspace surfaces (Round 4)

- Deal organizer / project list (FR-13)
- Project detail / scenario surface (FR-2)
- Copy operations: New Version, New Scenario, Copy Scenario, Copy Quote to Project (FR-12)
- Navigation rail as production product (currently scaffolding)

### Admin surfaces (Round 5)

- Firm settings page (target/floor margin %) (FR-15)
- Markup defaults page (FR-15)
- Audit log read view (FR-16)
- User management (FR-15)

### v2 surfaces (post-MVP)

- Inventory Movements UI (FR-9 v2)
- HubSpot deal-stage webhook handler
- NetSuite reconciliation
- Multi-step approval workflow
- Side-by-side scenario comparison
- Templates Library (curated `is_template` quotes)

---

## Document maintenance

This spec is living. When Round 4 or Round 5 designs settle, extend this document:
- Add new sections for the relevant surfaces
- Update "Pending sections" list
- Update version stamp at top
- Note source rounds and slice ownership for new content

CC reads this as build target for 9.2 forward. Significant changes to settled surfaces (Setup, Cost Build, Costing Sheet, Customer view, Mark-Accepted) require ADR-style change notes; minor refinements can edit in place.
