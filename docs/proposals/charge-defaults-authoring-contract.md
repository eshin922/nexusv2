# Charge defaults · the authoring integration contract

**2026-09-16 · specification only. Nothing here is built — wiring it touches
Costs, which is out of scope by instruction, and CD's Costs redesign is paused
pending the product/service type → charge applicability matrix.**

This document specifies how defaults would be consumed. It does NOT propose any
rule, and it does not assume the matrix's answer: if applicability turns out to
depend on more than product type (OQ4), §4's single-type read is the part that
changes, and the four clauses below are unaffected.

Companion to
[`product-type-charge-defaults.md`](product-type-charge-defaults.md). That
document describes the Settings feature that exists. This one specifies how the
authoring surface must consume it, so that the contract is agreed **before**
anything reads it rather than inferred afterwards from whatever got built.

---

## 1 · The four clauses

### C1 · Defaults are offered exactly once, at the moment a component is added

`resolveChargeDefaults` is read when composing the offer for a component being
**added**, and at no other time. It is never read when rendering, editing,
re-pricing, copying, sending, or re-opening a charge that already exists.

### C2 · What the operator accepts or deselects persists with the quote

The offer produces **rows the operator authored** in `quote_charge_instances`.
Acceptance is a write; deselection is the absence of a write. Both are the
operator's act, recorded as such.

### C3 · A later change to a rule does not alter an existing quote

It follows from C1 and C2 rather than being a separate promise: nothing
re-derives an authored charge, so there is nothing for a rule change to reach.
An admin editing a default changes what the *next* component is offered.

### C4 · "None expected" still permits a deliberate charge

A `none_expected` verdict suppresses **suggestions**. It must never disable,
hide, or gate the control by which an operator adds a supported charge. The
verdict is the firm's expectation, not a permission; an operator who knows this
job carries tooling adds tooling, and the reason they are adding it against the
firm's expectation is exactly the thing worth capturing in the charge's own
note.

The same holds for `needs_review` and for `contradiction`: neither is a reason
to prevent an operator from doing their job. A contradiction should be *shown*
at authoring time — it means an admin needs to look — and must not block the
add.

---

## 2 · How each state presents at authoring time

| Resolution | Offer | The add control |
|---|---|---|
| `suggestions` | The listed charges, each ticked per `preselected` | Available, plus any charge not suggested |
| `none_expected` | Nothing offered. Say **why**: reviewed, by whom, when | **Available** — C4 |
| `needs_review` | Nothing offered. Say that nobody has reviewed this type — not that none apply | **Available** |
| `contradiction` | Nothing offered. Say the defaults are inconsistent and need an admin | **Available** |

`describeEmptyResolution` exists so these three empty states cannot drift into
the same sentence in two surfaces, which is the practical way the distinction
gets lost. The authoring surface should use it rather than writing its own copy.

A preselected suggestion is a **ticked checkbox**, never a charge that already
exists. Until the operator confirms the add, no row has been written.

---

## 3 · What the authoring surface must not do

- **Must not re-read defaults to render an existing charge.** This is the single
  thing that would break C3, and it is enforced as an import boundary rather
  than by care: `tests/unit/charge-defaults.test.ts` fails the build if a
  rendering path imports the module. When the authoring surface is wired, its
  one module joins the permitted list; the quote-rendering trees are asserted
  separately and may never appear.
- **Must not derive a tooling classification from a suggestion.** A suggested
  `tooling` charge is still unclassified. `componentChargeDestination` refuses an
  unclassified tooling charge rather than defaulting, and that refusal is
  correct — mould/collar versus cutting die is a per-instance fact.
- **Must not derive a NetSuite item.** `other_service` and `otc_testing` select
  their item per line, frozen at send.
- **Must not read a suggestion as readiness.** A charge can be correctly
  suggested, correctly accepted, and still not post; no component charge
  destination has a verified production mapping today.
- **Must not fall back to another product type.** A component whose product type
  is unknown resolves to `needs_review` under its own name. Borrowing a sibling
  type's rules would offer charges on a classification nobody made.

---

## 4 · The read

One query per product type — the profile and its rules — resolved by
`resolveChargeDefaults`. **No second implementation in SQL**, and no second
resolution in the component: the same function Settings uses, so a contradiction
is reported identically in both places.

`listChargeDefaults` is the admin listing and is not the authoring read; the
authoring path wants one type, not all of them. A single-type loader is the
remaining piece, and it belongs with the wiring rather than here, because its
shape depends on where the component's product type is available.

---

## 5 · What would falsify each clause

Stated so the wiring can be checked rather than believed:

| Clause | The test that fails if it breaks |
|---|---|
| C1 / C3 | The import boundary — a rendering path importing `charge-defaults` |
| C2 | Change a rule, then re-open a quote authored before the change: its charges, their amounts and their presence are unchanged |
| C4 | With a `none_expected` type, the add-charge control is present and functional |
| §3 prohibitions | An authored charge from a suggestion carries no classification and no item until an operator sets them |

The C2 and C4 checks need the authoring surface to exist, and should land with
it rather than being deferred past it.
