# Brief: Rest-of-App Fidelity Sweep

**Status:** DRAFT — pending Edward review
**Date drafted:** 2026-05-13
**Companion docs:**
- `docs/rest-of-app-source-completeness.md` — source-on-disk
  verification (all 5 surfaces GREEN per Path A disposition)
- `docs/audit-findings/section-6b-*.md` — §6.b Step 11 audit
  findings (22 files; 6 landed in §6.b, 16 banked for this sweep)
- `CLAUDE.md` Patterns 27 (two-layer manifest), 28 (briefs are
  scope contracts), 30 (canonical CSS verbatim), 32 (pre-prod
  tolerance), Pattern-28-vs-rename-canon collision

---

## §0.5 · Schema verification (Pattern 22 / Pattern 25)

**Status: CLEAR — 2026-05-13.** Step 0 verification pass fired
post-approval per the standing Pattern 25 protocol. All schema
entities the brief touches were verified against current
`src/db/schema.ts`. No mismatches surfaced; no DDL required for
the sweep.

Verified entities per surface:

- **Costs** — `quote_skus`, `quote_tiers`, `packaging_inputs`,
  `production_inputs`, `freight_inputs` (all from §6.b scope;
  unchanged here).
- **Pricing** — `quote_skus`, `quote_tiers`, `quote_sku_tiers.
  sell_price_override` (L517), `quote_sku_tier_targets.
  client_target_price_per_unit` (L582; Slice 9.4b),
  `markup_defaults`, `quotes.target_margin_pct` (L252; per-quote
  override), `quote_tiers.tier_price_adj_pct` (L371),
  `quotes.global_price_adj_pct`.
- **Quote (Customer view)** — `quotes.customer_facing_notes`
  (L255), `quotes.internal_notes` (L256), `quote_skus.notes`
  (L431).
- **Mark Accepted** — `quotes.customer_accepted_at` (L288),
  `quotes.status` enum, `quotes.is_recommended` (L269; scenario-
  level recommended), `quote_tiers.recommended` (L378; tier-level
  recommended, §6.b Step 5).
- **Home** — `quotes.scenario_label` (L224), `projects`,
  `user_surface_visits` (L1318; Slice RI.9 Home Resume card),
  `audit_log`.

The sweep is **structural / visual + cross-surface primitive
extraction only**. No new columns, no migrations, no schema
mutations. Action-layer changes scoped to canonical-class-name
adoption (existing actions stay; their JSX-side renderers
update). Pattern 22 / §0.5 gate clears.

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract.

### Dual-canon declaration

Every surface in scope post-dates the design rounds that originally
defined it. RI.9 (May 2026) introduced nav primitives — eyebrow,
back-link, action cluster, nextMoveBanner — and the RI.8 surface
rename canon (Cost build → Costs, Costing Sheet → Pricing, Customer
view → Quote) landed on the same timeline. Both shipped via
implementation refresh, NOT via design-round refresh. The R2 / R3 /
R4 / R6 design sources predate them.

This sweep operates under a **dual-canon discipline**:

- **Chrome canon = implementation + R7a/R7b designer notes.**
  Eyebrow, back-link, action cluster, nextMoveBanner, surface
  rename ("Costs" / "Pricing" / "Quote" / "Mark Accepted"). Read
  from `src/lib/nav/surface-meta.ts`, `src/components/nav/*`,
  `src/styles/r7b-setup.css` (for `.r2-eyebrow`, `.r7b-head`,
  `.btn` primitive), and the RI.9 implementation patterns shipped
  on the per-surface page-head components
  (`src/components/pricing/pricing-page-head.tsx`, etc.).
- **Body canon = per-surface design source.** Tables, drilldowns,
  cards, content layout, copy, inline-edit affordances. Read from
  the per-round designer notes + data-source map + canonical CSS
  per the surface canon mapping table below.

**Working test:** is the element being audited a navigational
chrome primitive (lives in `src/components/nav/` or the
surface-meta layer)? Chrome canon. Is it the surface body's
content register (table, card, drilldown, cell)? Body canon.

### Surface canon mapping table

