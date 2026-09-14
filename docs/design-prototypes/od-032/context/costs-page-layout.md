# Costs page — layout (section-major, decided)

**From:** CD · **Follows:** `docs/costs-multi-sku-design-review.md`
**Fixed points, all now decided:**
1. Every cost entry point reachable on one page. No SKU switching. Scrolls, never paginates.
2. **Section-major** — sections outer, SKU rows within (§5.1). Reason: **multi-owner with
   handoffs** (§5.2).
3. **Anchor SKU retired** (§5.4) — out of the header, no default expansion.

> Supersedes the both-branches version of this document. The SKU-major branch is dead and
> has been removed rather than kept alongside — a spec that describes two structures and
> builds one is the same interpretation trap as a spec that drops a gate once and specifies
> it three times.

---

## 1 · Correction carried forward: the arity argument, withdrawn

Verified rather than reconstructed, per your ask. `production.lines[]` and
`packaging.lines[]` in `app/r6/data.js` are both flat arrays with **no `sku_id` field**.
R6 designed *both* sections single-SKU; Production's multi-SKU display in the shipped app is
a post-R6 divergence. **Three accidents, not three arities** — so "neither should adopt the
other" is withdrawn, and sections are treated consistently.

**The real arity distinction is `kind`, and it cuts across sections:**

```js
{ name: "Filling + capping",       kind: "per_unit",      t1: 0.28, t2: 0.24, … }
{ name: "Tooling + setup (NRE)",   kind: "amortized_nre", nre_total: 1800, … }
{ name: "R&D / stability prequal", kind: "amortized_nre", nre_total: 1200, … }
```

| Family | Behaviour | Has a SKU dimension? | Needs tier columns? |
|---|---|---|---|
| **Per-unit** | scales with volume | **Yes** — repeats per SKU | **Yes** |
| **One-time** | fixed total per tier | **An OWNER dimension** — see §11 | **Yes** |

> **Corrected (CA/Edward):** one-time costs **are entered per tier, explicitly, by the
> operator.** If tooling costs more at 10k units than at 50k, the operator enters both
> figures — the system derives nothing. Division is the operator's statement, not a
> calculation. My earlier "$1,800 is $1,800 at every tier" was wrong, and wrong about a
> business fact rather than a design preference.
>
> **The two families are still real, and the distinction is now exactly one thing: the SKU
> dimension.** Per-unit costs have one; one-time costs don't. That — not the grid — is why
> the one-time section appears **once at the foot** instead of repeating per SKU, and that
> reasoning is untouched. The page-length economy survives intact.
>
> **Amended for OD-032 (Aug 2026) — see §11.** The clause "one-time costs don't [have a SKU
> dimension]" stays true and stops being the whole story: an owned charge has an **owner**
> dimension, which is not a SKU dimension and does not repeat the section. Rows group under
> their owner; the section still appears once; tier column positions are unchanged.

## 2 · The page scrolls. It never paginates. It never switches.

> **One scrolling surface. Every cost entry point present at all times. No control may
> remove a pending entry point from the page.**

- **Collapsing hides completed work.** Legitimate — entry point stays, one click, no
  context change.
- **Switching hides pending work.** Prohibited. That was "Other SKUs in this scenario (2)".

**Guard: never collapse anything incomplete, and collapse nothing at all below 4 SKUs.**

## 3 · Section-major makes the tier grid structural, not a rule

Worth naming, because it's a genuine advantage of your call. Under SKU-major I needed a
*rule* to force consistent tier-column geometry across repeated per-SKU blocks. Under
section-major I don't:

**A section table is already a matrix — SKU rows × tier columns.** The geometry that had to
be enforced by convention is now enforced by the table itself. Three rules become one
structure plus two small ones:

1. **Tiers are columns. SKUs are rows. Never the reverse.** Tier is comparative (you read
   across it — and it's the established idiom in Pricing, R8 tier selection, the customer
   PDF). SKU is completive (you finish it).
2. **Tier column x-positions are identical across every section table — no exception.**
   A tier reads straight down the *entire* page: packaging → production → bulk raw →
   **shipping & one-time**. Now that the one-time section carries the grid too, this is
   universal rather than a rule with a carve-out — **simpler than the design I first drew.**
