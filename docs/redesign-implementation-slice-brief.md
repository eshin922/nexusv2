# Redesign-implementation slice brief

**Synthesizes:** all six CD design rounds (1, 2, 2.5, 3, 4, 5, 6) + Bulk Raw correction + pre-Round-6 audit findings + standing architectural commitments (CLAUDE.md, SPEC.md) + UX_BACKLOG deferred items.

**Status at draft time:** All design rounds shipped. Build through Slice 9.4b deployed. Slice 9.4c (quote-level client target) queued. Slice 9.5 (validation engine + `quote_warnings`) is the largest pre-design-implementation slice remaining.

**Working pattern:** Edward + CC (Claude Code) implements; CA (sounding board) sequences and reviews; architect agent handles math/pattern sign-off. This brief is for CC; CA owns the synthesis + smoke test orchestration.

---

## 0. Frame — what this brief is, what came before, what comes after

**CD's design is the v1 visual specification. CC implements it as designed. This is non-negotiable.**

Where this brief and CD's design rounds disagree, CD's design wins. Where this brief is silent on a visual question, CD's prototypes (HTML + .jsx + .css + .md docs) are the source of truth. Improvising or pattern-matching from prior slice implementations is not appropriate — the design system evolved across six rounds, and earlier slice patterns reflect pre-design-rounds aesthetics that are explicitly being replaced in this slice.

CC's protocol when ambiguity surfaces:
1. Re-read the relevant round's `.md` docs (designer notes + data-source map)
2. Open the round's HTML prototype, walk the state, see the rendered design
3. Read the round's `.jsx` component source for structural composition
4. Check `docs/cross-round-reconciliation.md` — many cross-round inconsistencies are pre-resolved
5. If still unclear → invoke the **Designer agent** (see §0.5). Designer either resolves the ambiguity directly, extends CD's vocabulary with discipline, or escalates to Edward + CA. CC does not improvise on visual questions.

