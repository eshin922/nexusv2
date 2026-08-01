# BV-006 — Product Structure Contract

## Status

**Approved governing business contract; frozen.**

No further edits are permitted unless a future Business Validation explicitly
changes this contract.

This contract defines the Product Setup business model and the progression from
customer intent to ERP projection. It authorizes no code change, schema
migration, backfill, Item Group creation, or NetSuite Assembly behavior.

## Governing progression

**Commercial Intent determines Product Structure. Product Structure and the
Commercial Cost Model determine Commercial Representation. Commercial
Representation and the Commercial Cost Model determine ERP Projection.**

The PM builds the Quote using Components and Products. The PM does not choose
Detailed, Item Group, or NetSuite Assembly behavior. Nexus derives downstream
behavior under approved business and integration contracts.

```text
Commercial Intent
    Components | Products
          ↓
Product Structure                   Commercial Cost Model
    Direct LEAFs | ASY Products     Quote-specific commercial costs
                    \               /
                     ↓             ↓
                    Commercial Representation
                              ↓
                         ERP Projection
```

## 1. Commercial Intent

Commercial Intent answers: **What is the customer buying?**

The business distinction is whether the customer is buying independently
commercialized Components or one customer-visible Commercial Product composed
of Components.

This intent emerges from how the PM builds the Quote; it is not a separate
accounting or ERP classification the PM must select.

### Individual Components

The customer is buying one or more Components as independently commercialized
lines.

- Each Component remains independently identifiable.
- A Component does not need an ASY to participate in a Quote.
- Component intent produces Direct LEAF Product Structure.

### Commercial Products

The customer is buying one or more customer-visible Commercial Products, each
composed of one or more Components.

- The Product is one customer-visible commercial unit.
- Its LEAFs describe the Components that comprise it.
- Product intent produces an ASY-backed Product Structure.

### PM workflow boundary

The PM builds a Quote using Components and Products. The PM does not choose an
accounting or ERP representation. Nexus derives downstream behavior from the
approved Product Structure and Commercial Cost Model.

## 2. Product Structure

Product Structure is built by the PM to express the Components and Products the
customer is buying.

### Quote

A **Quote** is the Nexus-owned commercial proposal and lifecycle boundary. It
contains the Components and Products offered to the customer, together with
their quote-specific economics, revisions, snapshots, and downstream evidence.

Product Structure must follow the Quote's clone, revision, send, acceptance,
completion, and historical immutability rules.

### LEAF

A **LEAF** is a reusable Component master carrying reusable product identity,
classification, specifications, and governed catalog attributes.

- A LEAF is not, by itself, a quote-specific commercial line.
- The same LEAF may participate in multiple Quotes and Products.
- Quote-specific quantity, cost, target, override, ordering, and historical
  state belong to a quote-scoped commercial attachment, not the reusable LEAF.
- A LEAF may be attached directly to a Quote or included in an ASY-backed
  Product.

### Direct Components

**Direct Components** are LEAF commercial attachments belonging directly to a
Quote without an ASY.

- They express the customer's intent to buy independently commercialized
  Components.
- Each Direct LEAF represents an independently commercialized line.
- They appear under a top-level **Direct Components** section in the customer
  specification addendum.
- They must not cause implicit ASY creation.
- Their quote-specific commercial identity is distinct from reusable LEAF
  master identity.

### ASY

An **ASY** represents one customer-visible Commercial Product composed of one
or more LEAF Components.

The deciding factor is not LEAF count. An ASY exists because the customer is
buying one customer-visible Commercial Product rather than independently
commercialized Components. It preserves the identity of its member Components
while creating one commercial unit.

An ASY is not:

- a manufacturing construct;
- a NetSuite Item Group;
- a NetSuite Assembly; or
- merely an organizational folder.

An ASY must not be required for Direct Components and must never be created
silently as a convenience wrapper. Its LEAF membership expresses Product
Structure; its downstream commercial and ERP treatment is derived later under
approved contracts.

### Commercial Product

A **Commercial Product** is one customer-visible unit presented, priced, and
accepted commercially. Within Product Structure, it is represented by an ASY
containing one or more LEAF Components.

The term does not create a second reusable Product master. It also does not
determine an ERP record type by itself.

## 3. Commercial Cost Model