3. **The tier header row is sticky per section table.** At ten rows deep the operator needs
   column labels without scrolling back.

Every section carries the tier grid. Only the per-unit family carries a SKU dimension.

## 4 · Layout at the three real shapes

### 4a · Structure

```
cost stack (per-tier rollup, unchanged)
─────────────────────────────────────────
Packaging          · owner: Purchasing   ┐
  [SKU rows × tier columns]              │ per-unit family
Production         · owner: Production   ┘ (has a SKU dimension)
  [SKU rows × tier columns]
─────────────────────────────────────────
Shipping & one-time costs · owner: Logistics
  [line rows × tier columns]  ← same grid, no SKU dimension, appears ONCE
```

Each section is one owner's region. That is the point of section-major: an owner works one
place, not ten. **Every section carries the tier grid**; only the per-unit family carries a
SKU dimension.

### 4b · One SKU + one-time costs — the majority

The SKU dimension has arity 1, so **suppress the SKU column entirely.** No SKU header, no
row label, no "1 of 1". Each section is a plain line-item table with tier columns; the page
reads cost stack →
packaging → production → bulk raw → shipping & one-time.

**Worth noting: the majority case is identical under either nesting.** Section-major and
SKU-major converge at arity 1, which means §5.1's answer costs the majority Quote nothing.
This is the shape that must feel best, and it does.

### 4c · Two to three SKUs — the comfort target

Each section table carries 2–3 SKU rows. **Nothing collapsed** (§2 guard). The one-time
section appears **once**, at the foot — not per SKU, because it isn't per-SKU. That single
fact is most of what keeps 2–3 comfortable instead of 3× longer.

Whole page ≈ two screens. Every owner's region visible in one scroll.

### 4d · Ten-plus — rare but real

Same four tables, ten rows each. Three things carry it:

1. **Completed rows collapse** (§5) — a 10-SKU packaging table with 7 done shows 7 compact
   summary lines and 3 open editing rows. Correct emphasis without hiding anything pending.
2. **The ledger navigates** (§6), so page length stops mattering.
3. **The one-time section still appears once** — proportionally *cheaper* at 10 SKUs than at
   1. It carries the tier grid like every other section, but it does **not** multiply by SKU
   count, and that is the load-bearing economy. The design gets less expensive as SKU count
   rises, which is the right direction.

**No default expansion**, per anchor-SKU retirement. "Where do I start" is answered by the
ledger and the owner filter, which is better than an arbitrary priority — there was no
business reason to rank SKUs, so the page shouldn't imply one.

## 5 · The collapse unit — decided

**The collapse unit is the completed SKU row. A section whose every row is complete
collapses as a whole.**

One rule, two granularities, because they're the same rule at different scales:

- **Mid-work** (packaging: 7 done, 3 outstanding) → the 7 completed rows collapse to summary
  lines. This is exactly the owner's question: *show me my remaining work.*
- **Done** (all 10 complete) → every row is collapsed, so the section reads as a single
  complete band. Section-level collapse is the degenerate case, not a second mechanism.

**Constraints on a collapsed row:**

- It **keeps its per-unit total visible.** A collapsed row is chrome reduction, not
  information hiding — the number stays, the editing affordances go.
- It shows: SKU code · status · per-unit total at the active tier. One line.
- **It never collapses if incomplete.** No exceptions, no "collapse all".
- **Nothing collapses below 4 SKUs.**
- Collapsed rows preserve tier column geometry, so the grid doesn't shift as rows open and
  close.

## 6 · The ledger, reshaped for multiple owners

You're right that §5's per-SKU list doesn't map onto a section-major page. But the fix isn't
to swap one axis for the other — it's that **there are now two readers with two different
questions**, and a flat list serves neither:

| Reader | Question |
|---|---|
| Section owner (Purchasing / Production / Logistics) | *What's outstanding **for me**?* |
| Whoever closes the Quote | *Is this Quote costed **at all**?* |

**So the ledger is a small completeness matrix, not a list.** Rows = SKUs, columns =
per-unit sections, one status cell each. Plus **Shipping & one-time as a single standalone
entry** at the foot — it has no SKU dimension, so it cannot be a cell in a SKU grid, and
pretending otherwise would repeat the original mistake in miniature.

