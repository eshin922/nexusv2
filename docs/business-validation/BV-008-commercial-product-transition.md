# BV-008 — Commercial Product Transition

## Status

**Approved governing business contract; frozen.**

No further edits are permitted unless a future Business Validation explicitly
changes this contract. Remaining open questions are implementation gates for
later slices and do not invalidate the approved transition rules.

This document defines the V1 business contract for transitions between
independently commercialized Components and customer-visible Products. It
applies the governing Product model in BV-006 and is consistent with the PM
workflow in BV-007.

It authorizes no code, schema, migration, test, backfill, or production-data
change.

## Governing principle

**Product Structure and Commercial Pricing are independent business concepts.**

**Structural transitions may change commercial meaning but must never
implicitly change commercial pricing.**

**Nexus preserves commercial state until an explicit operator authorization
approves the transition.**

## Business concepts

### Product Structure

Product Structure identifies whether a Component is independently
commercialized or belongs to one customer-visible Product. It records Component
membership and Product composition. It does not calculate a selling price.

### Commercial Pricing

Commercial Pricing establishes the selling price of each independently
commercialized line or Product. It does not determine Component membership or
Product composition.

### Structural transition

A **Structural Transition** changes whether Components are independently
commercialized or belong to a Product. V1 structural transitions include:

- creating a Product before Components exist;
- grouping independently commercialized Components into a Product;
- adding a Component to an existing Product;
- moving a Component between Products;
- removing a Component from a Product;
- regrouping Components among Products; and
- undoing an immediately completed grouping before further commercial decisions;
  and
- dissolving a Product into independently commercialized Components.

### Explicit operator authorization

**Explicit operator authorization** is an attributable PM decision approving a
specific change in Product Structure and, when pricing meaning changes, the
specific resulting commercial pricing state.

A generic save, the existence or number of Components, a calculated cost, or an
inferred downstream representation is not authorization.

## Business invariants

- One Product represents one customer-visible commercial unit.
- A Product may contain one or more Components.
- An independently commercialized Component and a Product have distinct
  commercial meaning.
- Product Structure never supplies an implicit selling price.
- Commercial Pricing never supplies implicit Product Structure.
- Structural changes that alter commercial pricing meaning require explicit PM
  authorization.
- Nexus preserves existing commercial state until the required authorization is
  complete.
- Nexus never invents a pricing transformation.
- Component identity and historical evidence survive structural transitions.
- No structural transition creates an Item Group, NetSuite Assembly, or other
  ERP object.
- A transition is atomic: either the complete authorized business transition
  succeeds or the original state remains authoritative.

## Repository evidence and commercial-meaning terminology

The current costing engine derives `computedSellPerUnit` automatically from
governed costs, markups, and the applicable price adjustment. In the absence of
a PM override, that derived value becomes `requiredSellPerUnit`. See
`src/lib/costing.ts`, lines 1173–1193.

The engine also derives a Product-level effective selling value by rolling up
member Components. See `src/lib/costing.ts`, lines 1291–1329. Only a zero-cost,
zero-revenue cell is presented downstream as unpriced rather than `$0.00`. See
`src/lib/customer-view-resolver.ts`, lines 207–223.

Therefore, the presence or absence of a numeric selling price does not identify
the relevant business state. A Component may have a derived numeric value before
the PM has established its independent commercial meaning.

BV-008 uses these business states instead:

- **No established independent commercial meaning** — the Components have not
  yet been established or relied upon as independent customer-visible commercial
  lines. A system-derived selling value may exist, but it is not itself a PM
  decision that the Components will be sold independently.
- **Established independent commercial meaning** — the Quote treats the
  Components as independent customer-visible commercial lines. Grouping them
  changes the commercial meaning of the Quote, regardless of whether their
  current selling values were derived or explicitly overridden.

The governing transition trigger is whether Product Structure changes
established commercial meaning, not whether a numeric price is null, zero,
derived, or overridden.

## Product creation before Components exist

The PM may explicitly authorize creation of a Product before adding Components.

The resulting empty Product:

- is an incomplete Product Structure;
- requires at least one Component before it becomes a valid commercial unit;
- has no selling price inferred from its existence;
- cannot advance to send, acceptance, or completion; and
- may be removed while the Quote remains structurally editable, subject to the
  applicable authorization and audit requirements.