**A note on cross-round cohesion.** CD's six rounds were produced sequentially without harmonization passes. Affordances designed in earlier rounds (e.g., "Pipeline" as breadcrumb root in Round 1) may be absent from later rounds (Round 4's two-tier rail does not include Pipeline) — sometimes because they were intentionally cut, sometimes because the later round wasn't focused on them, sometimes because CD assumed they'd carry forward implicitly. The design system is settled at the round level (CD has shipped six rounds and isn't producing more) but cross-round cohesion is a parallel workstream maintained throughout build via `docs/cross-round-reconciliation.md`. CC consults this doc before implementing affordances that span multiple rounds; Designer + CA + Edward maintain it as inconsistencies surface.

**The prototypes are not "reference."** They are the authoritative spec. CC's React Server Component implementation should produce DOM output that visually matches the prototype's React-CDN rendering. Same components rendered in different runtimes producing the same pixels.

This is the **redesign-implementation slice** brief. It rebuilds Nexus's UI to match the design system CD established across six rounds, replacing the v1 build's utilitarian-skeleton renderings (functional but unfaithful to design intent) with the production-grade visual treatment.

**What this slice is NOT:**

- It is not a feature-add slice. Functional behavior largely preserves what shipped through Slice 9.4b. Some surfaces gain affordances they were always meant to have (project list with filter chips, scenario cards with version chains); others lose accumulated cross-cutting content (Pricing Control Summary duplicated across 5 surfaces consolidates into Costing Sheet only).
- It is not a single sub-step. This slice spans multiple work blocks because the surface count is large and the schema migrations have dependencies. CC organizes into sub-slices (RI.0, RI.1, RI.2, ...) per the work breakdown below. RI.0 lands the design-token foundation before any visual rebuild work; subsequent sub-slices consume the tokens.
- It is not validation-engine work. Slice 9.5 (validation engine + `quote_warnings`) ships independently and feeds into the redesign-implementation surfaces (the "What's my move" inbox specifically depends on it).

**What this slice IS:**

A coordinated visual + structural rebuild of every PM-facing surface, applying CD's six rounds of design judgment plus the architectural commitments accumulated across them. After this slice ships, every Nexus surface PMs touch matches CD's design system. Subsequent slices (10, 11, 12, 13...) build new functionality against the corrected design baseline rather than perpetuating the utilitarian-skeleton aesthetic.

**Sequencing note.** This slice was originally scoped as post-Slice-12 polish. It was pulled forward to between Slice 9.5 and Slice 10 because:
1. Slice 10 (Customer view + Lines Requiring Review) is the first customer-facing surface; it must inherit the corrected design system, not the utilitarian one
2. Slice 11 (PDF generation) is similarly customer-facing
3. Slice 12 (Mark-Accepted + HubSpot writeback) is the MVP cutline; shipping MVP without the corrected design is a meaningful product quality regression
4. Cumulative UX debt across 9.4c + 9.5 + 10 + 11 + 12 would force reshape twice if the redesign happened post-12

**Open question on exact placement:** between Slice 9.5 and Slice 10 if CC capacity allows; between Slice 9.5 and Slice 10 with possible parallel admin-pages backend work if not. Edward + CA decide at scheduling time.

---

## 0.5 Decision authority matrix + fidelity protocol

This slice is large and has many decisions in flight. To prevent visual drift, the decision-authority is explicit.

### The Designer agent

Visual decisions during build are routed through a **Designer agent** — an AI agent with authority below CD (the human designer who produced the six rounds) but above CC on visual questions. Designer's responsibilities:

1. **Fidelity audit** — when CC implements a surface, CC invokes Designer to audit against CD's prototype before opening the PR. Designer produces a structured fidelity report (Critical / Significant / Minor deviations with classifications).
2. **Novel-state extension** — when CC hits a state CD didn't explicitly design, CC invokes Designer. Designer either extends CD's vocabulary with discipline (citing which round's pattern is being extended) or escalates to Edward + CA when novel design judgment is required.
3. **Design rounds for new functional surfaces** — when CA needs a small targeted design round for an upcoming slice (validation engine UI for 9.5, PDF visual for 11, Mark-Accepted detail states for 12), Edward or CA invokes Designer to produce a designer notes doc + data-source map + visual specification, mirroring CD's pattern. CA reviews before CC implements.

Designer does NOT override CD's existing work. Conflicts with CD's choices escalate to Edward + CA, who decide whether to send a targeted ask to CD or accept Designer's reasoning. Designer's prompt is at `docs/designer-agent-prompt.md`.

### Decisions CC owns

- **Schema implementation details** within architect-approved table shape (column naming refinements, index strategy, data-migration approach)
- **Routing structure** (URL patterns, file organization, Next.js app router conventions)
- **Component file organization** (which components share files, prop type design, internal abstraction)
- **React patterns** (server component vs client, data fetching strategy, suspense boundaries, useTransition usage)
- **Performance optimizations** (memoization, code-splitting, lazy loading)
- **Test structure** (which test files, mocking strategy, fixture organization)
- **Build tooling** (TypeScript config refinements, lint rules, build pipeline)

### Decisions CC does NOT own (visual / UX — defer to Designer, who defers to CD's prototypes)

- **Visual treatment** — layout, spacing, typography, color, borders, shadows
- **Component visual hierarchy** — which element is primary, secondary, tertiary; what's emphasized vs de-emphasized
- **Affordance shape** — button placement, modal vs drawer vs inline expansion, dropdown vs segmented control
- **Information density** — what shows in summary vs drill-down, how much metadata per row
- **State transitions** — what changes visually when a toggle flips, what animates, what fades
- **Empty / loading / error states** — visual treatment of zero-data, in-flight, failure cases
- **Status chips, badges, pills** — color treatment, sizing, what the visual register signals
- **Cross-cutting visual decisions** — when to use serif vs sans, small caps treatment, monospace usage

When CC encounters one of these and the prototypes don't answer it, **CC invokes Designer**. Designer either resolves directly (when extension of CD's vocabulary is clear) or escalates to Edward + CA (when novel design judgment is needed). Edward + CA may route to CD for a targeted clarification.

### Fidelity protocol — required for every surface

For each Tier 1 and Tier 2 surface (and each Tier 3 surface where visual treatment is being scaffolded), CC's implementation cycle is:

1. **Read** the relevant round's `.md` docs (designer notes + data-source map) cover-to-cover before writing any component code
2. **Render** the prototype locally — open the HTML in a browser, walk every state via the Tweaks panel, screenshot the states being implemented
3. **Implement** the surface in Next.js + RSC + Tailwind (or whichever stack patterns apply)
4. **Compare** side-by-side: rendered prototype on left half of screen, implementation on right half. Walk every state. Note every visual deviation.
5. **Invoke Designer for fidelity audit.** Designer produces a structured report classifying each deviation as Critical / Significant / Minor and recommending Must-Fix / Justify-or-Fix / Note disposition.
6. **Address Designer's findings:** must-fix deviations are corrected before PR; justify-or-fix deviations are either corrected OR explained in PR description. Designer may reclassify after seeing CC's justification.
7. **PR description includes** screenshots of both prototype and implementation side-by-side for each state, plus Designer's fidelity report with disposition for each finding. Edward + CA review for fidelity before merge — Designer's audit is the first pass; Edward + CA are the final pass.

Deviations that are NOT acceptable without explicit Edward + CA sign-off (these are "Critical" by Designer's classification):

- Different typography scale or weights
- Different color values (use CD's CSS variables verbatim)
- Different spacing rhythm
- Different component composition (e.g., shipping a modal where prototype has drawer)
- Different empty/loading state treatment
- Different motion grammar (animation timing, easing)

### Where to find CD's design

Available to CC at:
- `docs/design-prototypes/` — complete prototype bundle from CD
  - `index.html` — navigation hub linking to all rounds + the un-bundled source
  - `Nexus Round 1.html`, `Nexus Round 2.html`, `Nexus Round 2.5.html`, `Nexus Round 3.html`, `Nexus Round 4.html`, `Nexus Round 5.html`, `Nexus Round 6.html` — each self-contained (assets inlined; renders standalone in any browser)
  - `docs/round-3-data-source-map.md`, `docs/round-3-designer-notes.md`
  - `docs/r4-data-source-map.md`, `docs/r4-designer-notes.md`
  - `docs/r5-data-source-map.md`, `docs/r5-designer-notes.md`
  - `docs/r6-data-source-map.md`, `docs/r6-designer-notes.md`
  - `source/README.md` — CD's layout + conventions guide for the un-bundled source
  - `source/round-1/` — full working tree: `Nexus Quoting Flow.html` + `styles.css` + `tweaks-panel.jsx` + `app/{data.js, shell.jsx, project.jsx, setup.jsx, build.jsx, costing.jsx, notes.jsx}`
  - `source/round-2/` — `Nexus Round 2.html` + `tweaks-panel.jsx` + `app/r2/{shell.jsx, build.jsx, costing.jsx, notes.jsx, datamap.jsx, data.js, styles.css}`
  - `source/round-2.5/` — `Nexus Round 2.5.html` (JSX inline at bottom of file) + reused `app/r2/styles.css` + `tweaks-panel.jsx`
  - `cd-design-rounds-backlog.md` — CD's accumulated commitments across rounds 1-2 (distinct from project's `UX_BACKLOG.md`)

Open `docs/design-prototypes/index.html` for navigation. Each round's HTML opens and renders standalone — no missing-asset issues. Tweaks panel inside each prototype lets CC walk every state (state strip + drill-down strip in the chrome).

Rounds 1, 2, and 2.5 do not have separate `.md` design docs — those rounds predate CD's documented-design pattern. **The un-bundled source at `source/round-N/` is the canonical spec for those rounds.** CC reads the rendered prototype to see the design + reads the JSX/CSS source to understand component composition + reads CD's in-page designer notes (`notes.jsx`) for rationale that didn't make it into a separate `.md`. Designer agent reads from the un-bundled source directly during fidelity audits. The Round 1-2 design vocabulary is the foundation that subsequent rounds build on.

The CSS variables defined in CD's prototypes (visible inline in each HTML's `<style>` block, consolidated in `index.html`'s `:root` block, and authoritative in `source/round-1/styles.css` + `source/round-2/app/r2/styles.css`) are the canonical source for v1 design tokens. The OKLCH color space is intentional — CD chose it for perceptual uniformity. CC copies these tokens verbatim into the implementation's design-system layer (probably `src/styles/design-tokens.css` or equivalent) during RI.0 token foundation. Don't re-derive token values; use CD's verbatim.

The only exception: dark mode legibility tuning — the lowest text-contrast tier (`--ink-4` or equivalent) needs +15-20% luminance adjustment for dark mode per UX_BACKLOG entry. This adjustment is captured as a delta on the canonical tokens; CC implements both the canonical token and the adjusted dark-mode override during RI.0.

---

## 1. Slice scope and prerequisites

### Surfaces in scope

Twelve PM-facing surfaces across four scope tiers. **Tier 1 surfaces are critical-gap rebuilds** (current build is placeholder/skeleton/wrong); **Tier 2 surfaces are structural revisions** (current build is functional but architecturally mismatched); **Tier 3 surfaces are visual treatment passes** (current build is structurally correct, needs design-system polish); **Tier 4 surfaces are admin/cross-cutting**.

**Tier 1 — critical rebuilds:**

1. **Home / Deal organizer** (Round 4). Current build: "Hello, Ed. Import a deal" placeholder. Target: deal organizer landing with project list + filter chips + (deferred) inbox + outer rail (Pinned + Recent + ⌘K placeholder).
2. **Project Detail** (Round 4). Current build: HubSpot metadata viewer with single-quote-row. Target: Next-action card + scenario cards with version chains + activity rail + lineage panel.
3. **Costing Sheet** (Round 2 + 9.4a + 9.4b). Current build: Pricing Control Summary + per-tier cost breakdowns + per-SKU breakdown row. Target: cost stack panel ("How this number is built") as room organizer + margin verdict band with target/floor markers + per-SKU breakdown row preserved.

**Tier 2 — structural revisions:**

4. **Cost Build unification** (Round 2 + Round 6 + Bulk Raw correction). Current build: three separate pages (Packaging, Production, Freight) each with embedded Pricing Control Summary. Target: single Cost Build page with three sections (or four when DPS-sources-raws mode is active) as summary-with-drill-down architecture, horizontal cost stack header at top, no embedded Pricing Control Summary.
5. **Setup / Quote Builder** (Round 1 + audit finding). Current build: SKU + tier + notes + Cost Inputs nav strip + Pricing Control Summary + per-tier cost breakdowns. Target: SKU + tier + notes only; Cost Inputs nav strip becomes link to unified Cost Build page; Pricing Control Summary removed (lives on Costing Sheet only).
6. **Two-tier navigation rail** (Round 4). Current build: top wordmark + Settings link only. Target: outer rail (56px) with Pinned + Recent + ⌘K placeholder + Settings + avatar; inner rail (240px) with project header + scenarios list + surface links + activity feed.

**Tier 3 — visual treatment passes:**

7. **Customer view / Quote view** (Round 3). Current build: not yet built (Slice 10). This slice scaffolds the surface visually; Slice 10 fills in functional logic.
8. **Mark-Accepted flow** (Round 3). Current build: not yet built (Slice 12). This slice scaffolds; Slice 12 fills in.
9. **Import a deal** (Round 4 implication). Current build: standalone page. Target: modal-or-drawer from home, not a separate page.

**Tier 4 — admin and cross-cutting:**

10. **Firm settings page** (Round 5). Current build: Slice 8 admin page (utilitarian). Target: portfolio-effect strip + history rail + edit-mode preview-then-commit.
11. **Markup defaults page** (Round 5). Current build: Slice 8 admin page (utilitarian). Target: inline-edit table + propagation rule prose + Slice 9 prerequisite warning removed.
12. **Audit log read view** (Round 5). Current build: not yet built. Target: chronological feed + filter chips + cascade chip + default-collapsed diffs with expand.

### Prerequisite slices

The following must ship before redesign-implementation begins:

- **Slice 9.4c** (quote-level client target). Adds quote-level client target field; feeds into Costing Sheet's two-axis verdict surfacing. Small.
- **Slice 9.5** (validation engine + `quote_warnings`). The "What's my move" inbox in Round 4's deal organizer depends on this engine reaching ≥80% signal coverage per CD's pushback. The validation engine itself ships before redesign-implementation; the inbox surface ships AFTER both validation and redesign-implementation are deployed.

### Schema migrations required for this slice

Migrations 17-22 land before or as part of redesign-implementation. Order matters because some have FK dependencies. CC sequences within the slice; here is the dependency graph:

**Migration 17 — workspace state tables** (Round 4 commitments)
- `user_pinned_projects` — composite PK (user_id, project_id), pin_order INT
- `user_project_visits` — composite PK (user_id, project_id), last_visited_at TIMESTAMPTZ; indexed on (user_id, last_visited_at DESC) for MRU queries

**Migration 18 — scenario semantics** (Round 4 commitments)
- ALTER `scenarios` ADD COLUMN `recommended` BOOLEAN NOT NULL DEFAULT false (or scenarios.recommended; column home depends on whether scenarios is its own table at this point — currently scenario_label/scenario_status live on quotes; might want a dedicated scenarios table by then per Slice 14 plan)
- ALTER `scenarios.drop_reason` enum: ADD VALUE `'superseded_by_copy'` (and possibly `'draft_at_accept'` if not already present per Round 3 commitment; verify)

**Migration 19 — firm_settings versioning** (Round 5 commitment)
- Currently `firm_settings` is a single row. Promote to versioned: add `effective_from` DATE NOT NULL, `effective_until` DATE NULL (NULL = current), `updated_by_user_id` UUID FK
- Migration script: copy current row to a new history table OR keep single-table-with-history-rows pattern (one current row per firm, history retained); CC picks pattern at migration time per architect's review
- Index on (firm_id, effective_until IS NULL) for current-row lookup

**Migration 20 — audit log cascade tagging** (Round 5 commitment)
- ALTER `audit_log` ADD COLUMN `caused_by_audit_id` UUID NULL FK → audit_log(id)
- Backfill not required (existing audit rows have no cascade tagging; new behavior applies forward)
- Index on `caused_by_audit_id` for cascade-rollup queries

**Migration 21 — search trigram index on audit log** (Round 5 commitment)
- CREATE EXTENSION IF NOT EXISTS pg_trgm
- CREATE INDEX audit_log_summary_trgm_idx ON audit_log USING gin (summary gin_trgm_ops)
- CREATE INDEX audit_log_entity_label_trgm_idx ON audit_log USING gin (entity_label gin_trgm_ops)
- Verify denormalized `summary` and `entity_label` columns exist on audit_log; if not, add (Round 5 commitment implied them)

**Migration 22 — Bulk Raw schema** (Bulk Raw correction commitment)
- New table `bulk_raw_section_meta` keyed by (quote_id, scenario_id): raws_mode ENUM ('cm_sources', 'dps_sources', 'customer_supplies') NOT NULL DEFAULT 'cm_sources', deposit_pct NUMERIC(5,4) NULL, deposit_status ENUM ('none', 'due', 'invoiced', 'paid', 'reconciled') NOT NULL DEFAULT 'none', deposit_invoice_id TEXT NULL, deposit_invoiced_at TIMESTAMPTZ NULL, deposit_paid_at TIMESTAMPTZ NULL, deposit_reconciled_at TIMESTAMPTZ NULL
- New table `bulk_raw_categories` (per scenario): id PK, scenario_id FK, name TEXT, markup_pct NUMERIC(5,4) NULL (NULL = inherit firm default), sort_order INT
- New table `bulk_raw_ingredients` (per category): id PK, category_id FK, name TEXT, native_unit ENUM ('kg', 'L', 'mL', 'oz', 'g', 'lb'), cost_per_native_unit NUMERIC(10,4), usage_per_filled_unit NUMERIC(10,4), per_filled_unit_cost NUMERIC(10,4) GENERATED ALWAYS AS (cost_per_native_unit * usage_per_filled_unit) STORED, hts_code TEXT NULL, supplier_id UUID NULL FK → suppliers(id), notes TEXT NULL
- Data migration: existing `production_meta.bulk_raw_cost_per_unit` values where non-NULL → migrate to a single auto-created bulk_raw_categories row "Bulk raw (legacy)" with a single ingredient. Mark scenarios as `raws_mode = 'dps_sources'` if they had bulk_raw_cost_per_unit set; otherwise default to `'cm_sources'`.
- After data migration verified, DROP COLUMN `production_meta.bulk_raw_cost_per_unit` (or leave deprecated; architect decides)

**Migration 23 — cross-section deposit fields** (Round 6 + Bulk Raw correction implication)
- The deposit lifecycle (DUE / INVOICED / PAID / RECONCILED) Round 6 surfaced on Production AND Bulk Raw section headers needs corresponding data
- ALTER `packaging_inputs` (or a new `packaging_section_meta` table) — add deposit_pct, deposit_status, deposit_invoice_id, deposit_invoiced_at, deposit_paid_at, deposit_reconciled_at
- Same for production-section-level (probably new `production_section_meta` table)
- Or: a single `cost_section_deposits` table keyed by (quote_id, scenario_id, section_kind ENUM('packaging', 'production', 'bulk_raw')) — cleaner, one place for all deposit lifecycle, foreign keys to the appropriate parent
- Architect picks shape during migration design

**Note on migration sequencing:** Migrations 17-21 are independent. Migrations 22-23 form a dependent pair (deposit logic mentions section_kind which includes bulk_raw, so 22 lands first). CC orders within the slice; this brief sets the dependency.

### Cross-slice schema commitments (NOT migrated in this slice)

Captured here so they're not lost. Will land in their respective slices:

- **Slice 9.5: `quote_warnings` table** — primary key, severity enum, scope (line/quote), kind enum, status (active/accepted/auto_resolved), accept_reason, etc. Per Slice 9 brief.
- **Slice 11: `quote_snapshots` table** — Round 3 commitment #7. Per-send snapshot capturing customer-view tree + pdf_layout. Schema-versioned. Distinct from accept-event snapshot.
- **Slice 11: `quote_snapshots.pdf_layout` column** — Round 3 commitment #9. ENUM ('tier_table', 'single_tier'), default 'tier_table'.
- **Slice 12: `blended_below_floor_override_*` columns on quotes** — Round 3 commitment #3. Quote-level analog to existing line-level underpriced_override pair.
- **Slice 12: `hubspot_writeback` table** — Round 3 commitment #4. Status, retry, timestamps for async writeback confirmation.
- **Future: `production_runs` and `formula_yield_reconciliations` tables** — Round 6 + Bulk Raw correction. Two yield events (production yield + formula yield) need separate reconciliation row architecture. Likely Slice 13.5 polish or post-MVP. Don't schema-fork in this slice.

---

## 2. Schema migration plan (consolidated)

For CC's reference. Migrations 17-23 in order:

1. **17 — workspace state**: user_pinned_projects, user_project_visits
2. **18 — scenario semantics**: scenarios.recommended, drop_reason enum extension
3. **19 — firm_settings versioning**: effective_from / effective_until columns + index
4. **20 — audit log cascade tagging**: caused_by_audit_id column + index
5. **21 — audit log search**: pg_trgm extension + GIN indexes on summary/entity_label
6. **22 — Bulk Raw schema**: section_meta, categories, ingredients tables + data migration from production_meta.bulk_raw_cost_per_unit
7. **23 — cross-section deposit fields**: cost_section_deposits table (or per-section meta tables; architect call)

Each migration follows the existing manual-SQL pattern in `drizzle/manual/` if extension/realtime concerns surface. Otherwise standard Drizzle migrations.

**Verification scripts** added to `scripts/verify/` for each migration: round-trip insert/update/delete + read-back validation.

---

## 3. UI rebuild scope — per surface

For each surface: design source, current state, target state, key affordances, behavioral commitments, edge states, deferred items.

---

### 3.1 Home / Deal organizer (Tier 1 critical)

**Design source:** Round 4 (deal organizer with three states: healthy / sparse / empty), Round 4 designer notes (rail proposal, "What's my move" inbox, three pushbacks), Round 4 data-source map (signal kinds, project row content, filter bar).

**Current state:** placeholder "Hello, Ed." + "Import a deal" CTA + Settings. No project list, no rail, no inbox.

**Target state:** workspace landing with three components:
- **Top section: "What's my move" inbox** — DEFERRED to follow-up slice. Don't ship in redesign-implementation. CD's Pushback #1: don't ship inbox until Slice 9.5's `quote_warnings` engine reaches ≥80% signal coverage. Redesign-implementation slice ships the project list + rail + filter affordances; the inbox lands as a separate small slice once 9.5 validates.
- **Middle section: Project list** — table-style with columns: Deal/Client, Stage, Latest quote (margin + amount), Margin pip, Next action chip, Activity timestamp. Filter chips above table: All stages, Client, PM, Sales rep, Status, Has-lines-to-review. Sort: ↓ Last activity (default).
- **Top right: action buttons** — Import from HubSpot (modal, see 3.9), + New project.

**Key affordances:**
- Three filter-chip rows correspond to the three states designed (healthy / sparse / empty)
- Empty state: large empty-set glyph + "No deals yet" copy + Import-from-HubSpot CTA + New-project-manually CTA (per Round 4 empty-state design)
- Sparse state: project list + inbox-stub-area showing reduced inbox content
- Healthy state: full project list + (deferred inbox section showing "1 active project" placeholder until inbox slice ships)

**Behavioral commitments:**
- "What's my move" inbox empty placeholder reads "Inbox shipping with validation engine" until Slice 9.5 + inbox-launch slice
- Project list rows clickable → Project Detail page (3.2)
- Filter state persists in URL params (deep-linkable)
- Import button opens modal (NOT separate page; 3.9)

**Edge states:**
- Zero projects: empty state per Round 4 design
- Many projects (>20): no pagination in v1; backlog item for sort/scroll-to-top/pagination if real use surfaces problem
- Slow HubSpot refresh: skeleton state during load; "Refreshing from HubSpot..." indicator near refresh button (per existing pattern)

**Deferred to follow-up slices:**
- "What's my move" inbox section — lands after Slice 9.5 + signal coverage validation
- ⌘K global search affordance — placeholder icon ships in rail; functional implementation deferred (Round 4 commitment, no hard slice target)
- "Recent sources" memory in cross-project Copy picker — Slice 15 territory
- Cross-project picker scaling for 60+ historical projects — UX_BACKLOG entry; surface before history accumulates

---

### 3.2 Project Detail (Tier 1 critical)

**Design source:** Round 4 (three states: just-created single scenario / active multi-scenario / accepted closed-won), Round 4 data-source map.

**Current state:** thin metadata viewer with HubSpot stage chip + project category dropdown + sales rep + PM + imported date + single-quote-row + "Slice 14 placeholder" for scenarios.

**Target state:** workspace surface with:
- **Header strip**: client (italic h1) + deal name + PM/Sales/Stage/Synced metadata + Refresh-from-HubSpot button + presence chip (when realtime enabled). HubSpot Deal link rendered as "↗ View deal in HubSpot" (existing pattern).
- **Next-action card** (room organizer): three states per Round 4
  - Override pending: "Admin override is your move · Resume primary scenario →"
  - Just-created: "New project · enter your SKU shapes to begin · Open Setup →"
  - Accepted closed-won: green-bordered banner "Lumen & Co. accepted Primary v3 at Tier 2 · 50,000 units · $163,750 · 22.8% blended margin · accepted Apr 30. Aggressive and Pass-through scenarios auto-dropped." with View snapshot + Final PDF buttons
- **Scenario cards** (one per scenario): scenario label + status chip (Active/Dropped/Accepted) + ★ Primary indicator if recommended + margin mini ("22.8% · T2 blended") + Open / + New version buttons + draft-after-send banner when applicable + version chain (v1..vN with status, margin, amount, when) + drop_reason badge for dropped scenarios.
- **Activity rail** (right panel): audit log filtered to project scope, chronological feed, last 24h.
- **Lineage panel**: copied_from_quote_id traceability — "Aggressive forked from Primary v2 · Apr 28" or "No cross-project source".

**Key affordances:**
- Each scenario card shows version chain expandable to view all versions
- Dropped scenarios in inner rail collapse to "+N dropped" disclosure when count exceeds 3 (Round 4 pushback #2 commitment)
- Mark-Accepted will lock against [sent version], not [current draft] copy explicit on draft-after-send banner (Round 3 commitment surfacing)

**Behavioral commitments:**
- Activity rail copy strips internal IDs (audit finding) — render "v3 snapshot created at accept" not "Snapshot quote_snapshots.id=qs_1428"
- Closed-won state: scenarios still rendered but visually de-emphasized below the celebratory banner (compact view; don't dominate)
- Per-scenario activity (sibling auto-drops, draft creations after send) routed into the activity rail

**Edge states:**
- Zero scenarios: render placeholder "Slice 14 placeholder" message becomes "No scenarios yet · scenarios appear when you split into parallel quotes" with link to docs explaining scenarios concept (or just placeholder if Slice 14 ships first; verify timing)
- Many scenarios (>5): Round 4 commits to "+N dropped" disclosure for dropped; active scenarios all render expanded
- Realtime presence: when implemented, render presence chip near header

**Deferred to follow-up slices:**
- Scenario diff/Compare viewer — Round 3 designer note: routes to audit-log-filtered-to-changes-between-v3-and-v4 when audit-log read view ships (this slice ships audit log read view in 3.12, so Compare can be wired during this slice if desired; if not, ship as disabled with tooltip per Round 3 commitment)

---

### 3.3 Costing Sheet (Tier 1 critical)

**Design source:** Round 2 (initial design — cost stack panel as room organizer), Round 2.5 (multi-tier mechanics with sparkline + drawer), Slice 9.4a brief (per-SKU summary row architecture), Slice 9.4b brief (client target benchmark + two-axis verdict + sparkline).

**Current state:** Pricing Control Summary at top + per-tier cost breakdowns (TIER 1/2/3 COST BREAKDOWN sections, redundant with same content on every other page) + Per-SKU breakdown table at bottom (matches 9.4a/9.4b designs correctly).

**Target state:** complete restructure with three rooms:
- **Top — Cost stack panel** ("How this number is built"). Iconic visualization. Per-component bars (PKG / PROD / FRT / D+T / PASS) with markup hatched extensions. Subtotal → Sell → margin verdict band. Multi-tier: side-by-side per-tier columns (per Round 6 cost stack treatment). Active tier highlighted. Round 6's six-row composition (with conditional RAW row) applies when Cost Build is in DPS-sources-raws mode; otherwise five rows.
- **Middle — Margin verdict band**: target/floor markers, current margin position, per-tier verdict pip (good / below_target / below_floor / incomplete).
- **Bottom — Per-SKU breakdown table** (preserved from 9.4a/9.4b): SKU + Contribution + Required Sell + Client Target + Margin + All Tiers sparkline + tier selector tabs. KEEP AS SHIPPED.

**What gets removed from current build:**
- Per-tier cost breakdown sections (TIER 1/2/3 COST BREAKDOWN with Packaging/Production/Freight rows + % of cost). This content is the cost stack panel, just rendered in tabular instead of bar form. Cost stack panel replaces.
- Pricing Control Summary moves UP into the cost stack panel area (subtotal/sell/margin live there now); the standalone PCS card disappears.

**Key affordances:**
- Cost stack panel responds to active-tier selection (PM clicks Tier 2 → cost stack focuses on Tier 2 with side-by-side context preserved per Round 6's design)
- Margin verdict band shows blended margin AND per-tier margin (different views or dual-band)
- Edit firm policy link → Firm Settings page (Round 5 surface)
- "Open Cost Build →" button → unified Cost Build page (3.4)
- Apply / suggested global adj surfacing per existing 9.x logic — preserved

**Behavioral commitments:**
- Cost stack live animation: bars animate to new state on input change (CSS transition, not flicker-replace). Optimistic store already supports the data path — this is a CC implementation detail. CD's design specifies the animation grammar (eased-out, ~200ms, magnitude proportional to change).
- Sparkline on per-SKU rows preserved exactly as 9.4b shipped (lossy pattern-recognition surface; tooltips carry numbers).
- Multi-tier client target competitive verdict (9.4b's two-axis: margin verdict + competitive verdict) preserved.

**Edge states:**
- Empty cost stack (no inputs entered): render zero-state cost stack with "—" sells and "awaiting inputs" margin pips per Round 6 empty state
- Single-tier scenario: cost stack collapses to single column elegantly per Round 6 single-tier-complete state
- Per-cell client target conflict (override fires): existing 9.4b cross-cell consequences dialog preserved
- Below-floor pending override: existing 9.x BELOW FLOOR verdict + override CTA preserved

**Deferred to follow-up slices:**
- Slice 9.4c (quote-level client target) might ship before redesign-implementation; if so, Costing Sheet shows quote-level + per-SKU competitive verdicts. If not, only per-SKU.
- Lines Requiring Review affordance — Slice 9.5 + Slice 10 territory; not in this slice

---

### 3.4 Cost Build unification (Tier 2 structural revision)

**Design source:** Round 2 (single-page sections original intent), Round 6 (horizontal cost stack header, summary-with-drill-down, multi-tier-first), Bulk Raw correction (conditional fourth section + mode selector).

**Current state:** Three separate pages: `/packaging`, `/production`, `/freight`. Each has wall-of-inputs row layout + embedded Pricing Control Summary at bottom. No shared cost stack panel; PCS duplicated across all three pages.

**Target state:** Single Cost Build page at unified URL (e.g., `/quotes/[quoteId]/cost-build` or `/quotes/[quoteId]/cost`). Three (or four) sections rendered in summary-with-drill-down architecture per Round 6. Horizontal cost stack header at top. No embedded Pricing Control Summary (consolidated into Costing Sheet only).

**Page composition (top to bottom):**
1. **Page header**: "Cost build · [Scenario label] v[N]" + meta strip (HubSpot stage, synced timestamp, view-as-customer link, save-draft button, anchor SKU pill).
2. **SKU + scenario context strip**: anchor SKU pill + SKU name + tier count + units total + Other SKUs in this scenario action + Switch scenario action.
3. **Cost stack header** (per Round 6 Change A): multi-tier side-by-side per-tier columns. Five rows by default (PKG / PROD / FRT / D+T / PASS); six rows when raws-mode is `dps_sources` (PKG / PROD / RAW indented under PROD / FRT / D+T / PASS).
4. **Section rows** (per Round 6 Change B): summary-with-drill-down architecture. Three sections normally (Packaging / Production / Freight); four when raws-mode is `dps_sources` (Packaging / Production / Bulk Raw / Freight).

**Section row anatomy** (Round 6 design):
- Chevron (expand affordance)
- Section name + sublabel (compact metadata: line count + key flags)
- Status chip (complete / in_progress / empty)
- Owner badge (avatar initials + role name)
- Per-tier mini-stack (rollup values per tier)
- Open/Close CTA
- Deposit badge (when section has deposit configured): "$X DEPOSIT DUE" or "DEPOSIT INVOICED · INV-XXXX-XXX-NN"

**Drill-down behavior:**
- One drawer open at a time (clicking another section closes prior)
- Drawer expands inline below section row (NOT side-drawer, NOT modal)
- Drawer holds the full input form for that section
- Save / cancel scoped to drawer changes

**Section-specific drill-down content:**

**Packaging drill-down** (Round 6 + audit findings):
- Toolbar: line count + summary metadata + Add Line + From inventory buttons
- Table: Component (with notes sublabel) + Category + Supplier + Markup % chip + per-Tier columns + actions (•••)
- Inventory-eligible badge inline on row
- Total — packaging row at bottom of table
- Empty state: "No packaging components yet" + Add packaging line / Pull from inventory / Copy from another quote CTAs

**Production drill-down** (Round 6 + audit findings):
- Two consequential toggle cards at top:
  - `customer_ships_raws` — full-width card with description + consequence text live-updating
  - `allocate_service_fees_to_unit_cost` — full-width card with description + consequence text live-updating
  - When raws-mode (3.4 mode selector below) is `dps_sources`, the `customer_ships_raws` toggle is functionally redundant with the mode selector's "Customer supplies raws" option. **This is a visual/UX reconciliation question, not a CC decision.** CC verifies against CD's Bulk Raw correction prototype: if the prototype shows both controls active simultaneously, both ship; if the prototype shows the Production toggle disabled when mode-selector picks customer-supplies-raws, CC implements that conditional disable. If the prototype is ambiguous, CC invokes Designer; Designer either extends CD's vocabulary directly or escalates to Edward + CA who route to CD for targeted clarification.
- Toolbar: production lines count + service-fees mode + Add Line / + NRE charge buttons
- Table: Line (with kind sublabel) + Category + Supplier + Kind chip (NRE or per-unit) + Markup % chip + per-Tier columns + actions
- Bulk raw cost sub-section (only when raws-mode is `cm_sources` — when DPS sources raws, raws lives in Bulk Raw section, not here)
- Post-production reconcile sub-section (always visible when production has lines):
  - Header: "PRE-RUN · AWAITING ACTUALS" or "LOCKED · run complete"
  - Two yield-event cards side-by-side:
    - **Production yield (UNITS)**: actual units produced + NRE per-unit delta
    - **Formula yield (MASS)**: mass consumed vs ordered + mass consumed vs theoretical (only meaningful in `dps_sources` mode; in `cm_sources` mode, render as "tracked by CM" placeholder)
  - Bottom card: Margin impact

**Bulk Raw drill-down** (Bulk Raw correction; only visible when raws-mode is `dps_sources`):
- Mode selector at top (three radio cards): DPS sources raws (active state when this section visible) / CM sources raws / Customer supplies raws
- When mode is `cm_sources` or `customer_supplies`, the Bulk Raw section header still renders (mode declaration zone) but ingredient surface collapses to "BULK RAW INACTIVE" message
- When mode is `dps_sources`:
  - Toolbar: 4 raw categories · 8 ingredients · native units · deposit outstanding amount + Add Category button
  - Per-category cards: category name + ingredient count + markup chip + per-unit rollup
  - Within each category: ingredient table with Native unit + Cost / native + Usage / filled unit + Per filled unit cost columns + HTS code sublabel + supplier
  - Section deposit badge in section header

**Freight drill-down** (Round 6 + audit findings):
- Toolbar: freight lines count + treatment-is-per-line note + customs-on-DDP-only note + Add Line button
- Per-line cards (each freight line as its own card):
  - Header: line label + mode + supplier + incoterm + treatment toggle (Bundled/Passthrough button pair)
  - Per-tier rollup row: per-unit values with raw math sublabel ("$4,080 ÷ 12,000")
  - Customs sub-card (only on DDP lines): CBM/unit + Duty rate + Tariff (Section 301) + descriptive footer about incoterm consequences
- "+ Add another freight line" button at bottom of section

**Behavioral commitments:**
- Cost stack live animation across the page (Round 2 commitment + Round 6 carries-forward)
- Mode selector state persists per scenario; raws-mode change cascades to:
  - Cost stack header row composition
  - Bulk Raw section visibility/state
  - Production drill-down's `customer_ships_raws` toggle
- Deposit badge state pulls from the cross-section deposit table (migration 23)
- Per-line freight treatment changes propagate to cost stack (bundled rolls into FRT row; passthrough into PASS row)

**Edge states:**
- Empty: cost stack header empty (zero state); sections collapsed showing "no components yet" empty states with CTAs
- Multi-tier in-progress: typical mid-quote state; some sections complete, others partial; cost stack header shows partial tiers
- Single-tier complete: cost stack collapses to single column; sections each show single tier value

**Deferred to follow-up slices:**
- Cost stack lens toggle (absolute vs normalized) — UX_BACKLOG entry per Round 6 designer notes pushback #3
- Mini-stack engagement instrumentation — UX_BACKLOG entry per Round 6 designer notes pushback #1
- Empty-state line templates (pre-fill common shapes) — Round 6 deferred-to-quality-of-life
- Inventory pool view (cross-project surface) — separate slice; backlog
- Per-section approval workflow — separate slice; backlog

---

### 3.5 Setup / Quote Builder (Tier 2 structural revision)

**Design source:** Round 1 (Setup as the page where SKUs + tiers are defined; locked from Round 1 onward), pre-Round-6 audit (Pricing Control Summary doesn't belong on this page).

**Current state:** SKU rows + Tier rows + Notes textareas + Cost Inputs nav strip (Packaging / Production / Freight links) + Pricing Control Summary + per-tier cost breakdowns.

**Target state:** SKU rows + Tier rows + Notes textareas + Cost Inputs section (now linking to unified Cost Build, NOT three separate pages) + nothing else.

**What gets removed:**
- Pricing Control Summary card (moves to Costing Sheet only)
- Per-tier cost breakdowns (move to Costing Sheet only)

**What gets adjusted:**
- Cost Inputs section treatment: **CC verifies against CD's Round 6 prototype.** Round 6 unifies Cost Build into a single page with three sections; whether Setup retains a "Cost Inputs" link to that single page (as a navigation affordance) or removes the section entirely is determined by what Round 6's design shows. If Round 6 prototypes Setup with a single navigation row pointing at unified Cost Build, that's what ships. If Round 6 doesn't address Setup directly, CC invokes Designer. Designer verifies against Round 1's Setup design + Round 6 carries-forward; if still ambiguous, Designer escalates to Edward + CA who route to CD for clarification.

**What stays:**
- SKU table with HubSpot search + add-assembly + per-row inputs (label, type, units/pack, retail benchmark, notes, actions). Visual treatment refreshed to match design system (column headers in small caps, proper spacing, etc.).
- Tier table with apply-preset dropdown + add-tier button + label/quantity columns. Visual treatment refreshed.
- Internal notes + Customer-facing notes textareas. Distinct surfaces preserved.

**Behavioral commitments:**
- Setup page is purely about the SHAPE of the quote (SKUs, tiers, notes). Cost data lives elsewhere.
- "FROM HUBSPOT" badge on SKU rows: keep but refine visually per design system
- "Apply preset" tier dropdown for tier presets: preserve functionality

**Edge states:**
- Empty: render Round 1 empty state (CTA to add SKUs / use HubSpot search)
- Many SKUs: existing scrolling pattern preserved

**Deferred:**
- Per-SKU inventory eligibility surface (relates to inventory pool) — backlog
- SKU tree visualization for assemblies — Slice 5.5 shipped tree; visual representation in Setup is a polish item

---

### 3.6 Two-tier navigation rail (Tier 2 structural)

**Design source:** Round 4 (two-tier rail design with outer 56px cross-project + inner 240px within-project).

**Current state:** Top horizontal "Nexus" wordmark + top-right Settings link only. No rail.

**Target state:** Two-tier rail visible across all PM-facing surfaces.

**Outer rail (56px wide, fixed left):**
- Nexus N mark (top, links home to Deal Organizer)
- All-deals icon (compact, links home)
- Search icon (⌘K placeholder; functional later)
- Pinned section header
- Pinned project glyph squares (color-coded letter avatars; up to ~8; from `user_pinned_projects` table)
- Recent section header
- Recent project glyph squares (MRU; capped at 4; from `user_project_visits` table)
- Settings (role-gated; admin shows + Audit log + Markup defaults stacked above)
- Avatar (current user initials, bottom)

**Inner rail (240px wide; only when on a project surface):**
- Back-to-all-deals link (top)
- Project header (client + deal + stage + synced metadata)
- Scenarios list (with margin pip + draft-after-send warning chips per scenario)
- Sub-rail expansion under active scenario (Setup / Cost build / Costing sheet / Customer view links)
- Mini activity feed (from audit_log filtered to project)

**Behavioral commitments:**
- Rail is rendered on home, project detail, all quote builder surfaces, all admin surfaces (with appropriate emphasis)
- Pinned + Recent state persists per user (migration 17)
- Active scenario in inner rail highlights; clicking another scenario switches active context
- Dropped scenarios in inner rail: collapse to "+N dropped" disclosure when count >3 (Round 4 pushback #2 commitment)
- Admin surfaces: outer rail stays; inner rail hides (per Round 5 — admin = no project context)

**Edge states:**
- No projects: empty Pinned + Recent sections; rail still renders (with placeholders or simply omits the sections)
- Many projects: Pinned capped at user's pin count; Recent capped at 4; Pinned overflow handled by "more" affordance (deferred)

**Deferred:**
- ⌘K functional search — separate slice; UX_BACKLOG
- Cross-project picker scaling for 60+ projects — UX_BACKLOG
- Realtime presence indicators (avatar dots showing other users active) — Slice 8.5 territory; visual treatment carry-forward

---

### 3.7 Customer view / Quote view (Tier 3 visual scaffolding)

**Design source:** Round 3 (customer view as PM-internal preview that becomes the PDF — Option A from Round 2 sign-off). Three states: pure tier-pricing, pass-through freight + visible service fees, partial completeness.

**Current state:** Not yet built. Slice 10 is the functional implementation.

**Target state for redesign-implementation slice:** Visual scaffolding + design-system component shell. Slice 10 fills in functional logic against this shell.

**Page composition** (per Round 3):
- **Header strip**: project + scenario + version + status (mostly hidden in customer-view mode; visible in PM-preview mode)
- **PM-internal preview callout** (top of preview): "PM-INTERNAL PREVIEW · THIS BECOMES THE PDF" + boundary-guard notice
- **Customer-facing layout below the line**:
  - Vendor block (Halcyon Goods address + contact) — top
  - Customer block (recipient address + contact) — top
  - Quotation number + issued date + valid until + payment terms + lead time + customer-facing notes + incoterms
  - Pricing table (per-unit by tier): per-SKU rows + per-tier columns + retail benchmark column (when populated) + recommended-tier highlight + tier quantity headers
  - Freight section (when pass_through; folded into unit cost when bundled)
  - Send action toolbar at top: `Send as: tier table | single tier` toggle + Download PDF + Download + open mail draft

**Behavioral commitments:**
- **Boundary guard build invariant**: `<PdfPage>` and descendants import zero costing-surface modules. Build pipeline assertion. Failure mode: build error at compile time. (Round 3 commitment #8)
- NULL `tier_price` renders as "quote on request" — never `$0.00` (Round 3 carry-forward)
- "PM-internal preview" callout is visible only in preview mode; PDF render strips it
- `pdf_layout` parameter (tier_table | single_tier) drives layout; both render from same component tree per Round 3 commitment #9
- Send actions: Download PDF (saves to Downloads); Download + open mail draft (saves + opens default mail client via mailto:). NO SMTP, NO Gmail OAuth, NO HubSpot send.

**Edge states:**
- All tier prices NULL: customer view shows "quote on request" for every cell (rare; suggests SKU has no costing yet)
- Pass-through freight: separate freight line item with mode + cost
- Bundled freight: freight folded into unit cost; not shown to customer

**Slice boundaries:**
- This slice (redesign-implementation): visual shell + boundary-guard build assertion + design-system components for vendor/customer/pricing-table/freight blocks
- Slice 10: Lines Requiring Review affordance + recommended-tier indicator on customer view + per-tier price NULL handling + send action wiring + `pdf_layout` parameter handling
- Slice 11: PDF render path against same component tree + actual PDF generation backend + send-event snapshot writing

**Deferred:**
- Hosted customer-view URL — Slice 17+ user testing; rejected in Round 3
- Customer-side Accept button in PDF — rejected in Round 3
- Mailto integration polish — Slice 11

---

### 3.8 Mark-Accepted flow (Tier 3 visual scaffolding)

**Design source:** Round 3 (Mark-Accepted as room organizer for blended-margin verdict).

**Current state:** Not yet built. Slice 12 is the functional implementation.

**Target state for redesign-implementation slice:** Visual scaffolding + design-system component shell. Slice 12 fills in.

**Page composition** (per Round 3):
- Header: project + scenario + version + sent date + acceptance state
- **Sent-vs-draft mismatch banner** (when applicable, Round 3 pushback #2 — first-class affordance, not hidden):
  - "You sent v3 on Apr 28 · current draft is v4"
  - "Tier prices below reflect v3 (the sent version)"
  - "Mark-Accepted will lock against v3 and discard v4 (or save v4 as a sibling)"
  - Two actions: View v3 (sent) preview + Compare v3 ↔ v4 changes
- **Tier acceptance picker**: customer-facing pricing table + tier selector
- **Margin verdict block** (room organizer): blended margin pill with target/floor markers
- **Lines requiring review panel**: in-context, not modal; when underpriced gate fires
- **Action zone**:
  - `Mark accepted · blocked` (disabled, when gates fire) and `Request admin override` (active warning-tone) side-by-side per Round 3 pushback #3
  - When gates clear: `Mark accepted` primary button
- **Two paths forward cards** (when gate fires; decision aids, not action triggers): Fix margin / Request override

**Behavioral commitments:**
- **Sibling auto-drop on accept** (Round 3 commitment #5): `accept_source: 'manual_button'` triggers drop of all `status='active'` siblings on the same project, with `drop_reason='accept_sibling'` and `dropped_by_user_id` set. Auditable, reversible by admin.
- **Sent-version pinning** (Round 3 commitment #2): action takes `version_id` (always sent version), not current draft. Drafts created after send are saved as sibling scenarios with `status='dropped'`, `drop_reason='draft_at_accept'`.
- **Frozen Cost Build during pending approval** (Round 3 commitment #10): `pending` Mark-Accepted state freezes Cost Build edits. Cancel-then-edit is the explicit path.
- **Admin override flow**: warning-tone "Request admin override" CTA → Slack DM step (admin override workflow itself ships in Slice 12)
- **HubSpot writeback async confirmation** (Round 3 commitment #4): LOCKED state shows "synced 2m ago" / "syncing…" / "sync failed · retry"

**Slice boundaries:**
- This slice: visual shell + sent-vs-draft banner component + tier acceptance picker shell + margin verdict block (preserves Round 2 component) + lines-requiring-review placeholder
- Slice 12: full functional implementation (Mark-Accepted action, both gates, override workflow, snapshot logic, HubSpot writeback)

**Edge states:**
- Sent-vs-draft mismatch present: banner + Compare action visible
- No mismatch: standard view, no banner
- Gate fires: Mark-Accepted disabled + override CTA visible + lines-requiring-review panel populated
- Override pending: state shown ambiently with cancel option
- Successfully accepted: LOCKED state with View snapshot + Final PDF

**Deferred:**
- Compare v3 ↔ v4 audit-log filter — Round 3 commitment; ships when audit-log read view ships in this slice (3.12); inline routing handled by this slice
- Email-reply parsing for `accept_source: 'email_reply_parsed'` — Round 4/5
- Admin unlock workflow — Round 4/5
- Per-tier acceptance — rejected (Round 3)

---

### 3.9 Import a deal (Tier 3 minor revision)

**Design source:** Round 4 (deal organizer's Import-from-HubSpot action implies modal not separate page).

**Current state:** Standalone page at `/import` reached via "Import a deal" CTA from home. Search bar + table of deals + import-per-row buttons.

**Target state:** Modal (or full-screen overlay) reachable from home page's Import-from-HubSpot button. Same content (search + table + import) but doesn't navigate away from home.

**Behavioral commitments:**
- Modal open → search field auto-focused
- Import action → modal closes + project created + navigation to project detail
- Cancel/close → modal closes; user back on home

**Edge states:**
- Initial open: shows recent deals or default sort
- Long lists: paginated or infinite scroll
- Slow HubSpot: skeleton state during refresh

**Deferred:**
- Recent-imports memory — backlog
- Bulk import — backlog

---

### 3.10 Firm settings page (Tier 4 admin)

**Design source:** Round 5 (firm policy with portfolio-effect strip + history rail + edit-mode preview-then-commit).

**Current state:** Slice 8 admin page with utilitarian form. Likely has: target/floor margin number inputs + save button + minimal styling.

**Target state:** Two-state admin surface per Round 5:

**Read state:**
- Header: "Firm margin policy" with descriptive prose
- Current policy card: target margin (large numeric, green) + floor margin (large numeric, amber) + descriptive context
- Portfolio-effect strip: "14 ≥35% · 8 25-35% · 2 <25%" inline, view link
- Designer note panel: explains why "Save & re-band 24 quotes" button names the side effect
- Edit policy button (right-rail or bottom)
- Right rail: Policy history (4 changes shown by default + Full audit log link)

**Edit state:**
- Top card: edit policy form with target margin + floor margin inputs + "Effective immediately" indicator
- "+5.0 pts vs. current 35%" or "— unchanged" delta indicator per field
- Cancel + "Save & re-band 24 quotes" buttons (button names side effect on face)
- Re-band preview: "4 quotes change band. 0 newly drop below floor." + affected-quotes list with project + scenario + version
- Live quotes are re-evaluated against new bands the moment you save

**Behavioral commitments:**
- `firm_settings` versioned via effective_from/effective_until (migration 19)
- Re-band preview computes against full quotes WHERE status='sent' set against proposed-policy bands
- Affected-quotes list shows top 5 with link-to-quote affordances; "view all" routes to filtered list
- All edits audit-logged with cascade tagging (caused_by_audit_id used when re-band cascades fire derived audit rows)
- Schedule-effective-date affordance is drawn but inert (deferred per Round 5; backlog)
- Save action: writes new firm_settings row with effective_from = now(); sets prior row's effective_until = now()

**Edge states:**
- No prior history: history rail shows just current policy
- Many history entries: pagination or "show more" affordance

**Deferred:**
- Forward-dated firm settings (Schedule…) — Round 5 backlog
- Per-client target/floor overrides — Round 5 considered/rejected; defer until 3rd request

---

### 3.11 Markup defaults page (Tier 4 admin)

**Design source:** Round 5 (markup defaults with inline-edit table + propagation rule prose).

**Current state:** Slice 8 admin page with utilitarian table + Slice 9 prerequisite warning ("vocabulary will be redefined"). Slice 9.x has shipped; vocabulary is now settled.

**Target state:** Single-state admin surface per Round 5:

- Header: "Default markups by category" with descriptive prose
- Propagation rule helper banner (persistent): "How changes propagate. Editing a default updates draft quotes only, recomputing affected line items in place. Sent quotes are frozen at the markup that was in force when they were sent — re-sending a v2 picks up new defaults, the original v1 record stays intact. Audit log captures every change with before/after."
- Category table:
  - Columns: Category / Default markup (numeric + %) / In use (line items count) / Last edited (relative + initials) / actions
  - Sort: alphabetical by category name (default)
  - Inline-edit per row: click Edit → row becomes editable with Cancel + Save buttons
  - During edit: live disclosure "Saving 40% → 42% will recompute markup on 142 line items across 11 draft quotes. Sent quotes are not affected. Estimated blended-margin shift on those drafts: +0.6 to +1.4 pts" (Round 5 commitment #5 dry-run cost-stack engine)
- Add Category button (+ NEW CATEGORY): drawn but functionally inert in v1 per Round 5 (backlog; FR-15 vocabulary is locked)
- Categories: Primary Packaging / Secondary - Corrugated / Secondary - Labels / Secondary - Cards/Booklets / Manufacturing / Filling and Packout / Co-Packing / Raw Ingredients / Logistics / Passthrough / One Time Charges / R&D / Testing / Turnkey / Tooling

**Behavioral commitments:**
- Single-row edit only (no bulk edit per Round 5 pushback #3)
- Inline disclosure during edit; no modal
- Save: writes new markup_defaults value; recomputes draft quote line items in place; sent quote line items snapshot at send (preserved)
- Delete category: blocked when in_use > 0; surface "X line items use this category" message with link
- Rename category: explicitly out of scope for v1 (Round 5 commitment); tooltip explains "To rename, contact engineering"
- Slice 9 prerequisite warning: REMOVED (vocabulary is settled)

**Edge states:**
- Unused category (in_use = 0): "Unused — never used" chip on row (Round 5 commitment) — soft signal, not a delete CTA
- Many categories (>20): search box at top (functional when needed); v1 list fits one screen

**Deferred:**
- + NEW CATEGORY action wiring — Round 5 backlog (when vocabulary needs extension)
- Bulk edit — rejected (Round 5)
- Rename — rejected (Round 5)

---

### 3.12 Audit log read view (Tier 4 admin)

**Design source:** Round 5 (audit log as filtered chronological feed with cascade chips + default-collapsed diffs).

**Current state:** Not yet built.

**Target state:** Two-state admin surface per Round 5:

**Standard / Filtered view:**
- Header: "Audit log" with descriptive prose
- Filter chips at top: Search box (free-text on summary + entity_label, trigram-indexed) + Entity (project/quote/firm_settings/etc.) + User + Action + Date range
- Filter status bar: "FILTERED · All activity touching Lumen & Co. (project P-2418) — 6 entries across 8 days · Clear filter"
- Entry counter + Export CSV + Copy deep-link affordances on right rail
- Time-grouped feed: "TODAY · APR 30" group header, then entries; "YESTERDAY · APR 29"; etc.
- Entry rows: timestamp + user (initials + name) + action chip (color-coded per action enum) + entity (italic project/scenario/quote name with version) + summary text + diff field count + + DIFF / − COLLAPSE expand toggle
- Expanded diff: structured field-level before/after table inline below row
- Cascade chip: "cascade · 4 rows × 4 tiers re-derived" when source change has caused_by_audit_id descendants

**Behavioral commitments:**
- Append-only: never edited, never deleted
- Default sort: chronological reverse (most recent first)
- Cascade tagging surfaces via the chip; "show derived writes" toggle (Round 5 commitment #2) — off by default; on for forensic deep-dive — turns derived rows into visible feed entries
- Filter state in URL (deep-linkable)
- Trigram indexes on summary + entity_label power free-text search (migration 21)
- Export CSV: exports current filtered set
- Copy deep-link: copies current URL with filter state

**Edge states:**
- Empty / unfiltered: feed shows all-time recent (paginated)
- No matching results: "No entries match" empty state
- Very long feed: pagination or infinite scroll (50 per page)

**Deferred:**
- Real-time activity stream — rejected (Round 5; different surface)
- "What changed since last visit" digest — rejected (Round 5; different surface)
- PM-scoped audit visibility — rejected (Round 5; admin-only per spec)

---

## 4. Feature commitments by slice target

Across all six rounds, ~30 feature commitments accumulated. Listing here so CC schedules them correctly.

### Commitments landing in this slice (redesign-implementation):

From Round 4:
- `user_pinned_projects` table (migration 17)
- `user_project_visits` MRU table (migration 17)
- `scenarios.recommended` boolean (migration 18)
- `drop_reason` enum extension with `superseded_by_copy` (migration 18)

From Round 5:
- Cascade tagging at write-time via `caused_by_audit_id` (migration 20) — also applies retroactively to all action layers; CC instruments existing actions during this slice
- `firm_settings_history` versioning (migration 19)
- Search trigram index on audit_log (migration 21)

From Round 6:
- Single-page Cost Build architecture (collapse 3 separate pages into 1)
- Section-with-drill-down pattern across all sections
- Multi-tier as primary spatial axis
- Cost stack horizontal at top with multi-tier side-by-side

From Bulk Raw correction:
- Bulk Raw schema (migration 22): bulk_raw_section_meta, bulk_raw_categories, bulk_raw_ingredients
- Cross-section deposit lifecycle (migration 23)
- Mode selector (cm_sources / dps_sources / customer_supplies) with conditional Bulk Raw section visibility
- Conditional cost stack RAW row when raws_mode = dps_sources

From audit + Round 6 closeout:
- Light mode as default (per UX_BACKLOG entry)
- Dark mode token tuning (per UX_BACKLOG entry)

### Commitments deferred to specific later slices:

To Slice 9.5 (already independently scoped):
- `quote_warnings` table + validation engine
- UNDERPRICED chip + completeness gaps + anomaly detection
- "What's my move" inbox surface (after Slice 9.5 + signal coverage validation; lands in a follow-up slice)

To Slice 11 (PDF generation):
- `quote_snapshots` table + snapshot-on-send pattern (Round 3 commitments #1, #11)
- `pdf_layout` parameter on send action (Round 3 commitment #9)
- `<PdfPage>` boundary-guard build invariant (Round 3 commitment #8) — assertion lands as part of redesign-implementation; PDF render path uses it

To Slice 12 (Mark-Accepted):
- Sent-version pinning in Mark-Accepted action (Round 3 commitment #2)
- Quote-level warning override audit pair `blended_below_floor_override_*` (Round 3 commitment #3)
- HubSpot writeback async UI + retry (Round 3 commitment #4)
- Sibling auto-drop on accept (Round 3 commitment #5)
- Frozen Cost Build during pending approval (Round 3 commitment #10)
- Send-event snapshot logic (Round 3 commitment #11)

To Slice 13 (Deal organizer scaffolding — partially obsolete; redesign-implementation supplants the visual work, Slice 13 reduces to filter/sort/bulk-action functional implementation):
- This slice does the Deal organizer rebuild; Slice 13's scope reduces

To Slice 14 (Scenarios + New Version + New Scenario):
- This slice scaffolds the visual scenario architecture (cards, version chains, drop_reason badges); Slice 14 fills in functional logic

To Slice 15 (Copy Operations):
- This slice doesn't scaffold; copy ops are not a redesign target. Slice 15 ships fresh against the design system this slice establishes.

To Slice 16 (Markup Admin + Audit Log already in scope of original Slice 16 — this slice supplants visually; Slice 16 reduces):
- This slice does the Audit log read view rebuild; original Slice 16 scope reduces to Management Dashboard + functional audit-log logic

To post-Slice-12 polish (UX_BACKLOG):
- Mini-stack engagement instrumentation on Cost Build section rows (Round 6 designer notes pushback #1)
- Cost stack lens toggle (Round 6 designer notes pushback #3) — only if real PM use surfaces confusion
- Per-section approval workflow (Round 6 deferred)
- Inventory pool cross-project surface (Round 6 deferred)
- Empty-state line templates (Round 6 deferred)

To Slice 17 / real-user test:
- Auth provider migration: Microsoft 365 SSO primary, Google secondary (per `/home/claude/nexus-design/auth-provider-migration.md`)

### Schema commitments NOT migrated in this slice (cross-references):

For CC to track timing:

- `quote_warnings` (Slice 9.5)
- `quote_snapshots` (Slice 11)
- `quote_snapshots.pdf_layout` column (Slice 11)
- `blended_below_floor_override_*` columns (Slice 12)
- `hubspot_writeback` table (Slice 12)
- `production_runs` and `formula_yield_reconciliations` tables (Slice 13.5+ polish; per Bulk Raw correction)

---

## 5. Surface separation — what gets removed

Critical audit finding: Pricing Control Summary content currently duplicates across 5 surfaces. This slice consolidates.

**The Pricing Control Summary** (per-tier table with revenue/cost/margin/status/tier-adj inheriting global, plus per-tier cost breakdowns showing Packaging/Production/Freight rows with % of cost):

**Today appears on:**
- Setup page (incorrect; remove)
- Packaging input page (incorrect; remove with page consolidation)
- Production input page (incorrect; remove with page consolidation)
- Freight input page (incorrect; remove with page consolidation)
- Costing Sheet (correct; preserve)

**After this slice:**
- Costing Sheet ONLY

The Costing Sheet absorbs the Pricing Control Summary as part of its rebuilt cost stack panel + margin verdict band architecture. Other surfaces link to Costing Sheet via "Open Costing Sheet →" buttons (existing pattern preserved on Setup; Cost Build adds it).

**Why this matters:** the 5-surface duplication isn't just visual noise; it's a surface-separation principle violation. Each duplication implies "this is also a place to review pricing." The unified architecture commits to one place per question:
- **Setup**: "what is this quote about?" (SKUs + tiers + notes)
- **Cost Build**: "what does it cost to make?" (per-section component-level inputs)
- **Costing Sheet**: "is this priced right?" (margin verdict + cost stack visualization + per-SKU breakdown)
- **Customer view**: "what does the customer see?" (PDF preview)

Each surface owns one question; consolidation enforces the discipline.

---

## 6. Smoke-test scope

For Edward + CA to verify before merging redesign-implementation slice. Organized by sub-slice (RI.0 through RI.8 — CC sequences but here is the suggested order for smoke):

**RI.0 — Token foundation:**
- CD's `:root` block (paper / ink ramp + `--rule` + `--accent` + display/sans/mono font stacks, OKLCH) ported verbatim into `globals.css` or `src/styles/design-tokens.css`. Source for canonical values: `docs/design-prototypes/index.html` (consolidated `:root` block) and per-round CSS files in `docs/design-prototypes/source/round-1/styles.css`, `source/round-2/app/r2/styles.css`.
- Tailwind v4 `@theme` configured to expose CD's tokens to utility classes
- Newsreader / Instrument Sans / JetBrains Mono loaded via `next/font` (replacing any prior font-loading approach)
- Dark-mode `--ink-4` luminance adjustment per UX_BACKLOG entry: +15-20% luminance lift in dark theme
- Light mode confirmed as default at app shell level
- Smoke test: open existing Slice 9.4b Costing Sheet (per-SKU breakdown row) — verify column-header typography becomes JetBrains Mono small caps, sparkline colors pick up `--accent` and `--ink-3` via CSS variables, margin/competitive verdict pills shift to OKLCH-tuned palette. The 9.4b surface itself isn't being rebuilt in this slice, but it's the cleanest smoke target for verifying tokens flow through to existing components.
- Document drift: any token CC adds beyond CD's :root must be flagged in PR description with rationale (e.g., dark-mode override ramps not present in CD's source); Designer reviews additions

**RI.1 — Schema migrations + scaffolding:**
- All 7 migrations apply cleanly
- Verify scripts in scripts/verify/ for each migration round-trip
- Existing functional behavior unchanged (no UI rebuilds yet; only schema)

**RI.2 — Two-tier rail + Home (Tier 1 critical):**
- Outer rail renders on every PM-facing surface
- Pinned + Recent persist (pin a project, navigate elsewhere, return — pinned still there)
- Recent updates on project visits
- Home page shows project list + filter chips (no inbox; placeholder for inbox section)
- Empty state, sparse state, healthy state all render correctly

**RI.3 — Project Detail rebuild:**
- All three states render: just-created / active multi-scenario / accepted closed-won
- Next-action card shows correct state per project status
- Scenario cards render with version chains
- Activity rail filtered to project scope
- Lineage panel shows copied_from_quote_id traceability

**RI.4 — Cost Build unification + Bulk Raw:**
- Three separate pages → unified single page
- Cost stack header at top, multi-tier side-by-side
- Section-with-drill-down works for all sections
- Mode selector controls Bulk Raw visibility + RAW row in cost stack
- Deposit badges render on Production + Bulk Raw section headers
- Production drill-down: consequential toggles with consequence text live-update
- Production drill-down: post-production reconcile sub-section with dual yield events (Production yield + Formula yield)
- Freight drill-down: per-line treatment toggle works; customs sub-card on DDP-only lines

**RI.5 — Costing Sheet rebuild:**
- Cost stack panel renders with proper visual treatment
- Margin verdict band with target/floor markers
- Per-SKU breakdown row preserved (matches 9.4a/9.4b)
- Pricing Control Summary content REMOVED from Setup, Cost Build sub-pages

**RI.6 — Customer view + Mark-Accepted scaffolding:**
- Visual shells render
- Boundary-guard build assertion fires correctly (try importing a costing module into PdfPage tree → build error)
- Sent-vs-draft mismatch banner renders when applicable

**RI.7 — Admin pages:**
- Firm settings: read state + edit state + portfolio-effect strip + history rail
- Markup defaults: inline-edit table + propagation rule prose + Slice 9 warning REMOVED
- Audit log read view: chronological feed + filter chips + cascade chips + default-collapsed diffs

**Cross-cutting smoke:**
- Light mode is default
- Dark mode toggle works; legibility on lowest-contrast tier is acceptable in both modes
- Cost stack live animation works (input change → bars animate)
- All existing functional behavior preserved (cost calculation, action layer, audit logging, etc.)
- No regressions in 9.x feature set (per-tier adjustments, sell-price overrides, client target benchmarks, sparkline)

**Performance smoke:**
- Cost Build page loads in <2 seconds with realistic data (12 SKUs, 4 tiers, all sections populated)
- Cost stack live animation maintains 60fps during typical input edits
- Audit log read view paginates smoothly

**Accessibility smoke:**
- Keyboard navigation works through outer rail + inner rail
- Drawer open/close via keyboard
- Focus states visible

---

## 7. Open questions for build

Items that surface during implementation and need decisions:

**Q1. Where do per-section deposit fields live structurally?**
- Option A: separate `cost_section_deposits` table keyed by (quote_id, scenario_id, section_kind ENUM) — cleanest, one place for all deposit lifecycle
- Option B: section-specific meta tables (`packaging_section_meta`, `production_section_meta`, `bulk_raw_section_meta`) — more typed but more tables
- Architect call during migration 23 design

**Q2. How does mode-selector state interact with `customer_ships_raws` Production toggle?**
- Round 6 + Bulk Raw correction shipped both surfaces; Bulk Raw correction's mode selector includes "Customer supplies raws" which is functionally redundant with the Production toggle
- **This is a visual/UX reconciliation question — Designer's authority during build, not CC + architect.** CC verifies against CD's Bulk Raw correction prototype. If prototype shows both controls active simultaneously, both ship (with potential confusion accepted). If prototype shows the Production toggle visually disabled or merged when mode-selector picks customer-supplies-raws, CC implements that. If prototype is ambiguous, CC invokes Designer; Designer either extends CD's vocabulary directly or escalates to Edward + CA for targeted CD clarification before CC builds the section.

**Q3. Cost Build URL: `/cost-build` or `/cost`?**
- Today: `/packaging`, `/production`, `/freight`
- Target: single page replacing all three
- URL choice: minor UX call — `/cost-build` is descriptive; `/cost` is shorter
- CC picks; verify routing breadcrumbs render naturally

**Q4. Should Slice 13 be dropped entirely now that redesign-implementation rebuilds the deal organizer?**
- Original Slice 13 scope: project list + filter chips + bulk actions
- Redesign-implementation's Tier 1 scope covers project list + filter chips
- Bulk actions: not yet specified visually; could ship as part of redesign-implementation or stay as Slice 13 follow-up
- Edward + CA decide at sequencing time

**Q5. Realtime presence in rail — Slice 8.5 already shipped realtime; how does presence visualize in the new rail?**
- Round 4 mentioned presence chip on project detail header
- Round 6 not in scope
- Additive feature; design treatment likely: small dot on project glyphs in outer rail when other users active on that project; expanded on hover
- Backlog as polish; don't block redesign-implementation

**Q6. Should the inbox section in Home render as a placeholder banner ("Inbox shipping with validation engine") or be entirely hidden until Slice 9.5 + inbox-launch slice?**
- Placeholder communicates intent (PM knows it's coming); hidden is cleaner
- Placeholder probably wins — sets expectation, signals roadmap awareness
- Confirm at smoke

---

## 8. Estimated work breakdown

For CC's planning. Approximate; refine during build.

| Sub-slice | Scope | Estimated |
|---|---|---|
| RI.0 | Token foundation: CD's `:root` ported into `globals.css` / `design-tokens.css`, Tailwind v4 `@theme` configured, Newsreader + Instrument Sans + JetBrains Mono via `next/font`, dark-mode `--ink-4` tuning, light mode default | 1-2 days |
| RI.1 | Schema migrations 17-23 + verify scripts | 2-3 days |
| RI.2 | Two-tier rail + Home rebuild | 3-4 days |
| RI.3 | Project Detail rebuild | 3-4 days |
| RI.4 | Cost Build unification (3 pages → 1, sections-with-drill-down, cost stack horizontal, Bulk Raw section + mode selector, post-production dual yield) | 6-8 days |
| RI.5 | Costing Sheet rebuild (cost stack panel + margin verdict band) | 3-4 days |
| RI.6 | Customer view + Mark-Accepted visual shells + boundary-guard build assertion | 3-4 days |
| RI.7 | Admin pages (firm settings + markup defaults + audit log read view) | 3-4 days |
| RI.8 | Smoke + bug fix + design polish + light/dark mode tuning verification | 3-5 days |

**Total: 27-38 days of build effort.** Probably 5-7 weeks at AI-assisted velocity (CC + Edward + CA + architect + Designer handoff cycles). Smoke-test cycles add overhead but catch issues early.

This is a substantially-sized slice. CC + Edward should expect multiple PR cycles, multiple smoke walks, and probably one or two course-corrections during build (the same mid-slice catches that surfaced during 9.3 / 9.4b).

**Why RI.0 lands first.** Designer's calibration audit on Slice 9.4b surfaced the foundational issue: CD's design tokens are not in the codebase at all. `globals.css` has placeholder `--background`/`--foreground` + raw sRGB hex; Tailwind's stock palette is used directly throughout existing components. Asking subsequent sub-slices to "fix tokens locally" creates N divergent reskin commits that all need revert when proper foundation lands. RI.0 commits CD's canonical OKLCH tokens once, then every other sub-slice consumes them. This is the correct sequencing per Designer's recommendation; CA has accepted it.

---

## 9. Deferral decisions — what does NOT ship in this slice

Captured here so they're visible:

**Functional features deferred to later slices:**
- "What's my move" inbox surface (Round 4) — requires Slice 9.5 signal coverage validation
- Quote-level client target competitive verdict (Round 6 implication) — Slice 9.4c
- Validation engine + warnings (Round 5 + Slice 9.5)
- Customer view full functionality + recommended-tier highlight + Lines Requiring Review (Slice 10)
- PDF rendering (Slice 11)
- Mark-Accepted full functionality (Slice 12)
- HubSpot writeback (Slice 12)
- Scenarios full functionality (Slice 14)
- Copy operations (Slice 15)
- Management Dashboard (Slice 16)

**Polish features deferred to UX_BACKLOG / Slice 13.5:**
- Mini-stack engagement instrumentation
- Cost stack lens toggle
- ⌘K global search
- Cross-project picker scaling for 60+ historical projects
- Recent-sources memory in cross-project Copy picker
- Forward-dated firm settings (Schedule…)
- Bulk import deal action
- Per-section approval workflow
- Inventory pool cross-project surface
- Empty-state line templates pre-fill

**Architectural decisions deferred:**
- Per-client target/floor overrides (Round 5 considered/rejected; defer until 3rd request)
- Per-PM markup defaults (Round 5 considered/rejected)
- Hosted customer-view URL (Round 3 considered/rejected; revisit Slice 17 user testing)
- NetSuite v2 integration (separate roadmap)
- Auth provider migration to Microsoft 365 (Slice 17 + dedicated 1-hour task)

**Documentation updates required as part of this slice:**
- CLAUDE.md: add design-system token references, surface-separation principle, deposit lifecycle pattern, Bulk Raw schema notes
- SPEC.md: update §3 Authentication for Microsoft 365 SSO assumption (per auth-provider-migration.md), update slice plan to reflect redesign-implementation insertion between 9.5 and 10, update FR-13 (Deal Organizer) to reference Round 4 design as canonical reference
- UX_BACKLOG.md: append Round 6 backlog entries (light mode default, mini-stack instrumentation), append redesign-implementation deferrals listed above
- New: `docs/design-system.md` capturing visual tokens, color palette, typography scale, spacing rhythm, component conventions established across rounds — single source of truth for future visual work

---

## 10. Frame for CC

CC: this is the largest single slice in the build to date. It rebuilds 12 surfaces, runs 7 schema migrations, applies cascade tagging retroactively to existing action layers, and consolidates content that's accumulated across 5 surfaces incorrectly into 1 surface correctly.

**Approach recommendations:**

1. **Read all six round designer-notes + data-source maps before writing any code.** This brief synthesizes; the source materials carry detail this brief compresses. Especially Round 4 (rail proposal), Round 6 (Cost Build architecture), Bulk Raw correction (mode selector + deposit lifecycle). For Rounds 1, 2, 2.5, read the un-bundled source at `docs/design-prototypes/source/round-N/` (CD shipped JSX/CSS/data alongside the bundled HTMLs).

2. **RI.0 lands first. Token foundation before any other visual work.** CD's `:root` block in `index.html` plus per-round CSS files contain the canonical OKLCH design tokens. Port them verbatim into `globals.css` / `src/styles/design-tokens.css`. Configure Tailwind v4 `@theme` to expose them. Load fonts via `next/font`. Implement dark-mode `--ink-4` luminance lift per UX_BACKLOG. Smoke against existing Slice 9.4b surface to verify tokens flow through. Until RI.0 ships, no other sub-slice can claim fidelity-complete — Designer's calibration audit explicitly flagged this as the foundational gap.

3. **Migrations land before UI rebuilds that depend on them.** Schema is foundational; UI changes that depend on new tables (Bulk Raw, deposits, scenarios.recommended) can't ship until the migrations land. RI.1 happens after RI.0 and before RI.2-RI.7.

4. **Sub-slice per major surface, not per migration.** Each Tier 1 surface (Home, Project Detail, Costing Sheet) is its own sub-slice with its own smoke test cycle. Don't bundle Tier 1 surfaces; they're each substantial.

5. **Use the architect agent.** This slice has many cross-cutting decisions (deposit table shape, mode selector reconciliation with `customer_ships_raws`, audit-log cascade tagging retroactive instrumentation). Architect should sign off on each major architectural decision before CC commits to it.

6. **Use the Designer agent.** Per §0.5 fidelity protocol, Designer audits every Tier 1 and Tier 2 surface before PR. Designer reads CD's prototype source directly (un-bundled source for Rounds 1, 2, 2.5; designer notes + data-source maps for Rounds 3, 4, 5, 6). Build Designer into the workflow from RI.0 onward.

7. **Smoke-test discipline matters.** This slice is large enough that bugs accumulating across sub-slices become hard to triage. Smoke test each sub-slice individually before moving to the next.

8. **Document drift as you go.** When implementation reveals a design-spec mismatch, route to Designer first; Designer escalates to CA + Edward when novel design judgment is needed. Don't fix silently. Patterns surfaced during 9.3 / 9.4b apply here too — wrong-surface catches, scope-creep catches, role-as-affordance catches.

9. **Light mode default + dark mode token tuning** lands during RI.0 (token foundation), verified during RI.8 (final polish). Don't defer the tuning to RI.8 expecting to "fix it at the end" — RI.0 implements both light and dark token sets per CD's source + the +15-20% `--ink-4` luminance lift; RI.8 verifies legibility holds across all rebuilt surfaces.

**Expected delivery cadence:**
- RI.0 (token foundation) → smoke against existing Slice 9.4b surface → commit + PR + merge. Designer audits the rendered Slice 9.4b surface post-token-port to verify tokens flow through correctly.
- RI.1 (migrations) → smoke → commit + PR + merge
- RI.2-RI.7 (UI rebuilds) → each sub-slice individually → smoke per sub-slice → consolidated PR at slice end OR per-sub-slice PRs (CC + Edward decide)
- RI.8 (polish + smoke + bug fix) → final smoke pass → final PR

This is multi-PR territory. Single mega-PR is unwieldy.

**Pause points:**
- After RI.0 (token foundation) — Edward + Designer verify tokens render correctly on existing Slice 9.4b surface; this is the calibration moment for the whole slice's visual baseline
- After migrations apply (RI.1 complete) — Edward verifies schema state
- After each Tier 1 surface ships (RI.2, RI.3, RI.5) — Edward smoke walks the surface
- After Cost Build unification (RI.4) — Edward + CA smoke walk together; this is the largest single change
- Before RI.8 — Edward + CA review whole slice; final polish pass
- Before final merge — Edward gives go-ahead

**Surfacing back:**
Visual drift questions go through Designer first (fidelity audit + novel-state extension). Designer escalates to CA + Edward when novel design judgment is required. Architectural drift — workflow-fit questions ("is this how PMs actually do X?"), surface-separation questions ("does this affordance belong on this surface?"), schema-stability questions ("does this commitment match the architectural intent?") — goes directly to CA + Edward; Designer is not in this loop.

The slice is large, but the design system is settled. Build against it.
