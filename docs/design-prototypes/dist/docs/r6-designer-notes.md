# Round 6 — Designer notes (Cost Build redesign)

This round redesigns the IA you've been carrying since the spreadsheet days.
The legacy organization is **four concept tabs** (Packaging Setup, Cost Setup,
Production Setup, Freight Calc) with a **dual cost-stack widget** at the top
and tier-as-a-pivot-on-the-side. The redesign collapses to **one page,
[four] sections, one cost stack**, with **multi-tier as the primary spatial
axis** and drill-down where tabs used to live.

> **R6.1 correction (post-firm review):** Bulk Raw is now its own peer
> section, not a sub-section inside Production. Pushback #2 below was
> answered by the firm — raws are a discrete cost category with their own
> deposit workflow. The four sections are now **Packaging · Production ·
> Bulk Raw · Freight**. Bulk Raw renders only when raws-mode is "DPS
> sources"; in CM-sources or customer-supplies mode the section collapses
> to a "no costs tracked here" state and the cost stack drops the RAW row.
> See R6.1 addendum at the end of this doc.

What follows is what you should push back on, what I considered and rejected,
and what I'm committing to despite the smell.

---

## Three pushbacks

### 1. The mini-stacks on section rows might be the most expensive pixels on the page

Every section row has a per-tier rollup mini-stack. It shows you each tier's
per-unit cost for that section without opening it. It's also, structurally,
**a copy of the cost-stack header in miniature, three times**.

- The argument _for_: it answers "what does packaging cost at T2?" without a
  click. Section rows feel meaningful, not just labels.
- The argument _against_: the cost stack at the top **already says this**.
  PKG row × T2 column = same number. We're paying for the same number twice
  on screen and three times in code.
- What I'd push on: do users actually scan section rows to read tier costs,
  or do they go straight to the stack at the top? If the stack is the
  primary glance surface, the mini-stacks are decorative — replace with a
  single "complete / in progress / empty" status pill plus owner.
- The compromise I shipped: keep them, because they're load-bearing in the
  empty/incomplete states (when the stack header has nothing to read) and
  because they're a tactile preview before the drill-down opens. But this is
  a usage-data question. **Strip them after two weeks if scan-tracking shows
  nobody reads them.**

### 2. "Bulk raw" as a sub-section inside Production is a defensible call, not an obvious one

Where bulk raw cost (the goo) lives is a tossup. Three plausible homes:

| Option | Why | Why not |
|---|---|---|
| Inside Packaging | "It's part of the bottle" — the formula is the product | It's not a packaging component, it's the contents; the supplier is different; markup category is different |
| Its own section | "It's the most important cost" | Adds a fourth row that's usually one number; defeats the simplification |
| **Inside Production** (chosen) | The CM bills you for filling — they fill what you give them, but they often co-source raws. The cost lives in the production conversation. | It conflates "service" (filling) with "material" (the goo), which a strict accountant would split |

I went with Production because **the people entering the data are the
production team**, and the conversation in their head is "Marin will bill
us $X to fill, plus we sourced raws at $Y" — both go on the same PO. If
your customers think differently, this is wrong.

**Tell me if accounting wants raws as their own GL line** — if so, this
should be a fourth section, not a sub-section. The answer changes how the
reconciliation flow works (do you reconcile the formula yield separately
from the run yield?).

### 3. The cost-stack bars are normalized to max subtotal — that's a lie about reality

In the cost-stack header, each component bar's width is proportional to
that component's contribution to the **largest tier's subtotal**. So Tier 1
Packaging looks fatter than Tier 4 Packaging — visually correct (T1
**actually costs more per unit**), but it makes the eye think "T1 is bad" or
"T4 is great" when actually you _want_ T4 to be smaller, that's the whole
point of buying in volume.

Two truthful alternatives:
- **Bar width = absolute dollars, fixed scale across tiers.** Now T4
  packaging is genuinely shorter. The eye reads the right story. Cost: T1
  visually overflows when units are very small; need a max-width clamp.
- **Bar width = % of that tier's subtotal.** Every tier looks similar.
  Reads as "what dominates the unit cost at this volume." Cost: hides the
  volume-discount story entirely.

