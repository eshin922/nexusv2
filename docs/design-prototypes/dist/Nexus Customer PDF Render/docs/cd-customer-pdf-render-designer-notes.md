# CD — Customer-Facing PDF Render Layer · Designer notes

**Commission:** paged PDF render treatment for the locked customer-view tree (CD Comm · Slice 11 dependency).
**Prototype:** `Nexus Customer PDF Render.html` → `app/cpdf/`
**Scope reminder:** this designs the *second render target* (the paged artifact). It re-opens none of the R3 content/data canon (brief §1). Web preview and PDF render from the same component tree per R3 commitment #9 — this is the PDF arm.

---

## 0 · What shipped

A US-Letter paged artifact, authored to react-pdf primitives, holding all three locked page states across both pricing layouts:

| | `tier_table` | `single_tier` |
|---|---|---|
| **A · Pure tier-pricing** | 1 page | 1 page |
| **B · Pass-through + fees** | 2 pages (terms on p2) | 2 pages |
| **C · Partial completeness** | 2 pages (table overflows) | 2 pages |

The prototype's state strip and layout toggle are **prototype navigation only** — production renders whichever state the data is in, and whichever `pdf_layout` the PM picked at send (R3 Slice-11 commitment).

---

## 1 · Design to the render medium (brief §3) — the load-bearing decision

The single most consequential difference from the R3 web preview: **the pricing table is not a `<table>`.** react-pdf has no table primitive and no CSS grid; it composes layout from `<View>`/`<Text>` with a flexbox subset. The R3 customer-view used `<table>` + `grid-template-columns` for the customer block and charges rows — none of that ports.

Everything in `.pp-*` is therefore built from **flex rows and columns only**, with **margin-based spacing** (no CSS `gap` inside the sheet — `gap` is unreliable across react-pdf versions; margins are 1:1). The pricing "table" is a flex column of flex rows; each cell is a flex child with a fixed `flex` ratio so columns align vertically without a grid. This is the structure CC implements verbatim (Pattern 30) — the class names below map directly to react-pdf `View`s.

If the Slice-11 library spike lands on something looser than react-pdf, this ports up cleanly (designed to the tightest constraint, per §3).

## 2 · Pagination model (brief §2)

- **Page box.** US Letter, modelled at 816 × 1056 px (8.5 × 11 in @ 96 dpi). Margins 56 px top / 64 px sides / 88 px bottom (the bottom band reserves the fixed footer). These map to react-pdf `Page` `size="LETTER"` + `padding`.
- **First-page-only blocks.** Masthead (vendor identity + quote meta) and the parties block render once, on page 1. They are *not* `fixed`.
- **Running header (continuation pages).** Pages 2+ carry a slim `fixed` running header — vendor name + quote number (left), "Quotation · continued" (right). Answers Q3: continuation pages are never anonymous even before the footer.
- **Footer (every page).** `fixed` — vendor · quote number (left), "Page X of Y" (right). In react-pdf, the page count comes from `render={({pageNumber, totalPages}) => …}`.
- **Kept-together blocks.** The charges block and the commercial-terms block are atomic (`wrap={false}` in react-pdf) — a section header never orphans from its body across a break.
- **Where breaks fall.** State A is one page. State B breaks after the charges block, putting commercial terms + how-to-accept on page 2. State C breaks mid-table (see Q2).

> **Prototype caveat:** breaks here are *hard-split* into separate `.pp-sheet`s so the treatment is visible and reviewable. Production pagination is automatic (content reflow + `wrap`/`break` props). The hard split is a review affordance, not the production mechanism — called out on the in-page DN banner.

## 3 · Print typography ramp (brief §2.4)

Tuned for an at-arm's-length printed read, not a screen read. Newsreader for prose/product names, JetBrains Mono for data/labels/prices (tabular figures), one ramp:

| Role | Size | Face |
|---|---|---|
| Vendor name (masthead) | 27 px / ~20 pt | Newsreader 500 |
| Section title (`pp-h2`) | 18 px | Newsreader 500 |
| Body / lede | 11.5 px / ~9 pt | Newsreader |
| Product name (table) | 13 px | Newsreader 500 |
| Price cell | 12.5 px | Mono, tabular |
| SKU code / pack / labels | 9–10 px | Mono |
| Footer | 8.5 px | Mono |