| Surface | Body canon round | Body source files | Body CSS file | Designer notes | Data-source map |
|---|---|---|---|---|---|
| **Costs** | R6 | `r6_*.jsx` + `r6_data.js` + `r6_data.bulk-raw.js` | `6styles.css` (already migrated to `src/styles/r6-cost-build.css`) | `r6-designer-notes.md` | `r6-data-source-map.md` |
| **Pricing** | R2 | `r2_costing.jsx` + `r2_shell.jsx` + `r2_data.js` + `r2_datamap.jsx` + `r2_notes.jsx` | `2styles.css` | `r2-designer-notes.md` | `r2-data-source-map.md` |
| **Quote** | R3 | `r3_customer-view.jsx` + `r3_data.js` | `3styles.css` | `r3-designer-notes.md` (or `round-3-designer-notes.md` — same content) | `r3-data-source-map.md` |
| **Mark Accepted** | R3 | `r3_mark-accepted.jsx` + `r3_data.js` | `3styles.css` (shared) | `r3-designer-notes.md` (shared) | `r3-data-source-map.md` (shared) |
| **Home** | R4 | `r4_organizer.jsx` + `r4_project-detail.jsx` + `r4_rail.jsx` + `r4_copy-ops.jsx` + `r4_data.js` | `4bstyles.css` | `r4-designer-notes.md` | `r4-data-source-map.md` |

Chrome canon is uniform across all 5 surfaces: RI.9 nav primitives
+ R7a/R7b designer notes. The brief doesn't re-document chrome
canon per-surface; per-surface dimensions focus on body register.

### Surface rename canon override

Per the Pattern-28-vs-rename-canon collision discipline banked in
CLAUDE.md (§6.b Step 11 audit Finding 10): when design source copy
refers to a surface by its OLD name (e.g., R3 says "Customer view"
in helper text or back-links), the rename canon wins. R2 / R3 / R4
designer notes ALL predate the rename canon and use the old surface
names throughout. **Apply rename canon to surface references in
production copy; preserve design-source copy verbatim for
concept references (math layer naming, audit-log keys, schema
columns).** The brief makes this explicit so audit doesn't re-flag
the same gaps the §6.b sweep already arbitrated for Setup.

### Pre-known findings carried into the sweep

From §6.b Step 11 Designer audit (16 of 22 banked) and Edward smoke
pre-PR observations:

**Cross-surface primitive extraction (audit findings 17, 18, 22):**
- **`.calc-display` primitive** — modal margin block fully
  inline-styled (§6.b Finding 17). Cross-surface candidate: any
  cell rendering "calculated, display-only" register
  (Costs cost-stack rows, Pricing per-tier blended margin, Mark
  Accepted blended-margin verdict).
- **`.warn-band` primitive** — modal SKU dup-check warn band
  fully inline-styled (§6.b Finding 18). Cross-surface reuse:
  Slice 9.5 validation surfacing + Mark-Accepted sent-vs-draft
  mismatch + Pricing below-floor warning band + scenario-name
  uniqueness validation (UX_BACKLOG entry).
- **`.r7b-empty-state` class** — empty state grammar (§6.b
  Finding 22). Cross-surface: SKU table, tier table, Pricing
  tier table when no tiers, future Cost-build sections with no
  inputs.

**Token-discipline migrations (audit findings 01, 03, 04, 05 type):**
- Token-violations in remaining hardcoded `gray-*` Tailwind across
  rest-of-app surfaces. §6.b landed the SKU overflow menu + Reassign
  panel + AddAssemblyButton inline form. Sweep does the same pattern
  across Pricing inline-edit cells, Mark Accepted action cluster,
  Customer view PDF preview affordances, Home Resume card chrome.
- Modal styling primitives extracted to canonical class register
  (the inline-styled blocks in the Add-product modal — margin row,
  warn band, FSC trio — should be primitive classes for cross-modal
  reuse).

**Cost build seed findings (Edward smoke pre-PR):**
1. **Cost build page chrome missing eyebrow + back-link.** §6.b
   migrated Costs path-B (Costs path-B 1-5/5 commits) but the
   page chrome (`CostsHeader` in `src/components/costs/`) should
   be re-verified against canonical R7b head structure for
   consistency with Setup's full eyebrow + back-link grammar.
