# Setup standalone redesign — CD R7 ask

**Status:** Draft for Edward + CA review before routing to CD.
Promoted from §6.b after RI.8 step 1.5 spot-fix++ hit scope-cap
ceiling (May 2026).

**Companion docs:**
- `docs/ri8-brief-amendment.md` §6.c (original spot-fix decision)
- `docs/ri8-navigation-audit-findings.md` (separate CD R7 IA ask)
- `docs/UX_BACKLOG.md` "Setup page feature enhancements" (queued
  for §6.b — now in-flight via this ask)

---

## 0. Frame

RI.8 step 1.5 attempted spot-fix++ on Setup per §6.c (visual debt
clearing without redesign, scope-capped at 1-2 days). Two cycles
of work landed:

1. Apply R1 page-head + setup-grid + R5 card chrome to existing
   IA. CostingSummary card removed (surface-separation cleanup
   per brief §5).
2. SKU column work + customer-accept toggle redesign per Designer
   audit recommendation (b)+(c) lite — grid drift 67/33 +
   action cluster overflow menu.

Both landed. Both hit the same wall: the v1 SKU table's
seven-column structure (split Label/Product, inline Notes, Type
column for `sku_role` mutation control) is the root cause of the
"cramped / under-loved" Setup feeling. Designer's audit explicitly
rejected (d) full R1-faithful restructure as §6.b territory
because it required:

- Dropping the inline Notes column without designed replacement
  for `quote_skus.notes` authoring (sole authoring surface today)
- Merging Label/Product/Pack into one stacked cell with tree-depth
  indentation reshape
- Resolving Type-as-control vs Category-as-label (different schema
  columns; v1 has Type/`sku_role`, R1 shows Category/`cost_category`)
- Designing replacement workflows for the four R7-class affordances
- Tier table register that matches the SKU table redesign

That's design work. Spot-fix++ ceiling reached; further tweaks are
creeping redesign — exactly the failure mode §6.c's scope-cap was
designed to prevent. CA recommends escalation; Edward approved.

This ask routes Setup design work to CD.

---

## 1. Scope of CD R7 ask

### 1.1 Standalone Setup design pass

CD's prior rounds (R1 through R6) treated Setup illustratively
(R1 setup.jsx is six-column SKU table with mock data; later rounds
focused on Cost Build / Pricing / Quote / Mark-Accepted surfaces).
This ask is for **a focused design pass on Setup** that integrates
production realities + accumulated v1 affordances.

**Surfaces designed:**

- **Page head:** eyebrow + display title + sub-copy + action
  cluster. R1 established the canonical shape; carries forward
  unless CD changes the grammar.
- **Two-column setup grid:** SKU table left, tier rail right.
  R1 ratio 1.4fr 1fr; RI.8 spot-fix landed 2fr 1fr. CD may
  re-proportion based on the new column structure.