Prices are `font-variant-numeric: tabular-nums` so columns stay rod-straight — the single most important table-legibility move in print.

## 4 · Open questions resolved

**Q1 · Recommended-tier highlight that survives B/W printing.** The recommended column does *not* rely on a color ring. Four redundant signals, three of which survive grayscale:
1. **Bordered column** — a hairline box (`--pp-rec-edge`, a dark ink) brackets the column down the full table height. Structural, prints in B/W.
2. **Weight** — recommended prices are 600; all others 500/regular. Survives B/W.
3. **Label** — header shows `★ T2` + "recommended" in the sub-line. Survives B/W (the ★ is a glyph, not a color dependency).
4. **Tint** — a faint warm fill. Decorative only; degrades to light gray and is never the sole signal.

In `single_tier` the recommended column is the *only* column, so the bracket is dropped (nothing to distinguish it from) but the "T2 · 10k units · recommended" label is retained.

**Q2 · Pricing-table overflow.** When SKU count exceeds a page, the table breaks and the **header row repeats** at the top of the continuation, preceded by a `Tiered pricing · continued — DPS-2418` caption. The recommended-column treatment (bracket + label + weight) persists across the break, so the customer never loses the column key. Demonstrated in State C (6 SKUs → 4 on p1, 2 on p2). In react-pdf this is a `fixed` header `View` inside the table region.

**Q3 · Continuation identity.** Resolved with the slim running header (§2) *plus* the footer. Vendor + quote number appear top and bottom of every continuation page; a customer who prints and shuffles pages can re-pair them.

**Q4 · Partial-completeness sub-header.** Placed **inline above the table** as part of the lede paragraph (italic, naming the specific SKU + the pending milestone) — not relegated to a footnote register. The customer reads *why* a cell says "quote on request" before they reach the cell. A short legend line under the table reinforces it ("quote on request — pricing finalizes once the noted milestone clears").

## 5 · Locked treatments carried across the medium (brief §1)

- **NULL → "quote on request"**, never `$0.00`, never a dash-with-price-treatment. Rendered as italic Newsreader in the muted ink so it reads as prose, not a missing number. (`.pp-price.req`)
- **Flat pricing** (`is_flat_pricing`) → price shown in the first visible tier, em-dash in the rest, caption "Flat across all volume tiers" under the product name. In `single_tier` the single (identical) price simply shows.
- **Recommended-tier highlight** → see Q1.
- **Boundary guard** → the data layer (`app/cpdf/data.js`) carries *only* customer-visible fields. No margin, markup, cost, supplier, duty/tariff, CBM, version_number, scenario_label, audit field, presence, or internal note exists anywhere in this tree. The `shape` field (`step`/`flat`/`partial`) drives render treatment and is not a forbidden field. Per R3 commitment #3 the real enforcement is a build-time import assertion; the prototype demonstrates a tree that satisfies it.

## 6 · Things considered and rejected

- **Retail-benchmark column.** Brief §4 lists the customer per-SKU fields as name · pack · per-tier prices — retail benchmark is not among them. It exists in the data (R3 carried it as an optional UX_BACKLOG column) but is **not rendered**: it adds a column of MSRP context the brief didn't sanction, and risks reading as a margin tell. Left as a future per-quote toggle, not a default.
- **Per-tier charges in the charges block.** The charges block shows freight landed for the recommended tier with "per-tier amounts available on request" — same escape hatch as R3. Rendering a freight amount per tier would quadruple the block and invite the customer to reverse-engineer volume sensitivity. Held.
- **Color-only recommended ring** (the obvious port of the R3 screen treatment). Rejected on the grayscale-printer reality — see Q1.
- **Soft page breaks shown as dashed rules inside one continuous sheet.** Rejected: it hides the running-header/footer behavior, which is half the commission. Hard-split sheets show the real per-page chrome.

## 7 · Out of scope — confirmed not designed (brief §7)

The web customer-view surface (R3 owns it); any delivery mechanism (no email/cover-letter/send chrome); the spec-addendum / spec-sheet page (separate future toggle); and the PM-internal preview chrome ("THIS BECOMES THE PDF"). The in-page DN banner here is prototype rhetoric and is itself stripped from the render — only `.pp-sheet` content is the artifact.

