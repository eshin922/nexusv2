# Round 10 — Pricing traceability · Designer notes

**Deliverable:** Pattern 30 canonical source for progressive commercial traceability,
built at the hardest node — the `cost × markup` transition.
**Prototype:** `Nexus Round 10.html` → `app/r10/{data.js, styles.css, pricing-trace.jsx}`
**Built on:** the verified chain from `src/lib/costing.ts` (CA, Aug 2026). No R6 figures.
**Standing:** the four qualifications from `docs/progressive-traceability-evaluation.md` all
hold — operation-plus-operands, terminal human act, contract-not-component, **Customer View
excluded entirely**. Plus §7: the default must be sufficient for the routine decision.

---

## 0 · The single design move

> **A trace is arithmetic made visible. It is not a breakdown.**

Every level answers *why is this number what it is* by showing the **operation** that
produced it, then the operands the operation consumed. A breakdown shows only the second
half, which answers a question nobody asked.

That's the whole design. Everything below is consequence.

## 1 · Node kinds — the vocabulary

Verifying the chain produced **eight** node kinds, not one. This is the concrete proof of
the contract-not-component argument: a component that "expands a tree" needs an exception
for five of these.

| Kind | Operation | Where it appears |
|---|---|---|
| `sum` | operands add | sell-before-adjustment, packaging, freight, production cost |
| `markup` | `cost × (1 + m)` | **the hardest node** — every section |
| `allocation` | `total ÷ Q` | COGS/unit, allocated services, bulk raw |
| `rate` | `base × pct` | duty, tariff |
| `adjustment` | `base × (1 + A)` | computed sell |
| `resolution` | **a choice, not arithmetic** | markup fallback, tier-vs-global adjustment |
| `origin` | none — terminal | vendor quote, run estimate, firm setting |
| `override` | **none — replaces the chain** | PM-set price |

Two of these are the interesting ones, and neither is a tree.

### `resolution` — the node kind I didn't expect

`markup = line ?? category default ?? "Other" ?? 0.30` is not arithmetic. It's a **choice
among candidates**, and the losing candidates are what make the winner legible. Showing only
"markup 32%" answers nothing; showing *"no line override · no Shrink default exists · so the
Other default, 32%, set by Ray Whitfield in February"* answers completely.

So resolution nodes render the **whole ladder** with the winner marked and the unavailable
rungs struck through, each with its reason. **This is load-bearing** — collapsing it to the
resolved value re-creates exactly the opacity the principle exists to remove.

The tier-vs-global price adjustment is the same kind, and shows why it matters: the chain is
*replaces, never stacks*, and a resolution ladder states that visually. Arithmetic couldn't.

### `override` — terminal, and deliberately not a node in the chain

Per your instruction: **do not depict the override as another arithmetic node.** So it isn't
one. GLW-50 · T2 opens with a plain statement — *"This price was set by a person, not
calculated"* — the human act, and a `⊘ no arithmetic above this point` marker.

The superseded computation is still shown, below a dashed rule, dimmed, captioned *"what the
chain would have produced."* Visible because a PM needs to know what they overrode; visually
demoted because it is **not** the reason the number is what it is.

## 2 · The hardest node, as built

`GLW-30 · T2 → Production` is the node that would have broken a naive design:

```
Production                                    $0.6600 per unit
  = $0.5000 cost × (1 + 32% markup)              [cost × markup]
    ▸ Production cost per unit    $0.5000
        = $0.3000 COGS + $0.2000 allocated services
          ▸ COGS per unit          $0.3000
              = ($1,800 filling + $1,200 assembly) ÷ 10,000 units
                · Filling + capping   $1,800   → Sam Idris, CM run estimate R-114
          ▸ Allocated services/unit  $0.2000
              = $2,000 one-time ÷ 10,000 units
                ▸ One-time services  $2,000  = 800 + 900 + 250 + 50
    ▸ Manufacturing markup           32%      → firm setting, Ray Whitfield
```

**Correction 1 built in:** one aggregate markup over the whole section. Production has no
per-line markup, so none is shown. Per-line markup appears **only** in packaging and in
freight/duty/tariff — and in packaging each line carries its own resolution ladder.

**Correction 2 built in:** `allocate_service_fees_to_cost` is a live toggle. Switch it off
and the allocated-services operand **disappears from the chain entirely** — production cost
becomes COGS alone, and a note states that one-time fees now bill as separate fixed charges
rather than entering the per-unit price. The chain's *shape* changes, not just its numbers.
That's worth seeing, which is why it's a tweak rather than a fixture value.

**Duty and tariff** compute on `factory_cost_per_unit` (packaging + production + raw — not
freight), and the markup applies to the **dollars**, not the percentage. Both are stated in
the operation line, because both are things an operator would otherwise assume wrongly.

## 3 · Reconciliation is asserted, not hoped for

Every `sum` level carries a footer stating that its operands reproduce its parent exactly:

> ✓ 6 operands sum to $3.1997 — reconciles exactly