```
              PKG   PROD
  GLW-30       ●     ●
  GLW-50       ●     ◐
  RPL-200      ●     ○
  …
  Shipping & one-time      ◐
  ───────────────────────────
  3 of 11 not yet costed
```

**Why a matrix beats either list:** the owner reads a **column**, the closer reads a **row**,
and both get their answer from the same object with no mode change.

- **Column headers carry the owner's answer as a count** — *"Packaging 7/10"*. The owner
  reads one number; only if it's short do they scan down for gaps.
- **Rows are SKUs** because the rail is narrow and tall — many rows, few columns fits the
  geometry. Three or four section columns fit; ten SKU columns wouldn't.
- **Owner filter is primary** (per your note): selecting your section emphasizes that column
  and dims the rest. It's a *view* on one matrix, not a separate structure — so the closer's
  read is never destroyed by an owner's filter.

**Persistent rail, always visible.** On a page of unbounded length, a ledger that scrolls
away is decorative. This is the one element whose entire value is never being absent.

**Header line is an outstanding count, not a percentage** — *"3 of 11 not yet costed."* A
count is actionable; 73% doesn't tell you what to open.

**Language, from R9's status ledger: "not yet", never a blank.** A blank is ambiguous
between "zero cost" and "nobody looked" — and R6's schema already defines `NULL` as *no cost
entered at this tier, never inherited*. The ledger should say what the schema already means.

**Clicking a cell** moves the page to that section and expands that row. Scroll positioning
within one page — **not navigation**, and it must not become navigation.

**House rule, third instance** (R8 sent-vs-draft, R9 note-vs-tier, this): *if completing a
task requires knowing about state that isn't on screen, put the state on screen — don't
improve the route to it.*

## 7 · Naming — your check, and a concrete fallback

**"Shipping & one-time costs"** stands as the recommendation. Your concern is the right one:
the section also holds **duty, customs, testing, tooling**, and duty/customs are precisely
what someone might look for and not find under "shipping".

**If Aisha says "shipping" doesn't read as covering duty and customs, the fallback is
"Landed & one-time costs."** That's not a compromise — *"landed"* means **duty- and
customs-inclusive** in trade vocabulary, so it answers the exact objection. And it's DPS
domain language rather than implementation jargon: these PMs already work in FOB Long Beach
and EXW, so it exposes no internal concept and needs no training.

Decision rule for the check: if duty/customs are the terms PMs reach for first, use
**Landed**; if they think of it as "getting it here", use **Shipping**.

## 8 · Confidence and remaining contingency

**Confident:** §1's correction (evidence) · §2's guard · §3's geometry · §4a–d · §5's
collapse decision · §6's matrix ledger · §7's fallback rule.

**Resolved since last round:** §5.1 (section-major) · §5.2 (multi-owner — and it's the
reason) · §5.4 (anchor SKU retired) · NRE amortization stays visible in the per-unit view ·
one-time costs are per-tier operator entries (§1 correction) · **Pricing merges the two
families** — one total per tier, breakdown as the traceability mechanism.

**Still open, and not mine:**

