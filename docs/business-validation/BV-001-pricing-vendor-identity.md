# BV-001 — Pricing Vendor Identity

## Status

**V1 COMPLETE — implementation, UX review, focused validation, and diff review
passed.**

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

## Pricing Date

`pricing_date` is the optional date shown on the vendor quote or pricing source
used to establish the cost for the logical packaging pricing line. It is
line-scoped, copied during quote cloning, editable only while the quote is a
draft, and frozen as historical pricing provenance after send.

It is not the Nexus entry date, purchasing effective date, Purchase Order
date, or awarded-vendor date.

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

## Closed implementation prerequisites

1. HubSpot company property `type` with exact value `VENDOR` is authoritative.
2. Pricing Date has the approved line-scoped meaning above.
3. No local Vendor projection exists; V1 uses the existing HubSpot provider
   boundary for read-only filtered search and exact-ID revalidation.
4. The legacy census found populated values across draft and historical rows
   with consistent logical-line siblings. The additive migration does not
   transform them.

## Implementation evidence

- `assembly_leaf_inputs` stores the stable Company ID, immutable name snapshot,
  and date-only Pricing Date.
- The production action resolves a newly selected ID through HubSpot and never
  trusts a submitted name.
- The action rejects missing, archived, unnamed, and non-Vendor identities
  before persistence or success audit.
- Tier creation, preset replacement, quote cloning, loaders, local state, and
  deterministic fixtures preserve the governed fields.
- The former `supplier` input is no longer editable and appears only as
  read-only legacy evidence when no governed identity exists.
- Customer, PDF, HubSpot writeback, and NetSuite boundaries do not receive
  Pricing Vendor provenance.

## Closeout evidence

- Live browser review verified governed search, optional clear state, explicit
  no-result feedback, replacement, Pricing Date, save/reload, legacy fallback,
  and sent/completed read-only presentation.
- VAL-104 verifies the stable ID and immutable name snapshot across every tier
  sibling and records the fake-provider search/resolution ledger.
- Clone preservation is protected at the canonical quote-graph copy boundary;
  governed fields are copied with the logical line and remain internal.
- HubSpot lookup failure returns a visible load error and does not mutate the
  previous canonical value.
- Full boundary review found no customer, PDF, HubSpot-writeback, or NetSuite
  projection.

## V1 exit criteria

- Governed selections persist stable HubSpot Company identity and name
  snapshot.
- The selection remains optional.
- Legacy values remain readable without guessed identity.
- Pricing Date, if included, has an approved exact meaning.
- No NetSuite or procurement behavior is introduced.
- Persistence, compatibility, clone, authorization, and network-isolation
  tests pass.