This exists because of what verification found in R6: totals hard-coded beside lines that
didn't sum to them, NRE annotations that were arithmetically impossible. **A trace built on
numbers that don't reconcile is worse than no trace** — it teaches operators that the
explanation is decorative.

Two structural consequences:

1. **`app/r10/data.js` computes every number from inputs.** There are no stored totals. The
   grid and the trace read the same computation, so they cannot disagree.
2. **The trace displays unrounded values (4dp), while the grid cell displays 2dp.** CA
   confirmed no rounding inside the engine — 4dp happens only at the NetSuite boundary. If
   the trace rounded, its arithmetic would visibly fail to add up, and §3's assertion would
   be a lie. **Grid for scanning, trace for truth.** ← load-bearing

## 4 · Delivery — how it never leaves context

Four rules, from the evaluation doc, as built:

1. **Inline, below the row.** The trace opens as a panel directly beneath the SKU row it
   explains. No modal, no drawer, no page change.
2. **The originating cell stays visible and stays highlighted.** Plus a **sticky anchor bar**
   repeating the question — *"Why is GLW-30 · T2 $3.2797?"* — with the cost and margin. At
   depth five the operator can still see which number they're inside of.
3. **Depth is visible as depth.** Each level carries a `level N` badge and **states what it
   is explaining in its own header**, so a level read in isolation is self-describing. Nest
   guides fade with depth. Indentation alone stops reading as hierarchy past three levels —
   same reasoning as R9's continuation running header.
4. **One chain open at a time.** Opening an operand at depth *n* closes anything deeper, and
   opening another cell closes the previous trace. Two simultaneous deep chains double page
   length and neither is a context any more.

## 5 · The default — CORRECTED (see §10)

> ⚠ **This section was wrong and is superseded by §10.** It recorded an *assumed* routine
> decision rather than a verified one. Left in place because CC reads these notes verbatim
> and a silently-edited assumption is worse than a visible correction.

What it originally claimed: the routine decision is *"is this price right?"*, so price +
margin on the face of the grid is a sufficient default.

Why that's wrong: the production page says the routine decision is **"are all my tiers above
target, and if not, what do I lift?"** — which needs compliance status and the cost stack.
R10's grid cannot answer it. **By my own §5 test, the default is insufficient.**

The test itself stands, and is worth keeping: *can the operator make the routine decision
without expanding anything?* It failed here because I answered it against an assumed
decision instead of the observed one.

## 6 · Load-bearing — do not trade away

1. **Operation, never operands alone.** Every level shows how before it shows what. Deleting
   the operation line turns this back into a breakdown.
2. **Every chain terminates in a human act** — actor, date, document — never in another
   derived number. The terminal block is styled categorically unlike an arithmetic level for
   this reason.
3. **Resolution ladders show their losing candidates.** Collapsing to the resolved value
   restores the opacity.
4. **The override is not an arithmetic node.** No operation above it. The superseded chain
   is visible but demoted.
5. **Reconciliation assertions stay.** If a sum stops reconciling the trace must say so
   loudly, not silently render.
6. **The trace shows unrounded values.** Rounding here breaks assertion 5.
7. **Sticky anchor + self-describing level headers.** This is what "never leaving context"
   actually means in practice.
8. **The default view answers the routine question with zero expansion.** — see §10; the
   routine question is the *horizontal* one, and the cost stack is what answers it.
9. **Customer View is excluded.** Not a matter of care — the operation *is* the markup and
   the operands *are* cost and supplier. Structural exclusion, build-time assertion.

Cosmetic (safe to adjust): nest-guide colours, badge sizing, the seal glyph, operand row
hover treatment, anchor bar copy.

## 7 · What this implies elsewhere — named, not designed around

1. **Costs is the other half of this chain.** Every operand below "section sell" is a Costs
   number. When the Costs workspace ships, the same node vocabulary should render there —
   which means `data.js`'s node shape is the shared artefact, not the component.
2. **The `origin` node needs a real source.** Here it's fixture data (`actor`, `when`,
   `doc`, `note`). In production it must come from whatever audit/entry record already
   exists. If no such record exists for a given input, **that input cannot terminate a
   chain** — and that's a finding, not a design problem to route around.
3. **Bulk Raw is provisional.** The chain uses the pricing-active representation and says so
   in a warn note on that node. Per CA, the two representations are unconnected and it's
   with Business Validation. The trace deliberately does **not** portray quote-level
   ingredient rows as the arithmetic source of a sell price.

## 8 · Named structure (Pattern 30 — implement verbatim)

**The contract** (`app/r10/data.js`): `node({kind, label, value, unit, op, operands, origin,
chosen, candidates, superseded, note})` · `compute(sku, tierIdx, flags)` → `{sell,
computedSell, overridden, totalCost, margin, root}` · `resolveMarkup(line)`.

**Presentation** (`app/r10/pricing-trace.jsx`): `PricingTracePage` · `PricingGrid` · `Trace`
· `Level` · `Origin` · `Resolution` · `Recon`.

