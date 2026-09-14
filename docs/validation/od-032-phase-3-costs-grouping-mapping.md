# OD-032 Phase 3 — Costs owner grouping: Design Authority mapping, and two conflicts

**Status: pre-implementation mapping. No code written. Two conflicts surfaced for
disposition rather than resolved in code**, per the Phase 3 instruction:

> If the existing Costs layout cannot reproduce the Design Authority faithfully without
> violating another governed layout rule, surface the conflict before coding around it.

Design Authority: `docs/design-prototypes/od-032/`.

---

## 1 · What the Design Authority specifies for Costs

Two documents govern, and they say different amounts.

### 1.1 The prototype does not draw the Costs region

`design/Nexus OD-032 Round Trip.standalone.html` §03 has three switchable states — *Phase 1
· select types*, *Phase 2 · enter economics*, *Result · owned rows*. All three are drawn on
**Setup**, not Costs. The Result state carries the eyebrow `SETUP · SKUS, TIERS, NOTES` and
the caption *"After adding — charges owned by the component, editable in place."*

Captured: `evidence/prototype-result-owned-rows.jpg`.

Verified structurally as well as visually — the rendered document contains no
"Shipping & one-time" string anywhere, and its eight `<h2>` headings are the argument
sections, none of which is a Costs layout.

The prototype's only statement about Costs is prose, in the §03 card *"Cost lands where it
is caused"*:

> Charges are enterable from Setup but they are cost facts, so Costs remains their home:
> nested under the owning component, contributing to the same tier grid.

**So the visual Design Authority for the Costs region is the row treatment in the Setup
render, plus prose. There is no drawn Costs screen to be faithful to.**

### 1.2 The written authority is `costs-page-layout.md` §11

Amended in Phase 0(a). Its operative sentence:

> **Rows group under their owner. The section still appears once. Tier column x-positions
> are unchanged.** Quote-owned charges group under a **Project** heading — the honest name
> for what that section has always held.

And its explicit non-decision:

> Whether a legacy charge may display an owner name. **It may not** — charges whose
> `owner_ref` is anchor-coerced are Project-owned for OD-032 purposes and their anchor is
> never surfaced as a cause.

§4a fixes the region that sentence is about:

```
cost stack (per-tier rollup, unchanged)
Packaging          · owner: Purchasing   ┐ per-unit family
Production         · owner: Production   ┘ (has a SKU dimension)
─────────────────────────────────────────
Shipping & one-time costs · owner: Logistics
  [line rows × tier columns]  ← same grid, no SKU dimension, appears ONCE
```

---

## 2 · What the shipped Costs page actually renders

`src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx` composes **three**
`<SectionWithDrilldown>` regions and nothing else:

| Section | Drilldown | Holds |
|---|---|---|
| Packaging | `packaging-drilldown.tsx` | per-(leaf, tier) unit costs |
| Production | `production-drilldown.tsx` | **every one-time charge**, plus tier-total COGS |
| Freight | `freight-drilldown.tsx` | legs, duty, customs |

**There is no "Shipping & one-time costs" section.** Grepping the page and every Costs
component for `shipping & one-time` / `one-time cost` / `landed & one` returns nothing.

### 2.1 Where one-time charges live today

`production-drilldown.tsx:110-131` maps each fixed production column to a virtual line with
`kind: "tier_total_cogs" | "one_time_fee"`. The `one_time_fee` lines are the entire existing
one-time family:

```
setupFeeTotal         Setup fee total          Tooling
toolingArtworkTotal   Tooling / artwork total  Tooling   (legacy)
toolingTotal          Tooling total            Tooling
artworkTotal          Artwork total            Tooling
rdTotal               R&D fee total            R&D
otherServiceTotal     Other service fee total  Other
```

Duty and customs — which §7 of the layout doc explicitly wants under the same heading — are
in the **Freight** drilldown, a different region.

### 2.2 They are already grouped, by Item Group

`production-drilldown.tsx:223` selects `skus.filter(s => s.skuRole === "assembly")` and
renders **one table per assembly**. The header comment records why:

> BV-012 — the display rows are now keyed by ASSEMBLY... #282 re-keyed this DISPLAY to
> `assembly.id`, correctly — production belongs to the Item Group, not to one of its
> components.

The anchor leaf survives only as `anchorLeafByAssembly`, used to key the **markup node
lookup**, never as a displayed owner. So the current surface does **not** violate the
"anchor is never surfaced as a cause" rule. Nothing here needs repairing.

---

## 3 · Conflict A — there is no one-time section to group

Phase 3's scope is *"render the existing one-time Costs section grouped by causal owner"*
and *"preserve tier column geometry and the single one-time section."* Both presuppose a
region that does not exist.

The gap is not cosmetic. Reaching the Design Authority's layout means:

1. creating a standalone one-time region at the foot of Costs;
2. **moving the six `one_time_fee` lines out of the Production drilldown** into it;
3. **moving duty and customs out of the Freight drilldown** into it, since §7 names them as
   the section's contents and the fallback name *"Landed & one-time costs"* exists precisely
   to cover them;
4. giving that region the tier grid as `[line rows × tier columns]`, which is a different
   geometry from the per-assembly tables the lines render in now.

That is a restructure of two shipped sections, not a grouping change. It also cannot
"preserve tier column geometry" in the sense the instruction intends, because the lines have
no tier-column geometry of their own today — they inherit the Production drilldown's.

**This needs disposition. Three readings, and I do not think it is mine to pick:**

