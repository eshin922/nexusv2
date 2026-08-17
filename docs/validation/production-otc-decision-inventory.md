# Production / OTC — decision inventory

**Compiled 2026-08-17 against `7fa1739`.** Authorities:
[BV-011](../business-validation/BV-011-production-otc-accounting-map.md)
(classification / destination) and
[BV-012](../business-validation/BV-012-production-cost-ownership.md) (ownership).

> **UPDATED 2026-08-17 — F1, F2 and F4 are now SETTLED, and C1/C2 are narrowed.**
> See "Settled by the Direct Service disposition" below. The rest stands.

**This document decides nothing.** It reports the business and accounting
decisions that must be settled before any Production/OTC code is written, and
marks which of them **move money** or **change NetSuite structure**.

---

## Settled by the Direct Service disposition (2026-08-17)

Recorded here so the inventory does not read as open where it is not. Authority:
[BV-012 §5](../business-validation/BV-012-production-cost-ownership.md) and
[the Direct Service trace](direct-service-architecture-trace.md).

**F1 — do OTC destinations become SO lines? → YES.** Two independent routes now
require it:

- a **Direct Service** projects as a standalone OTC/accounting line
  (e.g. `OTC - Filling`), priced from service cost + `Production` markup, with
  no artificial Item Group;
- a **separately billed Item Group** OTC/service charge must reach the SO as an
  explicit line **associated with the owning Item Group**.

**F2 — where are allocation-OFF fees billed? → ON THE SO.** The current state,
where the PDF can show a separately billed fee that `totalRevenue` and the SO
omit, is **not preserved**. The Sales Order must represent the accepted
commercial total. This is the direction, not the mechanism; the reconciliation
is implementation-sequenced.

**F4 — are OTC lines inside the Item Group's `composition_hash`? → NO.**
`composition_hash` represents finished-good product structure. Packaging /
product structural membership continues to govern Item Group identity. An OTC
line may be *associated* with an Item Group for SO and accounting purposes
without joining its identity — so Setup, Tooling, Testing or Freight changing
between quotes does not manufacture a new Item Group. **OD-004 identity
stability is preserved.**

**C1 / C2 — allocation behaviour → NARROWED, not settled.** Allocation is now
governed as an **Item Group / turnkey concept only** (BV-012 §5.d): a Direct
Service does not expose it and does not route through it. What remains open is
whether allocation stays uniform across Item Group OTC destinations, and whether
an Inventory-Item OTC may be amortised into unit cost.

**Unchanged and still open:** A1, A2, B1–B4, D1/D2 (settled separately by
BV-013), E1–E3, F3.

---

## Already settled — do not re-litigate

