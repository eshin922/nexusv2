# UAT trace — tax and price level on SO2716

Measured 2026-08-19 against the sandbox, reading the raw Sales Order record
rather than a projected shape. Nothing changed.

SO2716 = internal id **362441** (CERT-300). `2716` is the tranId; the REST path
takes the internal id, and passing the tranId returns a 404 that looks like
"the order does not exist".

---

## 1 · Tax — the cause is the CUSTOMER, and the model is LEGACY

**Header.** `taxTotal = 1030.50`, `total = 18,205.50`, `subtotal = 17,175.00`.
The subtotal equals the frozen commercial total exactly, so **tax already sits
outside the frozen commercial statement** and REG-4 is untouched by anything
done here.

**Which tax model.** Enumerated the full header key set rather than testing for
one field:

| field | present |
|---|---|
| `taxDetails`, `taxDetailsOverride`, `taxRegOverride` (SuiteTax markers) | **absent** |
| `taxItem`, `isTaxable`, `taxRate`, `nexus`, `taxPeriod` | **absent** |
| `taxTotal` | present — derived, read-only |

So this is **legacy tax**, and there is **no header-level tax control on the SO
REST schema**. Per-line `taxCode` is the only lever the payload has.

**Per line, as posted:**

| # | line | taxCode | rate |
|---|---|---|---|
| 0 | `ZZ-CERT-KIT-G` (group header) | `-8` **-Not Taxable-** | — |
| 1 | `DPS-BOTTLE-0001` (**member, NetSuite-expanded**) | `-519` **CA_CA** @ 6% | 2.175 |
| 2 | EndGroup | `-8` -Not Taxable- | — |
| 3 | `OTC-0050` | `-519` CA_CA @ 6% | 5600 |
| 4 | `OTC-0024` | `-519` CA_CA @ 6% | 700 |

**Customer 388800 carries `taxable: true`.** Nexus sends no `taxCode` at all —
`sales-orders.ts:309` emits one only when `firm_settings.netsuite_default_tax_code_id`
is set, and it is NULL, per a 2026-07-28 disposition that deliberately left tax
to NetSuite's engine. That disposition is what the new business rule overturns.

**Do the item masters force it?** No — and this was checked with a control,
because the first attempt failed and a failed read is not a negative result:

```
66476 DPS-BOTTLE-0001  InvtPart     taxschedule 2
59157 OTC-0050         NonInvtPart  taxschedule 2
26348 OTC-0024         NonInvtPart  taxschedule 1
76054 ZZ-CERT-KIT-G    Group        (none)
control: SELECT id, itemid FROM item WHERE id = 66476  → succeeded
```

Two different schedules (2 and 1) produced the **same** `CA_CA` code, so the
code is derived from the customer's taxable flag and nexus, not from the item
master. The item master is not the cause.

**`-8` is a real, valid code in this account** — it is already on lines 0 and 2
of this very order, applied by NetSuite itself. Using it is evidenced, not
guessed.

### Proposed enforcement — per line, in two places

There is no transaction-level field, so enforcement is **per line**, and it must
cover a case that is easy to miss:

1. **Flat lines** (Direct Product, Direct Service, OTC/accounting) — emit
   `taxCode: { id: "-8" }` unconditionally, from a governed constant.
2. **Group header + EndGroup** — already `-8`, but emit it explicitly rather
   than inheriting a NetSuite default that is not ours to rely on.
3. **Item Group MEMBER lines** — **these are created by NetSuite's group
   expansion, not by Nexus**, which is why line 1 is taxable while the header
   around it is not. Nexus reaches them only through the Step 3 member-rate
   `PATCH`. The taxCode must ride that PATCH or grouped orders stay taxable
   however the flat-line emitter is changed.

Point 3 touches certified F1/F4 orchestration (the member PATCH convergence),
which is why it is written down here before being changed rather than folded in
quietly.

**Not proposed:** setting `firm_settings.netsuite_default_tax_code_id = '-8'`.
It requires no code change, which is its whole appeal, and it is the wrong
instrument — it leaves a governed commercial rule sitting in an admin-mutable
field, and it does not reach member lines at all, so grouped orders would stay
taxable while the setting claimed otherwise.

---

## 2 · Price level — Base Price, defaulted by NetSuite

| line | price level | rate |
|---|---|---|
| `DPS-BOTTLE-0001` | id `1` · **Base Price** | 2.175 |
| `OTC-0050` | id `1` · **Base Price** | 5600 |
| `OTC-0024` | id `1` · **Base Price** | 700 |

**Nexus never sets `price`.** It sets `rate`, and NetSuite fills `price` with
Base Price (id 1) while honouring the explicit rate. So the amounts are already
Nexus's — the label is what misreports, exactly as Aisha described: the line
claims a base price it did not come from.

The NetSuite mechanic for "Custom" is price level **`-1`**, set alongside the
explicit `rate`. Two things are NOT yet established and should not be asserted:

- the `pricelevel` record is **not SuiteQL-queryable** in this account (the read
  failed; the catalog is unconfirmed rather than empty), so `-1` is the
  documented NetSuite convention here, not something measured;
- whether setting it changes **member PATCH** behaviour is untested.

Both resolve on the next certification order by setting it and reading back.
Until that readback exists, this stays a proposal.

---

## 3 · Cost fields — what SO2716 actually shows

Relevant to Accounting's "unit cost required" finding, from the same read:

| line | `costEstimateType` | `costEstimateRate` | `custcol_dps_unit_cost` |
|---|---|---|---|
| `DPS-BOTTLE-0001` | **CUSTOM** | 1.5 | 1.5 |
| `OTC-0050` | **LASTPURCHPRICE** | 2500 | — |
| `OTC-0024` | **ITEMDEFINED** | 0 | — |

The product line already carries governed CUSTOM cost. The two OTC lines fall
back to the item master's own costing — `LASTPURCHPRICE` and `ITEMDEFINED` are
NetSuite defaults, not values Nexus sent. That is precisely the gap Decision 1
closes, and SO2716 predates it. The next certification order is the proof.
