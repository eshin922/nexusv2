# Round 11 — the composed Pricing page · Designer notes

**Deliverable:** Pattern 30 canonical source for the Pricing Workspace.
**Prototype:** `Nexus Round 11.html` → `app/r11/{data.js, styles.css, pricing-page.jsx}`
**Relationship to R10:** R11 **composes** R10; it does not replace it.

> `app/r11/styles.css` is an **addendum** to `app/r10/styles.css` — load root, then r10,
> then r11. Three documented overrides, all in the trace's *placement*, none in its
> vocabulary. `app/r10/pricing-trace.jsx`'s `Level` / `Origin` / `Resolution` / `Recon` are
> reused **verbatim**.

---

## 1 · What changed from R10, and why

Stated explicitly so the relationship is legible rather than inferred from a diff.

| | R10 | R11 |
|---|---|---|
| **Page** | a price grid + trace, nothing else | the full detail section: adjustment · compliance · cost stack · per-SKU breakdown · reference |
| **Trace entry** | always at the root (`Quoted sell`) | **at the node pressed**, ancestors in a breadcrumb |
| **`Trace` component** | `Trace` — root-only | superseded by **`TraceAt`** (`app/r11/pricing-page.jsx`) |
| **Node kinds** | eight | **nine** — `blend` added (§3) |
| **§5 default claim** | *"is this price right?"* — an assumption, and wrong | the horizontal question, answered with zero expansion (§5) |
| **Node keys** | counter-generated — **a defect** (§7) | deterministic |

R10's grid is **retired**. It was a harness for reaching the trace, never a proposal to
replace the detail section — see `r10-designer-notes.md` §10.

## 2 · The composition move: the trace opens where you pressed

`TraceAt(root, targetKey)` walks the node tree to find the path to `targetKey`, renders
**that node as level 0**, and puts everything above it in a breadcrumb:

```
inside  [ Sell before adjustment $3.3392 ]  ›  Production
```

Press **PROD at T3** because it looks fat and you land on production — not on quoted sell
with three levels to descend. Breadcrumb entries re-root the trace, so zooming out is one
click and zooming out is *available* rather than *mandatory*.

> **The horizontal view chooses the node. The vertical view explains it.** ← LOAD-BEARING

### 2a · Override framing must survive entry-at-node

Entry-at-node broke something R10 got for free. R10's `Trace` always entered at the root, so
an overridden cell always hit the `isOverrideRoot` branch and got the "set by a person, not
calculated" panel. `TraceAt` unwraps to `superseded` to reach the section node — which meant
the framing, being a property of *the root*, disappeared the moment the root changed.

The symptom was the exact failure this workstream exists to remove: a chain topping out at
`$4.5770` while the page said `$5.95`, with nothing on screen reconciling the $1.37 gap.

**Fix: the framing is a separate `supersededBy` prop, not a property of the root**, so it
survives *any* entry point. It renders above the entered node using the existing
`.r10-override` vocabulary — no new chrome — and `StackTrace` passes it too, because the
blended chain has the same hole wherever a tier holds an override.

**Second half of the same defect: the anchor meta mixed bases.** It showed an
override-derived margin on top of a computed-derived chain with no label. Both bases are now
named: *"10,000 units · quoted $5.95 (PM-set) · margin on quoted 41.1%"*.

This is load-bearing item 4 (the override is not an arithmetic node) reasserted in the
vertical view — the horizontal view already had it as the `PM overrides` stack row (item 11).
**A guarantee held in one projection is not held in the other unless it is stated in both.**
← LOAD-BEARING

### 2b · …but the blended chain gets a SCOPE note, not an override banner

Fixing §2a I overreached: `StackTrace` synthesised an object *shaped* like an override node
so it could reuse `supersededBy`. That made the banner lie. On any T2 stack cell it read
*"The quoted price is $3.88 — set by a person, not calculated"* — but $3.88 is a **weighted
mean of two computed prices and one PM-set one**, so it was never hand-set, and the panel
presented an arithmetic node *as* a human act. Exactly the inversion item 4 forbids.