An empty Product is not an independently commercialized line and creates no ERP
record or projection entitlement.

## Structural Transitions

All grouping, regrouping, moving, removing, and dissolving operations are
instances of the same business transition. The following rules apply to every
instance.

### Required transition facts

Before authorization, the transition must be defined by:

- the current Product Structure;
- the proposed Product Structure;
- every affected Component and Product;
- each affected line's current commercial pricing state;
- the proposed commercial meaning of each affected line;
- the selling-price decisions required by that new meaning;
- the commercial and historical data that will be preserved; and
- any value whose active applicability will change.

If these facts are incomplete, stale, conflicting, or ambiguous, the transition
is not eligible for authorization.

### Grouping with no established independent commercial meaning

Grouping Components before they have established independent commercial meaning
may proceed without a pricing conversion because the Quote is not transitioning
from approved independent customer lines. The PM must still explicitly authorize
creation of one Product.

Nexus must not infer a Product selling price from Component costs, quantities,
targets, specifications, automatically derived selling values, or any other
value. The Product remains commercially incomplete until its selling price is
established through explicit PM action.

### Grouping Components with established independent commercial meaning

Grouping Components with established independent commercial meaning changes the
Quote from separate customer lines to one customer-visible Product. This remains
true whether their current selling values are derived or explicitly overridden.

The transition must stop until the PM explicitly authorizes both:

- creation of the Product; and
- the Product's one commercial selling price.

Until that authorization is complete, the independently commercialized
Components and their existing commercial state remain authoritative.

Nexus must not silently sum, copy, average, retain, clear, allocate, or otherwise
transform Component selling prices. Prior Component selling prices remain
preserved as historical transition and audit evidence, but they do not remain
active as additional customer prices after the authorized transition.

### Adding a Component while building a Product

Adding a Component with no established independent commercial meaning changes
Product composition but does not authorize a Product price change. Nexus
preserves the Component's governed data and the Product's existing selling price
unless the PM separately authorizes a pricing change.

### Moving an existing Direct Component into a Product

Moving an existing Direct Component with established independent commercial
meaning into a Product ends that Component's independent commercial treatment.
The transition requires explicit PM authorization of the new commercial
meaning. Neither the Component price nor the Product price may be changed
implicitly, regardless of whether the Component price is derived or overridden.

### Moving or regrouping Components

Moving a Component between Products or regrouping several Components changes
the composition and potentially the commercial meaning of every source and
destination Product.

The authorization scope must include every affected Component and Product. No
source or destination Product price may be recalculated, allocated, or otherwise
changed implicitly. All pre-transition state remains authoritative until the
entire transition is authorized and succeeds.

### Removing a Component from a Product

Removal must establish whether the Component:

- becomes an independently commercialized Component; or
- leaves the Quote while remaining reusable master data.

If it becomes independently commercialized, its selling price requires explicit
PM action. Nexus must not derive that price from the Product selling price.

### Undo Grouping

**Undo Grouping** reverses an immediately completed grouping before any further
commercial or structural decision has changed the resulting Product state.

Undo Grouping:

- restores the exact authoritative Product Structure and commercial state that
  existed immediately before grouping;
- requires no repricing because it restores rather than transforms the prior
  commercial meaning;
- is available only while the same Quote remains editable and the complete
  pre-grouping state is still authoritative and unambiguous;
- is no longer valid after any Product price decision, Component move,
  regrouping, cost or pricing change, customer evidence, or downstream lifecycle
  event; and
- preserves audit evidence of both the grouping and its reversal.

If exact restoration is not possible, the event is not Undo Grouping. It is a
Dissolve Product transition governed by the rules below.

### Dissolve Product

Dissolution ends one customer-visible commercial unit and produces one or more
independently commercialized Components.

The Product selling price ceases to govern the resulting independent lines only
after explicit PM authorization. Nexus must not divide, copy, average, retain,
clear, allocate, or otherwise transform the Product price into Component prices.

The PM must explicitly establish the commercial selling price of every
resulting independently commercialized Component. The former Product price and
Product state remain preserved as historical evidence.

## Commercial selling-price requirements

One Product has one customer-visible commercial selling price. That price is
established only through explicit PM action and is not an arithmetic conversion
of Component prices or costs.

