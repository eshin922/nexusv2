# HubSpot Product price propagation evidence

## Evidence graph

| Node | Claim | Status | Evidence / next action |
|---|---|---|---|
| HPP-1 | Production Product property is writable numeric `price` | PROVEN | Read-only HubSpot Properties API metadata, 2026-07-31 |
| HPP-2 | Nexus maps missing/blank/zero to `0.00`, preserves explicit nonzero, and fails closed on invalid input | PROVEN IN ISOLATION | VAL-107 unit and fake-provider ledger evidence |
| HPP-3 | Real Nexus Product Library creation stores one HubSpot Product whose returned `price` is zero | UNTESTED | Controlled production create/read-back required |
| HPP-4 | HubSpot Product price propagates to the corresponding existing/new NetSuite Item | UNTESTED | Separate controlled native-sync experiment with HubSpot integration owner and NetSuite administrator |
| HPP-5 | Technical catalog zero never supplies a commercial Sales Order rate | STRUCTURALLY PROTECTED; OPERATOR EVIDENCE OPEN | Nexus SO payload uses calculated `requiredSellPerUnit`; retain parity/UAT evidence |

HPP-3 does not close HPP-4. A successful HubSpot Product creation proves only
the CRM catalog node, not NetSuite Item or Item Group readiness.

## Controlled live verification record

Pending. The `leaf_create` audit captures provider-submitted Product properties
and the parsed create response without credentials. Record Nexus LEAF ID,
HubSpot Product ID, immediate/later read-backs, price history,
duplicate/association checks, and retained or approved cleanup disposition
here.
