# UAT traces — Base→Custom price level, and the four operational fields

Measured 2026-08-19 against the sandbox. Both traces are complete; neither is
implemented. Nothing on the retained witnesses (SO2716 / SO2717 / SO2718) was
touched.

---

## 1 · Base → Custom price level

### What the orders carry today

Every priced line Nexus has ever posted carries price level **id 1 "Base
Price"** — SO2716, SO2717, SO2718, and the grouped fixtures alike. Nexus sets
`rate` and never sets `price`, so NetSuite fills the label itself. The amounts
are already Nexus's; only the label misreports where the number came from,
which is exactly what Aisha described.

### Can an Item Group MEMBER take the Custom flag? — YES, measured

The member line is the case that mattered, because members are created by
NetSuite's group expansion and Nexus reaches them only through the Step 3
rate PATCH.

Probe on **SO2715** (`CERT-MIXED-DELETE-ME`), member line addr 3,
`DPS-BOTTLE-0001`. **SO2714** — an identical untouched order — served as the
control, so a change appearing in both would not be attributable to the probe.

```
attempt 1   PATCH { price: {id:"-1"} }                 REFUSED
            "Please enter a value for Amount."
            line unchanged: rate 1.8705, priceLevel 1

attempt 2   PATCH { price: {id:"-1"}, rate: 1.8705 }   ACCEPTED
            AFTER  rate 1.8705   amount 1870.5   priceLevel -1

SO2715 subtotal 6075.5 → 6075.5      (unchanged)
SO2714 subtotal 6075.5 → 6075.5      (untouched control)
```

**Findings, in order of load-bearing-ness:**

1. **The flag holds on a member line.** `price` accepts `-1` on a
   group-expanded member and persists.
2. **It does NOT reprice.** Rate, line amount and the order total are all
   byte-identical before and after, and the control order did not move either.
3. **The level cannot be set alone.** `price` on its own is refused — NetSuite
   demands an amount in the same request. This is not an obstacle in practice:
   Nexus's member PATCH already sends `rate`, so `price` rides along with a
   value NetSuite is happy to accept. But it does mean the change is
   necessarily part of the rate PATCH rather than a separate pass.
4. `refName` on price level `-1` comes back **empty** — the id is the
   documented Custom sentinel rather than a named record, and the account has
   no `pricelevel` row to resolve (SuiteQL on `pricelevel` is not queryable
   here — a failed read, not an empty catalog). So `-1` is identified by
   behaviour: it is accepted, it persists, and it is not level 1.

SO2715's member line was **left at `-1`**. It is a `DELETE-ME` fixture and the
state is itself the evidence that the probe ran.

### What implementing it would touch

- `buildSalesOrderPayload` — add `price: { id: "-1" }` beside `rate` on flat
  lines. **Untested at CREATE**; only the PATCH path was measured, and a
  CREATE-time refusal analogous to attempt 1 cannot be ruled out from here.
- `patchSalesOrderLine` — a `priceLevelId` parameter written literally into the
  body, the same shape as the `taxCodeId` addition, plus the allowlist guard
  extended from five governed keys to six.

Not implemented, per instruction.

---

## 2 · The four operational fields

Source of truth → NetSuite target. **Three of four are already wired.**

| field | Nexus source | NetSuite target | state |
|---|---|---|---|
| Customer PO Number | `hubspot_deals_cache.client_po` | `otherRefNum` **+** `custbody_dps_client_po` | **wired** |
| Estimated Invoice Date | `hubspot_deals_cache.invoice_date_est` | `custbody_dps_est_invoice_date` | **wired**, observed populated |
| Segment | `hubspot_deals_cache.business_segment_id` | `cseg_dps_bus_seg` | **wired**, observed populated |
| Sales Rep | `hubspot_deals_cache.sales_rep_{id,name,email}` | `salesRep` (employee ref) | **NOT wired** |

### Source availability across the live cache (73 deals)

```
sales_rep_id        69      invoice_date_est   66
sales_rep_email     68      business_segment   66
client_po            4
```

`client_po` being sparse is real data, not a gap — most deals genuinely carry no
customer PO. All four emit conditionally, so a null source writes nothing.

SO2718 carries none of them, correctly: its lineage is a synthetic
certification deal whose cache row has all four NULL. Evidence for the wired
three therefore comes from real-customer orders — SO2701 / SO2704 / SO2707 /
SO2709 all carry `custbody_dps_est_invoice_date` and `cseg_dps_bus_seg`.

