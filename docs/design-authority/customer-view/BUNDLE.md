# Bundle: `customer-view`

**Authority scope:** Quote Presentation / Customer View — the operator's last stop before a
priced quote leaves the building. Two-pane workspace: live PDF preview (left) and the
four-card configuration rail (right) with a pinned finalize footer.
**Reference of record:** `design/Nexus Customer View.dc.html`
**Precedence:** Tier 3 (design bundle) — see
[`../../NEXUS_IMPLEMENTATION_STANDARD.md` §2](../../NEXUS_IMPLEMENTATION_STANDARD.md),
with the Tier-1 supersessions recorded below.
**Status:** Governing. **Implementation not started against this bundle.** The surface
currently in production was built without it.

| | |
|---|---|
| Intake archive | `../_intake/customer-view.zip` |
| Original filename as received | `nexuscustomerview.zip` |
| Received | 2026-08-22 |
| Tracked in repository | 2026-08-24 |
| Superseded by | *(nothing)* |

---

## Why this bundle was registered two days late, and what that cost

It sat **untracked at the repository root** from 22 August until 24 August — the exact state
[`../MANIFEST.md`](../MANIFEST.md) opens by describing as the reason that directory exists:

> the governing design source for two phases of work consisted of two untracked ZIP files at
> the repository root

In those two days the Quote Presentation surface was designed, built, reviewed, reconciled
against a *different* authority, and shipped to production behind a flag. None of that work
consulted this bundle, because nothing in the repository pointed at it and the manifest —
the place an implementer is told to check — did not list it.

The concrete consequence is recorded in
[`../quote-presentation-authority-reconciliation.md`](../quote-presentation-authority-reconciliation.md):
the reconciliation read `quote-presentation-profile-brief.md` as governing the whole rail,
concluded that Commercial recovery could not belong on the surface, and removed it. That
brief describes **Card 2 of four**. The removal was wrong, and the card that was deleted was
closer to this bundle than what replaced it.

**Registering a bundle is not filing. It is what makes the correct check return the correct
answer.**

---

## Files

### The specification

| File | Role |
|---|---|
| `design/Nexus Customer View.dc.html` | **The reference of record.** Template markup with exact inline styles, plus the logic class holding every derivation, the fixture data and the state transitions. |
| `design/Nexus Customer View.standalone.html` | Self-contained build — open in a browser to interact. Reference only. |
| `design/support.js` | The prototype's rendering runtime. Included so the standalone file can be traced. **Do not port it.** |

### The authority documents

| File | Role |
|---|---|
| `README.md` | The implementation handoff: layout, every measurement, tokens, interactions, state shape, derived economics, fixture data. |
| `docs/authority-model.md` | **CP · Revision 1** — who owns what, what is frozen, and what the primary button may claim. Read before implementing the governance gate. |
| `docs/designer-notes.md` | Why the rail has this order, and the presentation/economics split. Names its own supersessions. |
| `docs/data-source-map.md` | Field-by-field ownership: Costs, Pricing, policy, or this surface. |
| `docs/approval-states-design-position.md` | Approval states, including why an election voids a prior approval. |

---

## The rail this bundle governs

Four cards and a pinned footer. The order is the operator's order of thought.

| | Card | Owns |
|---|---|---|
| — | **Governed · not editable here** | Nothing. Read-only mirror of sell / charge cost / approved recovery / margin policy, each with a source tag and a route to the surface that owns it. Dashed border — the visual language for "owned elsewhere". |
| **1** | **Commercial recovery** | The bounded election. Charge-level `In unit price` / `Separate` / `Absorbed`, policy-constrained, with margin-after-recovery per governed tier and the governance gate. Heavier border: this is the consequential card. |
| **2** | **Customer presentation** | Shape, tiers shown, recommended tier, four include-toggles, customer note. Lighter border, deliberately quieter. *"Never changes economics. Display only."* |
| **3** | **Accounting handoff** | Commercial agreement (per charge, read-only), Customer received (derived), and the one authored Instruction to Accounting. Internal-violet: never printed. |
| — | **Finalize footer** (pinned) | Send chip, readiness checklist, primary action, `⤓ Download PDF` / `↳ Download + mail draft`, artifact line. |

---

## Approved deviations and dispositions

Recorded here rather than in commit messages, per MANIFEST rule 3.

### D1 · Commercial recovery applies at charge grain to every governed recoverable charge

**Edward, 2026-08-24. Tier-1 supersession.**

`authority-model.md` §1a bounds the commercial election to **freight treatment** — *"an
explicit, named exception, not a precedent."* That sentence is superseded:

> Commercial Recovery applies at charge grain to **every governed recoverable charge in the
> registry**, not freight only.

**§1a is not otherwise weakened.** Its load-bearing rules stand unchanged — this surface may
not touch a governed cost or price; it selects among pre-approved recovery policies for costs
that are already governed; a presentation choice may never be the operand of a downstream
money calculation.

This does **not** authorize three modes everywhere. `refusalFor` and governed charge policy
continue to decide which modes are permitted per charge:

- **In unit price** — where amortization is permitted
- **Separate** — where separately invoiceable
- **Absorbed** — only where policy allows **and** the absorbed cost is demonstrably retained
  in margin and floor economics

Denied choices stay visibly disabled with a concise operator-facing reason — the constraint
must be visible, not hidden, which is also what the reference of record specifies.

### D2 · The primary action is `Freeze & send`

**Edward, 2026-08-24.** The README's finalize footer says `Freeze & send`;
`authority-model.md` §4 renames it to `Finalize presentation`. **`Freeze & send` governs.**

§4's substance is unaffected: delivery is manual, Nexus never emails the customer, and no
button may imply an act the system does not perform.

### D3 · The governance/location distinction, stated once

The reconciliation that removed Commercial recovery conflated two different things. The
bundle separates them explicitly, and this is the sentence to carry forward:

| | owner |
|---|---|
| governed cost, recoverable amount, margin policy, approvals | **Costs / Pricing** |
| the bounded election of an allowed recovery treatment | **Customer View** |
| presentation controls, which stay revenue-neutral | **Customer View** |
| the frozen result of both | **Accounting** |

A control may move economics, be governed by Pricing, and live on this surface. All three at
once. *"Not a presentation control"* means it does not belong in **Card 2** — not that it
does not belong on the workspace.

### D4 · Explicit supersessions to apply

`designer-notes.md` supersedes, by name, chrome still present in production:

- the `PM-INTERNAL PREVIEW · THIS BECOMES THE PDF` ribbon
- the `Send as:` pair
- the boundary-guard **paragraph** — *"gone as a paragraph"*; its guarantee becomes structural
- the `Detail:` select and the `Include spec addendum` toggle in their old placement

`authority-model.md` §5 removes the **880px preview constraint**.

**Legacy chrome is not preserved merely because it predates this bundle.**

---

## Prior authority, and how it relates

[`../quote-presentation-profile-brief.md`](../quote-presentation-profile-brief.md) (#326,
authored 2026-08-21) remains registered and remains useful — its Layer-2 presentation-profile
schema, its SEND-freeze boundary and its Accounting-needs table are not contradicted here.

But it describes **Card 2 of this rail**, not the rail. Its sentence *"Nothing in this panel
is an input to economics"* is true of Card 2, whose own sub-line in this bundle is *"Never
changes economics. Display only."* Read as a statement about the whole surface, it produces
exactly the error it produced.

Where the two disagree about the workspace as a whole, **this bundle governs**: it is later,
it is the reference of record, and it is the one with a design.
