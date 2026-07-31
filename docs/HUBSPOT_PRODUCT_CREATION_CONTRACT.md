# HubSpot Product creation contract

## Price boundary

HubSpot Product price uses API property `price`. Production account metadata
read on 2026-07-31 reports label `Unit price`, `type=number`,
`fieldType=number`, currency display enabled, HubSpot-defined, non-calculated,
and writable.

When Nexus creates a HubSpot Product:

- missing, blank, or unspecified price becomes the string `0.00`;
- explicit numeric zero becomes `0.00`;
- an explicit valid nonnegative decimal is preserved;
- malformed, negative, or non-finite input fails before outbound creation;
- price remains optional in the reusable-component UI;
- existing Products are not updated by this create-only contract.

The default is a technical Product-catalog prerequisite. It is not read into a
LEAF, quote, customer price, costing calculation, or NetSuite Sales Order rate.
Nexus commercial transaction pricing remains independently calculated and sent.

## Creation ordering

Nexus calls the governed HubSpot provider before inserting the local LEAF. A
HubSpot rejection therefore creates no local LEAF. The returned stable HubSpot
Product ID is persisted only after successful creation.

For controlled production evidence, the canonical `leaf_create` audit record
retains the exact provider-submitted Product properties and the parsed HubSpot
create response body. These fields contain Product data only; authorization
headers and access tokens are never recorded.

## Evidence status

- HubSpot property identity/type: **PROVEN** by read-only production Properties
  API metadata and official HubSpot Products API documentation.
- Mapping/default/provider ledger: **PROVEN IN ISOLATION** by VAL-107.
- Live Nexus create and HubSpot zero read-back: **PROVEN** on 2026-07-31 by
  controlled Product `46747676852`, linked from Nexus LEAF
  `0d34a287-d766-4858-a259-dc9f6b51973b`; request, create response, two direct
  read-backs, price history, uniqueness, and empty association checks are
  recorded in the evidence graph.
- HubSpot Product price → NetSuite Item price propagation: **UNTESTED** and a
  separate controlled synchronization experiment.