**Canonical classes** (`app/r10/styles.css`): `r10-shell` `r10-topbar` `r10-flag` `r10-grid`
`r10-row`(`.head`) `r10-hcell` `r10-skucell` `r10-cell`(`.open`, `.ovtag`, `.why`)
`r10-trace` `r10-anchor` `r10-levels` `r10-level` `r10-nest`(`.d1–.d4`) `r10-lhead`
`r10-op` `r10-note`(`.warn`) `r10-operands` `r10-operand`(`.leaf`) `r10-origin`
`r10-res` `r10-res-row`(`.won .absent`) `r10-override` `r10-superseded` `r10-flagged`
`r10-recon`.

`.r10-dn` is prototype-only — **strip in production.**

## 9 · Open

- **`origin` provenance source** (§7.2) — needs confirming before build, not after. Which
  existing record supplies actor/timestamp/document per input type?
- **Bulk Raw** — provisional pending Business Validation.
- **Where the second surface lands.** Costs is the natural next one (§7.1), and it would
  prove the contract survives a different delivery. Margin would prove non-tree operations
  fit. I'd still do Costs first, since it shares operands with this chain.

---

# §10 · R10 does NOT replace the Pricing detail section

**Answer to CA: not intended.** The traceability brief read to me as *build the pattern at
the hardest node*, and I built exactly that — a focused prototype whose only job was to
prove the eight node kinds against the verified chain. But I rendered it as a **full Pricing
page shell** with a grid and nothing else, and a prototype that occupies the whole page
reads as a replacement for the page. That's on me, not on the brief.

**CA's position is correct: the trace is an addition.** Compliance, cost stack, adjustment
and reference all survive. And it's correct *by my own §5 test* — I assumed the routine
decision instead of verifying it, which is the same error class as reconstructing the arity
argument in the Costs review rather than checking it. Twice now the failure has been
asserting something about how operators work without looking.

## 10.1 · The stronger position: the cost stack IS trace level 1, transposed

They are not two designs to reconcile. They are **one contract with two projections.**

The cost stack's components — PKG / PROD / FRT / D+T — are precisely the **section-sell
nodes at level 1** of this trace (`packagingNode`, `productionNode`, `freightNode`,
`duty.node`, `tariff.node`). Same operands, same values, same node objects.

| | Projection | Answers |
|---|---|---|
| **Cost stack** | level 1 only, **transposed** — components as rows, all tiers as columns | *where* is margin going, across tiers |
| **Trace** | levels 1..n, **nested** — one tier, unbounded depth | *why* is this number what it is |

Horizontal breadth at fixed depth; vertical depth at fixed breadth. A PM asking "where is my
margin going" reads the stack at a glance; asking that of R10 would mean opening four traces
and holding four numbers in their head — CA's diagnosis, and it's right.

**This is the same argument as §7.1**, applied within Pricing rather than across pages: the
shared artefact is `data.js`'s node shape, not the component. It also retires any worry that
the two views could disagree — they read the same computed nodes, so they cannot.

## 10.2 · The entry point: open the trace AT the node clicked, not at the root

The design move that makes them compose rather than coexist.

If a PM clicks **PROD at T3** because it looks fat, they want to start at production — not at
quoted sell with three levels to descend before reaching what they were looking at. So a
stack cell opens the trace **positioned at that node**, with the levels above it available
but collapsed.

The stack becomes the navigator; the trace becomes the depth. Restated as a rule:

> **The horizontal view chooses the node. The vertical view explains it.**

This also fixes the "never leaving context" promise at the point it was weakest — the anchor
bar now repeats the *node* being explained, not just the cell.

## 10.3 · A finding for the adjustment control, from the verified chain

Worth raising because it is invisible on the page today and the chain makes it plain.

`A = tier_price_adj_pct ?? global_price_adj_pct` — **replaces, never stacks.** So a global
lift **does not affect any tier that carries its own adjustment.** In this fixture T3 has a
tier adjustment of 4%; raising the global from 2.5% to 4% would move T1, T2 and T4 and leave
T3 untouched.

A PM using **Preview Changes** today has no way to see that. The resolution node already
computes it, so:

> **Preview Changes should state which tiers the lift will not reach, and why** — "T3 is on
> its own 4% adjustment, set by Maya Okafor on Jul 2, and is unaffected."

That is the traceability principle applied to an *action* rather than a readout, and it's
the same house rule for the fourth time: the state that determines the outcome should be on
screen, not reachable.

## 10.4 · What this means for the prototype

`Nexus Round 10.html` should be read as **the trace component and its contract**, not as a
proposed Pricing page. The grid in it is a harness for reaching the trace — it is not a
proposal to replace compliance, cost stack, adjustment or reference.

The composed Pricing Workspace — detail section retained, stack and per-SKU breakdown
expanding into the trace, entry-at-node per §10.2 — is the next round, and it should follow
the Costs workspace model as originally briefed.
