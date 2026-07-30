# Production cost contract

Existing columns and values remain backward-compatible; no historical value is
multiplied or divided by migration.

| UI label / entry unit | Column / property | Precision | Rule | COGS | Customer / allocation |
|---|---|---|---|---|---|
| Filling / blending tier total | `filling_blending_cost` / `fillingBlendingCost` | 12,2 | total / quoted units | always | never direct; unaffected |
| CM assembly tier total | `cm_assembly_total` / `cmAssemblyTotal` | 12,2 | total / quoted units | always | never direct; unaffected |
| Bulk raw tier total | `bulk_raw_cost` / `bulkRawCost` | 12,2 | total / units unless customer supplies raws | always when applicable | never direct; unaffected |
| Setup fee total | `setup_fee_total` / `setupFeeTotal` | 12,2 | allocated: total / units; separate: zero in unit math | when allocated | once when separate |
| Tooling / artwork total | `tooling_artwork_total` / `toolingArtworkTotal` | 12,2 | same | when allocated | once when separate |
| R&D fee total | `rd_total` / `rdTotal` | 12,2 | same | when allocated | once when separate |
| Other service fee total | `other_service_total` / `otherServiceTotal` | 12,2 | same | when allocated | once when separate |
| Actual units produced | `actual_units_produced` / `actualUnitsProduced` | integer | operational reference only; never a quote-pricing denominator | n/a | never |

Future canonical aliases are `fillingBlendingCostTotal`,
`contractManufacturingCostTotal`, and `bulkRawCostTotal`; schema renames are
deferred in favor of additive compatibility.

Money is nullable, nonnegative, finite, at most two decimals, and within
`numeric(12,2)`. Null and zero contribute zero, but null means not entered.
Positive quoted units are required for division. `customerShipsRaws` means
customer-supplied bulk raw and gates bulk raw only. The allocation toggle
controls only the four one-time fees.

Successful changes emit a field-level production-input audit. Rejection writes
nothing, emits no success audit, and triggers no revalidation/provider/artifact.
Sent snapshots and PDFs retain send-time values. Current draft pricing also
uses quoted tier quantity, never actual output. The remaining decision is
whether a future, separately presented operational forecast should use actual
output; no reconciliation workflow is encoded here.
