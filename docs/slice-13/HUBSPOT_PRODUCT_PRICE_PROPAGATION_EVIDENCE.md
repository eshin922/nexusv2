# HubSpot Product price propagation evidence

## Evidence graph

| Node | Claim | Status | Evidence / next action |
|---|---|---|---|
| HPP-1 | Production Product property is writable numeric `price` | PROVEN | Read-only HubSpot Properties API metadata, 2026-07-31 |
| HPP-2 | Nexus maps missing/blank/zero to `0.00`, preserves explicit nonzero, and fails closed on invalid input | PROVEN IN ISOLATION | VAL-107 unit and fake-provider ledger evidence |
| HPP-3 | Real Nexus Product Library creation stores one HubSpot Product whose returned `price` is zero | PROVEN | Controlled production create and direct HubSpot read-backs, 2026-07-31 |
| HPP-4 | HubSpot Product price propagates to the corresponding existing/new NetSuite Item | UNTESTED | Separate controlled native-sync experiment with HubSpot integration owner and NetSuite administrator |
| HPP-5 | Technical catalog zero never supplies a commercial Sales Order rate | STRUCTURALLY PROTECTED; OPERATOR EVIDENCE OPEN | Nexus SO payload uses calculated `requiredSellPerUnit`; retain parity/UAT evidence |

HPP-3 does not close HPP-4. A successful HubSpot Product creation proves only
the CRM catalog node, not NetSuite Item or Item Group readiness.

## Controlled live verification record

On 2026-07-31, the operator created the retained, clearly labeled Product
`PVS-018 ZERO PRICE LIVE 20260731` (`PVS018-ZERO-20260731`) through the real
Nexus Product Library with price, cost, and URL unspecified.

- Nexus LEAF ID: `0d34a287-d766-4858-a259-dc9f6b51973b`
- HubSpot Product ID: `46747676852`
- Captured provider request properties: `{"name":"PVS-018 ZERO PRICE LIVE 20260731","price":"0.00","hs_sku":"PVS018-ZERO-20260731"}`
- Raw parsed create response returned the same ID, name, SKU, and `price: "0.00"` with no warning.
- Direct HubSpot read-backs at `2026-07-31T22:03:04.941Z` and
  `2026-07-31T22:03:22.001Z` both returned `price: "0.00"`.
- Price history contains one integration-authored value, `0.00`, at
  `2026-07-31T22:01:45.904Z`; no later price mutation was present.
- Exact-SKU search returned one Product. Product associations returned zero
  line items, Deals, and Quotes.
- Nexus persisted the returned HubSpot Product ID after the successful provider
  create. Name, SKU, standalone classification, blank cost, and blank URL match
  the submitted record.

The test Product is retained as clearly labeled test data. This proves HPP-3
only. HPP-4 remains untested and requires a separate controlled sync test.
