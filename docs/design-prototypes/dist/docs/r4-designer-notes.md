# Round 4 · Designer notes

## The rail proposal

The load-bearing decision: **two-tier rail**.

- **Outer rail · 56px** — cross-project. Pinned + Recent as color-coded glyph squares (initials of client name, accent color stable per project). Plus My-deals link, ⌘K placeholder, settings, avatar. Cross-project nav is rare-but-critical; the outer rail is intentionally narrow so it doesn't tax the within-project work it sits next to. Glyphs scale to ~8 squares before they need a "more" affordance — that's roughly the realistic ceiling for "projects I'm actively working this week."
- **Inner rail · 240px** — within-project. Project header (client + deal + stage + synced-ago), scenarios list with margin verdict pips and draft-after-send warnings, expanded surfaces under the active scenario (Setup / Cost build / Costing sheet / Customer view), mini activity feed.

Scenarios live in the **inner rail**, not as page-level tabs. Reasoning:
1. Brief flagged scenario-switching as "constant" — one-click from anywhere matters more than visual real estate on the project detail page.
2. Drilling into a scenario surfaces the surfaces (Setup/Cost build/Costing sheet/Customer view) right under it. Sub-rail expansion under the active scenario means the rail does triple duty: project nav + scenario nav + surface nav. No tab strip needed.
3. The project detail page also shows scenarios as cards. That repetition is intentional — the rail is a switcher; the page is the workspace. Both surface the same data; the page just shows it expanded with version chains.

The 12-active-projects scenario: you don't keep 12 squares in the outer rail. Pinned holds 2-3 ("the deals I'm actively closing"). Recent holds 4 ("the ones I touched this week"). The other 5+ live in the deal organizer one click away. ⌘K eventually closes the gap; until then, the deal organizer is search.

Admin nav is **role-gated at the bottom of the outer rail**. Maya (PM) sees Settings only. An admin would also see Audit log + Markup defaults stacked above it. Same outer-rail pattern; just role-conditional.

---

## Three pushbacks

### 1. The "what's my move across all projects" inbox is the right shape, but the source data isn't ready in v1

The brief steered me toward "show me what I have, not predict what I want." I held that line — the 5 signal kinds in the inbox (`override_pending`, `customer_silent`, `supplier_quote`, `stage_drift`, `fresh_setup`) are all derivable from data we already compute or commit to compute by Slice 9.5.

**But:** `awaiting_supplier_quote` isn't a thing in the schema yet. It's a SPEC FR-7 backlog item. The inbox design assumes it lands in 9.5 along with the rest of `quote_warnings`. If 9.5 slips, the inbox shows 4 signal types instead of 5 and that's fine — but if `quote_warnings` slips by more than that, the inbox is half-empty and the surface loses its punch.

Pushback: don't ship the inbox until the validation engine that feeds it is past 80% of its signal coverage. Better to ship the project list with row-level next-action chips and ship the inbox in 4.5 once the engine catches up than to ship a half-functional inbox now.

### 2. Scenarios-in-rail vs scenarios-as-tabs is a real UX tradeoff and I picked rail; the case for tabs is: dropped scenarios

Dropped scenarios in the rail are dimmed but visible. Cumulatively a project might accumulate 4-5 dropped scenarios over its lifetime (explored, accept_sibling, draft_at_accept, superseded_by_copy). The rail starts to feel cluttered.

The defense is "rail-level toggle to hide dropped" — easy to add, but it's a setting and users won't find it. Real answer is **collapse dropped scenarios into a "+2 dropped" disclosure under the active list**. I designed for it but didn't ship it in this round; would land in 4.5 if scenario count gets uncomfortable in real use.

Pushback: if Edward's gut says scenarios should be page-level tabs because the rail will feel busy, that's defensible. The cost is one extra click per scenario switch. Worth a quick A/B against a real PM if we have time.

### 3. The cross-project picker assumes 4 historical projects to pick from; at scale (Maya 18 months in, 60+ accepted projects) the two-pane layout with search needs to grow up

The two-pane "projects on left, quotes on right" is fine at 4-12 projects. At 60+ it needs:
- Default-sort by recent + accepted-pinned-to-top
- Filter by SKU label (SPEC says we'll search SKU labels — but the picker UI doesn't surface that yet)
- A "recently used as source" memory — PMs reuse the same 2-3 templates over and over

Pushback: design the picker now for the 60+ case, not the 4 case. The simple two-pane is correct for v1 but we should commit to the affordances above as a near-term iteration, not a "if needed later."

---

## What I considered and rejected

