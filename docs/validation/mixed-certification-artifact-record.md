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

---

# RESULT — PASS

**Sales Order SO2714 (`362241`)** · customer HANKS `329665` · quote
`ad6f7513…` → `complete` · push **`succeeded`** at 2026-08-13T22:03:25Z.

Reached in two governed steps: a CREATE that produced the order and stopped at
`awaiting_rates`, then **one resume through the designed recovery path** against
the same order. The resume is part of this attempt, not a second attempt.

## Before / after — provider read-back

Identical snapshot script both times, so the comparison is like-for-like.

| line | item | qty | rate BEFORE → AFTER | costType BEFORE → AFTER | costRate | costEstimate |
|---|---|---|---|---|---|---|
| 1 | Group `75854` | 1000 | — (unchanged) | **none → none** | — | — |
| 2 | `1024` Box | 1000 | **0 → 0.5365** | AVGCOST → **CUSTOM** | **0.37** | **370** |
| 3 | `66476` Bottle | 1000 | **0 → 1.8705** | AVGCOST → **CUSTOM** | **1.29** | **1290** |
| 4 | EndGroup | — | — | **none → none** | — | — |
| 5 | `71529` **Direct** | 1000 | **3.6685 → 3.6685** | **CUSTOM → CUSTOM** | **2.53** | **2530** |

Order total **3668.5 → 6075.5**. Line count 5 → 5, same ordering, same item ids.

## Gate — all eight conditions

| # | condition | evidence |
|---|---|---|
| 1 | no new SO | customer `329665` holds exactly `SO2714/362241` + pre-existing `SO2585/336668`, before **and** after |
| 2 | topology unchanged | 5 lines, same order, same items, every qty 1000 |
| 3 | `1024` converged | rate **0.5365**, `CUSTOM`, cost **0.37**, extended **370** |
| 4 | `66476` converged | rate **1.8705**, `CUSTOM`, cost **1.29**, extended **1290** |
| 5 | structural lines untouched | Group and EndGroup carry `costEstimateType: null`, `costEstimateRate: null` |
| 6 | Direct unchanged | `71529` exactly once, flat, after EndGroup — rate, cost and extended **bit-identical** across the resume |
| 7 | push terminal | `succeeded`, `completed_at` set; every governed-cost member carries `CUSTOM` at its exact governed rate — a failed write would have left `AVGCOST`/0, as it demonstrably did before the resume |
| 8 | preserved set unmoved | SO2707 3500 / 21:01 · SO2708 5550 / 04:45 · SO2709 4150 / 04:58 — identical before and after |

**Totals reconcile, and are the weakest of these checks.** Group subtotal
**2407** (EndGroup amount) + Direct **3668.5** = **6075.5** = the accepted Nexus
revenue recorded at acceptance. Presence and attribution are the proof; the
total is the corroboration.

### A correction to the pre-Send record

§ Pre-Send capture listed extendeds 537 / 1871 / 3668 and a total of 6076. Those
were derived by rounding the **2-decimal displayed** rates. The governed 4dp
rates are 0.5365 / 1.8705 / 3.6685, giving 536.5 / 1870.5 / 3668.5 = **6075.5**,
which matches the accepted total exactly. The prediction was an approximation of
the governed values; the governed values are what reconcile. Recorded rather than
quietly corrected, since a pre-record that is silently adjusted afterwards proves
nothing.

## M1–M4

| | claim | evidence |
|---|---|---|
| **M1** | Direct Product projects end-to-end | `71529` appears **exactly once**, as an ordinary line **outside** the group, after EndGroup — never swallowed into it, never duplicated |
| **M2** | Direct Unit Cost at CREATE | `CUSTOM` / **2.53** / extended **2530**, present from the CREATE and **unchanged** by the resume — which is what distinguishes it from M3 |
| **M3** | Item Group member Unit Cost post-expansion | both members moved `AVGCOST`/0 → `CUSTOM` at **0.37** and **1.29** by scalar PATCH against lines that did not exist at CREATE |
| **M4** | mixed projection | one Item Group with each member exactly once, one independent Direct line, no member duplicated flat, no accepted product omitted, quantities unchanged, subtotals and total correct |

**M2 and M3 are proven by different mechanisms on one order**, which is what a
single mixed artifact had to demonstrate: the Direct cost was already correct
before the resume and the member costs only became correct during it.

## Recovery path — proven alongside the certification

The resume reused `362241` rather than creating a second order, left topology
and the Direct line untouched, and converged only what was un-priced. That is
the ambiguous-create recovery contract behaving as designed, evidenced rather
than assumed.

## Residual, unchanged by this pass

An **unowned** provider Sales Order matched only by deal id remains
**correlation, not deterministic identity**. The ownership veto closes the
sibling-scenario overwrite; it does not make deal-id matching an identity. A
provider-side quote/snapshot key stays open debt — and the candidate sweep
showed it is not hypothetical, finding SO2646 and SO2624 on deals Nexus has no
record of.

## Two observability notes

- `costProjectionSummary` is returned by `markComplete` but **persisted
  nowhere** — not to the push row, not to the audit. Its outcome here was
  evidenced from the provider instead, which is stronger, but the report itself
  is unreadable after the fact.
- `netsuite_so_pushes.error_class` still reads `verification` on a row whose
  status is `succeeded` — stale residue from the pre-resume failure, not
  cleared on success. Cosmetic, and misleading to anyone querying by
  `error_class`.
