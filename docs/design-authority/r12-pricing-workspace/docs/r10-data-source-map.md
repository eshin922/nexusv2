# Round 10 — Pricing traceability · Data-source map

Covers the Pricing page and the trace tree. **Column names are canonical from `schema.ts` /
`src/lib/costing.ts`;** where a name is unconfirmed it is marked *(name TBC)* rather than
coined.

**Legend:** `EXISTING` = in schema / engine · **`NEW`** = must be created · `DERIVED` =
computed at render · `PROTO` = prototype-only, strip in production.

Prototype contract: `app/r10/data.js` (`window.NXR10`). It **computes** rather than stores —
there are no fixture totals, by design (see designer notes §3).

---

## The grid (default view)

| UI element | Source | Field / note |
|---|---|---|
| SKU rows | EXISTING | commercial attachments on the quote |
| Tier columns + quantities | EXISTING | quote tiers `{label, qty}` |
| Cell price | DERIVED | `required_sell_per_unit` = `sell_price_override ?? computed_sell_per_unit` |
| Margin % | DERIVED | `(sell − total_cost) ÷ sell` |
| Margin colour | DERIVED | vs `target_margin_pct` / `floor_margin_pct` — **classifies only, never alters price** |
| `set by PM` marker | EXISTING | `sell_price_override` is non-null |
| `why? ▸` affordance | PROTO/UI | hover-revealed; no data |

## The chain — node by node

Each row is one trace node. `op` is what the level displays as its operation.

| Node | Kind | Source | Operation |
|---|---|---|---|
| Quoted sell | `override` **or** `adjustment` | EXISTING | override → no operation; else `sell_before_adjustment × (1 + A)` |
| Price adjustment `A` | `resolution` | EXISTING | `tier_price_adj_pct ?? global_price_adj_pct` — **replaces, never stacks** |
| Sell before adjustment | `sum` | DERIVED | packaging + production + raw + Σ container + Σ duty + Σ tariff |
| Packaging | `sum` | DERIVED | Σ per-line sell |
| Packaging line | `markup` | EXISTING | `(unit_cost × qty_per_sellable_unit) × (1 + markup[p])` |
| Line markup | `resolution` | EXISTING | `line ?? category default ?? "Other" ?? 0.30` |
| Line unit cost | `origin` | EXISTING | supplier quote — **terminal** |
| Production | `markup` | EXISTING | `production_cost × (1 + Manufacturing_markup)` — **one aggregate markup; production has no per-line markup column** |
| Production cost | `sum` | DERIVED | `COGS/unit + (allocate ? allocated services/unit : 0)` |
| COGS per unit | `allocation` | EXISTING | `(filling + cm_assembly) ÷ Q` — inputs are **run totals**, not per-unit |
| Allocated services/unit | `allocation` | EXISTING | `one_time_service_total ÷ Q` — present only when allocation is ON |
| One-time services | `sum` | EXISTING | Σ per-tier operator entries — **entered per tier explicitly, never derived** |
| Bulk raw | `markup` or `flagged-out` | EXISTING ⚠ | `(customer_ships_raws ? 0 : bulk_raw_cost ÷ Q) × (1 + Raw_markup)` |
| Freight leg | `markup` | EXISTING | `per_unit_cost × (1 + Logistics_markup)` — per leg |
| Duty / Tariff | `markup` over `rate` | EXISTING | `(factory_cost_per_unit × pct) × (1 + duty_tariff_markup)` — **markup applies to the dollars, not the percentage** |
| Factory cost | `sum` | DERIVED | packaging + production + raw. **Freight is not in the duty base.** |
| Firm markup settings | `origin` | EXISTING | firm settings — actor + date — **terminal** |
| PM override | `override` | EXISTING | `sell_price_override` — persisted per commercial attachment and tier, PM-authored, audited. **Not derived from anything.** |

## Flags that change the chain's *shape*

| Flag | Source | Effect on the trace |
|---|---|---|
| `allocate_service_fees_to_cost` | EXISTING | ON → allocated-services operand present inside production cost. OFF → **the operand disappears from the chain entirely**; one-time fees bill as separate fixed charges and are not part of the per-unit price. There is no `separateServicesMarkupSum` path. |
| `customer_ships_raws` | EXISTING | ON → bulk raw contributes `$0.0000`; node renders as `flagged-out` with an explanation rather than a zero. |

## Terminal origins — the one genuinely new requirement

| Element | Source | Field / note |
|---|---|---|
| Actor | **NEW** *(name TBC)* | who entered this input |
| Timestamp | **NEW** *(name TBC)* | when |
| Document reference | **NEW** *(name TBC)* | supplier quote / run estimate / SOW / HTS code |
| Note | EXISTING (partial) | R6 carries free-text notes on some line types |

> **This is the pre-build question (designer notes §7.2).** The trace's stopping rule is
> *"you stop when you reach a person."* That requires an entry record per input. If some
> input types have no such record, **those chains cannot terminate correctly** — which is a
> finding about the data, not a layout problem to design around. Please confirm which
> existing record (audit log, line metadata, import provenance) supplies these per input
> type before this is scoped.

## Not sourced from here — deliberately

| Element | Why |
|---|---|
| `client_target_price_per_unit` | classifies competitiveness; may **propose** an adjustment requiring separate PM action. Does not change price, so it is not a node in the chain. |
| `target_margin_pct` / `floor_margin_pct` | classify the resulting margin. No automatic enforcement alters a quoted price. |
| `actual_units_produced` | does not reprice. Quoted tier quantity governs. |
| Rounding | none in the engine. 4dp occurs only at the NetSuite boundary — the trace therefore displays unrounded values so its arithmetic reconciles. |

**Every sell-side influence is the chain, the adjustment, or the override. Nothing silently
modifies a price** — which is what makes a complete trace possible at all.

## ⚠ Bulk Raw — provisional

Two unconnected representations exist:

- **Pricing-active:** `assembly_production_inputs.bulk_raw_cost` — scoped Product/ASY + tier.
- **R6.1 workspace:** `bulk_raw_section_meta` / categories / ingredients — quote-level, no
  SKU or Product reference, **never passed into `computeQuoteCosting`**.

The trace uses the pricing-active value and carries a visible warn note on that node. It does
**not** portray quote-level ingredient rows as the arithmetic source of a sell price. With
Business Validation; treat this node's placement as provisional.

## Excluded surface

**Customer View / the customer PDF are excluded from this pattern entirely.** The operation
*is* the markup and the operands *are* cost and supplier, so a universal "any number can
expand" is in direct structural tension with the PDF's boundary guard. Enforcement must be a
**build-time assertion on the customer subtree**, identical in mechanism to the existing
guard — not a runtime prop. If the trace component can be mounted in a customer surface with
internal operands reachable, that is a defect regardless of the props passed.