### Kanban-by-stage as the deal organizer's room
Kanban surfaces stage but loses urgency. The "what's my move" inbox does urgency much better. Kanban also implies the PM moves cards; in Nexus, stage is a HubSpot read, not a PM action. Kanban would be lying about agency.

### Combining the inbox and the project list into one sorted feed
Tempting — one list, sorted by urgency, project metadata inline. Pulled back because: scan and act are different jobs. The inbox is for "what's blocking me in the next hour"; the project list is for "what's my book of business." Mashed together you lose the at-a-glance scan. Two rooms, different jobs.

### Scenarios as a pure tab strip on the project page (Round 1 / SPEC FR-2 default)
Considered seriously. Lost on the rail-level switching argument — tabs in the rail are one-click from any surface; tabs on the page require getting to the project page first. For "primary scenario at 25k vs aggressive at the same volume" comparison, the second click matters.

### Wizardy onboarding for first-time PM
Brief errs toward "empty + clear CTA." I agreed. Onboarding wizards are a tax on every subsequent login (the muscle memory of "click past the wizard") to fix a problem that exists for one session. The "Import from HubSpot" CTA on the empty state IS the onboarding. If a PM can't read that, more wizard isn't the fix.

### A "smart" Next-action that re-orders projects by predicted priority
Brief explicitly excluded this. I held the line. The inbox surfaces existing system signals; nothing is predicted.

### Putting Setup in the rail as a surface link under the project
Setup is locked from Round 1 as a header section on the quote builder. I represented Setup as a surface link in the inner rail anyway — under each scenario, alongside Cost build / Costing sheet / Customer view — because it IS a surface PMs hit, even if its layout is settled. This isn't redesigning Setup; it's giving it nav.

---

## Feature commitments (proposed)

### 1. `user_pinned_projects` and `user_project_visits` tables
The outer rail's Pinned + Recent groups need persistent state. Pinned is an explicit set, Recent is an MRU capped at 4. Small, bounded, no ambiguity.

### 2. `scenarios.recommended` boolean
The "★ Primary" treatment on the active scenario card needs a flag. Today the brief implies `scenario_label = 'Primary'` carries it, but that's a label match — fragile. Adding a boolean is cleaner; defaults to `true` on the first scenario, falsifiable manually if the PM wants to recommend a different sibling. Lets the Next-action card and the rail know which scenario to point at when there's ambiguity.

### 3. Extending `drop_reason` enum with `superseded_by_copy`
SPEC FR-2 currently lists `explored`, `accept_sibling`, `draft_at_accept`. The Copy Scenario "drop current" path needs a fourth value. Trivial.

### 4. The `quote_warnings` engine producing a per-project rollup count for the deal organizer
Slice 9.5 already produces `quote_warnings` rows. The rollup is `count(*) where project_id = X and severity in ('action_required')`. The chip in the project row (`!7 review`) reads this. Calling it out explicitly so it's not lost as a SQL detail.

### 5. The cross-project picker's "recently used as source" affordance
Backlog item. Track `quote.copied_from_quote_id` in reverse — for a given user, the top 5 most-recent source quotes. Surfaces in the picker as a "Recent sources" pinned row. Doesn't need to ship in v1; should ship before 60+ historical projects become normal.

---

## Carries forward

- **NULL-as-empty-signal** held — the project row's margin column shows `—` not `0%` for incomplete drafts.
- **Internal-vs-customer visual grammar** — none of the workspace surfaces are customer-facing, so internal-only color (`--internal`) wasn't needed. The accent purple stays reserved.
- **Helper text earns its place** — every panel lead reduces a click. The Next-action card's headline + detail does it; the field-bucket preview's lead copy does it; the draft-after-send banner explains the pinning rule in one sentence rather than narrating.
- **Verdict-as-room-organizer flips per surface** — Deal organizer: "what's my move" + project list (twin rooms). Project detail: Next-action card. Copy ops: field-bucket transparency. Each surface picked deliberately.
- **Sibling-primary action layout** — the drop-or-keep modal is two cards side-by-side, not nested radios. Same vocabulary as Mark-Accepted's two-button forced-choice.
- **Summary vs tuning surface separation** (new from 9.4b) — Deal organizer is **summary** (read-only review, no input affordances on rows). Project detail is **summary at the page level** but the scenario cards lead into tuning surfaces via Open / + New version. The Copy Ops modal is **tuning** — full input.

## Out of scope, deferred to Round 4.5

- Sparse + empty projects detail (single + accepted shipped; the brief asked for them)
- Cross-project picker's "Recent sources" affordance
- Scenario hide-dropped disclosure (when scenario count gets uncomfortable)
- Admin's view of the outer rail (role-conditional Settings + Audit log)