| | |
|---|---|
| Ownership | Item Group owns Production economics; no Item Group, no Production economics (BV-012) |
| Classification | 16 destinations, 6 Inventory / 10 Non-inventory (BV-011) |
| Persistence | `assembly_production_inputs.assembly_id NOT NULL` — already correct |
| Authoring | One Production surface per Item Group; none on members or Direct Products (#282) |
| Allocation authoring scope | Quote-wide for V1 (2026-08-17), storage stays per-assembly |
| Allocation initialization | Unpersisted Item Group reads and writes the governed default (#283) |

---

## Current state, measured

Seven production inputs exist. BV-011 names sixteen destinations.

| input | today's treatment | BV-011 destination |
|---|---|---|
| `fillingBlendingCost` | always internal COGS — allocation cannot touch it | `OTC - Filling` · Inventory · finished-good |
| `cmAssemblyTotal` | always internal COGS | `OTC - Packout` · Inventory · finished-good |
| `bulkRawCost` | own governed node + own markup authority (T-4) | `OTC - Raws` · Inventory · finished-good |
| `setupFeeTotal` | one-time fee, allocation-gated | `OTC - Setup` · Non-inventory |
| `toolingArtworkTotal` | one-time fee, allocation-gated | **splits into two** — `OTC - Tooling` (Inventory) + `OTC - Artwork` (Non-inventory) |
| `rdTotal` | one-time fee, allocation-gated | `OTC - Formulation` · Non-inventory |
| `otherServiceTotal` | one-time fee, allocation-gated | `OTC - Other Service` · Non-inventory |

**No input exists** for Testing, Dies, Print Plates, Samples, Processing Fee,
Cartons, or Customs-as-distinct-from-Duties.

Markup: all six non-raw production inputs resolve through **one** category,
`PRODUCTION_MARKUP_CATEGORY = "Manufacturing"`. Bulk raw resolves through
`RAW_MARKUP_CATEGORY = "Raw ingredients"`, **which has no row** — it falls back
to `Other` at 30%.

Customer-facing: exactly four fee labels (`FEE_COPY`), emitted only when
allocation is OFF, aggregated per assembly.

NetSuite: **every SO line is a LEAF line** — `netsuiteItemId` from the library
leaf, `rate = requiredSellPerUnit`. Production economics reach NetSuite
**embedded in leaf rates**, never as their own lines. `mark-complete` contains
no service-fee handling of any kind.

---

## The decisions

Marked **💰 money** and **🏗 NetSuite structure**.

### A · Finished-good economics

**A1 — Does `cmAssemblyTotal` mean `OTC - Packout`?** The names differ
("CM assembly" vs "Pack-out"). No money if it is a 1:1 rename; a new input if
they are different activities.

**A2 — What is the governed markup for Bulk Raw? 💰**
`RAW_MARKUP_CATEGORY = "Raw ingredients"` has no row in `markup_defaults`, so
every quote carrying bulk raw is priced today at `Other`'s 30% via an explicit
fallback. This is live on production data. Either the category is created with
a governed rate, or the fallback is ratified as the rule. **Whichever is
chosen, the answer changes or confirms real prices already quoted.**

### B · Separate OTC / service lines

**B1 — Which of the seven unrepresented destinations get inputs in V1? 💰**
Testing, Dies, Print Plates, Samples, Processing Fee, Cartons, Customs. Each
new input is a new cost that reaches sell.

**B2 — Is `toolingArtworkTotal` split? 💰 🏗** BV-011 sends Tooling to an
**Inventory** item and Artwork to a **Non-inventory** item. One persisted field
cannot project to two item types. Splitting is a migration; not splitting means
one of the two destinations is unreachable.

**B3 — What distinguishes `OTC - Customs` from `OTC - Freight, Duties,
Tariffs`? 💰 🏗** Today `duty_pct` and `tariff_pct` fold into landed freight and
no separate customs quantity exists. BV-011 makes them two destinations, both
Inventory. The boundary is undefined.

**B4 — Are Cartons a re-map or a new input? 💰** Corrugated/carton costs are
plausibly authored today as packaging under the `Secondary` markup category.
Moving them to `OTC - Cartons` changes which markup applies.

### C · Allocation behaviour

**C1 — Does allocation stay uniform across all OTC? 💰** It is one boolean over
four fees today. BV-011 spreads OTC across both item types. Per-destination or
per-item-type allocation changes unit cost and therefore sell.

**C2 — May an Inventory-Item OTC be allocated into unit cost? 💰 🏗** Tooling,
Customs and Freight/Duties/Tariffs are Inventory Items in BV-011. Whether an
inventory item's cost can be amortised into another item's unit cost is an
accounting question, not a UI one.

**C3 — Does quote-wide allocation authoring survive C1?** The V1 scope
disposition (2026-08-17) was taken on the current uniform model. If allocation
becomes per-destination, "set once for the quote" may no longer express it.

### D · Markup authority

**D1 — Markup per destination, per item type, or one production rate? 💰**
Six inputs share one rate today; BV-011 has sixteen destinations.

**D2 — What is the governed markup vocabulary? 💰** `markup_defaults` holds
seven rows. `CLAUDE.md` documents nineteen categories as "the actual production
vocabulary… not placeholders." They disagree, and the rates are prices.

### E · Customer Quote / PDF presentation

**E1 — Which destinations are customer-visible, and under what labels?** Four
labels exist today. Sixteen destinations do not imply sixteen customer lines.

**E2 — Are customer-visible OTC lines grouped or itemised?** Interacts with
`detail_level` (`turnkey_only` / `itemized`) and OD-004.

**E3 — Freight presentation remains BV-009's question**, which is unratified
([OD-001](../OPEN_DECISIONS.md)). A dependency, not a new decision.

### F · NetSuite item projection

**F1 — Do OTC destinations become SO lines? 🏗** Today the SO line set is
exactly the leaf set. Adding OTC lines changes its shape, and REG-4 requires
the lines to sum exactly to the accepted commercial total.

**F2 — Where are allocation-OFF fees billed? 💰 🏗 — HIGHEST STAKES**

This is the one finding that is already live rather than prospective.

With allocation OFF:

- the fees are excluded from `requiredSellPerUnit`, therefore from
  `tierRollup.totalRevenue`, therefore from the SO amount — `mark-complete`
  pushes `totalRevenue` and contains no service-fee handling;
- the customer PDF renders them as separate charge lines **and folds them into
  the grand total** (`foldFees={hasCharges}`).

So on an allocation-OFF quote the customer is shown a total that the Sales
Order does not carry.

**This is stated as a divergence, not as a defect**, because it turns on an
undecided question: whether "the accepted commercial total" that REG-4
reconciles against is `tierRollup.totalRevenue` or the customer's turnkey
total. If fees are intended to be invoiced outside the SO, the current
behaviour is correct and should be documented. If not, every allocation-OFF
quote pushes a short SO. **Nobody should write Production/OTC code before this
is answered**, because it determines whether OTC lines are additions to the SO
or a separate billing path.

**F3 — Do the 16 accounting items exist in NetSuite, and who owns creating
them? 🏗** BV-011 names destinations; internal ids must be mapped before any
projection can resolve.

**F4 — Are OTC lines inside or outside the Item Group? 🏗** Under OD-004,
grouping follows the quote's agreed presentation. An OTC line attributed to an
Item Group is a group member; one attributed to the quote is not. This
determines the grouping plan's shape.

---

## Suggested settling order

F2 first — it is live, and its answer constrains F1 and C1. Then A2 and D2,
which are live pricing questions independent of everything else. Then B2/B3,
which are migrations. E and F1/F3/F4 last, since they consume the rest.

Nothing here should be coded before its decision is recorded as business
authority.