V1 permits Components with no established independent commercial meaning to be
grouped structurally before the Product selling price is established. The
resulting Product remains commercially incomplete until the selling price
exists. It cannot pass a lifecycle gate requiring complete commercial pricing.

V1 does not permit Components with established independent commercial meaning to
change that meaning until the PM authorizes the Product and its selling price as
one transition.

## Preservation requirements

A Structural Transition changes commercial structure; it does not recreate or
discard the underlying business records.

Nexus must preserve:

- reusable Component identity;
- quote-specific quantity;
- Component cost inputs and cost provenance;
- specifications and pinned specification evidence;
- notes;
- ordering, except for an explicitly authorized placement change;
- targets and overrides until their post-transition applicability is explicitly
  established;
- prior active selling prices as historical evidence;
- prior Product Structure and commercial meaning; and
- audit history, including actor, time, source state, destination state, and the
  authorized pricing decision.

Preservation does not mean every prior value remains active after a transition.
It means no value is destroyed, silently reassigned, or given new commercial
meaning without an approved rule and the required operator authorization.

If any required value cannot be preserved or its applicability cannot be
determined without ambiguity, Nexus must fail closed and retain the original
state.

## Required operator authorization

Authorization must be:

- performed by an authenticated PM with authority to edit the Quote;
- specific to the affected Quote, Product Structure, Components, and Products;
- based on the current, not stale, commercial state;
- explicit about the resulting commercial meaning;
- explicit about each newly required Product or Component selling price;
- attributable and retained as audit evidence; and
- completed before the transition changes authoritative structure or pricing.

Authorization of structure is not authorization for Nexus to calculate a price.
Authorization of one transition cannot be reused for a later or materially
different transition.

## Governing lifecycle constraint

Product Structure freeze is already established by the lifecycle invariants in
[BV-003 — Master Data Ownership](BV-003-master-data-ownership.md). A sent
customer proposal is protected by an immutable snapshot, successful NetSuite
completion locks the Quote, and commercial correction after completion uses a
cloned Quote.

Structural Transitions therefore occur only on the authoritative editable draft
under the existing revision and cloning contracts. BV-008 does not redefine the
Quote lifecycle.

## Transition integrity and failure constraints

- All transition facts and authorization must be valid before authoritative
  structure or pricing changes.
- Missing authority, stale state, incomplete pricing decisions, ambiguous
  identity, or conflicting concurrent changes fail closed.
- Cancellation or failure leaves all source Product Structure and commercial
  state unchanged.
- A failed transition creates no partial Product and moves no Component.
- Transitions must be idempotent.
- Failure handling must not destroy historical selling prices or evidence.
- A successful transition produces one complete, attributable audit event.

## Deferred scope

The following are explicitly outside V1:

- automatic or deterministic selling-price conversion;
- automatic summing, averaging, allocation, copying, retention, or clearing of
  selling prices;
- AI-generated pricing;
- autonomous execution of any future pricing recommendation;
- NetSuite Item Group applicability, membership, pricing, or projection;
- Finished Product behavior; and
- native NetSuite Assembly behavior.

Any future pricing recommendation remains advisory and cannot change commercial
state without explicit operator authorization.

## Later-slice implementation gates

1. What constitutes the authoritative Product selling-price decision when
   grouping changes established independent commercial meaning?
2. After grouping Components with no established independent commercial
   meaning, how far may the commercially incomplete Product advance before its
   selling price must be established?
3. Which existing targets and overrides remain actively applicable after a
   Structural Transition rather than being retained only as history?
4. What approved contract governs structural correction after acceptance but
   before completion?
5. What authority, beyond ordinary Quote edit authority if any, is required for
   a Structural Transition that changes commercial pricing meaning?
6. What business reason or supporting evidence must be captured with operator
   authorization?

## V1 implementation gate

Do not implement Commercial Product transitions until:

- the authoritative Product selling-price decision is defined;
- incomplete Product lifecycle limits are approved;
- target and override applicability is resolved;
- post-acceptance correction rules are approved;
- operator authority and required audit evidence are approved; and
- the contract is reconciled with canonical commercial identity, costing,
  pricing, revision, customer evidence, completion, and audit contracts.
