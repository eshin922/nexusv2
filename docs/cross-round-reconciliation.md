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

### CR-12. Quote-level client target on `<QuoteSummaryCard>` (Slice 9.4c)

**The inconsistency.** Slice 9.4c introduces a quote-level (per-tier, $ TOTAL) client target distinct from Slice 9.4b's per-(SKU, tier) cell target. The per-tier rollup table in `<QuoteSummaryCard>` must surface up to **three concurrent verdict/affordance states** per row: margin verdict pill (always), quote-level competitive verdict (when target set), and reconciliation warning icon (when target set + all cells set + |sum − target| > $1 ε). CD's six rounds did not design this composite; the Round 6 cost-stack header captures multi-tier columns side-by-side, but the `<QuoteSummaryCard>` per-tier rollup table is a Round 2 ancestor that has accumulated affordances surface-by-surface (Slice 9.2 added Tier adj column; 9.4c now adds Client target + reconciliation). Vocabulary anchors are CR-11 (warning chip register) and the Slice 9.4b verdict-surfacing convention; the question is composition + table-row layout.

**Disposition: EXTEND THE PER-TIER ROW WITH A NEW "Client target" COLUMN PAIRING TIER-TARGET INPUT + COMPETITIVE VERDICT CHIP + RECONCILIATION WARNING ICON + ↺ CLEAR. PRESERVE 6-COLUMN TABLE STRUCTURE; THE NEW COLUMN ADDS, REPLACES NONE; ROW BECOMES 7 COLUMNS. NO ROW WRAPPING, NO STACKED CARDS.**

**Specifics (per Designer extension memo, Slice 9.4c):**

- **Verdict pill placement — new column, NOT alongside `<MarginVerdictPill>`.** The Status column answers "is THIS TIER's blended margin healthy?"; the quote-level competitive verdict answers "is THIS TIER's revenue meeting the customer's stated tier-total target?" — two verdicts about the same row, not two readings of one verdict. Putting them in the same column creates stacked-chip pile / asymmetric column rhythm / conditional-swap problems. New column lives between Tier adj and the right edge. Column header: **"Client target"** (matches per-cell `<ClientTargetCell>` column header on per-SKU summary row — vocabulary consistency).
- **Column contents per row, single horizontal line, right-aligned:** `$ [ tier target ]  COMPETITIVE under target by $X  ⚠  ↺`. Reading order: input → verdict → warning → clear. Value first (where eye lands when scanning a tabular column), interpretation second, escalation third, action last.
- **Verdict chip — extends `<CompetitiveIndicator>` exactly.** COMPETITIVE = `border-emerald-300 text-emerald-800` outline; OVER_CLIENT_TARGET = `border-amber-300 text-amber-800`. `text-[9px]` uppercase, `px-1.5 py-0`. Inline copy carries direction + magnitude per Slice 9.4b verdict-surfacing convention: `"under target by $X"` / `"over target by $X"`. Tooltip: `"Tier revenue: $A.AA / Client tier target: $B.BB"` at 2-decimal precision (tier totals, not per-unit — 4-decimal would be noise here).
- **Reconciliation icon — outlined warning triangle, 10px, `text-amber-600` pre-RI / `--warn` post-RI.0 reskin.** CR-11 `review` severity glyph. Anchored inline-end of cell, `ml-1.5` (6px) gap from verdict chip. Tooltip = warning's `message` field verbatim. Click scrolls + highlights the per-SKU summary breakdown for the affected tier (drill-from-rollup-verdict-to-cell-investigation pattern, Round 2.5 precedent).
- **Composite state — additive, no suppression.** Input + verdict + warning render side-by-side in left-to-right reading order. The 10px outlined icon is naturally subordinate to the ~16px outlined chip with text — visual hierarchy already encodes "interpretation first, escalation flag second" without explicit suppression rules. When BOTH `BELOW_FLOOR` margin (Status column) AND `OVER_CLIENT_TARGET` (new column) fire, the row carries heavy negative signal — DO NOT mute it. The composite IS the diagnosis. Cross-reference fresh-dot precedence (CR-11): if a fresh-dot is ever added to this column's input, the warning icon takes precedence — same rule as CR-11.
- **Per-tier grid — 7 columns holds; do NOT break to stacked cards.** Tier · Revenue · Cost · Margin · Status · Tier adj keep current widths. New Client target column ~200px target, flex-grow when verdict + icon present. Existing `overflow-x-auto` wrapper at QuoteSummaryCard:134 handles narrow viewports (horizontal scroll, no row wrapping). Breaking-point trigger (NOT this slice): 8+ columns OR a column with multi-line content. If reverse-solve "→ apply suggested adj to match tier target" lands later, revisit.
- **No active-tier highlighting on QuoteSummaryCard.** Slice 9.4a's indigo highlight lives on per-SKU summary row + `MarginSparkline` because those surfaces are organized around "given the tier I'm currently focused on, how does this SKU price out?" The QuoteSummaryCard rollup is structurally the OPPOSITE — "all tiers side-by-side," row IS the tier, point is symmetric comparison. Active-tier highlighting here would imply a focus mode the surface doesn't have.
- **NULL-as-empty-signal — input always present, verdict + warning conditional.** Input visible with placeholder `"$ tier target"` when NULL. Verdict chip renders only when `competitiveStatusQuoteLevel !== null`. Warning icon renders only when `targetReconciliationStatus === 'mismatched_high' || 'mismatched_low'`. Clear path mirrors `<TierPriceAdjInput>`: ↺ button visible only when target is set; clicking writes UPDATE-to-NULL on `quote_tiers.client_target_price_total`. NOT empty-input-on-blur (the per-cell `<ClientTargetCell>` posture) — in a single-line row with multiple occupants, blur-to-clear creates ambiguity about what an empty input means at submit time.