2. **Cost build page title rename canon application.** Some
   legacy "Cost build" copy may remain in Costs surface
   components (drilldown helpers, action labels, etc.). Sweep
   verifies + corrects per RI.8 rename canon.
3. **Scenario name inline edit affordance.** UX_BACKLOG entry
   (Pattern 29 read↔edit on the eyebrow variant label). If the
   sweep touches the eyebrow primitive cross-surface, fold this
   in; otherwise stays as its own future slice.

**Pricing seed findings (Edward, pre-brief):**
4. **Cost stack widget on Pricing, not in R2 design canon.**
   Current Pricing surface renders a cost-stack widget (likely
   carried over from an earlier era when surface responsibilities
   between Costs and Pricing weren't crisp). R2 design canon scopes
   cost construction to the Costs surface; Pricing's room is the
   verdict band + per-cell pricing.

   **Primary disposition:** strip the cost stack widget from
   Pricing per R2 surface canon — cost construction lives on
   Costs only. **Verification step:** read R2 designer notes for
   explicit "Pricing intentionally does not show cost stack"
   commitment. If R2 is silent on the question, Edward pings CD
   for one-line confirmation before strip lands.

   **Alternative disposition** (decided at amendment-commit time,
   not sweep-finding time): if PM workflow audit during the sweep
   reveals real sanity-check value in cost-stack-on-Pricing,
   replace the full stack with a **mini-stack reference** —
   compact, read-only, points back at Costs as the operational
   home (precedent: Setup's cost-stack mini-reference pattern,
   if/when that lands). PM-facing copy makes the dependency
   explicit: "cost construction on Costs · this is read-only."

   Disposition gate: this finding is dispositioned DURING the
   sweep (not pre-approved at brief time) since the workflow
   audit + R2-notes verification both happen in-step.

**Already-banked v1.1 entries that may touch the sweep scope:**
- Drag-and-drop nesting (leaf into assembly) — Setup
- Attach existing leaf via assembly drawer — Setup
- Cross-surface autosave refactor (blur+Enter pattern)
- Cross-surface numeric input step attribute audit
- Multi-route shipping support — needs R8 design round before
  implementation, so out of this sweep's scope

---

## §1 · Scope

Five quote-scoped surfaces, each audited against its body canon
+ chrome canon:

1. **Costs** (`/projects/[id]/quotes/[quoteId]/costs`) — R6 body
   + RI.9 chrome. Path-B migration done; sweep is fidelity-audit
   pass + cross-surface primitive extraction.
2. **Pricing** (`/projects/[id]/quotes/[quoteId]/pricing`) — R2 body
   + RI.9 chrome. Path-B migration pending; sweep performs the
   migration in addition to fidelity audit.
3. **Quote** (`/projects/[id]/quotes/[quoteId]/quote`) — R3 body +
   RI.9 chrome. Path-B migration pending. Customer-view boundary
   guard verification.
4. **Mark Accepted**
   (`/projects/[id]/quotes/[quoteId]/mark-accepted`) — R3 body +
   RI.9 chrome. Path-B migration pending. Pending-state Cost-Build-
   freeze commitment preserved (Slice 12 spec; informs combined
   writebacks slice).
5. **Home** (`/` + `/projects/[id]` + `/inbox` + organizer) — R4
   body + RI.9 chrome. Path-B migration pending; sweep performs
   the migration.

**Cross-cutting:**
- Cross-surface primitive extraction (`.calc-display`, `.warn-band`,
  `.r7b-empty-state`) to canonical CSS register; ship once, use
  across all surfaces.
- Token-discipline cleanup (any remaining hardcoded `gray-*`
  Tailwind in audit findings + parallel-pattern audits across
  surfaces).
- Surface rename canon application sweep (all surface references in
  copy + back-link labels + breadcrumbs).

**Out of scope:**
- Adding new features / affordances beyond what the design source
  already specifies. The sweep is fidelity-against-canon, not
  feature work. v1.1 items stay banked.
- Multi-route shipping (R8 dependency).
- Editor / Phase 2 modal work (Phase 2 catalog parity).
- Per-surface state-machine extensions beyond what design source
  documents.

---

## §2 · Inherited foundations from §6.b + RI.9

- **RI.9 nav primitives** — `Eyebrow`, `BackLink`,
  `<YourNextMoveBanner>`, action cluster grammar, `surface-meta.ts`,
  `surface-routes.ts`. Sweep consumes; doesn't re-implement.
- **§6.b path-B precedent** — canonical CSS imported verbatim
  per surface (`r6-cost-build.css`, `r7b-setup.css`).
- **§6.b modal infrastructure** — `addProductSku` HubSpot-first
  path + `getProductsClient` dev/prod-aware client + Phase 1
  enums in `hubspot-product-options.ts`. Pricing surface consumes
  this when client-target-price affordances ship (Slice 9.4b
  scope; already shipped).
- **§6.b R6 inline-edit read↔edit (Pattern 29)** — read↔edit cells
  already in production for Setup retail bench, tier qty, tier
  label, units_per_pack chip. Sweep can adopt for Pricing per-cell
  sell-price overrides, target-price cells, etc., where canonical
  shows display-only but PMs need inline edit.

---

## §3 · Implementation primitives (per-surface dimensions)

Each per-surface section follows the §6.b two-layer manifest
discipline:

- **STRUCTURAL** — primitives implemented (column grids, drawer
  structures, action wirings)
- **POLISH MATCHED**
  - **Visual** — accent borders, chips, subtitles, color tokens,
    typography, layout grammar
  - **Copy verbatim** — from designer notes + prototype HTML

### 3.1 Costs — fidelity-audit pass

**Body canon:** R6 (`r6_page.jsx`, `r6_cost-stack.jsx`, `r6_section.jsx`,
`r6_packaging.jsx`, `r6_production.jsx`, `r6_freight.jsx`,
`r6_bulk-raw.jsx`, `r6_data.js`).

**Sub-dimensions to audit:**

1. **Page chrome** — verify Costs surface uses canonical eyebrow
   + back-link + action cluster grammar uniformly with Setup post
   §6.b. Edward seed finding 1 + 2.
2. **Cost stack header** (`src/components/costs/cost-stack-header.tsx`)
   — §6.b commit 3/5 migrated this. Re-audit for any drift since
   merge.
3. **Section drilldowns**
   (`src/components/costs/section-with-drilldown.tsx`,
   `packaging-drilldown.tsx`, `production-drilldown.tsx`,
   `freight-drilldown.tsx`, `bulk-raw-drilldown.tsx`) — §6.b
   commit 4/5 migrated. Re-audit.
4. **Drawer toolbar** — canonical `.drawer-toolbar` (nested under
   `.r6-drawer`). §6.b verified. Re-audit.
5. **Cost-stack RAW + PASS rows** — UX_BACKLOG entry "Restore
   cost-stack RAW + PASS rows under per-component split"; check
   if scope creep into this sweep or stays in backlog.
6. **Cross-surface primitive use** — Costs is the highest-density
   surface for `.calc-display` (calculated cells everywhere); the
   primitive extraction lands here.

### 3.2 Pricing — path-B migration + fidelity audit

**Body canon:** R2 (`r2_costing.jsx`, `r2_shell.jsx`, `r2_data.js`,
`r2_datamap.jsx`, `r2_notes.jsx`).

**Sub-dimensions to audit:**

1. **Page chrome** — Pricing's page-head component
   (`src/components/pricing/pricing-page-head.tsx`) verifies eyebrow
   + back-link + action cluster against canonical Setup precedent.
2. **Two-axis verdict pill** (`r2_costing.jsx`: `TwoAxisVerdict`)
   — R2 designer notes Decision X specifies the chip + pill
   register. Verify implementation
   (`src/components/pricing/two-axis-verdict.tsx`) matches.
3. **Margin verdict band** — R2 + R6 carry-forward; sweep verifies
   register parity across surfaces.
4. **Per-cell sell-price overrides** (Pattern 29 inline edit) — R2
   may show display-only cells; sweep verifies whether implementation
   adds Pattern 29 read↔edit or canonical stays display-only.
5. **Client target price affordances** (Slice 9.4b shipped) —
   verify the `quote_sku_tier_targets` read↔edit cells use
   Pattern 29 + canonical token register.
6. **Suggested-GPA banner** (Slice 9.2) — verify banner register
   matches RI.9 banner primitive grammar.
7. **Path-B migration commits** (parallel to §6.b 1-5/5 shape):
   - 1/5: Adopt R2 canonical CSS as verbatim `src/styles/r2-pricing.css`.
     **Footnote on existing partial `r2-pricing.css`:** the current
     file in `src/styles/r2-pricing.css` is a CC-interpreted partial
     written pre-Pattern-30 era (before the canonical-CSS-imported-
     verbatim discipline was banked). Step 1/5 DISCARDS the existing
     partial file entirely and replaces with verbatim
     `docs/design-prototypes/dist/2styles.css` per Pattern 30 working
     discipline. Same pattern §6.b applied for Costs (legacy
     `r6-costs.css` deleted in Costs path-B commit 5/5 in favor of
     verbatim `r6-cost-build.css`). Any nexus-specific overrides
     extracted to a separate `r2-pricing-overrides.css` file if
     needed; canonical file stays verbatim-pristine for diff-against-
     upstream when CD ships R-round refreshes.
   - 2/5: Pricing page chrome → canonical r2-* (or r7b-head where
     dual-canon overlap applies).
   - 3/5: Two-axis verdict + margin verdict band → canonical R2
     register.
   - 4/5: Per-tier table → canonical R2 grid grammar.
   - 5/5: Cleanup — drop dead legacy rules.

8. **Pattern 29 read↔edit on per-cell sell-price overrides — accepted
   nexus extension.** R2 canonical likely renders per-cell overrides
   as display-only cells (PMs would edit elsewhere or via dedicated
   editor). Current implementation uses Pattern 29 read↔edit
   (click-to-edit; blur/Enter commits) for these cells per the
   ergonomic-improvement disposition. **Pattern 39 candidate**
   instance — Nexus-side extension to design canon, accepted not
   violation. Document the delta from R2 in `src/styles/r2-pricing-
   overrides.css` header comment + the per-cell component source
   header. Same disposition applies to other per-cell numeric edits
   on Pricing where the design source shows display-only but PM
   workflow benefits from inline edit (verify per cell during the
   path-B fidelity audit).

### 3.3 Quote — path-B migration + fidelity audit

**Body canon:** R3 (`r3_customer-view.jsx`, `r3_data.js`).

**Sub-dimensions to audit:**

1. **Page chrome** — Quote's host component
   (`src/components/quote/quote-host.tsx`) verifies eyebrow +
   back-link + action cluster.
2. **Customer-view boundary guard** — CLAUDE.md "Customer-view
   boundary guard — build-time invariant" anchors this. Sweep
   verifies build pipeline enforces `<PdfPage>` + descendants
   import zero costing modules. The R3 designer notes Commitment
   #23 reinforces.
3. **PDF preview surface** — render-target parity (browser
   preview matches PDF generator output).
4. **Notes-above-T&Cs ordering** — UX_BACKLOG entry
   "PDF render path" — schedule later in release path; sweep
   defers but flags if visual register needs adjustment.
5. **Path-B migration commits:**
   - 1/N: Adopt R3 canonical CSS as `src/styles/r3-quote.css`
     verbatim.
   - 2/N: Quote page chrome → canonical r3-* / r7b-head.
   - 3/N: Per-tier table + customer-facing notes block → canonical
     R3 register.
   - 4/N: Cleanup.

### 3.4 Mark Accepted — path-B migration + fidelity audit

**Body canon:** R3 (`r3_mark-accepted.jsx`, `r3_data.js`).

**Sub-dimensions to audit:**

1. **Page chrome** — Mark Accepted's host component verifies
   eyebrow + back-link + action cluster.
2. **Pending-state Cost-Build-freeze commitment** — R3 designer
   notes #2 + #10. Verify the pending state UI surfaces the
   freeze visually + the action layer enforces it.
3. **Blended-margin verdict** (R3 Commitment #176: "verdict-as-
   room-organizer" carries to Mark-Accepted) — verify same chip
   + pill register as Pricing two-axis verdict.
4. **Tier card grammar** (per leaf SKU per tier) — `r3_mark-accepted.
   jsx` specifies the cell shape that Mark Accepted renders.
5. **External writebacks placeholders** — the combined writebacks
   slice is sequenced #3 (post-sweep). Sweep verifies the action
   cluster has placeholders for HubSpot deal writeback + NetSuite
   SO push but doesn't wire them.
6. **Path-B migration commits:**
   - 1/N: R3 canonical CSS imported (shared with Quote).
   - 2/N: Mark Accepted page chrome.
   - 3/N: Tier cards + verdict band.
   - 4/N: Cleanup.

### 3.5 Home — path-B migration + fidelity audit

**Body canon:** R4 (`r4_organizer.jsx`, `r4_project-detail.jsx`,
`r4_rail.jsx`, `r4_copy-ops.jsx`, `r4_data.js`).

**Sub-dimensions to audit:**

1. **Outer + inner rail** (`r4_rail.jsx`) — "two-tier navigation
   rail" R4 commitment. Cross-cuts every quote-scoped surface
   already; verify Home-specific affordances (project squares,
   pinned + recents).
2. **Deal organizer** (`r4_organizer.jsx`) — three states (healthy
   / sparse / empty). Sweep audits each state.
3. **Project detail** (`r4_project-detail.jsx`) — multi-scenario
   per project + draft-after-send banners + version chains.
4. **Copy-ops modal** (`r4_copy-ops.jsx`) — copy-from-existing-
   quote workflow.
5. **Resume card + inbox-next-move** (RI.9 step 4-6 + 9 shipped) —
   verify those primitives align with R4 register where they
   intersect with Home surface.
6. **Path-B migration commits:**
   - 1/N: Adopt R4 canonical CSS as `src/styles/r4-home.css` (or
     similar; current is `r5-admin.css` overlapping; clarify scope).
   - 2/N: Page chrome.
   - 3/N: Organizer + project detail.
   - 4/N: Rail.
   - 5/N: Copy-ops modal.
   - 6/N: Cleanup.

---

## §4 · Sequencing

Working sequence per §6.b precedent (per-step smoke checkpoints
optional; full Step N audit at end):

| Step | Work | Owner |
|---|---|---|
| 0 | Schema verification pass (Pattern 22 §0.5) | CC |
| 1 | Cross-surface primitive extraction (`.calc-display`, `.warn-band`, `.r7b-empty-state`) → canonical CSS classes | CC |
| 2 | Costs page chrome migration + fidelity-audit pass | CC |
| 3 | Pricing path-B migration + fidelity audit | CC |
| **2/3 smoke** | **Mid-slice smoke checkpoint** — Edward verifies Setup (shipped in §6.b on main) hasn't regressed after the cross-surface primitive extraction (Step 1) + Costs chrome migration (Step 2) + Pricing path-B (Step 3). Shared-CSS regression risk: extracted primitives + Costs/Pricing CSS sit in the same global cascade as Setup's r7b-setup.css; the smoke confirms no unintended cross-surface drift. | Edward |
| 4 | Quote path-B migration + fidelity audit (customer-view boundary verify) | CC |
| 5 | Mark Accepted path-B migration + fidelity audit | CC |
| 6 | Home path-B migration + fidelity audit | CC |
| 7 | Cross-surface rename canon application sweep | CC |
| 8 | Token-discipline cleanup (audit findings 04, 05 type across surfaces) | CC |
| 9 | Edward smoke pass (all 5 surfaces + cross-surface primitives) | Edward |
| 10 | Designer agent audit (cross-surface fidelity + intra-surface fidelity) — see §6 audit risks | CC + Designer |
| 11 | Audit-followup commits + PR-to-main | CC |

**Sequencing rationale:** primitives first (Step 1) so per-surface
audits in Steps 2-6 can consume them. Step 2 is NOT a "minor
adjustments" pass — it's a full Costs page chrome migration
(eyebrow + back-link + action cluster verification against R7b
precedent) AND fidelity audit against R6 body canon; the §6.b
Costs path-B shipped the body register but the chrome wasn't
explicitly audited against the post-§6.b RI.9 + R7b implementation
canon. Per-surface migrations in dependency-light → dependency-
heavy order (Costs → Pricing → Quote → Mark Accepted → Home).
Cross-cutting rename + token sweeps last (Steps 7-8) since they
touch every surface.

**Mid-slice smoke (2/3 checkpoint) rationale:** the cross-surface
primitive extraction (Step 1) drops new global CSS classes
(`.calc-display`, `.warn-band`, `.r7b-empty-state`) that any
surface — including Setup, which shipped in §6.b and lives on
main — could match. Costs path-B (already on main from §6.b) +
Pricing path-B (Step 3 work) consume the same canonical CSS
tokens that Setup uses. Edward's mid-slice smoke verifies
Setup hasn't regressed after Steps 1-3 land. If regression
surfaces, sweep halts on that surface until isolated; if clean,
Steps 4-6 proceed.

---

## §5 · Risks + open edge cases

- **Cross-surface primitive scope creep.** Extracting
  `.calc-display` / `.warn-band` / `.r7b-empty-state` invites
  "what about `.tier-grid`?" / "what about `.verdict-pill`?" type
  expansions. Pattern: extract only the THREE primitives explicitly
  carried from §6.b audit; defer further extractions to a follow-up
  primitive-consolidation slice.
- **R3 designer notes use "Customer view" / "Mark-Accepted"
  pre-rename naming.** Apply rename canon to surface references
  in production copy; preserve design-source verbatim for
  concept references (audit-log keys, helper text about
  surface concepts vs surface navigation). Audit pass needs to
  pre-arbitrate this per surface so Designer agent doesn't
  re-flag the same gaps already arbitrated in §6.b Step 11.
- **R4 "4bstyles.css" naming** — CD shipped `4bstyles.css` but
  no `4astyles.css`. Confirm with CD whether 4a was a discarded
  variant or whether `4b` is the canonical name. Worst case:
  rename `r4-home.css` regardless and document.
- **Customer-view boundary guard** must NOT regress during Quote
  path-B migration. Build pipeline assertion verified post-migration.
- **PDF render path** (Notes-above-T&Cs) is sequenced as a
  separate slice (#4 on release path). Sweep doesn't ship that
  fix but flags if Quote register changes affect PDF parity.

---

## §6 · Step 10 Designer audit scope

Cross-surface dimensions:
1. RI.9 chrome canon parity across all 5 surfaces (eyebrow +
   back-link + action cluster + nextMoveBanner consistent)
2. Surface rename canon (no "Cost build" / "Costing Sheet" /
   "Customer view" in production copy)
3. Token discipline (zero hardcoded `gray-*` / `bg-white` /
   `border-gray-*` in surface bodies post-sweep)
4. Cross-surface primitive use (`.calc-display`, `.warn-band`,
   `.r7b-empty-state` consumed everywhere applicable)

Intra-surface dimensions (per surface):
- Costs: Per §6.b Step 11 rubric (re-audit; minor adjustments
  expected post-sweep)
- Pricing: Two-axis verdict + margin verdict band + per-cell
  overrides + suggested-GPA banner + client target affordances
- Quote: PDF preview surface parity + customer-view boundary
  guard verification
- Mark Accepted: Pending-state freeze visualization + blended-
  margin verdict + tier card grammar
- Home: Outer/inner rail + organizer states + project detail +
  copy-ops

**Truncation mitigation** per §6.b Step 11 precedent: Designer
agent writes findings to `docs/audit-findings/rest-of-app-NN-
{SEVERITY}-{slug}.md` per finding + summary file at `00-summary.md`.

---

## §7 · Pattern banking placeholders

To bank if the sweep validates them:

- **Pattern 37 candidate — Dual-canon discipline.** When a surface
  has design source predating implementation refresh, chrome canon
  reads from implementation + later-round designer notes; body
  canon reads from original-round design source. Apply where: any
  surface whose design source predates a cross-cutting refresh
  (RI.9 nav, RI.8 rename, future R8 multi-route). Banks the
  working discipline this sweep operates under.

- **Pattern 38 candidate — Completeness reviews first-class.**
  Pre-brief, run a source-on-disk verification against the
  surfaces a sweep / slice will cover. Output as
  `docs/{slice-name}-source-completeness.md` with per-surface ✅/❌
  matrix. Surface gaps to Edward BEFORE brief drafting; never
  speculate about what CD might deliver later. Bank if this
  practice prevents another in-flight scope discovery cycle.

Promotion criteria for both: second reference moment validates
the pattern; Edward + CA confirm.

---

## §8 · Approval status

**APPROVED WITH AMENDMENTS — 2026-05-13.** Edward + CA review
complete; 4 amendments folded inline (Step 2 resize; mid-slice
smoke checkpoint at 2/3; §3.2 Step 1/5 footnote on discarded
partial r2-pricing.css; §9 "What's next" footer). 4 open-
question dispositions banked below. Step 0 schema verification
pass fires next.

### Open question dispositions (folded into brief)

1. **Cost-stack RAW + PASS row restoration scope (Q1)** —
   **STAYS UX_BACKLOG**, not folded into this sweep. Existing
   UX_BACKLOG entry ("Restore cost-stack RAW + PASS rows under
   per-component split") carries the work to a separate follow-
   up slice.

2. **`4bstyles.css` naming with CD (Q2)** — Edward pings CD for
   source-naming confirmation (was `4a` ever shipped vs `4b`
   variant only?). Regardless of CD response, **rename the file
   to `src/styles/r4-home.css` during path-B migration** to
   match the per-surface canonical naming register
   (`r6-cost-build.css`, `r7b-setup.css`, `r3-quote.css`, etc.).
   Source-naming history documented in the file header.

3. **Pattern 29 read↔edit adoption on Pricing per-cell
   overrides (Q3)** — **ACCEPTED NEXUS EXTENSION**. R2 canonical
   likely renders display-only; current implementation uses
   Pattern 29. Documented as explicit delta from R2 canon in
   per-component source header + the `r2-pricing-overrides.css`
   header comment. **Pattern 39 candidate** instance (see
   §7 + CLAUDE.md).

4. **Home `r4-home.css` vs `r5-admin.css` overlap (Q4)** —
   **Extract `src/styles/r4-home.css` separately**;
   `r5-admin.css` stays unchanged (admin surfaces are R5
   canonical scope; Home is R4 canonical scope; no shared
   class register). Path-B migration for Home creates new
   `r4-home.css` file from verbatim `4bstyles.css`; admin
   surfaces stay on their existing R5 chrome unchanged.

## §9 · What's next — release path anchor

This sweep is slot #2 on the v1 release path (banked in
CLAUDE.md "v1 release-path slice sequencing"):

1. ~~§6.b — Setup wholesale redesign + Phase 1 HubSpot-first
   modal + Costs path-B chrome migration~~ ✅ merged (PR #25)
2. **Rest-of-app fidelity sweep** ← this brief
3. **MS OAuth slice** (new — slotted between sweep + writebacks).
   Microsoft OAuth integration for the production deployment;
   blocks several downstream slices that depend on
   organization-tenant SSO.
4. Mark-Accepted external writebacks (HubSpot deal writeback +
   NetSuite SO push — combined slice per Pattern 33 cost-
   evaluation disposition)
5. PDF render path (Notes-above-T&Cs ordering + Customer view
   PDF findings)
6. v1 release

Sweep deliverables that downstream slices depend on:
- Cross-surface primitive extraction (`.warn-band` consumed by
  writebacks slice for retry-and-surface UX)
- Token-discipline cleanup (writebacks needs cross-surface
  retry banner; dark-mode safety matters in prod)
- Mark Accepted page chrome migration (writebacks slice extends
  the state machine; clean chrome is the surface)
- Customer view boundary verification (PDF render path relies
  on the boundary holding)
