# Bundle: `freight-1a`

**Authority scope:** Phase 2 — Costs Workspace, Freight section
**Selected variant:** **Option A** (`app/freight/1a.jsx`)
**Precedence:** Tier 3 (design bundle) — see
[`../../NEXUS_IMPLEMENTATION_STANDARD.md` §2](../../NEXUS_IMPLEMENTATION_STANDARD.md)
**Status:** Governing. Implementation in progress; operator findings open.

| | |
|---|---|
| Intake archive | `../_intake/freight-1a.zip` |
| Original filename as received | `Extract file as project (11).zip` |
| Intake date | 2026-08 |
| Tracked in repository | 2026-08-04 |
| Superseded by | *(nothing)* |
| Supersedes | The pre-worksheet freight implementation — see [Supersession](#supersession) |

Earlier documents cite this bundle by its original filename,
`Extract file as project (11).zip`. Those citations resolve here.

---

## Files

| File | Role |
|---|---|
| `app/freight/1a.jsx` | **The specification.** 901 lines. Option A component tree |
| `app/freight/styles.css` | Canonical freight stylesheet (shared across variants — see below) |
| `app/freight/data.js` | Sample data shaping the prototype. Illustrative, not authority |
| `app/costs/styles.css` | Costs-page shell grammar (`cw-*`) |
| `styles.css` | Root tokens and resets |
| `Nexus Freight 1a.html` | Rendered prototype for visual acceptance |

### Selected variant — and what is *not* authority

`app/freight/styles.css` is shared across three design explorations: **1a**,
**1b**, and **1c**. Only **1a (Option A)** was selected.

The stylesheet therefore contains rule families the selected variant never
uses:

| Family | Rules | Used by Option A? |
|---|---|---|
| `fr-*` | majority | **Yes — this is the Option A grammar** |
| `fr1b-*` | 24 | No — variant 1b, unselected |
| `fr1c-*` | 31 | No — variant 1c, unselected |

Verified: `fr1b-` and `fr1c-` appear **zero times** in `app/freight/1a.jsx`.

**Consequence for implementers.** Their absence from production JSX is
*correct*. Assembling them would be a fidelity error, not a fidelity fix. If
you are hunting for "missing hierarchy" in the implemented surface, these are
not it — see the parity audit instead.

Nexus's `src/styles/freight-1a.css` currently carries all 55 unselected rules,
copied when the stylesheet was adopted wholesale. Removing them is **cleanup,
not a fidelity requirement**, and is not on the Phase 2 critical path. Because
it departs from verbatim canonical CSS, if taken it is recorded here as a
deliberate scope-trim; the rules remain recoverable from `../_intake/`.

A separate matter: an invented bare `fr1-` prefix appeared in an earlier
implementation. That **is** a fidelity error and is prohibited outright by the
parity audit.

---

## Approved deviations

Departures from the bundle authorized by business disposition. Each is tier-1
authority and outranks the bundle where they conflict.

### D1 · Product-scoped shipment ownership

Freight is grouped by Setup-defined products; the product-scoped entry point
establishes shipment ownership.

*Not present in the bundle at all* — the prototype has no product grouping.
Implementation wraps source-faithful shipment cards in a minimal Setup-owned
product group **without altering the inner worksheet grammar**.

**Why:** freight belongs to a commercial product, and commercial structure is
owned exclusively by Setup (standard §4). The bundle was drawn before that
ownership rule was settled.

### D2 · Inherited shipment contents

Initial shipment contents inherit the owning product's Setup components.
Governed changes use *Edit shipment contents* and cannot cross that product.

**Why:** membership is evidence, not authorship (standard §5). Inheriting from
Setup means Costs never originates structure.

**Amended 2026-08-05 — operator correction (tier 2) + business disposition
(tier 1).** Inheritance seeded the shipment with *every* eligible component and
offered no way to change that at creation, so every shipment implicitly
contained every SKU. Operator validation found this made the primary
multi-SKU use case unrepresentable: split shipments, partial ocean / partial
air, staggered production releases, and customer-specific groupings all
require assigning a subset at the moment the shipment is recorded.

The create modal now carries the bundle's own assignment control — `SkuChips`
(`app/freight/1a.jsx:114`), the interactive `onToggle` chip set the prototype
already specified but which the implementation had rendered as read-only
chips. Every eligible component starts selected, so the common single-shipment
case is unchanged; at least one must remain selected.

This **refines the bundle's intent rather than violating it** (standard §2):
inheritance from Setup is preserved — the picker is seeded from Setup, cannot
offer anything outside the product, and Costs still originates no structure.
What changed is that the inherited set became visible and editable instead of
implicit. *Edit shipment contents* remains available for later changes.

Membership remains descriptive: it says which SKUs the freight is for and
never divides the cost. Nothing in the costing path reads it, and a regression
test asserts that neither `costing.ts` nor `costing-adapter.ts` may.

### D3 · V1 customs scope

Invoice-entered **Duty** and **Tariff** only. MPF/HMF remain within Duty.
Rate × Base authority and Entry Fees are out of V1 scope.

The bundle's customs source selector and Entry Fees rows are **omitted**, not
reinterpreted.

**Why:** V1 records what the invoice states. Rate × Base would make Nexus
recompute a determination customs already made (standard §1).

### D4 · Dynamic tier columns

The bundle's tier-column grammar is fixed at the prototype's tier count.
Implementation parameterizes the repeat count to the Quote's actual tiers.

**Only the repeat count is parameterized.** Geometry, class tree, and nesting
come from the source unchanged.

---

## Operator review status

**Reviewed. Findings open.**

The [Design Authority Matrix](../../phase-2-freight-design-authority.md) marked
all thirteen rows PASS. **That matrix is void.** It recorded engineering
completion, not operator acceptance, and was self-certified before real
operator validation. Operator review superseded it — see standard §2 on why
tier 2 outranks tier 3.

Operator findings: duplicated Freight headers · incorrect typography hierarchy
· missing T1/T2/T3 visual hierarchy · spacing rhythm deviations · incorrect
nesting · generic CRUD remnants · implementation approximated the supplied CSS
rather than using it verbatim.

**The current gap list is
[`../../phase-2-freight-dom-parity-audit.md`](../../phase-2-freight-dom-parity-audit.md)**
— thirteen rows, source-component by source-component, with a disposition for
each. That document, not this one, is what an implementer works from.

---

## Implementing modules

| Bundle component | Production module |
|---|---|
| `OptionA`, `TierHead`, `TotalStrip` | `src/components/costs/freight-drilldown.tsx` |
| Canonical CSS | `src/styles/freight-1a.css` |
| Persistence | `src/app/actions/freight-worksheet.ts` |
| Schema | `freight_subcategories` · `freight_destinations` · `freight_destination_breaks` · `freight_customs_entries` · `freight_customs_breaks` · `freight_destination_tracking` · `quote_snapshot_freight_workbooks` |

Business behaviour, persistence, propagation, snapshots, clone/revision, and
regression are **accepted**. The open work is design fidelity.

---

## Supersession

This bundle supersedes the pre-worksheet freight design in the business model
it expresses:

| | Superseded model | This bundle |
|---|---|---|
| Structure | Leg → Component → Tier | **Subcategory → Destination Candidates → Quantity Breaks** |
| Cost basis | CBM-proportional allocation across components | **Operator-determined amount recorded once** |

The superseded model's documentation is archived at
[`../../_archive/CUSTOMS_AND_FREIGHT.md`](../../_archive/CUSTOMS_AND_FREIGHT.md).
It is retained as history and is **not** a valid implementation reference.

---

## What would reopen this bundle

- A new design round for the Freight surface, arriving whole and registered as
  a superseding bundle
- A business disposition that contradicts the worksheet model itself, not
  merely its presentation
- V2 workbook import surfacing a shape the manual worksheet cannot express —
  though standard §6 requires convergence on one persistence model, so this
  would amend the bundle rather than fork it
