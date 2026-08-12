# OD-022 · Product Structure — operator workflow review

**Read-only review. No implementation. No NetSuite or HubSpot mutation.**
2026-08-12. Governing evidence: [REG-4 / Track B closure](reg-4-track-b-certification.md).

Track B established that *given a correct Product Structure, the Item Group
machinery faithfully preserves it in NetSuite.* This reviews the upstream
question: **how does an operator know which structure is commercially correct?**

---

## 0 · The finding that reframes the question

**V1 has no Direct Component capability. Every quoted component is already
inside an assembly, and always has been.**

- `quote_leaves.assembly_id` is **nullable** — the schema permits a Direct
  Component.
- The authoring UI **refuses to attach a component without one**:
  *"No assemblies in this quote — Create an ASY before attaching components"*,
  and the per-row control is disabled with *"Create an ASY first to enable
  attach."*
- Live data: **150 `quote_leaves` rows, 0 with `assembly_id IS NULL`.**
  `assembly_leaves` = 150. Every leaf in the system, without exception, sits
  under an assembly.

The brief anticipates the risk as **under-grouping** — an operator builds flat
components without realising they form one finished product. That risk is not
reachable in V1. The actual exposure is the inverse:

> **Operators are forced to invent an assembly even when components are
> independently sold — and that assembly silently becomes a NetSuite Item Group
> asserting they are one commercial product.**

Over-grouping, not under-grouping. The structure is not chosen; it is imposed
by the only path the UI offers, and the operator is never told what it means.

---

## 1 · Current operator journey

```
Project Setup
  └─ "+ Add component →"  ─────────────────────────────────────────┐
        │                                                          │
        ├─ Library modal opens                                     │
        │    • lists reusable components                           │
        │    • ATTACHING TO: <assembly selector>                   │
        │    • with no assembly: every Attach button DISABLED      │
        │                                                          │
        └─ "+ Create new product" → Add product modal              │
              mode toggle:                                         │
                [ LEAF ]  "Reusable component · type + specs"      │
                [ ASY  ]  "Quotable product · commercial fields"   │
              ASY fields: name, ASY Product Type, SKU              │
                          ("auto-generated if blank"),             │
                          description, unit price/cost, markup     │
              footnote: "Leaves added separately via the tree"     │
                                                                   │
  → operator must create an ASY to proceed ────────────────────────┘
  → attach components to it
  → Costs → Pricing
  → Quote surface: "Detail:  [ Itemized | Turnkey only ]"
  → Send   (detail_level frozen into the send snapshot)
  → Accept
  → Complete → grouping fires iff snapshot detail_level = turnkey_only
```

**Two independent inputs decide the downstream NetSuite structure, and neither
is framed as a commercial question:**

1. **Assembly composition** — authoring time, *forced*, never explained.
2. **`detail_level`** — Send time, labelled **"Itemized / Turnkey only"**, a
   *PDF presentation* control that also silently decides whether Item Groups are
   created at all.

An operator choosing "Turnkey only" is choosing how the customer PDF reads. They
are not told they are also choosing the Sales Order's commercial structure.

---

## 2 · Answers to the ten questions

**1 · Where does an operator choose or implicitly create an ASY?**
In the Add product modal, via a two-button mode toggle. It is not a choice in
practice — the library refuses attachment until one exists, so the first action
on every quote is to create an assembly.

**2 · What does the UI call it?**
`ASY`. Verbatim, as the button label. Also "ASY Product Type" on the form. The
Setup tree shows the ASY SKU as the row identity.

**3 · What explanation tells the operator why they would use it?**
None that is commercial. The two descriptors are
*"Reusable component · type + specs"* and *"Quotable product · commercial
fields"* — they describe **which fields the form shows**, not which business
situation calls for which. Nothing anywhere in the authoring surface mentions
grouping, Item Groups, or the Sales Order consequence. The only operator-facing
occurrence of "Item Group" in the codebase is `order-receipt.tsx` — rendered
**after** the Sales Order already exists.

**4 · Can an operator create multiple Direct Components without being prompted
to consider whether they form one finished product?**
**No — they cannot create Direct Components at all.** They are prompted the
opposite way: forced into an assembly with no explanation of what it asserts.

