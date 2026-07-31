# BV-003 — Master Data Ownership

## Status

**Business Validation complete.**

## Governing model

| Business object | Business owner | System of record | Nexus responsibility |
| --- | --- | --- | --- |
| Customer | Sales for CRM meaning; Accounting for ERP behavior | HubSpot CRM identity; NetSuite ERP record | Reference and consume through the governed Company-to-Customer lookup |
| Contact | Sales | HubSpot | Reference; Nexus has no canonical Contact master |
| Vendor | Purchasing | HubSpot CRM identity; NetSuite ERP behavior | Reference only in V1 |
| HubSpot Deal | Sales | HubSpot | Consume and retain imported context |
| Project | PM | Nexus workflow; HubSpot CRM attributes | Own the project work object and refresh CRM context |
| Quote | Sales and PM | Nexus | Own commercial proposal and lifecycle |
| Quote Revision | Sales and PM | Nexus | Own negotiation history within a quote |
| Quote Snapshot | Sales/PM accountable; Nexus controlled | Nexus | Generate and preserve immutable customer evidence |
| Product | Sales and Product/PM | HubSpot for synchronized product identity | Synchronize/reference; own only explicit Nexus attributes |
| ASY | PM/Product Development | Nexus | Own quote-scoped composition and costing structure |
| LEAF | Product Development/PM | Shared by attribute | Synchronize HubSpot fields; own Nexus operational metadata |
| Cost | PM/Purchasing inputs; Finance commercial policy | Nexus | Own quote-specific inputs and canonical calculations |
| Pricing Vendor | Purchasing/PM | HubSpot identity; Nexus quote selection | Reference identity and preserve pricing provenance |
| Sales Order | Accounting after creation | NetSuite | Compose and create once; never overwrite Accounting changes |
| NetSuite Customer | Accounting | NetSuite | Reference only |
| NetSuite Item | Accounting/Operations | NetSuite ERP item | Resolve and consume; do not independently create ordinary items |
| Item Group | Accounting presentation; Nexus composition | NetSuite record with Nexus deterministic identity | Generate/recover for applicable Sales Orders |
| Assembly | Operations and Accounting | NetSuite | No current Nexus creation or use of NetSuite Assemblies |
| Purchase Order | Purchasing and Accounting | NetSuite | Outside Nexus V1 |

## Lifecycle invariants

- A sent customer proposal is protected by an immutable snapshot.
- Successful NetSuite completion locks the quote.
- Commercial correction after completion uses a cloned quote.
- Quote revision and quote cloning are different business workflows.
- NetSuite owns ERP execution and Accounting adjustments after creation.
- Nexus must not synchronize over downstream Accounting changes.
- Purchasing, vendor award, and Purchase Orders remain outside V1.

## Confirmed V1 ownership gaps

1. Governed Pricing Vendor identity and historical provenance.
2. Item Group applicability and commercial pricing procedure.
3. Durable, idempotent Sales Order send and ambiguous-result recovery.
4. Below-floor margin exception approval.

Customer Contact association remains unclear but is not proven to block V1.
Product/LEAF attribute ownership is a documented split, not a conflict.

## Evidence

- [Integration Ownership Principle](../slice-13/INTEGRATION_OWNERSHIP_PRINCIPLE.md)
- [Field Ownership Register](../slice-13/FIELD_OWNERSHIP_REGISTER.md)
- [Data Traceability and Field Governance](../architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md)
- `src/db/schema.ts`
- `src/app/actions/projects.ts`
- `src/app/actions/quotes.ts`
- `src/app/actions/leaves.ts`
- `src/lib/hubspot-cache.ts`
- `src/lib/hubspot-pull.ts`
- `src/lib/costing.ts`
- `src/lib/netsuite/mark-complete.ts`
