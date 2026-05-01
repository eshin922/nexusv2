# Customs and freight — landed-cost data model

Slice 6.5 introduced per-SKU customs columns on `quote_skus`. Slice 7
added `freight_inputs` for shipment-line cost data. Slice 8 corrected
the CBM model after PM workflow review.

This file captures the canonical data shape, the math, and the rules
PMs follow when entering values. Cross-cutting against
`docs/SPEC.md` Section 5 (data model) and Section 6 FR-7 (markup
model). For Slice 8's per-component markup application see
`src/lib/costing.ts`; for the customer-invisible UI rule see
`docs/CLAUDE.md` "Customs / landed-cost data".

## Where each value lives

| Value | Table.column | Scope | Editable on |
|---|---|---|---|
| Duty rate | `quote_skus.duty_pct` | Per-SKU (leaf or assembly) | `/freight` customs row |
| Tariff rate | `quote_skus.tariff_pct` | Per-SKU (leaf or assembly) | `/freight` customs row |
| SKU's total CBM in this shipment | `freight_inputs.sku_total_cbm` | Per-(SKU, freight line, tier) | `/freight` per-tier cell |
| Total freight cost for shipment | `freight_inputs.total_freight` | Per-(line, tier) | `/freight` per-tier cell |
| Units shipped | `freight_inputs.units_in_shipment` | Per-(line, tier); NULL = use tier.qty | `/freight` per-tier cell |
| Freight markup % | `freight_inputs.markup_pct` | Per-line (denormalized) | `/freight` line metadata row |
| Freight treatment | `freight_inputs.freight_treatment` | Per-line | `/freight` line metadata row |

## Why CBM lives on freight, not on quote_skus

The original Slice 6.5 design put `cbm_per_unit` on `quote_skus` —
each SKU was assumed to have a fixed per-unit volume. Slice 8 dropped
that column after PM workflow review.

PM workflow: she captures **the total CBM this SKU occupies in
this shipment**. Derivation varies — clean-pallet shipments multiply
pallets × pallet CBM; mixed pallets allocate by judgment (this pallet
has 60% jars / 40% caps); some shipments are eyeballed. The schema
only stores the number; how it's derived is out of scope.

This makes CBM a property of `(SKU × shipment × tier)` rather than
of `(SKU)`:
- Different tiers ship different volumes (50k bottles take more space
  than 5k).
- Different shipments split the same SKU differently (one shipment
  carries the whole order; another ships only some tiers' worth).

The new column `freight_inputs.sku_total_cbm` captures this exactly.
Per-unit CBM is recoverable as `sku_total_cbm / units_in_shipment` if
the math ever needs it (Slice 8 doesn't).

## Math (canonical)

Per (leaf SKU, tier) — see `src/lib/costing.ts` for the implementation:

```
factory_cost_per_unit = packaging unit_cost
                        + production amortized service fees (when allocate_service_fees=true)
                        + bulk_raw_cost amortized (when not customer_ships_raws)

For each freight line at this tier:
  total_shipment_cbm        = sum across SKUs in this freight line × tier
                              of sku_total_cbm  (single-SKU lines in v1
                              → just this row's sku_total_cbm)
  this_sku_freight_$        = (sku_total_cbm / total_shipment_cbm)
                              × line.total_freight
  container_freight_per_unit = this_sku_freight_$ / effective_units
                              (where effective_units = units_in_shipment ?? tier.qty)
  duty_per_unit             = factory_cost_per_unit × sku.duty_pct
  tariff_per_unit           = factory_cost_per_unit × sku.tariff_pct
  landed_freight_before_markup = container + duty + tariff
  landed_freight_with_markup   = landed_freight_before_markup × (1 + line.markup_pct)

contribution_cost_per_unit = factory_cost
                             + sum across lines of landed_freight_before_markup
                             + separate service fees (when allocate=false)

required_sell_per_unit = (packaging × (1+pkg_markup)
                          + production × (1+manufacturing_markup)
                          + raw × (1+raw_markup)
                          + sum across lines of landed_freight_with_markup
                          + separate fees × (1+manufacturing_markup))
                         × (1 + global_price_adj_pct)
```

Per assembly: rolls up from children via `qty_per_parent`. No
additional markup at the assembly level (would double-mark-up).

## Per-SKU CI value semantics (duty/tariff)

Customs Invoice (CI) value is a customs term: it's the SKU's factory
cost × shipped units. Duty and tariff are pct rates applied to the CI
value. The pct rates live on `quote_skus.duty_pct` / `.tariff_pct`.

Algebraically, `duty_per_unit = factory_cost × duty_pct` is identical
to `(factory_cost × tier.qty × duty_pct) / tier.qty`, where the
numerator `(factory_cost × tier.qty)` is the SKU's CI value at that
tier. We compute per-unit directly because everything else in the
rollup is per-unit; per-SKU CI roll-up is implicit.

## Where customs declares — leaf vs. assembly

The customs declaration happens at ONE SKU level — leaves OR the
assembly, not both (or duty + tariff would double-count).

**Roman gummies pattern (per-leaf customs):**
- Two-SKU shared shipment: jars (69% CBM) + caps (31% CBM)
- Each declared separately at customs with its own HS code
- `duty_pct` / `tariff_pct` populated on each leaf
- Assembly's `duty_pct` / `tariff_pct` left NULL

**Fully-assembled finished-good pattern (per-assembly customs):**
- Single SKU declared at customs as one HS code
- `duty_pct` / `tariff_pct` populated on the assembly
- Leaves under that assembly leave their customs NULL

The UI surfaces `<CustomsRow>` on every SKU (leaf and assembly). PM
fills in whichever level matches the actual customs filing. Data
integrity is the PM's responsibility — v1 doesn't enforce
exclusive-or at the schema level.

## Customer-invisible rule

`duty_pct`, `tariff_pct`, and `sku_total_cbm` are NEVER customer-facing:
- Customer PDF (Slice 11): shows only "Freight: $X" per tier (with duty
  + tariff embedded silently) when `freight_treatment = pass_through`;
  invisible (folded into unit cost) when `bundled`.
- Internal Costing Sheet (Slice 8): MAY show duty/tariff/CBM
  decomposition for PM debugging.
- Anywhere these values render in UI, label clearly with
  "Internal — not shown to customer" badge or equivalent visual cue.

## Forward-compat notes (v1.5 / Slice 13.5)

- **Multi-SKU shared shipments.** Today every freight line has a single
  `quote_sku_id`. The Roman gummies pattern (jars + caps in one
  container) is modeled as TWO independent freight lines with separate
  `total_freight` values that the PM splits manually. A future Slice
  13.5 affordance would let PM declare a shared shipment once and
  auto-split by CBM share. Schema is forward-compatible — the rollup
  formula already sums `sku_total_cbm` across SKUs in the same line
  group. See `UX_BACKLOG.md` "Shared-shipment freight lines" and
  "Mixed-SKU pallet allocation guidance".
- **Multi-PO consolidated shipments.** Real DPS ocean containers
  combine 2+ POs (NM1020 + NM1021 in a single Nemah container). v1
  scopes freight per-quote; PMs do consolidated allocation in a
  separate workbook. Future: cross-quote freight lines or
  shipment-level reconciliation outside the quote. See
  `UX_BACKLOG.md`.
- **Bulk-set tariff/duty.** PM's common case: 35% China-origin tariff
  applies to all SKUs uniformly. Schema is per-SKU (correct for
  flexibility); a quote-level "Apply tariff X% to all SKUs" affordance
  is a Slice 13.5 polish item. See `UX_BACKLOG.md`.