**5 · Can an operator reach Send with a structure that is arithmetically valid
but structurally incompatible with the intended Item Groups?**
**Yes, in both directions, with nothing to stop them.**
- Two independently-sold components placed in one assembly → **one** Item Group
  claiming they are one product. Total is identical.
- One finished product split across two assemblies → **two** Item Groups. Total
  is identical.
- Correct assemblies + "Itemized" at Send → **no groups at all**, flat lines.
  Total is identical.

Every one of these reconciles to the cent. That is precisely the
attribution-without-reconciliation failure class banked in CLAUDE.md.

**6 · At what point does Nexus discover the structure is insufficient?**
**Never.** The Track B gate verifies that NetSuite matches **the frozen plan**.
The plan is derived from whatever assemblies the operator built. The gate is a
**faithfulness** check, not a **correctness** check — it cannot detect that the
plan itself encodes the wrong commercial intent, and it is not designed to.

**7 · Does any validation distinguish one-finished-product-with-components from
multiple-independently-sold-components?**
**No.** No column, predicate, warning, or gate encodes the distinction. Nothing
in the system holds the fact.

**8 · What happens with multiple finished products on one quote?**
Works correctly and is certified — SO2704 carried two assemblies → two distinct
Item Groups, including the same Bottle at $4 in one and $2 in the other. This
is a proven capability, not a gap.

**9 · What Product Library information survives into the grouping plan?**
Only: leaf `sku` (→ NetSuite item by SKU-match), `qtyPerParent`, rate, and the
**assembly's `sku`, `name`, `id`**. Product Type, specs, FSC status, supplier,
and library description do **not** reach the plan.

**Load-bearing and unflagged:** the assembly's **SKU is the `baseSku` in the
composition hash**. Renaming an assembly SKU changes the Item Group identity —
a different reusable group in NetSuite. The field is free text with placeholder
*"auto-generated if blank"*, presented as a naming convenience.

**10 · Which implementation terms leak into operator workflow?**
`ASY` (mode toggle, "ASY Product Type", tree rows), `LEAF` (mode toggle).
Both are identifiers. Neither names a commercial concept an operator would
recognise. `assembly` also surfaces in the library modal's empty state.

---

## 3 · Reachable V1 Product Structure states

| state | reachable in V1? | downstream result |
|---|---|---|
| One assembly, many components | **yes** — the default and only path | one Item Group (if `turnkey_only`) |
| Many assemblies, each with components | **yes** — certified by SO2704 | one Item Group each |
| Same component in two assemblies at different rates | **yes** — certified | two groups, rates preserved |
| Assembly with a single component | **yes** — Group B of the certification | a one-member Item Group |
| **Component attached directly to a quote (Direct Component)** | **NO** — UI blocks; 0 rows exist | — |
| Correct assemblies but `itemized` at Send | **yes** | **no groups**; flat SO lines |

**Latent fail-open worth recording:** if an assembly-less leaf ever did exist,
`mark-complete`'s line builder looks each leaf up through
`tree.assemblies → children`; a leaf with no assembly yields no match and hits
`continue`. It would be **silently dropped from the Sales Order** — no error, no
warning, no gate failure, and the group totals would still reconcile among
themselves. Unreachable today, but the schema permits the row.

---

## 4 · Proposed business rule

The brief's candidate — *"Are these components sold together as one finished
product, or are they independently sold components?"* — is the right axis. It
survives validation against the model: it is exactly what the assembly boundary
encodes, and exactly what the composition hash commits to.

But it is **not yet answerable by an operator in V1**, for two reasons:

1. **The second option does not exist.** Offering a choice whose "independently
   sold" branch cannot be built would be worse than offering none — it invites
   an answer the system will silently ignore by forcing an assembly anyway.
2. **A third input already decides the outcome.** Even a correctly-answered
   structure produces no groups if `detail_level` is `itemized` at Send. The
   operator would answer the structural question at authoring time and have it
   overridden by a presentation toggle later, with no indication.

**Recommended rule, framed for what V1 can honour:**

> **A Finished Product is a set of components the customer buys as one thing, at
> one price.** Its composition is what NetSuite receives as a single commercial
> product.
>
> Components that the customer buys and prices separately are **not** part of
> the same Finished Product, even when they ship together.