The **Commercial Cost Model** is the governed set of quote-specific economics
used in cost roll-up, pricing, and ERP projection. It is separate from Product
Structure.

The Commercial Cost Model may include:

- LEAF or Component costs;
- freight;
- duty;
- customs;
- testing;
- labor;
- setup charges; and
- other approved commercial costs.

Non-component commercial-cost values:

- are not LEAFs;
- are not ASY children;
- do not alter Product Structure; and
- participate in cost roll-up, pricing, and ERP projection only according to
  approved contracts.

Product Structure and the Commercial Cost Model are separate inputs to
downstream Commercial Representation and ERP Projection.

### Cost Roll-up

**Cost Roll-up** is the deterministic aggregation of governed quote-specific
costs into the applicable commercial unit and Quote economics.

- A Direct LEAF retains independent commercial-line treatment.
- An ASY-backed Product is commercialized as one customer-visible unit while
  preserving the identity of its member LEAFs.
- Component and approved non-component costs participate according to the
  approved costing and pricing contracts.
- Reusable LEAF catalog cost is an input, not a substitute for preserved
  quote-specific commercial values.
- This contract does not assert an existing pricing-engine mechanism.
- Canonical costing identity and transition from existing attachment identities
  remain gated.

## 4. Commercial Representation

Commercial Representation is derived by Nexus from the approved Product
Structure and Commercial Cost Model. It is not a choice presented to the PM.

### Direct LEAFs only

A Quote containing only Direct LEAFs represents independently commercialized
Components.

- Each LEAF remains an independent commercial line.
- No ASY is required or implicitly created.
- Customer specifications appear under **Direct Components**.

This supports the downstream **Detailed** representation.

### ASY-backed Products only

A Quote containing only ASY-backed Products represents customer-visible
Commercial Products rather than independently commercialized member Components.

- Each ASY is one Commercial Product.
- Member LEAFs retain Component identity and quote-specific cost inputs.
- The Product is commercialized as one customer-visible unit.
- Customer specifications remain grouped beneath the Product.

This supports a grouped commercial representation. Its Item Group eligibility
and projection remain separate readiness decisions.

### Mixed structure

A Quote may contain both Direct LEAFs and ASY-backed Products. Mixed Product
Structure is an approved architectural capability.

Nexus must preserve Direct Components as independent commercial lines while
treating each ASY as one Commercial Product. The PM must not be required to
select a representation mode.

Architectural support does not make mixed Quotes the initial operational
workflow. Product Setup should remain optimized for the common Component-only
and Product-only workflows and must not introduce complexity solely to advertise
mixed capability. Mixed operation may be enabled later without schema redesign.

### Detailed

**Detailed** is the downstream commercial representation of independently
commercialized Direct LEAFs.

- Components remain separate commercial lines.
- Detailed is not a PM Product Setup selection.
- Detailed is distinct from the customer-document itemized detail setting.

### Turnkey

**Turnkey** is a downstream grouped commercial representation of an ASY-backed
Product.

- The Product, not its member LEAFs, is the customer-visible commercial unit.
- Governed Component and non-component economics participate under approved
  cost roll-up and pricing rules.
- Turnkey is distinct from the existing `turnkey_only` PDF presentation value.
- This contract does not by itself authorize Item Group projection.

### Derivation boundary

Commercial Representation must be derived from governed Product Structure,
Commercial Cost Model, and approved business facts. Customer-PDF detail level,
CRM Deal type, Project category, ERP record presence, and legacy ASY presence
alone are not approved derivation inputs.

## 5. ERP Projection

ERP Projection is an implementation concern applied only after Commercial
Representation and applicable Commercial Cost Model rules are established. It
must not shape the PM's Product-building workflow.

| Product Structure | Commercial representation | Candidate ERP projection |
| --- | --- | --- |
| Direct LEAFs | Detailed | Flat NetSuite Item lines |
| ASY-backed Commercial Product | Turnkey/grouped | NetSuite Item Group, subject to separate readiness approval |
| Mixed Direct LEAFs and ASY-backed Products | Mixed | Projection per commercial unit; downstream contract not yet approved |

### Detailed NetSuite lines

Direct Components project as flat NetSuite Item lines under the approved
Detailed Sales Order contract. No Item Group or Assembly behavior is introduced
for those Components.

### Item Group relationship

