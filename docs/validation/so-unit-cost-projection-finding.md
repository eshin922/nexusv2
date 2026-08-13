# SO Unit Cost blank on Item Group members — diagnosis

**Status:** diagnosis only. No SO changed, no record recreated, nothing written to
NetSuite. All probes were GET / SuiteQL SELECT.
**Date:** 2026-08-13
**Reported by Accounting:** SO2707 member lines show a blank **UNIT COST** column.

---

## 1 · Answer

**It is a missing Nexus → NetSuite projection.** NetSuite is not withholding the
value and the field is not restricted — Nexus never sends it, so NetSuite falls
back to the item master's default cost basis, which is empty in this account.

Specifically:

- **Nexus sends only `item`, `quantity`, `rate` on SO lines.** No cost field of any
  kind is in the payload. Confirmed by reading the line construction in
  `mark-complete.ts` and `grouping-plan*.ts`.
- **The value is not blank — it is `0`.** The REST record returns
  `costEstimate = 0`, `costEstimateRate = 0`, `costEstimateType = AVGCOST` on every
  member line. Accounting's "blank" is NetSuite rendering a zero cost as empty.
- **`AVGCOST` is inherited from the item master.** Both items carry
  `costEstimateType = Average Cost` and `cost = 0` (costing method FIFO). They have
  no receipt history in this account, so average cost resolves to zero. NetSuite is
  deriving correctly from an empty basis.

## 2 · The field, established by arithmetic rather than by label

The displayed **UNIT COST** column is **`costEstimateRate`** (per unit).
`costEstimate` is the extended value. Proven against the firm's own Sales Orders:

| Control SO | qty | `costEstimateRate` | `costEstimate` | check |
|---|---|---|---|---|
| SO2645 | 5,000 | **0.071** | 355 | 0.071 × 5,000 = 355 ✓ |
| SO2646 | 1,000 | **9.05** | 9,050 | 9.05 × 1,000 = 9,050 ✓ |
| SO2698 | 500 | **0.1** | 50 | 0.1 × 500 = 50 ✓ |
| SO2701 | 1,000 | **2** | 2,000 | 2 × 1,000 = 2,000 ✓ |

`costEstimate` is consistent with `rate × qty` in **every** control, so it reads as
derived. The value to send is the **per-unit** one.

## 3 · Do non-Nexus Sales Orders populate it? Yes — with `CUSTOM`

| SO | origin | `costEstimateType` | lines with non-zero cost |
|---|---|---|---|
| **SO2646** (Epicuren masks, OTC setup) | firm | **CUSTOM** | 4 of 4 |
| **SO2645** (Roman Health) | firm | **CUSTOM** | 1 of 1 |
| **SO2701**, **SO2698** | firm | **CUSTOM** | all |
| SO2703, SO2704 | Nexus-era | AVGCOST | **0** |
| **SO2707 / SO2708 / SO2709** | Nexus certified | AVGCOST | **0** |

**The firm's established practice is `costEstimateType = CUSTOM` with an explicit
per-unit cost.** The values are plainly governed product costs, not inventory
valuations — `0.071/unit`, `9.05/unit`, `1250/unit` for an OTC setup line.

**Blankness is consistent across the entire certified set** — SO2707, SO2708 and
SO2709 all carry `0 / 0 / AVGCOST` on every product line.

## 4 · Item Group member lines vs ordinary lines

**No difference for this field.** Member lines carry the full cost trio exactly as
ordinary inventory lines do. What differs is the group *scaffolding*:

- Group **header** line (`ASY-…-G`) — no cost fields present at all
- Group **total** line — no cost fields present at all
- Group **member** lines — `costEstimate` / `costEstimateRate` / `costEstimateType`
  present, same as any inventory line

So the projection change applies to member lines and Direct product lines
identically, and must **not** attempt to set cost on the header or total lines.

## 5 · Which cost — and the trap on SO2709

**[Accounting to confirm]** The control evidence says Nexus's **governed per-unit
product cost**, matching the firm's existing CUSTOM practice.

For the reported members that is **Box `0.625`** and **Bottle `1.125`** — the
`assembly_leaf_inputs.unit_cost` values, which are the packaging component cost.

**Two numbers that must never be used, and SO2709 shows why:**

| | SO2707 Box | SO2709 Box |
|---|---|---|
| `rate` (sell) | 1.25 | **1.90** |
| governed unit cost | 0.625 | 0.625 |