Two further faults fell out of the same shortcut: the sentence was ungrammatical, because
non-values were stuffed into an `{actor} entered it on {when}` template; and it fired on
Packaging, Freight, Duty and Tariff rows, none of which the override touches.

The deeper fact: `StackTrace`'s synthetic root is **sell before adjustment**, which is
entirely computed. *No node in that tree was hand-set.* There was nothing to frame.

What the blended chain actually needs is a statement of **what it does and does not
explain** — so `TraceAt` gains a distinct `scopeNote` prop, rendered in the calm
`.r11-noop` treatment rather than the warn-register override banner:

> ↳ This chain explains **sell before adjustment ($3.3392)**. The quoted blended price
> ($3.8803) also carries the 2.5% price adjustment and 1 PM-set cell (GLW-50) — both are
> rows in the stack above.

**Rule: two facts that look similar are not the same fact. `supersededBy` means *this
number was hand-set*; `scopeNote` means *this chain stops short of the number you see*.
Reusing one chrome for both makes it assert something false.** ← LOAD-BEARING

**Follow-on: the scope sentence is composed from its own clause list.** The first cut made
the PM-set clause conditional but left the closing "…both are rows in the stack above"
fixed, so on the three tiers *without* an override the sentence promised two referents and
named one. Same defect class as the template it replaced — conditional parts and fixed parts
disagreeing.

Fixed structurally rather than by patching the string: the clauses are built as an array and
the sentence is rendered *from* it, including the closing agreement ("both are rows" /
"that is a row"). **Copy that varies with data must be generated from that data, never
assembled from a conditional fragment and a fixed tail** — the two drift apart the moment
anyone edits one of them. ← LOAD-BEARING

This also repairs the weakest part of R10's "never leaves context" promise: the anchor bar
now names the **node** being explained, not just the cell.

## 3 · The ninth node kind: `blend`

The cost stack is quote-blended across SKUs, and blending is not a sum — it's a **weighted
mean**: `Σ(value × units) ÷ Σ units`.

That is neither a tree nor a sum, and the contract absorbed it without an exception, which
is the third independent confirmation of the contract-not-component argument (the first two
being `resolution` and `override`). A blended stack cell expands to the per-SKU section
nodes, which expand into R10's chain unchanged.

Blending is **linear**, so the blended rows still sum to blended sell-before-adjustment —
the reconciliation assertion survives the projection.

## 4 · The stack reconciles all the way to the quoted price

The stack's rows are the six level-1 section nodes, then:

```
Sell before adjustment
+ Price adjustment      (tier ?? global — replaces)
+ PM overrides          (not derived — a human act)
= Quoted sell
  Unit cost
  Margin
```

**The `PM overrides` row is new and load-bearing.** Blended computed sell and blended
*actual* sell differ wherever an override exists, and without that row the column would
silently fail to reconcile — the exact R6 failure this whole line of work exists to prevent.
Making overrides visible in the horizontal view is a side benefit: today they're invisible
until you open a cell.

A footer asserts the arithmetic across all four columns, not just the one you're looking at.

**Cost is shown beneath sell in every component cell**, so the markup contribution is legible
without a mode switch. A cost/sell toggle would have been a mode, and a mode is a thing to
remember you're in.

## 5 · The routine decision — stated, not assumed

> **Assumed:** *"are all my tiers above target, and if not, what do I lift?"*

Everything above the breakdown answers that with **zero expansion**: compliance gives blended
and worst margin per tier with status; the stack gives composition across all four tiers at
once; the adjustment control sits next to the evidence for using it.

**This assumption is printed on the page itself**, in a dashed panel addressed to Edward, so
it gets confirmed or corrected rather than inherited. That's deliberate: this is the third
time in this workstream that reasoning harder produced a wrong answer where checking would
have produced the right one (the arity argument, the §5 default, and — nearly — this).