Stated this way it is answerable without NetSuite knowledge, and it matches the
existing `turnkey_only` semantics — "one number per volume tier, all-in" is
already the customer-facing expression of *one finished product*.

**Additional distinction to confirm with the business:** whether a quote may mix
finished products with independently-sold components *on the same quote*. The
runtime does not currently permit it (everything is an assembly, and
`detail_level` is quote-wide, not per-product). This is an open business
question, not a defect — flagged per the brief's instruction not to invent
semantics.

---

## 5 · Minimum UX changes

Narrowest set that makes the distinction visible without redesigning anything.

**A · Rename the mode toggle to commercial language.** *(no behaviour change)*

```
[ Finished Product ]   Sold as one product at one price.
                       Its components are grouped together downstream.
[ Component ]          A reusable part used inside finished products.
```

`ASY` / `LEAF` retire from the toggle and from "ASY Product Type", surviving only
in identifiers and technical detail. This is the highest-value change and the
cheapest: it is copy.

**B · Say what a Finished Product does, once, where it is created.** One line in
the modal — *"Components attached here are quoted and ordered together as one
product."* No NetSuite vocabulary; the business statement is sufficient and the
Item Group is its faithful implementation.

**C · Make the assembly SKU's weight visible.** It is the group's identity.
A short helper — *"Identifies this product; changing it later creates a
different product record downstream."*

**D · Reconcile the Send-time toggle with the structure.** "Itemized / Turnkey
only" currently decides whether the structure the operator built is honoured at
all. At minimum its label should indicate that consequence. This is the item I
would most want a business decision on before touching (see §7).

**Deliberately excluded:** a contextual "do these make one product?" prompt. With
Direct Components unreachable, the honest answer is always *yes, they must be* —
the prompt would be theatre. It becomes meaningful **only if** Direct Components
ship.

---

## 6 · Is Send/Complete validation justified?

**No. Do not add a gate.**

The brief sets the correct bar: *a warning based only on "more than one component
exists" is not sufficient authority.* Nexus holds no governed fact that
distinguishes a legitimate one-product assembly from a wrongly-bundled pair.
Every reachable structure is currently valid by construction, because the UI
permits only one shape.

A gate here would fire on correct structures and teach operators to dismiss it —
strictly worse than nothing.

**The one thing that would justify a gate** is the fail-open in §3: if Direct
Components become reachable, `mark-complete` must refuse an assembly-less leaf
rather than silently dropping it from the Sales Order. That is a real
correctness gate on a known-invalid state, not a heuristic — and it should ship
**in the same slice** that makes the state reachable, never after.

---

## 7 · Business decisions required

1. **Do Direct Components ship in V1?** This is the gating decision; everything
   else is downstream of it. If no, §5 is copy-only and OD-022 closes cheaply
   as a clarity fix. If yes, it is a capability slice with its own gate.
2. **May one quote mix finished products and independently-sold components?**
   Currently impossible (`detail_level` is quote-wide). Answering "yes" makes
   grouping a **per-product** property rather than a quote-wide presentation
   choice — a materially larger change.
3. **Should `detail_level` continue to control grouping at all?** It conflates
   *how the PDF reads* with *what the Sales Order structurally is*. Track B
   certified the mechanism faithfully; this asks whether the input is the right
   one. Related to OD-004's disposition, which deliberately tied them together —
   reopening the **input** is not reopening Item Group architecture.

---

## 8 · V1 implementation recommendation

**Ship §5 A–C now as a copy-and-explanation change. Defer everything else
behind decision 1.**

Rationale:

- It is the entire fix for the *stated* OD-022 risk — operators not
  understanding what structure they are creating — and costs almost nothing.
- It carries **no** behavioural risk: no schema change, no new reachable state,
  no gate, nothing Track B certified is touched.
- It does not foreclose Direct Components; it makes the vocabulary ready for
  them.

**Do not** add contextual prompts, structural gates, or Product Library
restructuring in V1. Each depends on a capability that does not exist and a
business decision that has not been made.

**Record explicitly:** this clarifies the model. It does **not** make a
currently-unreachable structure reachable — the distinction the brief asked to
be kept sharp.

---

## Scope kept

Track B and Item Group architecture untouched. No Product Library redesign, no
aesthetics. OD-021 separate. No mutation performed — this review is reads only.