SO2709 carries pass-through freight, which lifts the Box **selling rate** to 1.90
while the product's unit cost is unchanged at 0.625. Sourcing Unit Cost from
`rate`, or from any freight-loaded commercial figure, would put **1.90** in a cost
column and make the same product appear to cost three times more on a freight
quote than on a non-freight one — inverting margin on exactly the artifact
Accounting is reviewing.

Freight and customs are separate buckets in the Nexus cost stack. **The projection
must read the product cost bucket only**, and must be invariant to freight
treatment. That invariance is the thing to assert in a test: same product, two
quotes with different freight treatment, identical projected unit cost.

## 6 · Minimum projection change

On each **member and Direct product line**, at CREATE:

```
costEstimateType = CUSTOM
costEstimateRate = <governed per-unit product cost>
```

Do not set `costEstimate` — it is derived (§2). Do not touch header or total lines
(§4). Do not send `rate` (§5).

**Set it at CREATE, not by PATCH.** `patchSalesOrderLine` accepts only `{ rate }`
**by construction**, because a full-sublist PATCH returns 204 while silently adding
a second group expansion — twelve transaction lines and a doubled rollup, reported
as success. Widening that function to carry cost would re-open the exact hazard it
was narrowed to prevent. Cost belongs in the CREATE payload.

## 7 · What is NOT yet established — needs a disposable-sandbox probe

**I have not proven `costEstimateType` / `costEstimateRate` are writable through the
REST Record API.** The controls carrying CUSTOM values may have been created in the
NetSuite UI; their existence proves the *field* is populated in practice, not that
*this API* can set it. Three questions, all answerable on a throwaway SO:

1. Does REST accept `costEstimateType` + `costEstimateRate` on an item line at
   CREATE?
2. Does it accept them on an **Item Group member** line specifically? The
   `item-groups.ts` probe already banked one member-line field that behaves
   unlike its documentation, so member lines have a track record here.
3. Does NetSuite recompute `costEstimate` from the rate, or does omitting it leave
   the extended value at zero?

**Do not run these against SO2707/2708/2709.** Use a disposable sandbox SO, as with
the earlier idempotency measurement.

## 8 · Consequence for the certified set

The three certified Sales Orders are **not wrong** — no incorrect cost was written.
They are **incomplete**: a field the firm normally populates is absent, so
NetSuite-side margin reporting on these orders reads against a zero cost basis.

Whether the certified artifacts should be left as-is with the gap recorded, or the
projection fixed and a fresh artifact produced for Accounting, is a decision for
Accounting and not one I have taken. Per instruction, SO2707/2708/2709 are
unchanged.

---

## 9 · Status at walk stop (2026-08-13)

The repair is implemented and evidenced; the end-to-end governed artifact is
**not** produced. Recorded here so the distinction survives.

| | |
|---|---|
| Implementation `20da735` | complete — `tsc` clean, 9/9 new tests, 139/139 affected |
| Direct provider write | **proven** (sandbox probe, GET read-back) |
| Item Group member scalar PATCH | **proven** (12/12, no sublist expansion) |
| Targeted / affected regression suites | **green** |
| Full governed artifact | **PENDING** |
| SO2707 / SO2708 / SO2709 | preserved unchanged |
| Production deployment | **not deployed** — `main` is `e97011c`, which lacks the repair |

### Why no artifact was produced

Not for want of a working repair. Two independent environment/fixture facts, in
the order they were hit:

1. **CERT-ENV-1** — no deployed runtime suppressed HubSpot writes. Fixed for
   Preview only; see `cert-env-1-deployed-suppression-absent.md`.
2. **`fa74cbe5` is disqualified as a Complete fixture.** Its HubSpot deal
   (`63198467934`) carries **no company association**, verified authoritatively
   against a control deal resolving through the identical call.
   `markComplete` requires `associatedCompanyId` for customer resolution and
   throws without it. Restoring the evicted cache row does not help — the
   association does not exist at source.

**This is fixture lineage, not evidence against `20da735`.** Nothing observed
implicates the repair; the walk never reached the code under test.

Both accepted quotes in the database are SMOKE fixtures with the same gap, so no
qualifying fixture exists today. A replacement would require a full
draft → send → accept → complete run on a real deal-backed project — safe now
that Preview suppression is proven, but a longer tail than a one-click Complete.

**Deliberately not built before the Accounting call.** If Accounting's downstream
Production / OTC / Freight decisions change what the artifact must show, one
fixture can satisfy both rather than spending two.

### Blocking gate carried forward