If the routine decision is something else, **the page needs re-ordering, not more
disclosure.** Disclosure cannot repair a wrong default.

## 6 · The global-adjustment finding, built

`A = tier_price_adj_pct ?? global_price_adj_pct` — **replaces, never stacks.** So a global
lift reaches **no** tier carrying its own adjustment, and **no** cell carrying a PM override.
A PM raising global from 2.5% to 4% today sees three tiers move, one not, and nothing on the
page explains it.

**Preview Changes now states it**, per tier, using only what the resolution node already
computes:

> ⊘ **T3 · GLW-30** is on its own 4% adjustment and is **unaffected** — a tier adjustment
> replaces the global one, it does not stack. *Maya Okafor · 2026-07-02*

Two hold reasons, both surfaced: **tier adjustment** and **PM override**. The override case
was not in the original finding — it fell out of building it, and it's the more dangerous of
the two, because an override can exist on a single SKU within an otherwise-moving tier.

Actor, date and reason are all already in the node. No new data — just reading what's there.
This is the house rule's **fourth** instance and the **first applied to an action** rather
than a readout: *the state that determines the outcome should be on screen at the moment of
acting, not reachable afterwards.*

### 6a · The no-op state, and why it isn't a detail

`draft` initialises to the current global, so pressing **Preview changes** without editing
the figure is the natural first interaction with the control. That path originally produced
twelve warn-styled boxes reading *"does not move and is unaffected — · —"*: tautological
copy, em-dash placeholders where an actor and date belong, and alarm styling asserting that
something was wrong when nothing was.

That is worse than cosmetic. This panel is the round's headline finding, and its entire
claim is that it states what a lift will not reach **and why**. A default state firing
twelve reasonless warnings trains the PM to dismiss precisely the surface built to be
believed — the same argument the R9.2 spec makes for staying silent on ambiguity: **a
dismissed check is worse than no check, because it launders the error.**

Two changes, both in the contract rather than the styling:

1. **`reason` is `null` unless there is a genuine one.** A row that doesn't move because
   nothing changed is not *held* — it is simply unchanged. `held` now contains only rows
   with a real reason, so a reasonless warning cannot be constructed.
2. **No-op is a distinct state**, not an empty version of the preview: one calm line,
   neutral styling — *"No change. 2.5% is already the global adjustment — enter a different
   figure to see what a lift would reach."*

**Rule this generalises to: a warning must carry a reason. If it cannot, it is not a
warning — it is a state, and it needs its own message.** ← LOAD-BEARING

## 7 · Defects fixed in R10 (stated, not silent)

**7a · Node keys.** `app/r10/data.js`'s `node()` fell back to an incrementing counter when no
key was given. Keys therefore regenerated on every re-render, silently breaking any
open-state keyed by them — **packaging and freight were the affected level-1 sections**, so
exactly the two cells a PM would press first. Now deterministic (`kind·label`). R11's
entry-at-node depends on stable keys, which is how it surfaced.

**7b · `React.Fragment` prop rejection.** `Level`, `Resolution`, `Trace` and `PricingGrid`
used `<Fragment>` as a multi-child wrapper. The host injects `data-om-id` onto rendered
elements and Fragments reject arbitrary props, so every render logged errors that escalated
per interaction. Removed from R10 and R11 alike — **no `Fragment` remains in either file.**

The replacement is not uniform, and the distinction matters for CC:

- Where the Fragment wrapped **block content inside an existing box** (`Level`'s
  operands+`Recon`, `Resolution`, the override branches) → a plain `<div>`.
