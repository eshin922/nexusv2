# BV-007 — Product Setup Workflow

## Status

**Approved governing business contract; frozen.**

No further edits are permitted unless a future Business Validation explicitly
changes this contract. Remaining open questions are implementation gates for
later slices and do not invalidate the approved workflow rules.

This document defines the intended PM workflow for building Product Structure
on a Quote. It is a design and business document only. It authorizes no code,
schema, migration, backfill, test, or production-data change.

BV-007 applies the frozen business model in
[BV-006 — Product Structure Contract](BV-006-product-structure-contract.md):

- the PM builds Components and Products;
- a directly attached LEAF is an independently commercialized line;
- one Product represents one customer-visible unit composed of one or more LEAF
  Components;
- Product Structure is separate from the Commercial Cost Model; and
- Nexus derives Commercial Representation and ERP Projection under separately
  approved contracts.

## Workflow objective

Product Setup should let a PM answer one practical question:

**What is the customer buying?**

The PM should be able to express either:

- independently commercialized Components; or
- one or more customer-visible Products composed of Components.

The PM should not need to understand or choose Detailed, Item Group, or
NetSuite Assembly behavior while building the Quote.

## Governing workflow rules

1. A new Quote starts with an empty Product Structure.
2. **Add Component** is the primary starting action.
3. At Quote level, **Add Component** creates an independently commercialized
   Component.
4. Inside a Product, **Add Component** adds the Component to that Product.
5. Nexus never creates a Product merely because Components exist.
6. Nexus suggests creating a Product only when the PM expresses an intent to
   commercialize selected Components as one customer-visible unit.
7. A Product is created only after the PM explicitly confirms that action.
8. A Product may contain one or more LEAF Components.
9. Components may be grouped into a Product while the Product Structure remains
   editable.
10. A Product may be dissolved back into independently commercialized
    Components while Product Structure remains editable.
11. Grouping and ungrouping must preserve Component identity and must present the
   effect on quote-specific commercial data before confirmation.
12. Product Setup does not create Item Groups or NetSuite Assemblies.

## 1. Starting a Quote

The PM begins through the existing Quote creation workflow and arrives at Setup
with an empty Product Structure.

The first Setup state should let the PM begin without making an early Product
classification:

- **Add Component** is the primary action.
- **Create Product** remains available as a visually secondary action for cases
  where the PM already knows the customer is buying one Product.

Neither path asks the PM to choose Detailed, Turnkey, Item Group, or Assembly.

### Recommended empty-state language

> Start by adding Components. Group them into a Product when the customer will
> buy them together as one unit.

The wording is a workflow recommendation for review, not approved UI copy.

## 2. Adding Components

### Adding from the Product Library

The PM selects a reusable LEAF from the Product Library. Context determines its
default destination:

- at Quote level, **Add Component** creates an independently commercialized
  Component; and
- inside a Product, **Add Component** adds the Component to that Product.

The PM should not repeatedly choose a destination while building the same
Product. Explicit destination selection remains available when the PM invokes a
global add action, moves a Component, or otherwise works in genuinely ambiguous
context. Nexus must never silently guess between multiple Products.

### Creating a new Component

If the required reusable LEAF does not exist, the PM may use the governed
Product Library creation workflow. After creation, the current Setup context
determines the default destination. Product creation in HubSpot and LEAF
persistence remain governed by their separate approved contract.

### Result of direct addition

Adding at Quote level creates an independently commercialized Component in
Product Structure:

- the LEAF remains reusable master data;
- the quote attachment represents an independently commercialized line;
- no Product is created; and
- the Component appears immediately under **Components**.

## 3. Introducing a Product

### Exact introduction moment

Nexus should introduce the Product concept at either of two explicit PM actions:

1. the PM chooses **Create Product** before adding Components; or
2. the PM selects one or more existing Components and chooses **Group as
   Product**.

The proposed interaction presents **Group as Product** when the PM selects one
or more Quote-level Components. Selection makes the Product action available
without inferring that grouping is required. Product creation occurs only after
the PM invokes the action and confirms it. Component count alone must never
trigger Product creation. A one-Component Product is valid, and multiple
independently commercialized Components are also valid.

Whether selection is the exact point at which Nexus should recognize Product
intent remains the primary open workflow question.

### Creation boundary

The Product is created only when the PM confirms that the selected Components
will be commercialized as one customer-visible Product.

Before confirmation, Nexus should show:

- the proposed Product name;
- the Components that will belong to it;
- that those Components will no longer be independent commercial lines; and
- any governed commercial values that require preservation, reassignment, or a
  new decision.

The PM is confirming business structure, not an ERP record type. Confirmation
must not create an Item Group or NetSuite Assembly.

### Empty Product behavior