- **NRE migration** → Business Validation, as you've routed it. `allocate_service_fees_to_
  unit_cost` routes service fees through different markup paths and both reach sell price,
  so it's a pricing question. **Layout note:** if NRE stays in Production, the one-time
  section holds fewer lines than §4a implies, but nothing structural changes — the section
  exists regardless, because freight/duty/customs/testing are already there.
- ~~Pricing inheriting the two-family split~~ → **answered.** Pricing shows one total per
  tier across all components; the families merge there, correctly. The breakdown is the
  traceability mechanism, not a second cost-entry surface. Design question moves to *what
  the breakdown looks like* — its own brief.
- ~~Bulk Raw arity~~ — **retired.** Bulk Raw is out of v1 (CA, Aug 2026): plumbing
  preserved, operator surface removed, returns with NetSuite Assemblies. It is gone from
  §4a's structure and from the ledger. With no operator surface there is nothing to place,
  so the arity question I had flagged dissolves rather than being answered.


---

## §9 · Corrections applied (CA, Aug 2026)

1. **One-time costs carry the tier grid.** They are entered **per tier, explicitly, by the
   operator** — the system derives no division. §1's table, geometry rule 2 and §4a's diagram
   all reflect this. The two families remain real, and the distinction is now exactly one
   thing: **the SKU dimension.** Per-unit costs have one; one-time costs do not. That — not
   the grid — is why the one-time section appears **once at the foot**, and the page-length
   economy is unaffected. **Amended by §11 (OD-032):** one-time costs gain an *owner*
   dimension, which groups rows within the single section rather than repeating it.
2. **Bulk Raw is out of v1.** Removed from §4a's section list and from the ledger's columns.
   Plumbing preserved; returns with NetSuite Assemblies. The per-unit family is now
   **Packaging + Production**, and the open arity question is retired rather than answered.

Everything else in this document stands: section-major, the scroll/collapse guard, the
completeness matrix, the tier geometry, and the naming decision.


---

## §11 · Amendment — one-time costs gain an owner dimension (OD-032, Aug 2026)

**Documentation only. No runtime or UI behaviour changes with this amendment** — it settles
the Design Authority so the later OD-032 UI phases build against a document that is true.

### What stops being true, and what does not

This document's load-bearing claim for the one-time section is:

> per-unit costs have a SKU dimension; one-time costs don't — that is why the one-time
> section appears once at the foot.

**Half of that stops being true.** Under OD-032 a one-time charge is owned by the commercial
object that caused it: `'@quote'` for engagement-level charges — project setup, container
freight, duty — or a packaging component for the charges that component caused. So an owned
charge **has an owner dimension.**

**The economy survives, and the correction is narrow**, because the section's rows were
always *lines* rather than SKUs and it already carries the tier grid:

> **Rows group under their owner. The section still appears once. Tier column x-positions are
> unchanged.** Quote-owned charges group under a **Project** heading — the honest name for
> what that section has always held.

### Why an owner dimension does not repeat the section

A SKU dimension would repeat the section, because a per-unit cost exists once *per SKU* and
the reader needs each SKU's figure side by side. An owner dimension does not: a charge exists
once, under exactly one owner, and grouping is how the reader is told which. Grouping adds
headings inside one region; it does not add regions.

That is the whole reason the page-length argument in §4b — "the majority quote is one SKU
plus a pile of one-time costs" — is unaffected. The pile gains headings. It does not gain
copies.

### ⚠ SUPERSEDED 2026-08-27 — the heading below is not Project

Everything from here to the end of §11 was written against a **two-type** owner model in
which every existing charge was quote-owned. Disposition B at the Phase 3 stop replaced it
with three types, and the existing population is **Item Group**-owned per BV-012 §1.a, not
Project-owned.

So the operative sentence above — *"Quote-owned charges group under a **Project** heading"* —
remains true of quote-owned charges and **describes no charge that exists today**. The
population it was written about groups under its **Item Group**.

The rest of §11 stands: rows group under their owner, the section still appears once, and
tier column x-positions are unchanged.

The subsection below is retained as the record of what was decided and why it did not
survive contact with BV-012.

### The Project heading is a rename, not a new concept — SUPERSEDED, see above

Every charge in the section today is engagement-caused; none has ever had another owner. The
heading names what was already true rather than introducing a category, which is why existing
quotes need no migration and no backfill to render correctly under the amended layout.

### What this amendment deliberately does not decide

- **Whether a legacy charge may display an owner name.** It may not, and that is governed
  outside this document: charges whose `owner_ref` is anchor-coerced are Project-owned for
  OD-032 purposes and their anchor is never surfaced as a cause. See OD-028 and
  `docs/validation/od-032-implementation-plan.md` §2.2.
- **The two-phase entry sheet.** That is the round trip's §03, not this document's concern.
  This document governs the Costs region the resulting rows land in.

---

## §10 · Delivered as a render

**Prototype:** `Nexus Costs Workspace.html` → `app/costs/{data.js, styles.css, workspace.jsx}`

Edward's question from the round that started this — *does section-major work with real
multi-SKU data?* — answered at the comfort target: **3 SKUs × 4 tiers, real arithmetic.**

**The fixture reads its inputs from `window.NXR10` rather than restating them**, and inherits
R10's discipline of computing everything from inputs with no stored totals. R6's numbers are
not used anywhere.

> ### ⚠ Sharing an input set is not sufficient — the derivation has to match too
>
> The first cut of this render asserted that reading inputs from `NXR10` made "the Costs page
> and the Pricing page cannot disagree" structural. **It didn't, and they did.**
> `dutyTariffLines()` built its base as packaging + production + allocated services and
> omitted **bulk raw** — so Costs understated duty by $0.0162/unit and tariff by $0.0300/unit
> at T2, about $1,386 across a 30,000-unit order, with nothing on either page saying so.
>
> Two mistakes, and the second is the instructive one:
>
> 1. **"Plumbing preserved, operator surface removed" means the term stays in the
>    arithmetic.** Bulk Raw is out of the sections and out of the ledger — it is *not* out of
>    factory cost, and therefore not out of the duty and tariff base.
> 2. **A guarantee that nothing checks is a comment.** I wrote the claim into the header and
>    into this document and then didn't build it. The cost stack's reconciliation strip is the
>    precedent I had and didn't apply.
>
> Both fixed. `crossCheck()` recomputes Pricing's `factory_cost_per_unit` from R10's own
> `compute()` and compares it to this page's base for every SKU × tier, and the page renders
> the result: *"✓ duty & tariff base matches Pricing's factory cost — all 12 SKU × tier
> combinations."* If they ever diverge the strip turns red and names the combinations.
>
> **Load-bearing:** any claim that two surfaces cannot disagree must be asserted on screen by
> something that would fail loudly if it stopped being true. ← LOAD-BEARING

> ### ⚠ …and the same rule applies WITHIN a page
>
> The one-time section had a second instance of the same class. `oneTimeLines()` assigned
> scope by **position in the fixture** — whatever sat on `skus[0]` was called project-wide —
> so *Artwork adaptation*, carried by GLW-30 alone, was labelled `project` on a page whose
> entire job is cost attribution. Tooling was attributed correctly, which made the
> inconsistency sharper: two fees on one SKU, one right and one wrong.
>
> Worse, the label set was built from `skus[0]` plus a name match, so **a fee unique to a
> later SKU could be dropped from the section entirely.** It reconciled with Production's
> allocated-services row only by accident of the fixture's shape.
>
> Both fixed by removing the dependence on ordering and naming:
> the label set is the **union across all SKUs**, and **scope is derived from the carrier
> count** — project when every SKU carries the fee, otherwise named for its carriers.
>
> And the assertion I had just written the rule about, applied where I hadn't: the one-time
> section and Production's "+ allocated services" row show **the same money twice**, so the
> page now states it — *"✓ these fees equal Production's allocated services at every tier."*
>
> **The generalisation:** the rule is not about *pages*. Any number appearing twice — across
> surfaces or within one — needs something that fails loudly when the two stop agreeing.
> "It reconciles today" is not a property of the design if nothing checks it.
> ← LOAD-BEARING

Verified in the render:

- **Packaging reconciles exactly** — component lines sum to the SKU's per-unit cost
  (GLW-30 · T2: five lines → $1.2500, computed $1.2500).
- **One grid template across every row on the page** — a single
  `grid-template-columns` value for all sections including Shipping & one-time, so a tier
  reads straight down the whole page with no carve-out (geometry rule 2, now universal).
- **Ledger reads "3 of 7 not yet costed"** — a count, not a percentage. Rows are SKUs,
  columns are the per-unit sections, and Shipping & one-time is a standalone entry because it
  has no SKU dimension.
- **"not yet" never a blank** — RPL-200's un-started production cells say so in words.
- **Expansion** shows component lines with run totals and terminates in a human act
  (*Purchasing · Ana Reyes · 2026-04-18 · Verre Pacific quote VP-8841*).
- **Nothing is folded at 3 SKUs**, per the guard — collapse begins above 3.

**Both corrections are in the render, not just the document.** One-time costs carry the tier
grid, with an in-page note that every amount is a per-tier operator entry and the section's
economy is appearing **once**. Bulk Raw is absent from the sections, the ledger and the
arithmetic.

**One thing the render made concrete** that the document only implied: Production shows COGS
per unit, with allocated services as a muted **consequence** row reading *"entered in
Shipping & one-time — shown here as a consequence."* That is the answered pre-build question
(if NRE moves, the per-unit amortisation stays visible) rendered rather than described — a
PM sees the $0.20 in their unit cost and where it came from, without it being editable in
two places.
