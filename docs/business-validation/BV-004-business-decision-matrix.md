# BV-004 — Business Decision Matrix

## Status

**Business Validation complete.**

## Recorded decisions

| Business decision | Decision owner | Timing | Nature | Authoritative record | Downstream consumers |
| --- | --- | --- | --- | --- | --- |
| Select customer/deal | Sales; PM imports | Project initiation | Judgment in HubSpot; deterministic import | Project HubSpot Deal ID and snapshots | Project, quotes, customer resolution |
| Select quote products | PM/Product Development | Quote construction | Judgment | ASYs and attached LEAFs | Costing, preview, PDF, Sales Order |
| Enter source costs | PM/Purchasing | Costing | Judgment | Packaging and production inputs | Pricing and margin |
| Select Pricing Vendor | PM/Purchasing | Costing | Judgment | Currently free-text only; governed identity is V1 | Cost provenance |
| Allocate one-time fees | PM | Costing | Judgment | Production allocation policy | Unit pricing and separate fees |
| Set target margin | PM/authorized commercial user | Pricing | Judgment or firm default | Quote target margin | Pricing classifier |
| Apply price adjustment | PM/authorized commercial user | Pricing | Judgment | Quote/tier adjustment | Sell price and margin |
| Override sell price | PM/authorized commercial user | Pricing | Judgment | Tier/LEAF override plus audit | Revenue and customer pricing |
| Recommend tier | PM | Quote construction | Judgment | Recommended tier state | Customer presentation |
| Select accepted tier | Customer; recorded by Nexus | Acceptance | Judgment | Customer accepted tier and acceptance event | Completion and Sales Order |
| Send quote | Sales/PM | Commercial readiness | Judgment plus system gates | Snapshot, event, PDF, audit | Client review |
| Revise quote | Sales/PM | Negotiation | Judgment | New version and preserved history | Future send/acceptance |
| Clone quote | Sales/PM | Separate proposal/correction | Judgment | New quote and source link | Independent lifecycle |
| Accept quote | Customer/internal recorder | Client decision | Judgment | Accepted status, tier, event, audit | Completion |
| Complete quote | Authorized internal operator | After acceptance | Human initiation plus deterministic gates | Completion and NetSuite push evidence | Accounting/Operations |
| Create Sales Order | Nexus | Completion | Deterministic | NetSuite push record and ERP transaction | Accounting/Operations |
| Adjust Sales Order | Accounting | After creation | Judgment | NetSuite | ERP execution |

## Decisions not yet fully recorded

| Decision | Current state |
| --- | --- |
| Governed Pricing Vendor identity | **Closed 2026-07-31.** Stable HubSpot Company ID + immutable name snapshot persist; see [BV-001](BV-001-pricing-vendor-identity.md). Register gate 1 is V1 COMPLETE |
| Below-floor commercial approval | Detection and blocking exist; authoritative approval workflow does not. **V1 release blocker REG-2**, gated on [OD-002](../OPEN_DECISIONS.md) |
| Item Group applicability | Accounting currently supplies the decision manually; no canonical Nexus datum is approved. **V1 release blocker REG-4**, gated on [OD-004](../OPEN_DECISIONS.md) |
| PM accepted-tier override | Data model anticipates it; V1 affordance is deferred |
| Awarded vendor and Purchase Order authorization | Intentionally outside V1 and Nexus |

## System-derived decisions

Nexus deterministically derives:

- effective unit cost and sell price;
- gross profit and gross margin — **blended margin is defined by
  [BV-010](BV-010-blended-margin-definition.md)** as *(Σ revenue − Σ cost) ÷
  Σ revenue*. This row named the quantity without defining it, and three
  derivations shipped under the name as a result;
- target/floor classification;
- effective accepted tier under the current V1 fallback;
- NetSuite customer and item resolution;
- Sales Order payload construction;
- deterministic Item Group identity for a known composition.

These computations do not replace the human decisions that supply commercial
inputs or authorize exceptions.

## Evidence

- `src/app/actions/quotes.ts`
- `src/app/actions/costing.ts`
- `src/lib/costing.ts`
- `src/lib/pricing-suggestions.ts`
- `src/lib/quote-guards.ts`
- `src/lib/netsuite/mark-complete.ts`
- `src/lib/netsuite/item-groups.ts`
- `src/db/schema.ts`
