# Cross-round reconciliation

**Purpose.** CD produced six rounds of design work sequentially (Rounds 1, 2, 2.5, 3, 4, 5, 6) plus a Bulk Raw correction. Later rounds did not always harmonize earlier rounds. Affordances designed in Round 1 may have been intentionally cut, implicitly carried forward, or simply not in scope for later rounds — and CD's designer notes don't always say which.

This document tracks every cross-round inconsistency surfaced during the redesign-implementation slice, with the disposition (preserve / cut / reshape / clarify-with-CD) and rationale. It becomes the source of truth for "what does the Round 4 rail actually contain" or "is Pipeline a v1 surface" and prevents the same question being re-litigated in different sub-slices.

**Maintained by.** CA + Designer agent during build. CC consults before implementing affordances that span multiple rounds; CC adds new entries when surfacing new inconsistencies.

**Decision authority.** CA + Edward decide; Designer can recommend; CD consulted via targeted ask only when CA + Edward determine the question requires CD's judgment specifically.

---

## How to use this doc

When CC encounters an affordance during implementation that exists in one round but is absent in another, before improvising:

1. **Search this doc** — has the inconsistency been resolved? If yes, follow the disposition.
2. **If not resolved**, surface to Designer with both rounds cited. Designer either resolves directly (when CD's intent is clear from designer notes or the disposition is straightforward) or escalates to CA + Edward.
3. **CA + Edward decide** the disposition; the resolution lands in this doc.
4. **CC implements** per disposition.

**Default position when ambiguous: preserve the earlier-round affordance.** The bias is toward inclusion, not silent removal. Cutting an affordance is a real design decision; preserving one is the conservative path.

---

## Resolved inconsistencies

### CR-1. Pipeline navigation — Round 1 breadcrumb root vs Round 4 rail

**The inconsistency:** Round 1's breadcrumb structure puts **"Pipeline"** as the top-level navigation root (visible in `Nexus Round 1.html` source: `crumbs = { project: [{ label: "Pipeline" }, ...], setup: [{ label: "Pipeline" }, ...], build: [{ label: "Pipeline" }, ...] }`). Pipeline implies a sales-pipeline top-level surface — a list of deals organized by HubSpot stage, presumably.

Round 4's two-tier rail design enumerates the outer rail's contents explicitly: Pinned + Recent + My-deals link + ⌘K placeholder + Settings + avatar. **Pipeline is absent.** Round 4's designer notes don't mention Pipeline at all — neither as a cut nor as a carry-forward.

**The question:** Did "Pipeline" become the Deal organizer (Round 4's home page), making the rename canonical? Or was Pipeline a separate surface (a HubSpot-stage-grouped view of deals) that Round 4 didn't surface but should still exist? Or was Pipeline a Round 1 placeholder that never had a real design?

**Disposition: PIPELINE = DEAL ORGANIZER (renamed).**

**Rationale:** The Deal organizer in Round 4 covers the role Pipeline implied in Round 1 — it's the surface that lists all projects (= all deals = the pipeline). Round 4's filter chips (All stages, Client, PM, Sales rep, Status, Has-lines-to-review) explicitly include stage filtering, which is the core of "pipeline" as a concept. The Deal organizer is the v1 pipeline view; "Pipeline" was Round 1's name for what later became "Deal organizer" / "My deals."

**Implications for CC implementation:**
- The Round 1 breadcrumb pattern (`Pipeline > Client > Quote > Surface`) does not survive into v1. Round 4's rail-driven navigation replaces breadcrumbs as the primary navigation pattern.
- CC does NOT introduce a separate Pipeline surface.
- The home page (Round 4 deal organizer) is the pipeline. Filter by stage to get a stage-grouped view.
- "All deals" link in Round 4's outer rail navigates home.
- If a HubSpot-stage-grouped view becomes valuable later (Kanban-style by stage), that's a post-MVP feature — not in v1.

**Decided by:** CA + Edward, May 2026, during pre-RI.1 cross-round reconciliation pass.

---

## Open inconsistencies — surfaced but not yet resolved

### CR-2. Round 1 breadcrumbs vs Round 4 rail-driven navigation

**The inconsistency:** Round 1 used breadcrumbs (Pipeline > Client > Quote > Surface) as the primary navigation pattern. Round 4 designed a two-tier rail that subsumes much of what breadcrumbs do (the inner rail shows project context + scenario + surface). Round 4's designer notes don't explicitly say "breadcrumbs go away" — they design the rail without addressing breadcrumbs.

**The question:** Do breadcrumbs persist alongside the rail, get replaced entirely, or appear in some surfaces but not others?

**Tentative disposition (pending CA + Edward sign-off):** **Breadcrumbs are subsumed by the rail; remove from primary navigation.** The inner rail's project header + scenario list + sub-rail expansion under active scenario provides the same orientation breadcrumbs would. Adding breadcrumbs on top creates redundancy.

**One nuance:** the topbar in Round 4 may still benefit from a context strip (e.g., "Lumen & Co. · Primary v3 · Cost build" as a small location indicator) for orientation when the rail is collapsed or on smaller screens. This is a topbar pattern, not breadcrumbs.

**Surfaced:** during cross-round reconciliation pass before RI.1.
**Status:** awaiting CA + Edward confirmation. Default tentative disposition is conservative; CC should NOT implement breadcrumbs in v1.

---

### CR-3. "Sample" / "Send sample" actions

**The inconsistency:** Earlier rounds may have referenced sample-related actions (sample requests, sample shipments, sample status tracking) as part of the project lifecycle. Later rounds focus on quote-flow specifics and don't surface sample workflows.

**The question:** Are samples a v1 concern? Does Nexus track sample status, and if so, on what surface?

**Tentative disposition:** **Samples are not a v1 concern.** SPEC.md scope is quote management — generation, costing, customer-facing PDF, accept-with-writeback. Samples live in a different operational track (production R&D, customer relationship), tracked elsewhere (HubSpot deal properties, NetSuite, Excel).

**Implications:** No Nexus surface displays sample status. No Nexus action creates sample requests. If a PM is mid-quote and needs to reference whether samples were sent, they look in HubSpot, not Nexus.

**Surfaced:** by CA during reconciliation pass; no concrete reference in CD's rounds, but flagged proactively.
**Status:** disposition feels right but worth confirming with Edward. Sample-tracking is a known DPS workflow that v1 explicitly defers.

---

### CR-4. Profile / preferences surface

**The inconsistency:** Some rounds may show a user-profile or preferences affordance (avatar opens menu, settings link, preferences page). Round 4's outer rail has Settings + avatar at the bottom but doesn't elaborate on what Settings contains or whether it's the same as user preferences.

**The question:** What does "Settings" mean in v1? Is it admin-only (firm settings, markup defaults, audit log per Round 5) or does it also include per-user preferences (theme toggle, notification preferences, etc.)?

**Tentative disposition:** **Settings = admin pages only in v1.** Round 5's design treats Settings as the admin entry point: firm settings + markup defaults + audit log. Per-user preferences are minimal (theme toggle, possibly density toggle) and live elsewhere — likely in the avatar dropdown or as a simple preferences modal. Round 4 doesn't design this explicitly; tentative disposition is "minimal preferences in avatar menu, admin pages under Settings."

**Implications for CC implementation:**
- Settings link → admin pages (gated by role)
- Avatar dropdown → user info + sign out + theme toggle (light/dark) + maybe density toggle
- No separate "Preferences" page in v1
- No notification preferences (no notifications system in v1)

**Surfaced:** during cross-round reconciliation pass.
**Status:** awaiting CA + Edward confirmation. CC should NOT design or build a separate Preferences page.

---

### CR-5. Round 1 vs Round 4 — "Refresh from HubSpot" placement

**The inconsistency:** Round 1's project view likely had the Refresh-from-HubSpot button in a specific location (probably top-right, near the project header). Round 4's project detail design positions the refresh action somewhere — possibly the same spot, possibly different. The headers may have evolved across rounds without the refresh button placement being explicitly addressed.

**The question:** Where does Refresh-from-HubSpot live on the project detail page in v1, per Round 4's canonical design?

**Tentative disposition:** **Top-right of project header strip, alongside the synced timestamp.** This matches both Round 1 and Round 4's general header pattern; Round 4 doesn't explicitly reposition it.

**Implications:** CC follows Round 4's prototype rendering for exact placement. If Round 4's prototype shows it in a different spot than this disposition assumes, the prototype wins.

**Surfaced:** during reconciliation pass.
**Status:** low-stakes; CC verifies against Round 4 prototype, follows what's there.

---

### CR-6. Status chip vocabulary across rounds

**The inconsistency:** Status chips appear in many rounds (scenario status: Active / Dropped / Accepted; quote status: Draft / Sent / Accepted; line status: Complete / Incomplete / Underpriced; etc.). The exact copy and visual treatment may have drifted across rounds:

- Round 1 may use "in progress" where Round 4 uses "active"
- Round 3 may use "dropped" where Round 5 displays "declined"  (hypothetical example)
- Visual treatment (color, weight, border) of the same status may differ slightly between rounds

**The question:** What's the canonical status vocabulary + visual treatment in v1?

**Tentative disposition:** **The most recent round's vocabulary wins per surface.** When a status appears in multiple rounds, follow the most recent round's design for that surface. When the same status appears across multiple surfaces (e.g., scenario status), use Round 4 (the most recent that designs scenarios broadly) for visual treatment, Round 5 for admin-page specifics.

**For CC implementation:** Don't introduce new status copy. Use the chip text as it appears in the canonical round prototype for the surface being implemented. If the same status appears with different copy in different rounds, surface to Designer.

**Surfaced:** anticipated during implementation; flagged proactively here.
**Status:** general guidance; specific instances will be tracked as they surface during build.

---

### CR-7. Cost Build section structure — Round 2 vs Round 6

**The inconsistency:** Round 2 designed Cost Build with sections (Packaging / Production / Freight) on a single page. Round 6 redesigned Cost Build with summary-with-drill-down architecture, horizontal cost stack header, and conditional fourth Bulk Raw section. These rounds disagree on:

- Section visual treatment (Round 2's table-of-rows vs Round 6's section-row-with-drill-down-drawer)
- Cost stack placement (Round 2: at bottom or side; Round 6: horizontal at top)
- Per-tier rendering (Round 2: inline columns within each section; Round 6: cost stack header captures multi-tier, sections are summary)

**The question:** Round 6 supersedes Round 2's Cost Build design — which is unambiguous because Round 6's designer notes explicitly call out "this redesigns the Cost Build page Round 2 first sketched." But what about specific affordances Round 2 designed that Round 6 didn't carry forward (e.g., specific input row patterns, supplier sub-panels, allocation math captions)?

**Disposition: ROUND 6 IS CANONICAL FOR COST BUILD STRUCTURE; ROUND 2 ELEMENTS PRESERVED WITHIN ROUND 6's ARCHITECTURE WHERE NOT CONTRADICTED.**

**Specifics:**
- Section structure: Round 6 wins (summary-with-drill-down)
- Cost stack: Round 6 wins (horizontal at top, multi-tier side-by-side)
- Input row design within drill-down: Round 2's row patterns preserved unless Round 6 explicitly redesigned them
- Supplier sub-panels: Round 2 designed these; Round 6 implies them through "supplier" column references but doesn't redesign — preserve Round 2's treatment
- Allocation math captions ("$5,250 setup ÷ 25k units = $0.21/u"): Round 2 designed; Round 6 implies through Production drill-down — preserve Round 2's treatment

**Implications for CC:** When implementing Cost Build, walk Round 6 first for structure. When Round 6 is silent on a specific input-row affordance, fall back to Round 2 for that detail.

**Decided by:** CA, May 2026, based on Round 6 designer notes' explicit framing as a redesign of Round 2's Cost Build.

---

### CR-8. Tier rail / tier picker — Round 1, Round 2.5, Round 6

**The inconsistency:** Tier picker design has evolved across rounds:

- Round 1: "tier rail" component (vertical stack of tier pills with quantity + margin) — visible in `Nexus Round 1.html`
- Round 2.5: tier selector tabs above per-SKU breakdown table
- Round 6: multi-tier side-by-side columns in cost stack header replaces tier-picker-as-switcher in many contexts

**The question:** Where does the tier picker live in v1, and is it the same component everywhere?

**Tentative disposition:** **Tier picker context-dependent:**

- Cost Build (Round 6): cost stack header shows tier columns side-by-side; active tier highlighted by default. No separate tier-picker-as-switcher; user clicks a tier column to focus that tier.
- Costing Sheet (Round 6 carry-forward): same as Cost Build — cost stack panel with tier columns; tier selector tabs only within per-SKU breakdown table (Round 2.5 pattern preserved).
- Customer view (Round 3): tier-picker-as-tabs at top to switch between single-tier and multi-tier views (per pdf_layout parameter).
- Project Detail (Round 4): no tier picker; scenario cards show all tiers compactly.

**Implications for CC:** Tier picker is not a single component reused everywhere. Different surfaces have different tier interaction patterns. Implement per the canonical round for each surface.

**Surfaced:** during reconciliation pass.
**Status:** disposition straightforward; CC follows per-surface canonical round.

---

### CR-9. "Nexus" wordmark / brand treatment in topbar

**The inconsistency:** Round 1's brand treatment puts "Nexus v1" in the sidebar header (Newsreader serif "Nexus" + JetBrains Mono "v1" version chip). Round 4's two-tier rail design puts "Nexus N mark" at the top of the outer rail (compact 56px width).

**The question:** Does the wordmark stay (Round 1's "Nexus" full word) or compact to just the N mark (Round 4)? Where does it live?

**Disposition: ROUND 4 WINS — N MARK ONLY, OUTER RAIL TOP.**

**Rationale:** Round 4's 56px outer rail is constrained; "Nexus" full wordmark wouldn't fit. Round 4 explicitly designs the N mark as the brand element at outer-rail-top, links to home (Deal organizer). Round 1's wordmark was a 240px sidebar pattern that Round 4's two-tier rail explicitly replaced.

**Implications:** No "Nexus" wordmark in v1. The N mark is the brand. Topbar may have a deal-context strip but no brand element (brand lives in the rail).

**Decided by:** CA, derived from Round 4 designer notes' explicit rail dimensions + content enumeration.

---

### CR-10. Topbar contents — across all rounds

**The inconsistency:** Topbar contents have varied across rounds:

- Round 1: breadcrumbs + presence + actions
- Round 2: similar to Round 1, evolved
- Round 4: rail-driven navigation; topbar role unclear
- Round 5 (admin): no topbar in some admin layouts? unclear
- Round 6 (Cost Build): page-header strip with "Cost build · Scenario v3" + meta + actions; this overlaps with topbar's role

**The question:** Does v1 have a topbar? What goes in it?

**Tentative disposition:** **Yes, v1 has a topbar — but minimal.** Contents:

- Left: deal-context strip when on a project surface (e.g., "Lumen & Co. · Primary v3"). Empty when on home / admin / non-project surfaces.
- Center: nothing typically
- Right: presence indicators (when realtime active) + Refresh-from-HubSpot button (when on project surface) + view-as-customer link (when on Cost Build / Costing Sheet)

Most action affordances live in page-level surfaces (header strips on Setup / Cost Build / Costing Sheet pages), not in the topbar. Topbar is for cross-page elements (presence, refresh, role-conditional admin signals).

**Implications for CC:** Implement a topbar component but keep it sparse. Page-specific actions live in page headers (per Round 6's pattern), not topbar.

**Surfaced:** during reconciliation pass.
**Status:** awaiting CA + Edward confirmation. CC implements minimal topbar; pattern emerges as more surfaces ship.

---

### CR-11. Validation warning UI register (Slice 9.5)

**The inconsistency:** Slice 9.5 ships three new UI surfaces — inline warning icon, per-page summary panel, Costing Sheet aggregation panel — that CD didn't explicitly design. Without explicit reconciliation, these could drift into a new chip register or accidentally conflict with the `--internal` boundary-guard reservation.

**Disposition: WARNINGS USE CD'S VERDICT-RAMP CHIP REGISTER (`--good` / `--warn` / `--bad`). NOT `--internal`. NOT a new register.**

**Specifics (per Designer extension memo, Slice 9.5):**

- **Severity color tokens** — `info` = `--ink-3` (muted gray, ambient FYI), `review` = `--warn` (amber), `action_required` = `--bad` (red). Maps to Round 2 `chip` / `chip warn` / `chip bad` already canonical at `dist/source/round-2/app/r2/styles.css:255-273`. Pre-RI Tailwind placeholders (`text-slate-500` / `text-amber-600` / `text-red-600`); reskin to canonical tokens during RI.0.
- **Inline icon shape** — 10px geometric SVG, single-color via `currentColor`. Fill-vs-outline split mirrors Slice 9.4b convention: outlined info circle for `info` (advisory), outlined warning triangle for `review` (matches `CompetitiveIndicator` outlined posture), filled exclamation circle for `action_required` (matches `MarginVerdictPill` BELOW_FLOOR filled posture).
- **Anchor** — inline-end of input cell, ~6px gap from right edge.
- **Fresh-dot precedence** — when warning fires on a cell that's also marked fresh (Round 2 `fresh-dot` affordance), warning icon takes precedence; fresh-dot is suppressed. Resolution always supersedes ambience.
- **Per-page summary chip** — `[icon] N warnings ▾`, highest severity wins for chip color, hidden when zero.
- **Costing Sheet aggregation panel** — replaces the existing "0 lines need review" card. Severity emphasis: when any `action_required` present, chip uses `border: 2px solid var(--bad)` matching Round 2's BELOW_FLOOR verdict treatment (this is the visual cue PMs see for "Mark-Accepted will gate"). Standard 1px treatment when only review/info present.
- **Accept-all behavior** — single bulk reason for v1 (per-warning multi-row picker is wrong for v1 weight); confirmation dialog gates when ≥1 `action_required` present.
- **Accept popover microcopy** — "Accepting suppresses this warning. It returns if you change the underlying value." (drops the manual-reactivate reference since that path is UX_BACKLOG, not v1).

**`--internal` reservation — DO NOT cross with this register.**

`--internal` (the D+T purple in the cost stack, hatched extension on customer-invisible markup) is reserved for the **boundary-guard signal**: "this never goes to the customer." Surfaces using `--internal`:
- Cost stack D+T row (`<PdfPage>` boundary-excluded)
- Customs panels on freight (CBM / duty / tariff)
- Any "Internal — not shown to customer" badge

Validation warnings are PM-internal **by virtue of where they live** (cost-build / costing-sheet pages, never the PDF render tree per Round 3 boundary-guard build invariant). They don't need the `--internal` color register; they earn the verdict-ramp register because they answer "is this priced/configured right" not "is this visible to the customer." Future surfaces extending verdict-style affordances (validation warnings, Slice 12 Mark-Accepted gate states, Slice 9.5+ compliance signals) follow the verdict-ramp register; future surfaces extending boundary-guard affordances (PM-internal cost composition, supplier names, customs internals) follow `--internal`.

**Cross-round coherence verified.** Round 1 chip register, Round 2 chip register, Round 6 section-row chip register all share the verdict-ramp tokens; warnings inherit that vocabulary across all surfaces this slice ships and surfaces RI.4 will rebuild.

**Implications for CC:**
- Pre-RI: Tailwind utilities mapped per Designer memo (severity tokens table)
- Post-RI.0: mechanical reskin — find `text-slate-500` / `text-amber-600` / `text-red-600` → replace with `--ink-3` / `--warn` / `--bad`
- Future verdict surfaces (e.g., Slice 12 Mark-Accepted blocking states) inherit the same chip register

**Decided by:** Designer agent + CA + Edward, May 2026, Slice 9.5 design extension review. Reference: `docs/designer-agent-prompt.md` Pattern 2 invocation; full memo retained in conversation history (Slice 9.5 PR 2 turn).

---

### CR-12. Italic-display register is desaturated (`text-ink-3`)

**The inconsistency:** R2 styles.css line 228 establishes `.page-title em { font-style: italic; color: var(--ink-3); font-weight: 400; }` — italic-as-typographic-secondary, intentionally desaturated. Without an explicit cross-round resolution, future surfaces using italic-display can drift to saturated `text-ink` (full color), reading as emphasis instead of CD's secondary register.

**Disposition: ITALIC-DISPLAY USES `text-ink-3` (DESATURATED). SATURATED `text-ink` ITALIC IS RESERVED FOR IN-PROSE EMPHASIS (e.g., R2 `.lede em` body italics).**

**Specifics:**

- **Italic client h1 on Project Detail** (Round 4 brief §3.2 line 297): `font-display text-3xl italic text-ink-3` — the saturated weight reads as emphasis, not as the secondary header register CD established for italic-display.
- **Italic client name in inner rail header**: `font-display text-sm italic text-ink-3` — same convention; reading "Lumen & Co." as desaturated secondary while the deal name (parent context) renders at `text-ink-2`.
- **Italic client name in Deal Organizer project list rows**: `font-display text-sm italic text-ink-3` — same convention.

The pattern: when italic-display renders in a card/header position (room organizer treatment), use `text-ink-3`. Reserve `text-ink` italic for run-of-prose emphasis where the text is one token within a body sentence.

**Why this matters:** italic-display is one of the system's signature typographic moves (Newsreader serif italic at large size). Saturating it loses the visual hierarchy CD established. When PMs scan a Project Detail header, italic client name should read as "context anchor, not the emphatic statement" — that's what desaturation conveys.

**Implications for CC:**
- Future surfaces using italic-display (Customer view greeting, PDF customer block, Mark-Accepted accepted state) inherit `text-ink-3` for the italic
- Existing utilitarian `italic` Tailwind utility usages in pre-RI surfaces (e.g., `customs-row.tsx`, `sku-search-panel.tsx`) are body-prose italics; those use `text-gray-500` / `italic text-...-500` which is the body-italic register; not subject to this convention
- Designer audits flag any future `italic text-ink` usage as a fidelity violation if it's display-class typography

**Decided by:** Designer agent + CA + Edward, May 2026, RI.1+RI.2+RI.3 block-boundary fidelity audit (re-run). M21 finding promoted to a CR entry to harden against future drift across remaining RI sub-slices.

---

## Anticipated future inconsistencies

These haven't surfaced yet but are likely to during build. Pre-flagged so Designer + CC know they're coming:

### CR-13. Cost stack header structural fidelity — per-tier columns + segmented bars

**The inconsistency.** RI.4 initial implementation rendered the cost stack header as horizontal rows-spanning-tiers (components as primary axis); CD's R6 source uses the opposite: per-tier columns as primary axis, components stack vertically inside each column. Plus the bar element was single-segment (cost only); R6's `.r6-bar` grammar (R2 source verbatim, R6 inherits per brief §3.3) is two segments: `seg.cost` solid component color + `seg.markup` same-color hatched overlay with 1px dashed white separator. Edward smoke caught both gaps; Designer Pattern 2 produced the reshape spec; CC implements per CD's named class structure.

**Disposition: COST STACK HEADER USES R6 NAMED-CLASS STRUCTURE — `.r6-stack-grid` (rail + N tier columns) > `.r6-tier-col` (head + bars + foot per tier) > `.r6-comp-row` (one per component) > `.r6-bar` (with `seg.cost` + `seg.markup` children). Per-tier columns are the primary spatial axis. Active-tier highlight is whole-column via inset box-shadow + accent-soft tint.**

**Source access (corrected May 2026):** R6 was shipped as a bundled HTML file (`docs/design-prototypes/dist/Nexus Round 6.html`) with assets inside `<script type="__bundler/manifest">` chunks (base64-gzipped). CD did NOT ship un-bundled source for Round 6 (Rounds 1, 2, 2.5 had it under `source/round-N/`; Rounds 3, 4, 5, 6 didn't). The bundle is opaque to grep / Read / Glob.

**Extracted source now lives at `docs/design-prototypes/dist/source/round-6/`** (recovered programmatically via `scripts/extract-r6-source.mjs`; see that directory's README). This contains the rendered DOM + inline `<style>` blocks (`index.html`, ~117KB, 753 CSS class definitions) plus 11 named `.jsx` modules (`cost-build-page.jsx`, `section-summary-row.jsx`, `cost-stack-header.jsx`, four drawer files, etc.). **All Designer + CC audits against R6 must read this directory directly**; the prose `dist/docs/r6-designer-notes.md` is supplemental, not a substitute for the rendered source.

**Specifics:**

- **R6 actual CSS class vocabulary is UNPREFIXED.** R6 source uses `.chip`, `.stack`, `.cell`, `.section-row`, `.sku-row`, `.tier-col`, etc. — NOT the `r6-` synthetic prefix the initial RI.4 implementation invented. The synthetic-class list this section originally carried (`.r6-stack-grid`, `.r6-row-rail`, `.r6-tier-col`, etc.) was a Designer convention adopted before extraction was possible; it should be reconciled toward R6's actual class names during the next implementation sweep. Any future audit-finding-implementation cycle on this surface MUST cite specific R6 class names from the extracted source, not the synthetic prefix.

- **Component → color token mapping** (R2 source canonical, R6 inherits):
  - PKG = `var(--accent)` (indigo)
  - PROD = `var(--good)` (teal-green)
  - RAW = `var(--good)` (PROD child; same family)
  - FRT = `var(--freight)` (cyan-teal; **NEW token** added to design-tokens.css per Designer recommendation — codebase previously collapsed PROD + FRT to `--good`, losing R2's three-component-color distinction)
  - D+T = `var(--internal)` (customer-invisible purple)
  - PASS = `var(--ink-3)` at `opacity: 0.55` + italic right-side amount label (passthrough is not marked up; visually de-emphasized)

- **Segmented bar grammar** (R2 source verbatim — `source/round-2/app/r2/styles.css` lines 381-456 — R6 inherits per brief §3.3 line 333 "markup hatched extensions"):
  - `seg.cost` — solid component color, full opacity, width = `cost / maxTotalCost × barWidth`
  - `seg.markup` — same component color base + 45° hatched overlay via `repeating-linear-gradient(45deg, rgba(255,255,255,0.20) 0 4px, rgba(255,255,255,0) 4px 8px)` + `border-left: 1px dashed rgba(255,255,255,0.40)` separator
  - PASS has no `seg.markup` (passthrough is never marked up)

- **V1 limitation — segment population:** cost-rollup math layer's `QuoteCostBreakdown` exposes the SUM of `cost × (1 + markup)` per component (already-amortized). Splitting cost vs markup requires math-layer extension. For v1, `seg.cost` renders the FULL value; `seg.markup` renders empty. Bar STRUCTURE has both segments wired so that when the math layer extension lands (UX_BACKLOG entry "Cost rollup component breakout for RAW + D+T + PASS rows" extended to include cost-vs-markup split), only the per-component value derivation changes; the visual layer is already correct.

- **Active-tier highlight** is whole-column via `style={{ backgroundColor: "var(--accent-soft)", boxShadow: "inset 2px 0 0 var(--accent), inset -2px 0 0 var(--accent)" }}`. Inset box-shadow over border avoids layout shift when the active flips. Cell-level `bg-accent-soft/30` (CC's prior implementation) removed.

- **Live animation** preserved per R2 commitment + R6 carries-forward: `transition-all duration-200 ease-out` on each `seg-cost` + `seg-markup` width.

- **6-row case (raws_mode = dps_sources):** RAW row inserted between PROD and FRT; rail label uses `.r6-rail-row-child` modifier (indent + `└` parenting tick + `text-ink-4` desaturated); tier column body bars stay flush left. When `raws_mode !== "dps_sources"`, RAW row hidden from both rail and tier column bodies (no skeleton row).

- **Adjustment row in footer:** spec'd as conditional render when `tier.adjustment_per_unit !== 0`, but the cost-rollup doesn't expose per-tier adjustment per-unit cleanly today. Omitted entirely for v1; UX_BACKLOG entry covers the math-layer addition + rendering when it surfaces.

**FRT color token addition (codebase change):**
- `design-tokens.css` adds `--freight: oklch(0.55 0.10 195)` (light) + `--freight: oklch(0.78 0.10 195)` (dark) plus `--freight-soft` variants
- `globals.css` `@theme` exposes `--color-freight` + `--color-freight-soft` for Tailwind utility access (`bg-freight`, `text-freight`, etc. — none consumed yet outside cost stack header; available for future surfaces that need the freight hue)

**Working pattern established (Edward directive, RI.4):**
For any net-new visual surface in the redesign-implementation slice, CC reads CD's prototype HTML first, identifies CD's named CSS classes, and builds against the same structural hierarchy. Brief is a navigation aid pointing to which round + section applies; CD's HTML defines what to build. Brief amendments to §0.5 + Designer prompt landed alongside this CR (effective for RI.5 onward; applied to this in-flight reshape as well).

**Decided by:** Designer Pattern 2 + Edward + CA, May 2026, RI.4 block-boundary smoke item (c). Reference: Designer extension memo (full structural spec); Edward's directive on R6-source-as-authoritative; brief §0.5 amendment; Designer agent prompt amendment; R2 source CSS for segmented bar grammar (`source/round-2/app/r2/styles.css:381-456`).

**Amendment (May 2026, RI.4 block-boundary smoke item d) — section row alignment + active-tier propagation:**

After the cost stack header reshape landed correctly, smoke surfaced a second structural-fidelity gap: section rows below (collapsed Production / Bulk Raw / Freight rows) carried right-edge mini-stacks at a different rhythm than the cost stack header above. R6 commitment "tiers are columns everywhere" means tier-column geometry must propagate down through every surface that lives below the cost stack — not just exist within the cost stack itself. Designer Pattern 2 audit produced the extension spec; CC implemented in the same block PR.

Specifics:

- **Aligned-but-distinct, NOT unified grid.** Section rows are their own `.r6-section-row` block; tier-column geometry is shared via a page-level `tierColumnsTemplate` derived value (`repeat(N, minmax(160px, 1fr))`) passed to `<CostStackHeader>` and every `<SectionWithDrilldown>`. Each surface owns its block; forcing section rows into `.r6-stack-grid` would distort `.r6-row-rail`'s purpose or fragment the namespace.

- **Three-region grid for section row** using CSS `contents` keyword for the tier-cells wrapper (so children participate directly in the parent grid): `gridTemplateColumns: "minmax(180px, 1.2fr) ${tierColumnsTemplate} auto"` — left region (chevron + name + sublabel), middle region (N tier cells inline via `display: contents`), right region (status chip + deposit + open/close cta).

- **Active-tier propagation is page-wide**, with three intensities of accent-soft register so the active column reads at every intensity level appropriate to the surface:
  - **Cost stack header tier card** — full-perimeter inset 2px accent border + accent-soft tint (peak intensity, headline surface)
  - **Section row tier cell** — accent-soft pill (`border-accent/40 bg-accent-soft text-accent-ink`) on the active cell only (mid intensity, secondary surface)
  - **Drilldown table** — `bg-accent-soft` on the column header, `bg-accent-soft/30` on the data cells (lowest intensity, tertiary surface — input forms must remain legible)

- **Cost-stack header tier-card heads become clickable buttons** that drive the active-tier store + URL via `setActiveTier(tier.id) + router.replace(?tier=...)`. Mirrors `active-tier-selector.tsx` pattern; **no separate `<ActiveTierSelector>` mounted on Cost Build** — the cost stack header IS the selector. `<ActiveTierUrlSync>` mounted at the page root inside `<CostingStoreProvider>` handles URL → store on initial mount + browser back/forward.

- **Drilldown column-highlight sweep** — three line-row components touched: `packaging-line-row.tsx` (`TierCostCell`), `freight-line-row.tsx` (`FreightTierCell`), `production-section.tsx` (`CellRow` + table header strip). Each subscribes to `selectActiveTierId` directly so re-renders are local to changed cells, not the whole row. Bulk Raw drilldown's ingredient table has no per-tier columns; column-highlight not applicable there.

- **`section-mini-stack.tsx` deleted.** The right-edge mini-stack shape was the wrong rhythm; replaced by tier cells in the section row's middle grid region. Only consumer was `section-with-drilldown.tsx` which now inlines the tier-cell rendering.

- **Smoke verification points** (Edward's directive, RI.4 block-boundary smoke item e): rapid tier-toggle responsiveness across cost stack + section rows + open drilldown — should feel sub-perceptual; profile DevTools if any lag/flicker. With a section drilldown open, tier toggles should propagate column highlight through to drilldown cells consistently across all four sections.

- **Per-cell vocabulary inside section row middle region** (Designer Pattern 1 audit refinement, May 2026): inactive cell is text-only (no container, no border, no bg); active cell is the R2 `.chip.accent` pill register (`border-accent/40 bg-accent-soft text-accent-ink`, R2 source `styles.css:271`); empty active cell renders em-dash inside the active pill (R6 designer notes commitment #2 dashed-pill register adapted to active state). Container chip-shape per cell is rejected — it borrows chip semantics that should land on the active-tier highlight alone.

- **Section row visual hierarchy** (Designer Pattern 1 audit Concern 5): section name carries display register at `text-xl font-medium tracking-tight` for headline weight (R2 `.section-head h2` register, not full 22px page-section-head); status chip demoted by removing `font-medium` and `tracking-wide` so it reads as ambient context, not co-dominant with the name. Scan-weight ordering: section name (display, ink) → tier values aligned in rhythm (mono, ink-3 with one accent-pill on active) → status chip + open/close (mono small, ink-3) → deposit badge when present.

**Decided by amendment:** Designer Pattern 2 (initial extension) + Designer Pattern 1 (refinement audit) + Edward + CA, May 2026. References: Designer agent extension memos (Q1-Q5 structural / refinement audit Concerns 1-5 + structural-fork answer that aligned-but-distinct is correct); Edward's directive on R6-source-as-authoritative + smoke verification scope.

**Amendment-2 (May 2026, RI.4 block-boundary smoke item f) — `tierColumnsTemplate` ripout + R6 actual-source reconciliation:**

Edward smoked the implementation against R6's rendering. "Many many visual differences" surfaced. Investigation revealed the load-bearing access blocker: R6 was shipped as a bundled HTML file with assets opaque to grep / Read / Glob; CD did not ship un-bundled `source/round-6/`. Prior Designer audits worked from prose `r6-designer-notes.md` only — describing commitments without specifying pixel-level styling. Vocabulary-consistent extensions accumulated and drifted further from R6's actual rendered output with each pass.

`scripts/extract-r6-source.mjs` recovers R6 source programmatically; output at `docs/design-prototypes/dist/source/round-6/`. R6 actual class register is **unprefixed** (`.r6-stack`, `.r6-tier-col`, `.r6-comp-row`, `.r6-bar`, `.r6-section`, `.r6-section-row`, `.tier-mini`, `.mini-stack`, etc. — these ARE the real class names in R6 source; the synthetic-prefix caveat the original entry carried is now obsolete and replaced).

Comprehensive Designer Pattern 1 audit against extracted source surfaced **13 Critical + 9 Significant + 7 Minor deviations**. Single biggest finding: **the `tierColumnsTemplate` shared-grid pattern is invented — does NOT exist in R6 — and produced every "tier values spreading awkwardly across the page" symptom**. Cost stack and section row do NOT share tier-column geometry:

- **Cost stack** uses `repeat(N, 1fr)` full-bleed with `gap: 1px` on `--rule` background (gap-as-hairline-divider — NOT separate cards with padding+gap)
- **Section row mini-stack** is content-sized flex inside an `auto` track of a 6-track grid (`32px 1fr auto auto auto auto` = chev | head | status-chip | owner | mini-stack | open-cta)

Stripped end-to-end from `page.tsx`, `cost-stack-header.tsx`, and `section-with-drilldown.tsx`.

Other comprehensive-sweep changes (full inventory in implementation diff): cost stack tier card no border + active = `inset 0 -3px 0 var(--ink)` bottom underline (NOT full-perimeter accent pill); bar grammar = full-cell-width bar with segments scaled via `width:%` (NOT bar shrinks); foot Sell label display 14px + bare margin row with pip dot (NO chip); tier head 22px display qty with `<sup>units</sup>` suffix; stack head H2 + 5/6-item component color legend (NOT mono caption + grammar legend); section row name 18px display + sublabel mono 11px ink-3 lowercase (NOT uppercase 10px ink-4 eyebrow); section row tier-mini active = ink + font-medium text only (NO pill); page header H1 italic display 30px = "Cost build · Primary v3" (project identity in rail, NOT cost-build header); HubSpot pulse-dot meta strip; scenario context strip card chrome; anchor pill ★ + code + "— anchor SKU" tag with name outside italic 17px; mode selector green-themed segmented control (RAW family); five `--comp-*` tokens added to design-tokens.css (PKG / PROD / FRT / RAW / D+T) — separate from broader semantic palette so cost stack hues can shift independently.

Owner column rendered with placeholder per Path A (22px paper-3 circle + em-dash + ink-4 "—" label) until `cost_section_meta.owner_user_id` schema lands. UX_BACKLOG entry "Cost section ownership data model" tracks the schema + assignment surface.

**Lesson — process amendment (CLAUDE.md "Design prototype source access" section):** comprehensive Designer audit against extracted source → CC implements complete sweep → single smoke at end. Iterative concern-by-concern audits without source-of-truth grounding optimize for local consistency at the cost of cumulative drift; this was paid for in real Designer + dev cycles before the access blocker was diagnosed. Going forward for any net-new R6 surface or any "many visual differences" smoke result: comprehensive cycle, not incremental.

**Decided by amendment-2:** Designer Pattern 1 comprehensive audit + Edward + CA, May 2026. References: Designer agent comprehensive audit memo (13C + 9S + 7M deviation inventory); R6 extracted source at `docs/design-prototypes/dist/source/round-6/index.html` lines 2346-2709 (page-head + context + cost stack + section row + drawer); R6 `cost-stack-header.jsx` + `section-summary-row.jsx` + `cost-build-page.jsx` for component-level reference.

**Amendment-3 (May 2026, RI.4 block-boundary final sweep) — drilldown rebuilds + body bg correction + Tailwind v4 utility-class learning:**

After amendments 1+2 closed structure + content-fidelity gaps on the page chrome (cost stack header, section rows, scenario context strip), Edward smoked against R6 and surfaced two further gaps: (1) the four section drilldowns were not rebuilt against R6 and were carrying form-based UI from prior slices, fundamentally divergent from R6's drilldown register; (2) global CSS `body { background: var(--paper) }` was wrong against R6 (`var(--paper-2)`), so `bg-paper` cards sat on the same color as the page bg producing zero contrast.

**Drilldown rebuilds — full R6 fidelity per `docs/design-prototypes/dist/source/round-6/{packaging,production,freight,bulk-raw}-drawer.jsx`:**

- **Packaging:** flat `.r6-dt.pkg` table replacing per-SKU form composition. Cols: Component | Category | Supplier | Markup | per-Tier | actions. Per-line metadata + tier cost cells inline-editable; computed landed value `unit_cost × (1+markup) × qty/unit` shown as sub-text. Total — packaging foot row.
- **Production:** flat `.r6-dt.prod` table. CC schema stores fixed cost fields per (SKU, tier); R6 uses variable lines per section. Bridge: map each fixed cost field to a virtual "line" with R6 metadata (kind, category). Six virtual lines per SKU (Filling/blending, CM assembly, Setup fee, Tooling/artwork, R&D, Other services), plus Bulk raw cost when raws_mode = cm_sources. NRE rows show amortized sub-text (`→ $X/u`) when `allocateServiceFeesToCost = true`, swap to "billed as one-time charge" sublabel when false. R6 toggle cards at top + post-prod reconcile block at bottom.
- **Freight:** per-line `.r6-fr-line` cards. Each head: inline supplier edit + meta + `.r6-fr-treat` Bundled/Passthrough toggle (dark blue / ink fills on active). `.r6-fr-tiers` rollup row with inline total-freight inputs + computed per-unit + raw `$X ÷ Y units` math sublabel. `.r6-fr-customs` blue-tint sub-card when `bundled` (CBM + duty + tariff).
- **Bulk Raw:** three-card `.r6-raws-mode` banner (DPS / CM / Customer) with green accent. R6 empty drawer for inactive modes + dps-with-no-categories. Drawer toolbar + `.r6-raw-cat` cards with `.r6-raw-ing-head` + `.r6-raw-ing` ingredient table.

All four drilldowns use R6's unprefixed class register (`.r6-dt`, `.r6-fr-line`, `.r6-raws-mode`, etc.) extracted verbatim from R6 source into `src/styles/r6-cost-build.css` and imported via `globals.css`. Existing actions wired (`updatePackagingTierCell`, `upsertProductionInputs`, `updateFreightTierCell`, `setRawsMode`, `updateSkuProductionPolicy`).

**Body bg correction (cross-cutting):** R6 `body { background: var(--paper-2) }` (`index.html:362`) — slightly grey, so `--paper` cards (cost stack outer, section row outer, drawer toolbar, freight line cards, raw category cards) read as visibly lighter card surfaces on the page. CC's body bg was `var(--paper)` since RI.0 (a porting error from R2 base). Corrected globally in `globals.css` body rule. Outer + inner rails also flipped from `bg-paper-2` (which now matched body) → inline `background: var(--paper)` so rails read as lighter strips against the page.

**Tailwind v4 @theme utility class learning (durable lesson):** Tailwind v4's `@theme { --color-paper: var(--paper) }` chain pattern produced inconsistent utility class output for some elements during RI.4 — `bg-paper` would render correctly on some surfaces (inner rail) but not others (cost stack outer, section row outer). Root cause not fully diagnosed; pragmatic resolution was switching visual-critical bg/border to inline `style={{ background: "var(--paper)", border: "1px solid var(--rule)" }}` which bypasses Tailwind's utility/theme layer entirely and resolves CSS variables at the browser-runtime layer. Pattern: when a Tailwind custom-token utility class doesn't render reliably across a slice, use inline `style={{ <prop>: "var(--token)" }}` for the visual-critical surface. Reserve Tailwind utilities for layout (flex, grid, padding, gap) which compile reliably.

**Decided by amendment-3:** Edward + CA + Designer Pattern 1 + CC, May 2026. References: R6 extracted source `docs/design-prototypes/dist/source/round-6/{packaging,production,freight,bulk-raw}-drawer.jsx`; R6 CSS `index.html:2705-3352` (drawer-toolbar + r6-dt + r6-prod-toggles + r6-post-prod + r6-fr-line + r6-fr-customs + r6-empty-drawer + r6-raws-mode + r6-raw-cat); `src/styles/r6-cost-build.css` extraction; `src/app/globals.css` body bg correction.

---

### Future-CR-A. Validation warning UI (Slice 9.5) overlap with Round 6 Cost Build

**RESOLVED → CR-11.** Slice 9.5 design extension memo (Designer, May 2026) closed this entry. Disposition: warnings use verdict-ramp chip register, not `--internal`; integration into Round 6's section-row chip slot is clean (no register collision). Kept here for trail; see CR-11 for canonical disposition.

### Future-CR-B. Customer view (Round 3) vs PDF (Slice 11) layout

Round 3 designed customer view as the PM-internal preview that becomes the PDF. The two render from the same component tree per Round 3 commitment. But Round 3's prototype is rendered in a browser at desktop dimensions; the PDF at letter-page dimensions may need layout adjustments (column widths, font sizes, page-break logic). Designer + CC reconcile during Slice 11 implementation.

### Future-CR-C. Mark-Accepted (Round 3) vs HubSpot-writeback async UI

Round 3 designed Mark-Accepted with a "syncing… / synced 2m ago / sync failed · retry" indicator. The actual visual treatment of these states isn't fully specified — sync-failed retry UX in particular needs detailed design. Designer produces extension when Slice 12 surfaces the question.

### Future-CR-D. Realtime presence indicators (Slice 8.5 already shipped) on rail vs Round 4 rail design

Round 4's rail design doesn't show presence indicators (the rail was designed before Slice 8.5 implemented presence). When CC implements the rail in this slice, presence indicators need a visual treatment — likely a small dot on Pinned/Recent project glyphs when other users are active on those projects, expanded info on hover. Designer produces the extension during RI.2 (rail rebuild).

### Future-CR-E. "What's my move" inbox surface (Round 4 designed, deferred to post-9.5)

Round 4 designed the inbox section of the deal organizer but the slice brief defers it until Slice 9.5's `quote_warnings` engine reaches ≥80% signal coverage. When the inbox launch slice ships (post-9.5), Designer verifies the Round 4 design against actual coverage; if coverage gaps require empty/loading state work CD didn't fully design, Designer extends.

---

## Resolution log

| Date | CR# | Decided by | Status | Disposition |
|------|-----|------------|--------|-------------|
| 2026-05 | CR-1 | CA + Edward | **Decided** | Pipeline = Deal organizer (renamed) |
| 2026-05 | CR-7 | CA | **Decided** | Round 6 canonical for Cost Build structure; Round 2 elements preserved within Round 6 architecture where not contradicted |
| 2026-05 | CR-9 | CA | **Decided** | Round 4 wins — N mark only, outer rail top |
| 2026-05 | CR-2 | CA + Edward | **Provisional** | Breadcrumbs subsumed by rail; topbar may have small deal-context strip. Edward to revalidate when RI.2 (rail) ships. |
| 2026-05 | CR-3 | Edward | **Provisional** | Samples not in v1. Edward to revalidate against actual workflow during real-user test (Slice 17). |
| 2026-05 | CR-4 | CA + Edward | **Provisional** | Settings = admin pages only; user prefs (theme toggle) in avatar dropdown. Edward to revalidate when RI.7 (admin pages) ships. |
| 2026-05 | CR-5 | CA + Edward | **Provisional** | Refresh-from-HubSpot top-right of project header. CC verifies against Round 4 prototype during RI.3. |
| 2026-05 | CR-6 | CA + Edward | **Provisional** | Most-recent-round wins per surface for status chip vocabulary. Specific instances tracked as they surface. |
| 2026-05 | CR-8 | CA + Edward | **Provisional** | Tier picker context-dependent across surfaces. CC follows per-surface canonical round. |
| 2026-05 | CR-10 | CA + Edward | **Provisional** | Topbar minimal; page-specific actions live in page headers. Edward to revalidate when RI.3 + RI.4 ship. |
| 2026-05 | CR-11 | Designer + CA + Edward | **Decided** | Validation warning UI uses verdict-ramp chip register (`--good` / `--warn` / `--bad`); NOT `--internal` (reserved for boundary-guard). Closes Future-CR-A. |
| 2026-05 | CR-12 | Designer + CA + Edward | **Decided** | Italic-display register is desaturated (`text-ink-3`). Saturated `text-ink` italic reserved for in-prose body emphasis. Future italic-display surfaces inherit; Designer audits flag drift. |
| 2026-05 | CR-13 | Designer + CA + Edward | **Decided** | Cost stack header uses R6 named-class structure: `.r6-stack-grid` > `.r6-tier-col` > `.r6-comp-row` > `.r6-bar` (with `seg.cost` + `seg.markup`). Per-tier columns are primary spatial axis; whole-column active highlight; FRT gets new `--freight` token. Working pattern established: net-new visual surfaces require reading CD's source HTML first; brief is a pointer not a substitute. **Amended (May 2026):** tier-column geometry propagates page-wide via shared `tierColumnsTemplate` (cost stack header + every section row aligned-but-distinct); active-tier propagation page-wide with three intensities (header card → section pill → drilldown cell); cost-stack header tier-card heads are the selector (no separate `<ActiveTierSelector>` on Cost Build); `section-mini-stack.tsx` deleted. |

**Provisional vs decided.** Provisional dispositions are the working assumption CC implements against. They're not final until Edward walks the rendered page during smoke and confirms (or refines). Cost of revisiting a provisional disposition is small — typically a small visual change, not architectural rework.

The pattern: implement against provisional → Edward smokes the rendered surface → confirm or refine. This protects against committing to dispositions that look right on paper but feel wrong when rendered.

---

## Process notes for the team

- **Designer agent** should add new entries here as cross-round inconsistencies surface during fidelity audits or extension work
- **CC** consults this doc before implementing affordances spanning multiple rounds; surfaces new inconsistencies to Designer when found
- **CA** reviews open entries periodically and pushes for resolution rather than letting them accumulate; some open items may sit until the surface they affect is implemented (just-in-time resolution is fine for low-stakes items)
- **Edward** has final authority on contested dispositions
- **CD** consulted via targeted ask only when CA + Edward decide a question requires CD's specific judgment; not the default escalation path

This doc lives in the repo at `docs/cross-round-reconciliation.md`. Update via PR; CC + Designer can edit; CA reviews changes.