## 8 · Named structure (Pattern 30 — implement verbatim)

Components (`app/cpdf/pdf-render.jsx`): `Masthead` · `Parties` · `PricingTable({skus, layout, continued})` · `PricingFoot({partial})` · `ChargesBlock` · `TermsBlock({incoterms})` · `NotesBlock` · `HowToAccept` · `RunHead` · `Footer({page, pages})` · `Sheet({runhead, footer, continuation})`. State compositions: `StatePure` · `StatePassThrough` · `StatePartial`.

Canonical classes (`app/cpdf/styles.css`, all `.pp-*` → react-pdf `View`/`Text`): `pp-sheet` `pp-flow` `pp-masthead` `pp-parties` `pp-eyebrow` `pp-h2` `pp-h3` `pp-lede` `pp-table` `pp-thead` `pp-tbody` `pp-tr` `pp-c-prod` `pp-c-num` `pp-c-rec` `pp-th-lab` `pp-th-sub` `pp-prod-name` `pp-prod-meta` `pp-prod-flat` `pp-price` (`.req` / `.dash`) `pp-table-foot` `pp-charges` `pp-charge-row` `pp-terms` `pp-term` `pp-notes` `pp-accept` `pp-runhead` `pp-footer`. (Addendum-1 additions in §A8.)

---

# ADDENDUM 1 — line totals · grand turnkey total · turnkey-only mode

Folds into the base bundle. Everything above stands unchanged. All values added here derive from **sell prices** — they stay inside the Pattern-45 boundary (no cost/margin exposure), and no schema field is added (unit price + tier qty were already in the bundle).

## A0 · Coverage

A second parameter, `detail_level` (`itemized` | `turnkey_only`), now crosses the existing `pdf_layout` — two orthogonal switches, not a 3-way enum. The prototype covers the full four-cell matrix across all three page states:

| | `itemized` | `turnkey_only` |
|---|---|---|
| `tier_table` | SKU rows + per-cell line totals + per-tier grand totals | per-tier turnkey cards only |
| `single_tier` | SKU rows + line totals + one grand total | one hero turnkey figure |

## A1 · Line total — in-cell stack (Q1)

At four tier columns the table is width-constrained, so a dedicated total column would crush the unit prices. **The line total stacks under the unit price in the same cell** (`.pp-linetotal`, muted mono, one notch smaller). The unit price stays the dominant read; the extended total (`unit × tier qty`) sits beneath it as supporting context. Tabular figures keep both numbers rod-straight down the column. In `single_tier` the same stack applies to the one column.

**Flat-SKU decision.** The locked rule keeps the *unit* shown once (first tier) with em-dashes after + the "flat unit" caption. But a flat unit at different quantities produces *different* line totals — so the per-tier line total **is** shown in every tier cell even where the unit reads "—". This honours the locked unit-display rule while surfacing each tier's true order value, which is what a totals-bearing quote needs. The caption now reads "Flat unit across all volume tiers" to make the distinction explicit.

## A2 · Grand turnkey total (Q2)

A `Turnkey total` row (`.pp-grand`) closes the table: per-tier sum of line totals, separated by a strong rule, label-weighted in Newsreader with the per-tier figures in 14 px mono. It out-weights the line totals (heavier rule, larger figure, serif label) without competing with the per-tier comparison — the columns still align under their tier headers, and the recommended bracket carries through and **closes** on the total (the one place the column box bottoms out). In `single_tier` it collapses to a single all-in figure.

**Per-unit turnkey (added on request).** Each turnkey figure also carries a **blended all-in per-unit** beneath it — the turnkey total ÷ units shipped at that tier (priced lines only). It answers "what does the all-in work out to per piece?" without re-itemizing, and it's distinct from the per-SKU unit prices above (it's the basket average, fees included). For a "from $X" tier it reads "from $X/unit"; in the single-tier hero it's "$X / unit · blended all-in".