- **SKU table** — full redesign. Key decisions CD owns:
  - Column structure (R1's six vs v1's seven — drop Notes?
    merge Label/Product? rename Type→Category? compress Actions?)
  - Notes authoring workflow (if dropped from inline, where does
    `quote_skus.notes` get authored?)
  - Type/sku_role treatment (it's a mutation control — leaf vs
    assembly — not a label; design where this lives)
  - Action affordances (RI.8 currently has ↑↓× + ⋯ overflow with
    Assign/Detach/Refresh/HubSpot-link in the overflow; CD
    designs the canonical action vocabulary)
  - Visual distinction between Leaf and Assembly rows (per
    UX_BACKLOG enhancement #2)
- **Tier table** — full redesign, parallel decision set to SKU
  table. Key decisions CD owns:
  - **Column structure:** v1 has Label, Qty, Price-adj %, actions.
    R1 has its own `.tier-row` grid. CD picks the canonical
    column set + ordering + widths.
  - **Inline edit pattern:** click-Edit (mirrors R5 markup-
    defaults), debounced autosave, or blur+Enter (RI.8 freight
    surface pattern). CD picks the canonical pattern.
  - **+ / − add/remove control:** affordance placement (foot
    button, inline + per row, action cluster) + visual register.
  - **Default tier handling:** quotes start with a default tier
    set OR PM picks from preset templates (RI.4 added tier
    presets). CD designs the preset-vs-blank initial state.
  - **Empty state:** "no tiers yet" prompt + CTA to add first
    tier. R5 patterns for empty states exist; CD applies
    consistent treatment.
  - **Visual coupling with SKU table:** the two tables share a
    grid + visual register. CD designs them as a pair — same
    inline-edit pattern, same row register, same action
    cluster grammar. NOT two independently-designed surfaces.
- **Notes section design — full scope, BOTH internal + customer-
  facing notes.** Per Edward + CA Gate 3 disposition (May 2026),
  customer-facing notes authoring is Setup-anchored and lives
  inside THIS ask (not the navigation IA R7 ask). The Setup R7
  designer needs the answer to design Setup properly. Specific
  questions:
  - Currently full-width below the setup grid (single block
    containing both internal-notes textarea + customer-facing
    notes textarea). Stays unified, splits into two surfaces,
    or moves authoring of customer-facing notes adjacent to where
    they render (Quote surface)?
  - The two have different audiences — internal-notes is PM-only,
    never customer-visible; customer-facing notes render on the
    Quote surface PDF.
  - Per-SKU notes (the `quote_skus.notes` column dropped from the
    inline column in §1.1 SKU table) is a separate concern from
    quote-level notes — three distinct surfaces in play
    (per-SKU notes, internal-notes, customer-facing notes).
    CD designs how all three relate.

### 1.2 Feature enhancements (per UX_BACKLOG "Setup page feature enhancements")

Bundled into this redesign because they share natural integration
points with the table treatment:

- **Add-new-product authoring.** Setup today supports HubSpot
  product lookup + Nexus-local assembly creation. No path to add
  a brand-new product (custom one-offs require leaving Nexus →
  HubSpot → return). Open design questions:
  - Where does the new product LIVE — Nexus-local (quick), HubSpot
    writeback (canonical), or PM choice with chooser UX?
  - Where does the affordance render in the redesigned table?
- **SKU table interactivity:**
  - Drag-and-drop row reordering (replaces existing up/down
    arrows in the action cluster)
  - Assembly rows expand/collapse to reveal nested components
  - **Inline edit affordances for nested components** —
    explicit decision: IN-SCOPE for this §1.2 bundle. Scope
    impact: nested component editing means the expand/collapse
    affordance ALSO exposes editable fields (unit cost, qty,
    markup, etc.) on the nested rows. This is meaningfully
    larger than read-only expansion. If CD wants to carve this
    into a separate v1.5 enhancement, decide at design time
    and document the carve in designer notes.
  - Better visual distinction between Leaf and Assembly row
    treatments

### 1.3 Cross-page IA touchpoints (flag to CD; outside Setup-only scope)

- **Setup → Costs** next-step affordance. Currently
  "Continue to cost build →" lives in the page-head action
  cluster (R1 fidelity). CD confirms or restructures.
- **Setup → Pricing** affordance — DEFERRED to navigation IA R7
  ask (item c: per-surface 'next move' affordance owns this).
  Setup inherits whatever nav IA R7 decides for Setup → Pricing.
  Not asked here.

(Customer-facing notes authoring placement — previously item (f)
of the navigation IA R7 ask — has been folded INTO §1.1 Notes
section design above per Edward + CA Gate 3 disposition. It's
Setup-anchored: the Setup R7 designer needs to design Notes
treatment as part of Setup, not as a cross-surface IA question.)

---

## 2. What CD does NOT need to design

To bound the ask:

- **Schema doesn't change.** Designer's audit established that
  Type/sku_role and cost_category are different columns; CD picks
  display vocabulary but doesn't redesign the schema.
- **Cost build / Pricing / Quote / Mark-Accepted surfaces** —
  unchanged; this is a Setup-only design pass.
- **Inner rail / outer rail** — unchanged; navigation IA R7
  handles cross-surface rail decisions separately.
- **Mode selector / Bulk Raw section** — those are Cost build
  concerns, not Setup. (CC verified May 2026: mode selector
  renders inside `BulkRawDrilldown` on `/costs`, NOT on Setup.
  Exclusion holds.)
- **Admin pages** — Round 5 design already established; RI.8
  steps 2-5 build them out.

---

## 3. Deliverables expected from CD

Same shape as prior CD rounds:

1. **HTML prototype** rendered against representative DPS data
   (5-7 SKUs including at least one assembly with nested
   components; 3-4 tiers; long product names that stress column
   widths).
2. **Designer notes** explaining decisions on each surface (SKU
   table column structure, Notes workflow, action vocabulary,
   tier table register, feature enhancement placements).
3. **Data-source map** identifying which schema columns each
   visible field reads + which the user can write.
4. **Round 7 designer canon** entries — any new visual
   primitives, registers, or extensions documented for Designer
   agent + future-CC reference.

---

## 4. Sequencing relative to RI.8

**RI.8 froze further Setup tweaks** post-step-1.5. Current Setup
state (R1 page-head + setup-grid + R5 card chrome + 67/33 SKU
column + ↑↓× + ⋯ overflow + inline Notes) shipped to main with
RI.8 (merge commit `7bf6dc8`, May 2026).

**§6.b ships as its own slice** when CD R7 lands. The slice scope:

1. Implement CD's Setup redesign against the R7 prototype +
   designer notes.
2. Land the feature enhancements (add-new-product + drag-drop +
   assembly expand/collapse + Leaf/Assembly distinction) per CD's
   integration design.
3. Replace step-1.5's spot-fix++ work in place. RI.8's Setup work
   gets fully superseded — no lingering technical debt to clean up
   since spot-fix++ was always scoped as throw-away polish.

**Step 2 (Markup defaults Round 5 rebuild)** of RI.8 ran in
parallel with this CD R7 routing — admin work wasn't gated on
Setup decision. CD R7 turnaround is independent of CC's RI.8
implementation pace; RI.8 has now shipped.

---

## 5. Risks + open questions

- **Notes workflow design is the load-bearing question.** Per-SKU
  `quote_skus.notes` has no replacement authoring surface today.
  CD must design one (or confirm the column gets dropped, which is
  a schema decision Edward + CA call separately).
- **Tier table register coupling.** SKU + Tier tables should read
  consistently. CD designs them as a pair, not as separate
  surfaces.
- **Feature enhancements scope creep.** Add-new-product authoring
  with HubSpot writeback has implementation cost CD doesn't pay
  but CC does. CD picks the design; CC + Edward weigh
  implementation feasibility before §6.b kicks off.
- **Coordination with navigation IA R7.** Both R7 efforts touch
  cross-surface notes authoring — resolved by Gate 3 disposition
  (May 2026): customer-facing notes authoring folded INTO this
  ask's §1.1 (Setup-anchored). Navigation IA R7 keeps items a-e.
  No remaining coordination risk.

---

## 6. Approval status

- [x] **Gate 1** — Edward approved promoting §6.b to active CD R7
      ask (May 2026).
- [x] **Gate 2** — Edward + CA approved §1 scope shape post-
      refinements (Tier table parallel scope, §1.2 inline-edit
      explicit decision, §1.3 Pricing entry deferred to nav IA,
      §2 mode selector verification, §4 RI.8 ship past tense,
      §5 notes coordination resolved). May 2026.
- [x] **Gate 3** — Item (f) customer-facing notes authoring
      RELOCATED INTO §1.1 of THIS ask (Setup-anchored). Navigation
      IA ask keeps items a-e (genuinely cross-surface).
- [ ] **Gate 4** — Routing: Edward + CA forward both asks (this
      doc + navigation IA findings §4) directly to CD. CC isn't in
      the loop.

Gate 4 is the only open gate. Once routed to CD, this doc is the
canonical brief CD reads.