### Sales Rep — two obstacles, both measured

**(a) NetSuite already populates it, and not from Nexus.** `salesRep` is present
on every real order and resolves to employee **210084 on all of them** — three
different customers, one identical rep. Nexus never sends the field, so
NetSuite is deriving a single default. Meanwhile the HubSpot owner is a real
per-deal value Nexus already holds (Jing Santos on those three).

So this is not "an empty field to fill". It is a field NetSuite fills with
something, which may or may not be what Accounting wants, and the question of
whether Nexus should override it is theirs rather than ours.

**(b) Nexus cannot resolve or validate an employee.**

```
GET /record/v1/employee/210084
  → 403 "You need the 'Lists -> Employee Record' permission"
GET /record/v1/customer/388800
  → 200 ZZ-VALIDATION Nexus Certification Customer      (control: the path works)
```

The integration role lacks employee-record permission. The control proves this
is a genuine permission boundary rather than a broken path. Consequently Nexus
could not apply the resolve-or-refuse discipline it uses for items — it would
be posting an employee id it cannot verify exists.

**Mapping gap.** The cache holds a HubSpot **owner** id/name/email; `salesRep`
wants a NetSuite **employee** internal id. No mapping between those identity
spaces exists in Nexus. Matching on email would be an invented default, so it
is not proposed.

### One discrepancy found in passing

`sales-orders.ts` documents that `cseg_dps_bus_seg` **mirrors `class`** —
*"class is the NS classification taxonomy; cseg is the parallel custom segment
taxonomy — ref carries the same segment id in both"* — citing reference SO2646.

`body.class` is never assigned. A grep for it returns nothing, and on
SO2701 / SO2704 / SO2707 / SO2709 `class` is **null** while `cseg_dps_bus_seg`
is `3`. The comment describes a parity mapping that was never implemented.

Whether `class` should also be written is an Accounting question — the comment
asserts the reference order carries both, which is evidence but not a decision.
Recorded rather than fixed.

---

# DISPOSITIONS APPLIED — 2026-08-19

## Price level — CREATE probe green, Custom implemented

The remaining unknown was CREATE. Probed on a disposable order carrying **no
`custbody_dps_deal_id`**, so it sits outside the duplicate-deal rule and could
not collide with any lineage.

```
SO2720   7 × 123.45 with price -1   →  ACCEPTED
         priceLevel -1 · rate 123.45 · qty 7 · amount 864.15 · subtotal 864.15 · tax 0
```

Every check passed: level Custom, rate unchanged, quantity unchanged,
amount = qty × rate exactly, tax 0.

**Implemented:**

| where | what |
|---|---|
| flat lines at CREATE | `price: { id: "-1" }` beside the governed rate |
| Item Group members | `priceLevelId` on the existing rate PATCH |
| Item Group header / EndGroup | **not sent** — neither carries a rate |
| `patchSalesOrderLine` | **throws** if `priceLevelId` arrives without `rate` |

That last row is the rule the PATCH refusal implies. NetSuite rejects a
price-only write today, so the guard is belt-and-braces — it exists because a
future version that accepted it would be free to source the rate itself, which
is the outcome Custom exists to prevent.

**Falsification:**

```
flat lines revert to NetSuite-chosen level    caught (5)
member PATCH drops the price level            caught (1)
price level allowed without the rate          caught (1)
group HEADER acquires a price level           caught (1)
```

## Sales Rep — NetSuite-derived for V1

No change. Nexus holds a HubSpot **owner**; `salesRep` wants a NetSuite
**employee**; no governed mapping exists, and employee verification is blocked
(`403`, `Lists → Employee Record`, against a succeeding control read). No
email/id mapping was invented and no unverifiable reference is sent.

## Customer PO · Estimated Invoice Date · Segment — no change

All three already wired and observed populated on real orders.

## `class` — comment corrected, field still not sent

`body.class` remains unassigned. Two stale comments claimed otherwise and were
corrected:

- the field-surface header listed `class — NetSuite class ref (business segment
  id; NetSuite resolves)`;
- the parity note claimed `cseg_dps_bus_seg` **mirrors** `class`, citing
  reference SO2646.

Neither was true. Observed orders carry `class = null` with `cseg_dps_bus_seg`
populated. A comment describing an unimplemented mapping is worse than no
comment: it reads as done. Whether `class` should be written stays an
Accounting question.