A NetSuite **Item Group** is a possible ERP projection of a grouped Commercial
Product. It is not the source of Nexus Product Structure and is not derived from
ASY membership alone.

Its ERP membership may be derived from:

- the ASY's governed LEAF or Component structure; plus
- approved non-component commercial-cost lines such as freight, duty, customs,
  testing, or other one-time-charge items.

These projection-only lines remain outside Product Structure. They are not
LEAFs and are not ASY children.

This document does not approve final Item Group applicability or mapping. Those
remain separate readiness gates, including authorization, pricing procedure,
membership rules, deterministic identity, permissions, durable send/recovery
behavior, and controlled NetSuite evidence. An ASY must not automatically
become an Item Group.

## Deferred: Finished Product and NetSuite Assembly

**Finished Product remains a future Business Validation topic. Native NetSuite
Assembly behavior and its governing business distinction from Turnkey are
outside BV-006.**

Finished Product is not a currently approved derived Commercial Representation
or ERP path. A NetSuite Assembly remains an ERP finished-good record distinct
from a Nexus ASY.

This document approves no Finished Product entry rule, ERP projection, Assembly
mapping, bill-of-materials ownership, build behavior, inventory effect,
lifecycle, or synchronization contract.

## Structural invariants

- The PM builds Components and Products.
- Direct Components are commercialized independently.
- ASY-backed Products are commercialized as one customer-visible unit.
- A Quote may architecturally contain both Direct Components and ASY-backed
  Products.
- Every quote-specific LEAF commercial attachment belongs to a Quote.
- Reusable LEAF identity and quote-specific commercial identity are distinct.
- Direct LEAFs do not require ASYs.
- A Direct LEAF represents an independently commercialized line.
- An ASY may contain one or more LEAFs.
- An ASY represents one customer-visible Commercial Product.
- LEAF count does not determine whether an ASY exists.
- An ASY is not a folder, manufacturing object, Item Group, or NetSuite
  Assembly.
- Non-component commercial costs are outside Product Structure.
- Customer presentation settings do not determine Product Structure or ERP
  behavior.
- Migration must not infer or alter historical commercial meaning or values.
- **Product Structure is built by the PM. Commercial Representation is derived
  by Nexus. ERP Projection is derived from the approved Commercial
  Representation and Commercial Cost Model.**

## Open business questions

These questions are implementation gates for the later slices they affect; they
do not invalidate the approved portions of this contract:

1. At what point, and through what PM action, does Nexus convert independently
   added Components into one ASY-backed Commercial Product?
2. For supported mixed structures, is Product Structure alone sufficient to
   derive behavior per commercial unit, or is an additional persisted boundary
   required?
3. What is the canonical quote-scoped commercial identity for Direct LEAFs,
   ASY-backed Products, and their member LEAF attachments?
4. How does grouping, regrouping, or ungrouping affect existing quantities,
   costs, prices, targets, specifications, ordering, audit history, and customer
   evidence?
5. How are legacy ASYs classified when they may have served as organizational
   or costing containers rather than customer-visible Commercial Products, and
   what operator review or authoritative evidence is required?
6. What business authorization permits Item Group projection, and what are the
   approved rules for Component membership, projection-only commercial-cost
   lines, pricing, and recovery?
7. How do Direct Components and ASY-backed Products behave in cloning,
   revision, sending, customer preview, PDF pricing and specifications,
   completion, deletion, and detachment?
8. At what lifecycle event does Product Structure become immutable, and which
   roles may group, regroup, or ungroup Components before that point?
9. How are intentional repeated uses of the same reusable LEAF distinguished
   within a Quote or Commercial Product?
10. Are specifications pinned per quote-specific LEAF attachment, per
    Commercial Product, or both?
11. In future Business Validation, what business distinction would establish a
    Finished Product and authorize any NetSuite Assembly behavior?

## Implementation gate

Do not begin canonical attachment migration or historical backfill until the
following are approved:

- when and how the PM creates or changes a Commercial Product;
- the canonical quote-scoped commercial identity;
- mixed Commercial Representation and downstream projection rules before mixed
  operation is enabled;
- regrouping effects on commercial values, specifications, and evidence;
- legacy ASY classification and reconciliation;
- Item Group authorization, membership, pricing, and projection rules; and
- lifecycle behavior across cloning, revision, sending, preview, PDF,
  completion, deletion, and detachment.