**Composite state matrix — concrete render spec:**

| Margin verdict | Quote-target | All cells set | Reconciliation | New column renders |
|---|---|---|---|---|
| any | NULL | n/a | not_applicable | `$ [____]` (empty input only) |
| any | $X | none | not_applicable | `$ [X.XX]  COMPETITIVE under target by $Y  ↺` |
| any | $X | partial | not_applicable | `$ [X.XX]  OVER TARGET by $Y  ↺` (no warning — gated upstream) |
| any | $X | full | matches | `$ [X.XX]  COMPETITIVE under target by $Y  ↺` (no warning — within ε) |
| any | $X | full | mismatched_high | `$ [X.XX]  OVER TARGET by $Y  ⚠ ↺` |
| any | $X | full | mismatched_low | `$ [X.XX]  COMPETITIVE under target by $Y  ⚠ ↺` |

Margin verdict (Status column) is independent — always renders, unchanged by new column contents.

**Token + sizing summary (pre-RI Tailwind → post-RI.0 reskin):**

| Element | Pre-RI Tailwind | Post-RI.0 token |
|---|---|---|
| Input field | `w-24 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-right tabular-nums` | `--ink-3` border / `--surface-0` bg |
| Input placeholder | `"$ tier target"` | (text only) |
| Verdict chip — COMPETITIVE | `border border-emerald-300 text-emerald-800 bg-white px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide rounded` | `--good` outline |
| Verdict chip — OVER_CLIENT_TARGET | `border border-amber-300 text-amber-800 bg-white px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide rounded` | `--warn` outline |
| Reconciliation warning icon | 10px outlined warning triangle SVG, `text-amber-600 currentColor` | `--warn` |
| Icon margin from chip | `ml-1.5` (6px) | (unchanged) |
| Clear button | `rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50` | `--ink-4` text / `--ink-1` border |
| Cell flex | `flex items-center justify-end gap-1.5` | (unchanged) |

**Open call (deferred to smoke):** column header copy `"Client target"` reads identically on both per-SKU summary row (per-unit values) and QuoteSummaryCard (tier-total values). Designer judgment: keep both as `"Client target"`, let column context disambiguate. Edward to confirm during smoke; if PMs are confused, polish PR adds `"(tier total)"` qualifier to QuoteSummaryCard column header.

**Cross-slice question surfaced, not blocking 9.4c:** reverse-solve at quote level (per-tier `→ apply suggested adj to match tier target`, analogue of Slice 9.4b's per-cell affordance) is silent in the 9.4c brief. If in scope for PR 2, the new column gets a 4th occupant; if deferred, ships with input + verdict + warning + clear only. CA + Edward to call.

**Implications for CC:**
- Pre-RI: Tailwind utilities per token table above
- Post-RI.0: mechanical reskin — same find/replace pattern as CR-11
- Future quote-level reverse-solve affordance (if it lands) inherits this column's structure; revisit column-density rule at that time

**Decided by:** Designer agent + CA + Edward, May 2026, Slice 9.4c PR 2 design extension review. Reference: `docs/designer-agent-prompt.md` Pattern 2 invocation; full memo retained in conversation history (Slice 9.4c PR 2 turn).

---

## Anticipated future inconsistencies

These haven't surfaced yet but are likely to during build. Pre-flagged so Designer + CC know they're coming:

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
| 2026-05 | CR-12 | Designer + CA + Edward | **Decided** | Quote-level client target on QuoteSummaryCard renders in a new "Client target" column (input + competitive verdict chip + amber reconciliation warning icon + ↺ clear, additive, no suppression); 7 columns total, no row break to stacked cards; no active-tier highlighting (preserves tier-symmetric posture); input always present, verdict + warning conditional. Extends `<CompetitiveIndicator>`, CR-11, and verdict-surfacing convention. |

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