- Where the Fragment wrapped **siblings that must participate in a parent grid**
  (`PricingGrid`'s `.r10-row`s, `Breakdown`'s `.r11-brow`s, the `.r11-scell` cell content,
  the breadcrumb's flex children) → `style={{ display: "contents" }}`. A plain wrapper there
  would break the `:first-child` border rules and the sibling flow.

> **Rule for this codebase, third instance:** never use `Fragment` as a multi-child wrapper
> in rendered output. When the children must stay grid/flex siblings, use
> `display: contents` — not a plain `div`.

**7d · Inline spans, again.** `.r11-bsku .n` and `.r11-bsku .m` computed to `display: inline`,
so the product name and the SKU code shared a line box — "Hydra-Glow Vitamin C
Serum**GLW-30 · 30 ml**" — and `.m`'s `margin-top` was inert, because vertical margins do
not apply to inline elements. Fixed with `display: block` on both.

This is the **third** occurrence of one rule I had already written down after the R9 receipt
fix, so it is promoted here from a chat note to canonical text:

> **A `<span>` in JSX has no `display`. Any rule that sets `margin-top`, `white-space` or
> `text-overflow` on one must also set `display` — unless the span is already a flex or grid
> *child* (which blockifies it). Being the *descendant* of a flex item is not enough.**

That last clause is what caught me: the wrapper `<span>` here *was* blockified as a flex
item, but its children were not, and blockification does not inherit.

**7c · `Recon` ignored `blend` nodes.** It only asserted on `kind === "sum"`, so an opened
blend node showed an operation with no reconciliation — a gap against load-bearing item 5 by
my own rule. `Recon` now handles both: sums assert their operands **sum** to the parent,
blends assert they **average** to it. The assertion applies to every arithmetic node kind,
not only sums.

## 8 · Load-bearing — R10's nine stand, plus three

R10's items 1–9 are unchanged. Added:

10. **The cost stack reads R10's own node objects** (`sectionsOf()` reaches into
    `sellBefore.operands`; it does not recompute). This is what makes "they cannot disagree"
    true rather than aspirational. If anyone re-derives stack values independently, the
    guarantee is gone.
11. **The `PM overrides` row.** Without it the stack silently stops reconciling wherever an
    override exists.
12. **Preview Changes states what it will not reach, and why.** An action whose effect is
    partly invisible at the moment of taking it is the failure this exists to remove.
13. **Reconciliation covers every arithmetic node kind**, not only sums (§7c). A node that
    shows an operation and asserts nothing is the R6 failure in miniature.
14. **A warning must carry a reason** (§6a). `reason` is `null` when there isn't one, and
    the no-op is its own state with its own message — never a silent-but-alarming preview.
15. **Override framing travels with the chain, not the root** (§2a), and any panel showing
    two bases names both. A guarantee held in one projection is not held in the other unless
    it is stated in both.
16. **`supersededBy` and `scopeNote` are different facts** (§2b). "This number was hand-set"
    is not "this chain stops short of the number you see". Never render one as the other —
    a blend containing a PM-set cell is a composition, not a human act.
17. **Data-dependent copy is generated from the data** (§2b follow-on), closing agreement
    **and list joining** included. A conditional fragment welded to a fixed tail disagrees
    with itself; so does a two-item joiner (`join(", and the ")`) applied to an n-item list —
    correct at n=2, ungrammatical at n=3. Both are the same defect one layer apart, and
    n=3 became reachable the moment the surgical lift shipped (adjustment + lift + override
    on one tier). `joinClauses()` is correct at every n, so the next lever cannot break it.

Cosmetic (safe to adjust): panel ordering within the two-column row, reference-cell
highlighting, breadcrumb chip styling, stack row label wording.

## 9 · Named structure (Pattern 30 — implement verbatim)

**Contract** (`app/r11/data.js`): `sectionsOf(result)` · `quoteAtTier(ti, flags)` ·
`previewGlobal(newPct, flags)` → `{noop, current, newPct, tiers}` · `findPath(root, key)`.
**Presentation** (`app/r11/pricing-page.jsx`): `PricingWorkspace` · `AdjustmentPanel` ·
`CompliancePanel` · `CostStack` · `ReconStrip` · `Breakdown` · `Reference` · **`TraceAt`** ·
`StackTrace` · `SkuTrace`.
**Reused verbatim from R10:** `Level` · `Origin` · `Resolution` · `Recon` · `compute()` ·
`node()`.

