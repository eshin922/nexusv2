# BV-001 — Pricing Vendor Identity

## Status

**Approved in principle; V1 implementation prerequisites remain open.**

## Business promise

A quote may optionally identify the governed HubSpot Vendor whose pricing was
used to build a cost. Nexus persists the stable HubSpot Company ID and a vendor
name snapshot so the pricing source remains understandable historically.

Pricing Vendor describes the source of quote pricing. It is not the vendor
eventually awarded a Purchase Order.

## Confirmed current behavior

- Packaging cost lines currently store a nullable free-text `supplier`.
- The value is editable in the production costing UI and is copied when a
  quote is cloned.
- It is not part of the canonical costing formula.
- It is not projected to the customer preview, PDF, or NetSuite Sales Order.
- Nexus has no demonstrated local governed Vendor master.
- HubSpot remains authoritative for CRM company identity, including Vendor
  companies. Nexus does not own vendor creation or synchronization.

Repository evidence:

- `src/db/schema.ts` — `assembly_leaf_inputs.supplier`
- `src/app/actions/costing.ts` — line metadata persistence
- `src/components/costs/packaging-drilldown.tsx` — current supplier entry
- `src/app/actions/quotes.ts` — quote graph cloning
- [Integration Ownership Principle](../slice-13/INTEGRATION_OWNERSHIP_PRINCIPLE.md)

## Approved V1 contract

- The UI label is **Pricing Vendor**.
- Selection is optional.
- Options come from HubSpot companies whose authoritative company
  classification is Vendor.
- Nexus persists the stable HubSpot Company ID.
- Nexus caches the selected vendor name for display and history.
- Existing free-text supplier values remain readable as compatibility
  evidence.
- Historical records are not linked by name unless identity is deterministic.
- Nexus does not project Pricing Vendor to NetSuite in V1.
- Nexus does not imply that Pricing Vendor is the awarded vendor.
- Nexus does not create or synchronize vendor master records.

## Optional Pricing Date

V1 may include an optional `pricing_date`, but its exact business meaning must
be confirmed before schema or UI implementation. It must not be coded until
the business specifies whether the date means, for example, the vendor quote
date, the date pricing was received, or another governed event.

The confirmed meaning must define:

- which business event the date represents;
- who supplies it;
- whether it is copied during quote cloning;
- whether it remains immutable in sent/completed history;
- null behavior; and
- whether it applies to a cost line or a broader quote scope.

## Compatibility contract

The migration is additive:

- preserve the existing `supplier` column and values;
- add governed identity fields without transforming historical text;
- show the governed selection when present;
- otherwise show the legacy supplier value as historical text;
- do not maintain two independently editable supplier concepts for new work.

Whether the legacy field remains writable depends on the production-dependency
audit. If no dependency requires it, new editing uses only the governed
Pricing Vendor selection.

## Explicit non-goals

- vendor-quote parsing;
- vendor recommendations;
- vendor-master ownership;
- awarded-vendor selection;
- Purchase Order creation;
- procurement automation;
- NetSuite vendor projection.

Automated vendor-quote ingestion is V1.5. Broader sourcing and procurement
intelligence is V2.

## Implementation prerequisites

1. Confirm the authoritative HubSpot company property and exact value that
   means Vendor.
2. Confirm the exact business meaning and scope of Pricing Date.
3. Determine whether an existing local HubSpot company projection can serve
   the lookup or identify the smallest required read boundary.
4. Produce a read-only census of populated legacy `supplier` values.

## V1 exit criteria

- Governed selections persist stable HubSpot Company identity and name
  snapshot.
- The selection remains optional.
- Legacy values remain readable without guessed identity.
- Pricing Date, if included, has an approved exact meaning.
- No NetSuite or procurement behavior is introduced.
- Persistence, compatibility, clone, authorization, and network-isolation
  tests pass.
