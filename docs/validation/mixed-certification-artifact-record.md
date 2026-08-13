# Mixed Direct + Item Group certification artifact — record

**Quote:** `ad6f7513-17fc-4e84-978e-a2492cdb8f29`
**Scenario:** `CERT-MIXED-DELETE-ME-2026-08-13T21-26-07` · `turnkey_only`
**Project:** Hanks - Hydration Full Retail Rollout
(`7d9c22dd-e7f5-4ccc-82c4-46502b718eba`)
**Deal:** `54020672837` → company `41135125320` (HANKS) → NetSuite customer
**329665**

---

## Pre-seed gate (all green, re-proven immediately before seeding)

| prerequisite | evidence |
|---|---|
| HubSpot cache row | present for `54020672837` |
| associated company | `41135125320` |
| `netsuite_customer_map` | resolves to `329665` |
| **provider-side zero** | `findSalesOrdersByDealId` → **0**, control `59153706532` → SO2707 through the same query |
| Preview runtime | HubSpot `SUPPRESSED`; NetSuite `sandbox`; account sandbox `true`; write authorized `true` |
| sibling scenarios | project had **0** existing quotes |
| deal stage | `195274339` (active) — cache row not eviction-eligible mid-walk |

Provider-side zero is mandatory and is **not** substitutable by the
Nexus-owned-SO count: the candidate sweep found SO2646 and SO2624 on deals with
no Nexus record at all.

## Pre-Send capture — Tier 1, 1,000 units

Read from Pricing before any lifecycle action. Blended margin 31.0%
(target 35%, floor 25% — below target, soft warning, sendable; **no lift
applied**, so these are the rates that get sent).

| product | structure | qty | governed cost | sell rate | extended |
|---|---|---|---|---|---|
| `10064-GNX-Box` Genexa - Box | **Item Group member** | 1,000 | **0.37** | **0.537** | **537** |
| `DPS-BOTTLE-0001` Primary - Bottle | **Item Group member** | 1,000 | **1.29** | **1.871** | **1,871** |
| `BA146400` SOL - Hydr '39 Jet Set Backpack | **Direct Product** | 1,000 | **2.53** | **3.668** | **3,668** |

| | |
|---|---|
| expected **Item Group subtotal** | **2,408** |
| expected **Direct subtotal** | **3,668** |
| expected **total revenue** | **6,076** |

**Every sell rate differs from its governed cost** — 0.37 ≠ 0.537,
1.29 ≠ 1.871, 2.53 ≠ 3.668. A cost silently echoing `rate` would therefore be
visible rather than reconciling.

The three costs are also mutually non-proportional, so a swap between products
cannot produce the same total.

## Walk

Send → Accept → Complete, once, through the Preview UI at the runtime proven
above. Provider GET is authoritative for certification; Nexus success state is
not sufficient.

*(Result section appended after the read-back.)*