- **A1 — group in place.** Add owner grouping to the `one_time_fee` lines where they already
  are, inside the Production drilldown. Smallest change, no section moves, no Freight
  disturbance. But it is not the amended layout, and it inherits Conflict B below in its
  sharpest form.
- **A2 — build the section.** Implement §4a's standalone region and move the lines into it.
  Faithful to the written authority; materially larger than Phase 3's stated scope; touches
  Freight, which Phase 3 excludes.
- **A3 — defer the region, group nothing yet.** Treat Phase 3 as blocked on the layout
  question and sequence the section build as its own phase with its own design pass.

### 3.1 A note on what "faithfully" can mean here

Even under A2 there is no drawn Costs screen to check fidelity against. The available visual
authority is the Setup render's row treatment: a small-caps mono eyebrow
(`ONE-TIME CHARGES CAUSED BY THIS COMPONENT`), rows on a lighter ground with 6px radius and
6px gaps, a 5-column grid `1fr 110px 96px 150px 24px`, name at 12.5px with a mono meta line
at 9.5px reading `print plates · one-time · unplaced`, and a right-aligned `···`.

That treatment is drawn **inside a Setup SKU tree row**, at Setup's geometry. Porting it into
a Costs section that carries a tier grid is an interpretation, not a transcription — and
Phase 3's instruction is explicit that *"functional grouping without visual fidelity is not
completion."* I would want the target drawn before building it, rather than inventing the
Costs treatment and calling it fidelity.

---

## 4 · Conflict B — BV-012 vs the OD-032 owner model, on existing charges

This one is a governed-rule collision and holds under every option above.

**BV-012 §1.a** — approved governing business rule, recorded 2026-08-17, confirmed with
Accounting:

> **Production costs belong to the Item Group itself. They do not belong to an arbitrary
> packaging component underneath it.**

**OD-032** has exactly two v1 owner types: `'@quote'` (Project) and a packaging component.
**Item-group ownership is explicitly deferred** — the README lists it under Deferred:
*"No demand until a charge is genuinely caused by an assembly rather than a component in
it."*

Every one-time charge that exists today is Production economics from
`assembly_production_inputs`. Under the implementation plan §2.2 they are **Project-owned**
for OD-032 purposes, because their `owner_ref` is anchor-coerced.

So grouping them by causal owner means collapsing all of them under a single **Project**
heading — which:

- **detaches Production economics from the Item Group that incurs them**, the precise
  attachment BV-012 §1.a exists to assert and that #282 re-keyed the display to honour; and
- **merges one-time fees from different Item Groups into one undifferentiated list.** On a
  two-Item-Group quote, today the operator sees each group's setup and tooling under its own
  table. After grouping they would see one Project list with both groups' fees in it and no
  way to tell which incurred what.

§11 anticipates none of this. Its reasoning for why no migration is needed —

> Every charge in the section today is engagement-caused; none has ever had another owner.
> The heading names what was already true rather than introducing a category.

— is true of the *region §11 imagines*, where the rows were never grouped by anything. It is
not true of the region that shipped, where they are grouped by Item Group under a rule
approved two months after the layout document was written.

**Three readings, again for disposition:**

- **B1 — Project is a flat heading; Item Group grouping is dropped.** Faithful to §11,
  contradicts BV-012's attachment on screen.
- **B2 — Project heading, Item Group retained as a sub-grouping inside it.** Honours both:
  charges are Project-owned (no anchor surfaced, no component named as cause), and the Item
  Group still visibly incurs its own production fees. Costs one nesting level the Design
  Authority does not draw.
- **B3 — legacy charges keep their Item Group tables untouched; only component-owned charges
  get owner grouping.** Nothing existing moves at all, which is the most literal reading of
  *"legacy Project charges resolve exactly as before."* But then the **Project** heading
  never appears, and §11's central instruction goes unimplemented.

**B2 is the one I would recommend** if a recommendation is wanted — it is the only option
that leaves both governing statements true at once, and the cost is one nesting level rather
than a contradiction. But it invents a level the Design Authority does not draw, which is
exactly the kind of silent resolution Phase 3's instruction forbids, so it is surfaced
rather than taken.

---

## 5 · What is NOT in conflict

Worth stating, so the disposition is about the two things that are:

- **No anchor is surfaced as a cause today.** The display keys by assembly; the anchor leaf
  is a markup-node lookup only. The OD-028 rule is already honoured.
- **The tier grid exists** and one-time lines already sit in it, so "tier column x-positions
  unchanged" is satisfiable under A1 and B2 without geometry work.
- **Component-owned charges have no existing rows to disturb** — nothing can author one
  until the phase-4 sheet ships, so their grouping is greenfield whichever option is chosen.
- **Phase 2's storage and costing input are sufficient** for any of these options. The
  causal owner reaches the engine as `ownerRef` on `ChargeEconomics`, and legacy charges
  carry `ownerRef: undefined`, which is exactly the Project/component discriminator a
  grouping renderer needs. No further model work is required by Phase 3.

---

## 6 · Recommended sequencing

1. Edward dispositions **A** (where the grouping happens) and **B** (what happens to Item
   Group grouping for legacy charges).
2. If A2 or B2 is taken, the Costs region is drawn before it is built — the Design Authority
   currently has no Costs screen, and building one from prose would be the reinterpretation
   the fidelity requirement rules out.
3. Phase 3 implements the dispositioned shape, with visual evidence against whatever is then
   the drawn authority.