**Canonical classes** (`app/r11/styles.css`): `r11-page` `r11-assume` `r11-cols` `r11-panel`
`r11-phead` `r11-pbody` `r11-adjrow` `r11-field` `r11-cur` `r11-preview` `r11-prow`
`r11-held` `r11-noop` `r11-comp` `r11-ccell` `r11-status` `r11-stack` `r11-srow`(`.head .rule .total`)
`r11-slab` `r11-scell`(`.flat .open`) `r11-recon` `r11-brow` `r11-bsku` `r11-bcell`
`r11-sub` `r11-ref` `r11-refcell`(`.best`) `r11-crumb` `r11-tracewrap`.
Overrides of r10 (three, documented in-file): `.r11-tracewrap .r10-trace`,
`.r11-tracewrap .r10-level .r10-lhead .depth::after`, `.r11-tracewrap .r10-anchor`.

`.r10-dn` and `.r11-assume` are prototype-only — **strip both in production.**

## 10 · Open

- **The routine decision** (§5) — printed on the page for Edward.
- **Blended vs per-SKU cost stack.** I chose **blended at quote level**, with per-SKU stacks
  inside the breakdown, because a per-SKU stack would need a SKU selector and that is
  switching under another name. If the production stack is per-SKU today, this is a change
  worth confirming rather than assuming.
- **`origin` provenance source** — carried from R10 §7.2, still the pre-build question.
  Which existing record supplies actor / timestamp / document per input type? Chains cannot
  terminate correctly without it.
- **Bulk Raw** — still provisional, still carrying its warn note, still with Business
  Validation.


---

# §11 · Provenance, the surgical lift, and the freight flag

## 11.1 · Provenance — two grades of terminal, and one thing to fix in the schema

Confirmed: **actor and timestamp exist for every commercial mutation. Source documents
largely do not** — only packaging carries a vendor and a free-text note. The R10 fixture has
been corrected to match, so CC does not build to a richer terminal than the data can supply.
The illustrative *"Verre Pacific quoted it Apr 18"* chain now exists only where it really can.

**The stopping rule holds.** "Who set this and when" *is* a human act, and it is a complete
answer to the question the trace asks. So the thin grade is **not styled as deficient** — no
empty document slot, no "missing source" placeholder. It differs only in its closing line:

| Grade | Closing line |
|---|---|
| Sourced (packaging) | *end of chain · entered from a supplier source* |
| Thin (everything else) | *end of chain · a person set this figure; no source document is recorded* |

The thin line states the absence once, factually, at the point where a reader might wonder —
rather than rendering a gap they have to interpret. Sourced terminals additionally take an
accent left-edge, so the two are distinguishable at a glance without either looking broken.

### ⚠ The audit FK must not be `ON DELETE SET NULL`

Flagging this as **load-bearing to the pattern, not an operational nicety.** The stopping
rule is *you stop when you reach a person*. If deleting a Nexus user nulls historical actor
identity, then **every chain that terminated in that person retroactively terminates in
nothing** — and a trace that ends in "unknown" is not a thin terminal, it is a broken one.

Recommendation: **denormalise the actor's display name onto the audit row** at write time,
so the terminal is a historical fact rather than a live join. Provenance is about what
happened, and what happened does not change when someone leaves.

## 11.2 · The surgical lift

**Where it lives: at the breach, never as a standing lever.** Edward's instinct is right and
the house rule points the same way — the routine act is *checking compliance*; the lift is
the exception path off that finding. So it surfaces **inside the compliance cell that reports
the breach**, and if every tier clears the floor **the control does not exist on the page at
all.** A standing fourth lever would advertise an action that is usually wrong to take.

**Collapsed to the worst breach per tier**, with `+ 2 more cells below floor at T1`
expanding the rest. Same discipline as the Costs workspace: the exception must not outweigh
the routine read, but nothing pending is ever hidden — the count is always visible.

### The question you asked me to answer rather than assume

> Should a cell above floor but below target offer the lift?