I shipped option 1 (normalize to max subtotal across tiers) because it
preserves the "smaller tier = wider bars" narrative that the legacy widget
also told. **But the right answer probably depends on whether the user is
trying to understand "what costs are big" (tier-relative) or "is volume
discount working" (absolute).** A tweak that lets the user choose lens
might be the honest answer; I didn't ship one because adding lens-toggling
to a glance widget is the start of feature creep.

---

## Considered and rejected

### A side drawer instead of inline drill-down

I considered putting Packaging / Production / Freight detail in a right-side
drawer (the Round 4 inbox pattern). Rejected because:
- The cost stack at the top is the reference — when you edit a line in
  packaging, you want to glance up and see the stack move. A side drawer
  hides the stack at small screen widths.
- Three sections, drilled-into one at a time, fit comfortably inline. The
  page is already vertical-scroll-shaped; making half of it horizontal-shaped
  for no gain.
- Inline drill-down also handles the "all three open" edge case — useful
  during a final review pass — without modal stacking.

### Keeping the legacy four concept tabs

Tempting because nobody has to relearn anything. Rejected because the four
tabs **don't map to the work**. "Cost Setup" was a leftover bucket that
collected the cost stack widget plus tier setup plus a few things that
should live elsewhere. "Packaging Setup" and "Cost Setup" overlap. The
right axis is **what part of the bill of materials is this**, not **what
phase of setup are we in**.

### Tier as a tab at the top of each section

Considered: each section header has tabs T1 / T2 / T3 inside it, and you
edit one tier at a time. Rejected because:
- It buries the multi-tier comparison that's the entire point. The whole
  reason this product exists is that the customer wants three prices for
  three volumes; hiding two of them behind a tab is a regression.
- Per-tier columns in the line table give you side-by-side editing, which
  is faster than tabbing.

### A single mega-table with all components across all sections

Considered: one giant table, column = tier, row = component, grouped by
section. Rejected because:
- Sections have different metadata. Packaging has supplier and inventory
  flag; production has kind and NRE total; freight has incoterm and
  treatment. A single table either has 18 columns (most empty per row) or
  collapses metadata to invisibility.
- Status, ownership, and approval are section-level concepts. Hiding
  sections inside a giant grid hides accountability.

### Showing PASS as its own row even when 0

Kept it. Pushback expected: "this looks dumb when it's always zero." But:
- It establishes the grammar. When a freight line gets switched to
  passthrough, PASS appears in the same place every time — no jumping
  layout.
- The empty PASS row signals "passthroughs are possible" to a user who
  doesn't know yet that they are.

The cost: 18px of vertical space per tier column. Acceptable.

### A "quote health" panel

Round 4 has a "next action" surface. I considered repeating it here as
"this build needs: bulk raw, T4 production lines, freight on T4." Rejected
because:
- The empty cells ARE the next-action signal. A separate panel is redundant.
- The status chips on each section row already tell this story.
- The Round 4 next-action card stays canonical for the project; this page
  is the workspace, not the dashboard.

---

## Five commitments

These are decisions I'm committing to, with named risk if they're wrong.

1. **Multi-tier is the page's primary spatial axis.** Tiers are columns
   everywhere — in the cost stack, in the line tables, in the section row
   mini-stacks. **Risk:** wide screens only. On <1280px, the line tables
   need to scroll horizontally. I think that's fine for an internal tool;
   users have monitors.

2. **NULL means "no entry" — never "inherited from another tier".** Empty
   cells render as a dashed pill, not an inherited value. **Risk:** more
   typing in the early states. Mitigation: bulk-fill controls (post-MVP)
   that let you copy T1 → all tiers when you actually do mean inheritance.
   The opacity is the point — you should never wonder whether a number is
   real or borrowed.

3. **Treatment lives on the freight LINE, not the section.** A real
   shipment has bundled inbound + passthrough outbound; one button at the
   section level forced the wrong simplification. **Risk:** more clicks
   when both lines should be the same. Acceptable because mode/incoterm
   already differ per line, so you're already touching each.

4. **Customs uses the freight blue family, not its own color.** Customs is
   freight that happens at the border. Giving it purple or warn-yellow
   would imply it's a separate class of cost; it isn't. **Risk:** at
   first glance the customs card might read as "more freight, why is this
   here." Mitigation: the eyebrow says "Customs · DDP" and the card only
   renders for DDP lines.