A Product may be created before its first Component is selected to support the
natural build-first workflow. It must immediately display an **Incomplete — add
at least one Component** state. The Product visibly exists, but Nexus tells the
PM during Setup that Components are still required. The issue must not be
deferred until send. An empty Product is not a commercial line and is not
eligible for downstream workflow.

## 4. Converting Components into a Product

Independently added Components may later become one Product while the Quote
remains structurally editable.

### Proposed workflow

1. The PM selects one or more Components at Quote level.
2. The PM chooses **Group as Product**.
3. Nexus asks for the customer-visible Product identity or name.
4. Nexus previews the structural and commercial effect.
5. The PM confirms.
6. The selected Components move from **Components** into the new Product.

This operation changes Product Structure. It must preserve reusable LEAF
identity and historical audit evidence.

### Commercial-data gate

Grouping unpriced Components may proceed without a pricing conversion. Grouping
Components that already contain independent selling prices requires explicit PM
confirmation.

Nexus must preserve the existing commercial data until the PM confirms the
transition. Nexus must not silently sum, copy, average, retain, clear, or
otherwise transform Component selling prices. The PM must explicitly choose to
create one Product and define its commercial selling price.

Any automated pricing recommendation is future scope and cannot execute without
operator approval. Deterministic price conversion is not a V1 option.

## 5. Converting a Product back into Components

A Product may be dissolved into independently commercialized Components while
the Quote remains structurally editable.

### Proposed workflow

1. The PM opens the Product actions.
2. The PM chooses **Convert to Components**.
3. Nexus previews the Product and member Components that will be affected.
4. Nexus explains that the Product commercial unit will be removed and its
   member LEAFs will become independent commercial lines.
5. The PM confirms.
6. Member Components move to **Components** and the empty Product is removed.

This is not deletion of the reusable LEAFs.

### Commercial-data gate

Nexus must not silently divide, copy, retain, clear, or otherwise transform a
Product selling price into member Component selling prices. The PM must make an
explicit pricing decision for the resulting independently commercialized lines.
Existing commercial data remains preserved until that transition is confirmed.

After send, acceptance, completion, or another approved structure-freeze event,
the Product must not be dissolved in place. Correction proceeds through the
approved revision or clone workflow.

## 6. Setup page states

The Setup page should use one consistent hierarchy rather than separate modes.
It should show Components and Products together when both exist.

### Empty Quote

```text
Product Setup

What is the customer buying?

[ Add Component — primary ]
Create Product — secondary

No Components or Products have been added.
```

### Components only

```text
Product Setup

Components
├── Bottle
├── Pump
└── Label

[ Add Component — primary ]
Create Product — secondary
```

Each row is an independently commercialized line. The PM may select rows and
choose **Group as Product**.

### Products only

```text
Product Setup

Products
└── Daily Cleanser
    ├── Bottle
    ├── Pump
    └── Label

[ Add Component — primary ]
Create Product — secondary
```

Each Product is one customer-visible commercial unit. Component rows preserve
identity and composition but are not presented as independent commercial lines.

### Incomplete Product

```text
Product Setup

Products
└── Daily Cleanser
    Incomplete — add at least one Component
    [ Add Component ]

[ Add Component — primary ]
Create Product — secondary
```

The Product exists and remains editable, but its incomplete state is visible
where the PM is working. The Product-level **Add Component** action defaults into
that Product.

### Mixed Components and Products

```text
Product Setup

Components
├── Display Carton
└── Sample Sachet

Products
└── Daily Cleanser
    ├── Bottle
    ├── Pump
    └── Label

[ Add Component — primary ]
Create Product — secondary
```

Mixed Product Structure is architecturally supported, but this is not an initial
operational workflow. Product Setup should remain optimized for the common
Component-only and Product-only paths and should not add interaction complexity
solely to surface mixed capability.

### Single-Component Product

```text
Product Setup

Products
└── Branded Applicator
    └── Applicator

[ Add Component — primary ]
Create Product — secondary
```

The Product is valid because the customer is buying one customer-visible Product,
not because it contains a minimum number of LEAFs.

### Interaction principles

- **Add Component** remains the primary action in every editable state.
- Current context supplies the default Component destination.
- Explicit destination selection remains available when context is ambiguous.
- **Create Product** remains available as a secondary action.
- Components and Products have visually distinct hierarchy and labels.
- Nexus does not expose Item Group or NetSuite Assembly choices on Setup.
- Empty, pending, success, and failure states must be visible.
- A failed structural operation leaves the prior Product Structure intact.

## 7. DPS workflow examples

### Example A — Detailed packaging quote

#### Customer request

The customer wants separate pricing for a bottle, pump, label, and carton.

#### PM workflow

1. The PM starts the Quote and opens Product Setup.
2. The PM chooses **Add Component**.
3. The PM attaches Bottle directly to the Quote.
4. The PM repeats for Pump, Label, and Carton.
5. The Setup page shows four rows under **Components**.

