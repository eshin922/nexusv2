# Design Review — Costs page & multi-SKU Quotes

**From:** CD · **Re:** interaction model for costing a Quote · **Status:** recommendation, no implementation
**Sources read:** `app/r6/data.js`, `app/r6/page.jsx`, `docs/r6-designer-notes.md` (the original Costs design)

---

## 0 · Summary

**The current model isn't wrong and it isn't arbitrary — its prerequisite expired.** Same
shape as the FINALIZE gate, and you were right to suspect it.

My recommendation, in one line: **Costs should not be organized by SKU. It should be
organized by what each cost attaches to** — with SKU as a dimension *inside* the per-SKU
costs only, and the Commercial Cost Model surfaced as the peer it already is in the
architecture.

That makes the majority case (one SKU + one-time costs) read as a nearly flat page,
2–3 SKUs comfortable, and 10+ survivable. It also means **neither Packaging nor Production
is the accident** — see §3.

Confidence is high on §1–§4. §5 depends on four things I don't know and should not guess;
they're stated as questions, and one of them can flip my default view.

---

## 1 · What the original design assumed — and which prerequisite expired

This is the useful finding, and it's documented in my own notes rather than inferred.

R6's committed decision #1 was: **"Multi-tier is the page's primary spatial axis. Tiers are
columns everywhere."** And the data model behind it:

```js
scenario: {
  label: "Primary",
  sku: { code: "GLW-30", name: "Glow Capsule 30ml", anchor: true, units_total: 47000 },
}
```

Note the shape. `scenario.sku` is **singular**, and the flag is **`anchor: true`**.

So the original Costs design assumed **one scenario = one anchor SKU × N tiers**. The page
had exactly one axis of multiplicity to spend, and it spent it on **tiers**. SKU was never
a dimension at all — it was *scenario context*, a label in the header. `cost_stack`,
section rows, mini-stacks, line tables: all tier-major, all implicitly single-SKU.

**That assumption was true when it was made and is now false.** Slice 1 (BV-006/007/008)
introduced Components/Products and made SKU a real dimension of a Quote. But Costs never
received a second axis — so multi-SKU was retrofitted into the only place available: a
disclosure control in the context bar, sitting beside "Switch scenario".

Every operator finding follows mechanically from that:

| Finding | Cause |
|---|---|
| Visually de-emphasized though mandatory | It was added as *context*, not as workflow — it inherited the styling of the thing next to it |
| Operators overlook additional SKUs | Nothing on the page asserts that unfinished work exists elsewhere (see §4) |
| Reads as secondary | It **is** secondary in the model; the styling is honest about a model that's now wrong |
| One operator thought other SKUs were inaccessible | A disclosure implies optional depth, not a required traverse |
| Doesn't indicate which SKU is active | There was no "active SKU" concept — there was one anchor SKU, always |

**So the diagnosis is not "the navigation is weak."** Fixing the control alone would treat
the symptom of a missing dimension. The page needs a real answer for multi-SKU, not a
better disclosure.

## 2 · Your prior question — half right, and the better half is the important one

You asked whether SKU is the right organizing unit at all, given that the dominant Quote is
one SKU plus non-component costs.

**Correct that SKU is the wrong organizing unit. Not correct that the page lacks a
dimension most Quotes don't have** — 2–3 SKUs is common, so the SKU dimension is real; it
just isn't the *organizing* one.

The sharper framing: **costs don't all have the same arity.** Some belong to one SKU, some
belong to the Quote. The approved architecture already says this — the Commercial Cost
Model is deliberately *not* SKU children. The Costs page contradicts its own architecture
by implying everything hangs under a SKU.

That's why "one SKU + one-time costs" being the majority matters. In that Quote the
per-SKU family has **arity 1** and the one-time family has arity *n* — the page's whole
multiplicity is in the costs it currently treats as subordinate.

## 3 · Why three interaction models exist — the sections are telling the truth

The three models aren't three careless choices. Each section drifted toward **the natural
arity of its own cost object**:

| Section | Ships as | Because the cost object is… |
|---|---|---|
| Packaging | one SKU at a time | **genuinely per-SKU** — a 30 ml bottle belongs to GLW-30 |
| Production | multiple SKUs on one page | **often shared** — a filling-line setup spans SKUs in a run |
| Freight | ambiguous | **inherently multi-SKU** — a container holds several SKUs; it never fit either model, so it never resolved |

**Answer to your Q5: neither should adopt the other.** Making Packaging multi-SKU would
show a matrix mostly full of blanks — components don't cross SKUs. Making Production
one-at-a-time would force the operator to enter one shared setup cost *n* times, or to
pick a SKU to hide it under. Both "fixes" damage a section to satisfy a consistency that
was never the right axis.

Freight being ambiguous is the tell. It's the section whose arity matches neither model,
and it's the one nobody could classify. That's the strongest evidence that **arity, not
SKU, is the organizing principle.**

## 4 · Recommendation

**A unified workspace, organized by cost family, with a completeness ledger.**

### 4a · Two families, not one hierarchy

- **Per-SKU costs** — packaging components, per-SKU production. SKU is a dimension *here*.
- **Quote-level costs** (the Commercial Cost Model) — freight, duty, tariff, customs,
  testing, setup, tooling. **Peers of the per-SKU family, not children of a SKU.**

This makes the page's shape match the architecture, and it makes the majority Quote read
correctly: one SKU (a single block, no switching, no navigation) plus one-time costs
(a peer section, finally sized like the real work it is).

### 4b · SKU becomes vertical grouping; tier stays as columns

The genuine tension: you cannot have both SKU-as-columns and tier-as-columns. My call:

- **Tier stays horizontal.** Tiers are *comparative* — you read across them, and
  tier-as-columns is already the Nexus idiom in Pricing, tier selection, and the customer
  PDF. Changing it would break consistency across four surfaces.
- **SKU becomes vertical grouping** — stacked blocks inside the per-SKU family. You do
  *not* compare SKU against SKU the way you compare tier against tier; you complete them.
  Vertical scales to 10+ without a horizontal scroll, and collapses to nothing at arity 1.

At 2–3 SKUs — the comfort target — all SKUs are visible at once with no switching, which is
where the current model fails hardest.

### 4c · The completeness ledger — the actual fix for "operators overlook SKUs"

The disclosure control failed for a reason better navigation won't fix: **nothing on the
page ever said "you have unfinished work elsewhere."** Better navigation helps an operator
who knows to look. It does nothing for one who doesn't.

So: a persistent ledger of **what's left to cost** — per SKU and per quote-level cost,
showing complete / in progress / empty. Visibility into work remaining becomes a property
of the page rather than something the operator has to reconstruct by traversal.

This is the same bug class as the R9 note-vs-tier gap and the R8 sent-vs-draft mismatch:
**two facts that ought to agree, displayed apart, with no surface stating the
disagreement.** It's the third instance, which suggests it's worth naming as a house
pattern: *if completing a task requires knowing about state that isn't on screen, put the
state on screen — don't improve the route to it.*

R6 already has the raw material (`status: "empty" | "in progress" | "complete"`, plus
`owner`), so this is surfacing existing data, not inventing it.

### 4d · What I am **not** recommending

- Not tabs, sidebars, or a SKU dropdown — all three keep SKU as the organizing unit and
  preserve the traverse problem, just with better signage.
- Not a SKU × tier matrix — it punishes the majority to serve the rare case, and packaging
  would be mostly blanks.
- Not "fix the disclosure control." It would be cheap and would leave the model wrong.

## 5 · What this depends on — four things I should not guess

The brief invited questions rather than assumptions. These are real; #1 can change my
default view.

1. **Do PMs cost SKU-major or section-major?** Finish GLW-30 completely, then GLW-50 — or
   do all packaging across SKUs, then all production? My recommendation holds either way,
   but it determines the **default grouping** inside the per-SKU family. I've assumed
   section-major (sections outer, SKUs within) partly because of #2. If PMs actually work
   SKU-major, invert it: SKU blocks outer, sections within.
2. **Is costing one person's job, or several?** R6 carries `owner: "Logistics"` on freight,
   which implies handoffs. If different people own different sections, section-major is
   clearly right and the ledger should show owner per outstanding item. If it's one PM
   start-to-finish, #1's answer dominates instead.
3. **Are packaging components ever shared across SKUs within one Quote?** A common carton
   for two SKUs, say. If yes, "per-SKU" isn't strictly per-SKU and packaging needs a
   shared-component concept — which changes §3's table.
4. **Is `anchor SKU` still a live concept, or dead?** If a scenario still has a designated
   anchor, that's a legitimate default focus and the ledger should respect it. If Slice 1
   retired it, it should come out of the Costs header, where it still appears.

Also worth confirming, though it doesn't change the recommendation: **which sections have
actually been audited.** You said not all have. If any section beyond Freight turns out to
have mixed arity internally, that strengthens §3 rather than weakening it — but I'd rather
know than assume three.

## 6 · Fit with the rest of Nexus, and what this implies elsewhere

**Consistent:** tier-as-columns matches Pricing, R8 tier selection, and the customer PDF.
The completeness ledger reuses R9's status-ledger grammar (three states, plain language,
"not yet" rather than a blank). Cost-family organization matches Setup's
Components/Products distinction rather than fighting it.

**Two implications I'd rather name than design around:**

1. **The Commercial Cost Model becomes visible as a first-class thing in the UI.** Today
   it's architecture the operator can't see; under this recommendation it's a named peer
   section. That's a product decision, not just a Costs decision — it affects vocabulary in
   Setup and possibly Pricing. It's also required by principle 5 (expose no implementation
   concepts): the fix is a *plain-language* name for it, not the internal term. I'd want to
   land that name deliberately.
2. **Pricing may inherit a per-SKU/quote-level split.** If Costs stops implying everything
   hangs under a SKU, Pricing's rollup should reflect the same two families — otherwise the
   traceability principle breaks at the boundary. Worth checking before this ships, not
   after.

---

## 7 · Answers, in the order you asked

1. **One page per SKU?** No — the model's prerequisite (one anchor SKU per scenario)
   expired when Slice 1 made SKU a real dimension.
2. **Unified workspace?** Yes — organized by **cost family** (per-SKU vs quote-level), not
   by SKU.
3. **If one page per SKU, what navigation?** Moot, but recorded: if you keep the current
   model, the fix is still the **completeness ledger**, not better navigation. Navigation
   helps operators who know to look.
4. **If unified, how organized?** Per-SKU family (packaging, per-SKU production) with SKU
   as vertical grouping; quote-level family (freight, duty & tariff, testing, setup) as a
   peer section. Tiers stay as columns throughout.
5. **Should Packaging adopt Production's model, or vice versa?** Neither. Each already
   matches the arity of its own cost object; the inconsistency is a symptom of the wrong
   organizing axis, not the disease.
6. **What workflow matches how a PM actually costs a Quote?** *Complete the costs a Quote
   has, in the shape it has them* — most Quotes are one product and a pile of one-time
   commercial costs, and the page should look like that rather than like a SKU traverse.
   **This is the answer I hold with least certainty**, because it depends on questions 1
   and 2 in §5. Everything above is robust to their answers; the default view is not.