**Freight rule (brief §2).** Pass-through freight is **never folded** into the turnkey total — it's billed at cost (EXW) and can't sit inside a fixed quoted price. It renders as a held-out "Plus — outbound freight, billed at cost" note under the total. **Allocated/bundled** service fees **do** fold in: in the pass-through state the one-time project & SKU fees ($14,400) are added to the turnkey total *and* itemized in the charges block — an "Includes … folded into the total above and itemized below" note reconciles the two so the customer never double-counts. In the bundled state, fees and freight are already inside the unit price; an "All-in" note says so and nothing is added twice.

## A3 · Turnkey-only — sparse but confident (Q3)

`turnkey_only` drops the SKU rows entirely. The risk is an empty-looking page; the fix is to make the absence deliberate:

- **`tier_table`** → a row of per-tier cards (`.pp-tk-card`), the recommended one lifted (heavier border, tint, "recommended" tag), each carrying tier label · qty · a large turnkey figure. Reads as a confident price menu, not a stripped table.
- **`single_tier`** → one hero figure (`.pp-tk-hero`, 40 px) bracketed by strong rules, with the recommended tier + qty to its left.
- Both are anchored by a **"What this turnkey price includes"** block (`.pp-tk-included`) — names the finished products covered, and ticks what's in (freight/duty/tariffs, tooling, folded fees) vs. held out (pass-through freight, any pending line). This is what fills the vacated space and tells the customer the number is genuinely all-in.

Because `turnkey_only` carries no itemized charges block, the pass-through state collapses from 2 pages to 1 — pagination follows content, footers reflect the real count.

## A4 · Unpriced lines (brief §4)

- **Itemized:** unpriced cells stay "quote on request" (unchanged); the affected tier's grand renders **"from $X"** (sum of priced lines) with a footnote naming the pending line (CAP-60 · Tier 1). Demonstrated in State C, Tier 1 → "from $165,000".
- **Turnkey-only:** no itemization exists to show a partial against, so the affected tier renders **"total on request"** (card or hero), with the same pending-line note in the includes block.

## A5 · Sequencing (brief §5, informational)

The charges-inclusive turnkey total depends on real service-fee / freight data (Slice 11 · F1.5, currently stubbed). CD designs the treatment now; CC ships the total + F1.5 as one unit. The prototype uses representative figures.

## A6 · Things considered and rejected

- **Dedicated total column.** Rejected at 4 tiers — see A1. Revisit only if a layout ever caps at ≤2 tiers.
- **Folding pass-through freight into the total** to give "one number." Rejected: it's billed at actual cost and can't be a fixed quoted figure; folding it would misrepresent the commitment. Held out explicitly.
- **Hiding the charges block in itemized pass-through** (since the total folds the fees). Kept — itemized mode's whole job is the breakdown; the reconcile note prevents double-counting.

## A7 · Out of scope (unchanged)

Base-brief §7 still holds. The turnkey total is a *display* of sell-side sums; it introduces no cost, margin, or BOM math — line totals are computed on the ASY (finished-good) sell price only, never component/BOM math.

## A8 · Named structure delta (Pattern 30)

New components (`app/cpdf/pdf-render.jsx`): `GrandTotalRow({skuSet, layout, foldFees, freightAtCost, allInUnit})` · `TurnkeySummary({skuSet, layout, foldFees, freightAtCost, allInUnit, partial, lede})`. Helpers: `lineTotal(price, ti)` · `tierGrand(skuSet, ti, foldFees)` · `SERVICE_FEES_TOTAL`. `PricingTable` gains the per-cell line-total stack; `CustomerPdfHost` gains `detail` / `setDetail`.

New classes: `pp-linetotal` · `pp-grand` (`.g-label` `.g-sub`) `pp-grand-num` (`.from` / `.req`) `pp-grand-notes` `pp-grand-note` (`.k` `.amt` `.freight`) · `pp-turnkey` (`.single`) `pp-tk-cards` `pp-tk-card` (`.rec`) `pp-tk-tier` `pp-tk-qty` `pp-tk-rec-word` `pp-tk-total` (`.req` / `.from`) `pp-tk-hero` (`.h-label` `.h-tier` `.h-qty` `.h-num`) `pp-tk-included` `pp-tk-scope` `pp-tk-incl-list` `pp-tk-incl` (`.out`).