#### Workflow result

- Product Structure: four independently commercialized LEAF Components; no
  Product.
- Nexus derives downstream behavior later; the PM makes no accounting selection
  on Product Setup.

### Example B — Turnkey quote

#### Customer request

The customer wants one quoted Daily Cleanser Product comprising a bottle, pump,
label, and formula-related Component.

#### PM workflow

1. The PM starts the Quote and chooses **Create Product**.
2. The PM names the Product **Daily Cleanser**.
3. The PM adds Bottle, Pump, Label, and Formula Component to that Product.
4. The Setup page shows one Product with four member LEAFs.
#### Workflow result

- Product Structure: one Product with four LEAFs.
- Nexus derives downstream behavior later; the PM makes no accounting selection
  on Product Setup.

### Example C — Mixed quote

#### Customer request

The customer wants one turnkey Daily Cleanser Product plus separately priced
display cartons and sample sachets.

#### PM workflow

1. The PM creates **Daily Cleanser** as a Product.
2. The PM adds Bottle, Pump, Label, and Formula Component to that Product.
3. The PM adds Display Carton directly to the Quote.
4. The PM adds Sample Sachet directly to the Quote.
5. The Setup page shows the two independent rows under **Components** and the
   four Product members beneath **Daily Cleanser**.

#### Workflow result

- Product Structure: one Product plus two independently commercialized LEAF
  Components.
- Nexus derives downstream behavior later; the PM makes no accounting selection
  on Product Setup.

#### Validation status

This example proves the intended architectural capability. It is not the
initial operational workflow and does not require the V1 Setup experience to
promote or teach mixed composition.

### Example D — Single-component commercial product

#### Customer request

The customer is buying one branded applicator as one customer-visible Product.
Its current composition contains a single reusable Applicator LEAF.

#### PM workflow

1. The PM chooses **Create Product**.
2. The PM names the Product **Branded Applicator**.
3. The PM adds the Applicator LEAF to the Product.
4. The Setup page shows one Product containing one Component.

#### Workflow result

- Product Structure: one Product with one LEAF.
- Nexus derives downstream behavior later; LEAF count does not select an
  accounting concept.

## 8. Commercial Cost Model boundary

Product Setup concerns only **Components** and **Products**. Commercial costs are
not added, organized, or classified on Product Setup. They enter later through
the approved costing workflow governed by BV-006 and applicable costing
contracts.

Product Setup must not introduce accounting concepts or projection-only lines
into Product Structure. A structural change that alters pricing meaning requires
an explicit PM decision and must fail closed without that decision.

## 9. Lifecycle and reversibility

### Editable Quote

While Product Structure is editable, the PM may:

- add or remove independently commercialized Components;
- create or remove an empty Product;
- add or remove Components within a Product;
- group Components into a Product; and
- convert a Product back to independently commercialized Components.

Each action requires draft/authentication guards, explicit scope, atomicity, and
audit evidence in any future implementation.

### Frozen or historical Quote

Once the approved lifecycle freezes Product Structure, it must not be mutated in
place. Sent, accepted, completed, superseded, or otherwise historical evidence
must preserve the Product Structure shown to the customer and used downstream.

The exact freeze event and the appropriate revision-versus-clone path remain
open Business Validation decisions.

## 10. Open Business Validation questions

These questions are implementation gates for the later workflow slices they
affect; they do not invalidate the approved portions of this contract:

1. At what exact point does Nexus recognize that independently added Components
   should become one Product?
2. What exact UI action, suggestion, and confirmation convert independently
   added Components into one Product without forcing an early classification?
3. Which minimum Product identity fields must the PM supply when creating a
   Product?
4. Beyond the selling-price rules governed by BV-008, how are existing costs,
   targets, specifications, ordering, and audit evidence treated when Components
   are grouped, regrouped, or ungrouped?
5. At what lifecycle event does Product Structure freeze?
6. After freeze, which changes require a revision and which require a clone?
7. How are intentional repeated uses of the same reusable LEAF distinguished
   within one Quote or Product?
8. How are legacy Product structures classified when they may not represent
   customer-visible Products?
9. What actions remain available for an incomplete Product, and when should
   Nexus automatically remove an abandoned empty Product, if ever?
10. What final operator presentation should implement the warnings and explicit
    confirmation required by BV-008?
11. What downstream contracts must be approved before architecturally supported
    mixed Quotes become an operational workflow?

## Workflow approval gate

Do not implement Product grouping, ungrouping, or operational mixed-Quote
workflow until the applicable blocking questions above are approved and
reconciled with costing, pricing, customer evidence, lifecycle, and ERP
projection contracts. Canonical attachment architecture must preserve mixed
capability without requiring mixed workflow to be enabled.