5. **Production toggles are explicit consequence-sentences, not boolean
   labels.** Each toggle includes "→ what changes." This is a wordier
   pattern than `[x] Customer ships raws`, but the silent footgun on the
   legacy app — flipping a toggle and not realizing packaging cost dropped
   to zero — was real. **Risk:** the toggles get verbose if we add a
   third or fourth. We won't; if we need a fifth concept, it gets its own
   sub-section.

---

## What's deliberately out of scope

- **Per-section approval workflow.** Status chips show "complete"; they
  don't yet route for approval. That's the next round.
- **Inventory pool.** Inventory-eligible packaging lines are flagged but
  there's no pool view yet. That's a cross-project surface, separate round.
- **Cost-stack visualization tweaks.** Lens choice (absolute vs.
  normalized) is an open question above; not shipping a tweak for it yet.
- **Empty-state line templates.** "Add packaging line" doesn't yet pre-fill
  from the most common shape. That's a quality-of-life pass once the IA is
  validated.

---

## R6.1 addendum — Bulk Raw as a peer section

**Decisions confirmed with firm.**

### What changed
1. **Bulk Raw is its own section** — fourth peer to Packaging / Production /
   Freight, not a sub-section inside Production. Same drill-down architecture.
2. **Per-line raw materials** — categories (oil base, actives, fragrance,
   preservatives) with ingredient sub-lines under each. Ingredients carry
   the cost; categories carry the markup and the deposit handle.
3. **Native units** — raws are entered in kg / L / mL with a `cost / native`
   field and a `usage / filled unit` field. Per-filled-unit cost is computed
   live from the two. Procurement enters what they actually buy; the cost
   stack reads what we actually pay per bottle. Both numbers are visible in
   the drawer because they answer different questions.
4. **Section-rollup deposits** on Packaging, Production, and Bulk Raw —
   small chip on the section header showing `$X deposit due` /
   `Deposit paid · INV-…` / `Deposit invoiced`. Slice 12 stub; deeper
   workflow lives in writeback.
5. **Dual yield reconcile** in Production —
   - **Production yield** (units): actual units produced vs. quoted, drives
     NRE per-unit reconciliation.
   - **Formula yield** (mass): two cells side-by-side —
     mass-consumed-vs-ordered (procurement waste; "we got billed for raws
     we didn't use") and mass-consumed-vs-theoretical (fill efficiency;
     "the line over-filled by 12%"). They reconcile, they don't re-quote.
6. **Cost stack — conditional RAW row.** When `raws_mode === dps_sources`,
   the stack shows a sixth row, RAW, indented under PROD with a parenting
   tick. The indent + label hierarchy carries the parent-child relationship
   ("the goo that goes in the bottle") without giving raws full visual
   parity with PKG/PROD/FRT. When raws_mode is `cm_sources` or
   `customer_supplies`, the row is hidden — RAW would be lying about cost
   contribution that isn't ours.

### Why a peer section, not a sub-section
The original Round 6 placed bulk raw inside Production because the
production team enters the data and the CM bills both on one PO. The firm
corrected: **raws are a separate cost category and we take deposits
against them specifically**. A sub-section can't carry a deposit workflow
because deposits are billed at the category level (you invoice a 50%
deposit on raws specifically, not on "production things including raws").
That's the load-bearing reason. The visual / accountability arguments
(separate GL line, separate owner) were already known; the deposit
workflow tipped it.

### Section owner
Purchasing. The category is "what did we source," not "what did we make."

### Carry-forwards / next round
- **Per-tier raw cost** is currently a flat-ish stack with a small volume
  break (T1 +4%, T3 −5%, T4 −8% from T2 baseline). In reality, raw costs
  tier by **supplier price breaks at order quantity**, which is
  ingredient-by-ingredient. The next round should let an ingredient row
  carry per-tier `native_cost` values; current schema already supports it,
  the UI just doesn't expose tier columns at ingredient level yet.
- **Deposit invoice CTA** lands in Slice 12 — section chip becomes a
  button that drafts an invoice in HubSpot/QB writeback.
- **Formula yield over-fill** detection is reactive (you log mass
  consumed); a Slice 14 surface should plot the running over-fill across
  recent runs to flag a drifting filling line before it costs a quote.
