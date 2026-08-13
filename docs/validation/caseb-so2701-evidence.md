# Case B — SO2701 created · pre-group evidence

**2026-08-12 · sandbox `7924416_SB2` · DPS-1045 v2 · deal `58332160883`**

## CREATE — succeeded

| | |
|---|---|
| NetSuite internal id | **361141** |
| tranid | **SO2701** |
| push status | `succeeded` |
| amount_pushed | **12000.0000** |
| idempotency key | `nxs-so-b18ee08b1582c8d5b1cab59e38195fe81c4b328f` (unchanged from Walk 1, accepted) |
| snapshot / tier | `77dc598b` / `b3e94d40` (1,000 units) |
| started → completed | 01:48:14.286 → 01:48:31.825Z |
| quote | `complete`; `accepted_tier_id` written by the freeze tx |

**No idempotency replay.** The watch condition — the same validation error
naming `class` despite a class-free body — did not occur.

## Retry repair proven end-to-end

Two rows now share snapshot `77dc598b`:

| row | status | class in payload | sha256(body) |
|---|---|---|---|
| `550dfe60` (Walk 1) | `failed` / `validation` | **true** | `b0ccc82d…` |
| `1e8602fc` (this) | `succeeded` | **false** | `085556b1…` |

The historical row is untouched and still carries its pre-repair body. The new
attempt was built from current code.

Transmitted body frozen pre-POST: `.artifacts/PRE-CREATE-BODY.json`,
`sha256 a82e11ba6aee0d637e22defda19ee6bea730d6fdd8f5d14e475cf1290e5ea05a`.

## Untouched read-back vs frozen target

| field | expected | actual | |
|---|---|---|---|
| customer | 72173 | `72173` | ✓ |
| HubSpot deal | 58332160883 | `58332160883` | ✓ |
| total | $12,000 | line 0 `12000`; items 4000 + 6000 + 2000 | ✓ |
| status | Pending Fulfillment | `B` | ✓ |
| Business Segment | 3 | `cseg_dps_bus_seg = 3` | ✓ |
| Project Services | Primary Packaging | `Primary Packaging` | ✓ |
| Project Source | International → 2 | `2` | ✓ |
| Est invoice date | 2026-09-01 | `9/1/2026` | ✓ |
| `SO.terms` | NetSuite-owned | `2` — customer 72173 also `terms = 2` | ✓ |
| customer PO | absent (`client_po` null) | absent | ✓ |
| duplicate / partial | none | exactly 1 SO for the deal | ✓ |

**Line Classes — the V1 Class contract, proven on a live order.** Nexus
transmitted no `class`; NetSuite derived every line from the Item record:

| line | SKU | qty | rate | amount | line class | item class |
|---|---|---|---|---|---|---|
| 1 | `DPS-BOTTLE-0001` | 1,000 | 4 | 4,000 | **1 Primary** | 1 |
| 2 | `10064-GNX-Box` | 1,000 | 6 | 6,000 | **10 Secondary** | 10 |
| 3 | `DPS-BOTTLE-0001` | 1,000 | 2 | 2,000 | **1 Primary** | 1 |

*(SuiteQL renders Sales Order item lines with negative sign; magnitudes shown.)*

**No unexpected `$0.00` commercial field.** The only zero is line 4, a NetSuite
system `TaxGroup` line, `-Not Taxable-`.

**`custbody_project_manager = 180234` — NOT sent by Nexus.** NetSuite populated
it itself, the same way it populates Class. Strengthens the case that the
owner→employee mapping may not be Nexus's to own. Recorded, not acted on.

**Not confirmed:** `custbody_dps_project_category` and
`custbody_dps_payment_terms_text` both returned SuiteQL 500s on read. That is a
read failure, not evidence of absence — both are present in the frozen body.

## B3 — Item Group observability ESTABLISHED

**Working projection: `transactionLine.itemtype`.**

Positive control, legacy **SO2454** (a genuinely grouped order):

```
line 5   Group        TCS-BAR-01    qty -15000      (header, no amount)
line 6   NonInvtPart  OTC-0012      amt  -7,896.00  <- member
line 7   InvtPart     TCS-BAR-01    amt -19,096.50  <- member
line 8   EndGroup                   amt -33,285.00  <- terminator, group total
line 19  NonInvtPart  OTC-0036      amt  -6,292.50  (outside the group)
```

Group existence = rows with `itemtype='Group'`; membership = the lines between
`Group` and `EndGroup`; group total = `EndGroup.netamount`.

**SO2701 pre-group** — `InvtPart` ×3 + `TaxGroup`; **no `Group`/`EndGroup`**.

Established on the untouched SO *and* against a known-grouped control, so a null
result after grouping means "no group", not "wrong query". `getRecord` was not
needed (it errored on path encoding); projection 1 is sufficient.

## Next — manual step, administrator required

Grouping per the frozen plan, unchanged:

| group | externalId | amount | members |
|---|---|---|---|
| **A** `OD004-CASEB-A` | `nxs-grp-6b601641…` | **$10,000** | `10064-GNX-Box` 1,000 @ $6 · `DPS-BOTTLE-0001` 1,000 @ $4 |
| **B** `OD004-CASEB-B` | `nxs-grp-01df6311…` | **$2,000** | `DPS-BOTTLE-0001` 1,000 @ $2 |

`DPS-BOTTLE-0001` appears in both at different rates — the property that makes a
wrong-membership wrap detectable despite an unchanged $12,000 total.

Reconcile against `expectedAmount`, not `turnkeyUnitPrice × quantity`.
