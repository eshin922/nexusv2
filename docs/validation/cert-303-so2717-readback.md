# CERT-303 · SO2717 provider readback

Lineage II. Quote `45dc9f64-45e9-4785-b60f-d8141ef65eef` · **DPS-1056** ·
NetSuite **SO2717** (internal `362541`), created 2026-08-19.

Every figure below is read back from NetSuite, not from what Nexus believes it
sent.

---

## Result — 8 of 10

| # | required | observed | |
|---|---|---|---|
| 1 | quantity 2,000 | **1** | ✗ |
| 2 | rate $2.24 | **$4,480** | ✗ |
| 3 | amount $4,480.00 | 4480 | ✓ |
| 4 | cost type CUSTOM | `CUSTOM` | ✓ |
| 5 | cost rate $1.60 | 1.6 | ✓ |
| 6 | tax code -8 | `-8 -Not Taxable-` | ✓ |
| 7 | tax total $0 | **0** | ✓ |
| 8 | item OTC-0016 / 15323 | `OTC-0016 OTC - Micro Testing`, id 15323 | ✓ |
| 9 | selected intent = posted provenance | 15323 → 15323 → 15323 | ✓ |
| 10 | REG-4 exact | 448000c = 448000c | ✓ |

### The tax fix is proven

`taxTotal = 0` while **customer 388800 still carries `taxable: true`**. That is
the non-vacuous form of the proof: the customer configuration that produced
$1,030.50 on SO2716 is unchanged, and the payload is what suppressed it. No
master data was touched.

### Cost is proven

`costEstimateType: CUSTOM` with `costEstimateRate: 1.6` and
`custcol_dps_unit_cost: 1.6` — the governed live cost, $3,200 / 2,000 units.
SO2716's OTC lines fell back to `LASTPURCHPRICE` and `ITEMDEFINED`; this one
does not.

### Provenance matches

Frozen `selectedNetsuiteItemId` 15323 → frozen `netsuiteItemId` 15323 (written
at push) → provider line item id 15323. The operator's choice, the record of
what was posted, and what NetSuite holds all agree.

---

## The two failures — a Direct Service unit line was emitted as a charge line

```
FROZEN   qty 2000   unitRate 2.2400   lineAmount 4480.00
POSTED   qty 1      rate     4480     amount     4480
```

`accounting-line-emitter.ts` hardcodes `quantity: 1 as const`, and its header
states the intent plainly: *"ONE emitter for both a Direct Service and a
separately billed Item Group OTC charge. They are the same kind of thing — a
one-time charge whose amount IS its own line."*

**That premise is what the disposition rejects.** The rule is that quantity-1
belongs to separately billed OTC / accounting-charge lines, and NOT to a Direct
Service unit line. Here the two disagree, so a line the accepted statement
describes as 2,000 units at $2.24 reached NetSuite as one unit at $4,480.

This is the same shape as the gate defect fixed earlier today: a proxy
("Direct Service ≈ one-time charge") that was serviceable while every Direct
Service was in fact a one-time fee, and is wrong now that a Direct Service can
be unit-priced across a tier quantity.

**Reconciliation does not catch it, and cannot.** REG-4 is EXACT — 448000c
against 448000c — because `1 × 4480` and `2000 × 2.24` are the same total. This
is the documented rule in practice: *exact reconciliation is necessary but not
sufficient; a presentation can reconcile perfectly while attributing value to
the wrong governing authority.* The total is right and the unit economics are
misstated, which is precisely the failure summing cannot see.

Not repaired here. The emitter serves BOTH Direct Services and Item Group OTC
charges, so splitting them is a change to what a governed emitter emits, and it
needs the rule stated before the code moves: which frozen lines are unit lines
and which are charge lines. The frozen row already carries what that decision
would key on — `lineKind`, `bv011Destination`, and a per-tier `quantity` that is
2000 here and would be 1 for a true one-time fee.

---

## Also observed — price level

`priceLevel id=1 "Base Price"` on the posted line, exactly as on SO2716. Nexus
sets `rate` and never sets `price`, so NetSuite fills the label. The
Base→Custom change remains unimplemented per instruction, pending a test of its
effect on Item Group member PATCH.
