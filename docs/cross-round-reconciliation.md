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