**No — floor only.** The lift is *corrective*: it answers a firm mandate, and its size is
computed, not chosen (`cost ÷ (1 − floor)`). Target is a *goal*, and closing a gap to a goal
is a commercial judgement with no correct answer — which is precisely what the global and
tier levers are for.

Offering the corrective control for a judgement call would blur the two authorities, and it
is that distinction which made the lever independently persisted and independently removable
in the first place. **A lever that answers to one authority should not appear when the other
one is speaking.** ← LOAD-BEARING

### Composition, not replacement

The lift **multiplies separately** from the tier/global adjustment:

```
computed_sell = sell_before_adjustment × (1 + A) × (1 + lift)
                                          A = tier ?? global   ← replaces
                                                                 lift ← composes
```

It is **not** part of the `tier ?? global` resolution ladder, and the trace shows it as its
own `adjustment` node so the two cannot be read as alternatives. No tenth node kind was
needed — the operation shape already existed.

### The stack needs a `Surgical lifts` row

A fourth lever that changes the price means the column stops reconciling without a row for
it. This is load-bearing item 11 applied a second time, and it is now the second time a new
price influence has required a new stack row — so, stated generally:

> **Every lever that can change a quoted price owes the cost stack a row.** If it cannot be
> shown as a row, the stack cannot assert reconciliation, and the assertion is the thing that
> makes the stack trustworthy. ← LOAD-BEARING

### Override conflict — reject with a route

An override is a person saying *"this price, specifically."* A lift computing over it would
silently overturn a deliberate decision, so the lift is **rejected, not overruled**, and the
rejection names the person and the date and offers the way to act:

> **GLW-50 · lift unavailable** — This cell has a price override set by **Maya Okafor** on
> 2026-07-24. Remove it before applying a lift. → *Review override*

Without the route the state is on screen and the means to act on it is not — which is the
half-fix the house rule exists to prevent.

## 11.3 · The freight flag — rename **and** relocate

**Rename.** "Pass-through" means the opposite of what it does. In commercial usage passing a
cost through means *billing it separately, at cost, on top* — here it means bundling freight
into the unit price. A name that took a code audit to disambiguate is a name that will be
guessed wrong by every operator who meets it.

Recommendation: **`Freight on the customer's quote: bundled into unit price | shown as a
separate line`**. It names the two outcomes rather than a mechanism, and it is unambiguous
without training. (If a single term is needed: **"freight display"**.)

**Relocate — and this is the more important half.** It sits on the freight leg beside cost,
markup and units, all of which are pricing inputs. It is not one. Placing a presentation
setting among calculation inputs *teaches* the operator that it affects the calculation,
which is exactly the misreading that required a code audit to correct.

It belongs with the other customer-view settings — `pdf_layout`, `detail_level`,
`include_spec_addendum` — which are the things that decide **what the customer sees, not
what the quote costs.**

This is the same argument as the Costs review, applied one element down: *a page's
organisation should match what its elements actually are.* The freight flag is the clearest
single instance of that principle in the product, because here the mismatch has already
produced a documented misunderstanding.

## 11.4 · Costs corrections — confirmed

1. **One-time costs carry the tier grid.** Landed. `docs/costs-page-layout.md` §1 records the
   correction, geometry rule 2 is universal with no carve-out, and §4a's diagram shows the
   one-time section with the same grid as every other. Its economy is that it appears
   **once**, not that it is grid-free.
2. **Bulk Raw out of v1** — being applied to §4a now. Plumbing preserved, operator surface
   removed, returns with NetSuite Assemblies. This also **retires the open question** I had
   flagged about its arity: with no operator surface, there is nothing to place.


---

# §12 · Compliance becomes per-cell

Both of Edward's criticisms are correct, and the second one is structural. Answering it
**removed** a surface rather than adding one.

## 12.1 · Is there a tier-level read that matters independently?

You asked me to say what it is if there is one. There is — but it is **one row, not a panel.**

- **Blended margin per tier** is a genuine independent fact: it is what the quote earns at
  that tier, and it is the number the Sales Order tab's tier decision consumes. It survives.