No NetSuite write may occur on any deployed runtime until Vercel Preview
`NETSUITE_ACCOUNT_ID` and `NETSUITE_ENV` are read and recorded in
`cert-env-1-deployed-suppression-absent.md`. `assertWriteAuthorized` fails closed
on a production account **unless** `NETSUITE_ENV=sandbox` is set explicitly,
which would override the inference — so the guard cannot be assumed without both
values.

---

## 10 · Correction to §1 (2026-08-13, from read-only SO line inspection)

**§1 states the governed cost was always transmitted, "only to
`custcol_dps_unit_cost`". That is true of the FLAT branch and false of the Item
Group branch.** Direct line-item reads of the certified orders show the custom
column is `null` on **every** line of an Item Group order — group header, members
and EndGroup alike:

```
SO2707 (361542)                        SO2704 (361441)
line 1 Group     custcol_dps_unit_cost null    line 1 Group     null
line 2 InvtPart  null · AVGCOST · rate 0       line 2 InvtPart  null · AVGCOST · rate 0
line 3 InvtPart  null · AVGCOST · rate 0       line 5 Group     null   (1-member group)
line 4 EndGroup  null                          line 6 InvtPart  null · AVGCOST · rate 0
```

The mechanism is the create payload: the group branch sends **bare** group lines
(`item` + `quantity` only), because sending members explicitly alongside a group
duplicates the order (Probe 7a). NetSuite expands the members itself, and they
inherit from the item master — so no per-line custom column was ever set, and no
later pass patched one. Only `rate` was patched, by rate convergence.

**So on Item Group orders neither the custom column nor the native cost basis
carried the governed cost.** `costEstimateType: AVGCOST` with
`costEstimateRate: 0` is confirmed empirically as the source of the blank Unit
Cost Accounting reported.

This **strengthens** the repair's rationale rather than changing it: the
projection pass added in `20da735` is the only mechanism that can reach member
lines at all, since they do not exist at CREATE time.

**It also sharpens the scope of the gap on the certified set.** §8 says the three
orders are incomplete rather than wrong; that stands, and the incompleteness is
total for Item Group orders — no cost field of any kind was populated on their
lines.

**Related, and unexercised:** every certified Sales Order is group-based. The
flat branch — which now carries `costEstimateType`/`costEstimateRate` at CREATE —
**has never run in production.** Its cost behaviour is proven by unit test and by
the disposable sandbox CREATE probe, not by a governed artifact. See
`product-library-setup-v1-boundary-review.md` §11.

### 10.1 · Correction to §10, and a mechanism for the flat path

§10 said the flat branch had never run. **Wrong** — grouping applies only when
`detailLevel === "turnkey_only"`; the flat payload is the default and is kept
byte-for-byte for `itemized`. **SO2698 is itemized** and reads back as three
plain `InvtPart` lines. The certified set is uniformly `turnkey_only`, so the
sample could not have shown the flat branch even though it runs.

**And SO2698 carries `costEstimateType: CUSTOM`, `costEstimateRate: 0.1`** —
pushed 2026-07-29, weeks before `20da735`, by code that demonstrably never sent
those fields. `legacy-so-populated-field-parity.md:117` recorded the same values
independently at the time, attributing them to "NetSuite-computed from unit
cost".

**The most consistent reading of the evidence: a NetSuite-side derivation
populates the cost basis from `custcol_dps_unit_cost`.** On SO2698 the derived
`costEstimateRate` (0.1) equals the transmitted custom column (0.1) exactly. That
order also carries several other SuiteScript-populated fields, so server-side
automation on REST-created orders is established behaviour for this account, not
a novel hypothesis. I have **not** inspected the script itself, so this is a
strong inference from values, not a read of the automation.

**It explains the defect precisely, and sharpens it:**

| path | `custcol_dps_unit_cost` | resulting cost basis |
|---|---|---|
| flat / itemized | sent at CREATE | derived → `CUSTOM` + correct rate |
| Item Group members | **never set** (bare group lines) | nothing to derive → `AVGCOST` + `0` = **blank** |

So Unit Cost was never uniformly broken — it worked wherever the custom column
reached the line, and failed wherever it could not. The three certified orders
are all `turnkey_only`, which is why Accounting saw blanks on all of them.

**This does not weaken the repair; it removes a dependency.** `20da735` sets the
native pair directly on both paths, so the value no longer relies on a
server-side derivation Nexus does not own, cannot see, and did not know it was
depending on. That dependency is itself worth recording as a finding: correct
output was being produced by a mechanism outside the codebase.