- **Worst margin + exemplar SKU** was never an independent fact. It was a *pointer at a cell*
  — a summary standing in for the thing it was pointing at. That is why the panel could not
  drive the decision, and why `+ 2 more cells below floor` had to exist at all.

So the answer is not "per-cell instead of per-tier". It is: **the grid is the compliance
surface, and the tier-level read survives as a rollup row on it.** Symptom and diagnosis on
one surface, in the relationship they actually have.

## 12.2 · The merge — one grid, two jobs

R11 already had the right grid; it was in the wrong role. The per-SKU breakdown *was* the
per-cell compliance surface, sitting at the bottom of the page as diagnostic detail beneath
a summary that could not act.

**So the breakdown is promoted, not duplicated.** `ComplianceGrid` replaces both
`CompliancePanel` and `Breakdown`: each SKU row carries margin + price per tier
(compliance), and expands to section sells per tier (composition + trace entry). **One grid,
two jobs — the page has one fewer surface than before, not one more.** ← LOAD-BEARING

Every below-floor cell now carries its own `needs 3.0%` marker, so *"which cells look wrong"*
is answerable at a glance. Nothing is promoted and nothing is counted-and-hidden.

## 12.3 · The action names its target

Selecting a breaching cell opens an action panel that states the cell explicitly:

> **RPL-200 · T1** — is at 22.8%, below the 25% firm floor. A **3.0%** lift on
> **RPL-200 · T1** alone clears it. No other cell is affected.
> → *Lift RPL-200 · T1 to floor*

**A PM about to change a quoted price should never have to infer which cell they are
changing.** The old copy said "this cell" and relied on adjacency. ← LOAD-BEARING

**The panel renders against the row that owns it**, inside that SKU's `display: contents`
wrapper — the same placement `SkuTrace` uses. Rendered once at the end of the grid it was
positionally fixed while its trigger was not, so selecting a top-row cell put the action
243px below it at 3 SKUs and roughly 800px below at the 10-SKU case the Costs work was
sized for. **A disclosure that opens somewhere other than where you pressed has left
context, even without navigating.** ← LOAD-BEARING

Getting that right took two passes, and the second is the instructive one:
`display: contents` **flattens the SKU wrapper into the grid's block flow**, so "last child
of the wrapper" is not "next to the row" — it is after every one of that SKU's section
sub-rows too. Collapsed it measured 0px; expanded, 302px and rising.

**Source order must mirror what triggers each panel**, and now does:

```
.r11-brow          ← a margin cell here triggers…
CellAction         ← …this
section sub-rows   ← a section cell here triggers…
SkuTrace           ← …this
```

With `display: contents` there is no wrapper to contain anything, so adjacency is purely a
question of source order — the ordinary intuition that a child is "inside" its parent does
not apply.

Two additions that fell out of building it:

- **`Lift all N to floor` per tier.** Edward's point that a PM presses the button and the
  panel still says BELOW FLOOR was a real defect: one action could only ever fix a third of
  the problem. Each lift is still computed and persisted independently — this is a
  convenience over N independent corrections, not a new lever.
- **An applied lift satisfies the breach.** `liftToFloor` computes against the *unlifted*
  base — that is how the required percentage is derived — so `needed` stays true after
  correction. The grid reads `outstanding` (`needed && !applied`) everywhere a count is
  shown. Without it the tier still reported "3 cells below floor" at 25.0%, which is the
  panel contradicting its own number.

## 12.4 · Layout

Compliance is the routine act, so it is **first and full width**. The global price adjustment
is commercial and occasional — a single input, a button and its provenance — so it is a
**compact full-width bar beneath the grid**: read the problem, then choose the instrument
(per-cell lifts in the grid, or the whole-quote lever below it). Cost stack and reference
follow, unchanged.

The old two-column row gave a small control half the page and squeezed four compliance
columns into the other half. **Weight should follow frequency of use, not order of
implementation.**
