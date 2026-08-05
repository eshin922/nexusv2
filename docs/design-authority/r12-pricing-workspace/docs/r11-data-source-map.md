# Round 11 — the composed Pricing page · Data-source map

Covers the page around the trace. **The trace itself is unchanged — see
`docs/r10-data-source-map.md`, which remains authoritative for every node in the chain.**

**Legend:** `EXISTING` = in schema / engine · **`NEW`** = must be created · `DERIVED` =
computed at render · `PROTO` = prototype-only, strip in production.
Column names are canonical from `schema.ts` / `src/lib/costing.ts`; unconfirmed names are
marked *(name TBC)* rather than coined.

Prototype: `app/r11/data.js` (`window.NXR11`) — projections over `window.NXR10`'s computed
nodes. **It recomputes nothing.**

---

## Global price adjustment

| UI element | Source | Field / note |
|---|---|---|
| Current global % | EXISTING | `global_price_adj_pct` |
| Who set it / when | **NEW** *(name TBC)* | same provenance requirement as every `origin` node — see R10 map |
| New % input | UI | — |
| **Preview per tier** | DERIVED | recompute at the proposed global; compare per SKU per tier |
| "moves / unchanged" | DERIVED | `|after − before| > 0` |
| **Hold reason · tier** | EXISTING | `tier_price_adj_pct` is non-null → the global is **replaced, not stacked**, so the lift does not reach this tier |
| **Hold reason · override** | EXISTING | `sell_price_override` is non-null → the whole computed chain is replaced, including the adjustment |
| Hold actor / date | EXISTING | tier adjustment: who set it. Override: `sell_price_override` actor + timestamp (already persisted and audited) |

> Both hold reasons are already computed by the `resolution` node in the R10 chain. **No new
> data is required for this panel** — it reads what the chain already knows and states it at
> the moment of acting.

## Per-tier compliance

| UI element | Source | Field / note |
|---|---|---|
| Blended margin | DERIVED | `Σ((sell − cost) × units) ÷ Σ(sell × units)` across SKUs at that tier |
| Worst margin + which SKU | DERIVED | `min(margin)` over SKUs at that tier |
| Status | DERIVED | vs `target_margin_pct` / `floor_margin_pct` — **classifies only, never alters price** |

## Cost stack — trace level 1, transposed

| UI element | Source | Field / note |
|---|---|---|
| Component rows | DERIVED **from R10's nodes** | `sectionsOf(result).sections` — the level-1 operands of `sell_before_adjustment`: packaging · production · bulk raw · freight · duty · tariff |
| Blended value per cell | DERIVED | **`blend` node** — `Σ(value × units) ÷ Σ units`. Linear, so rows still sum to sell-before-adjustment |
| Sell before adjustment | DERIVED | Σ blended sections |
| Price adjustment row | EXISTING | `tier_price_adj_pct ?? global_price_adj_pct`; shown as the delta it contributes |
| **PM overrides row** | EXISTING | `Σ(sell − computed_sell)` where `sell_price_override` is set. **Required for the column to reconcile.** |
| Quoted sell | DERIVED | blended `required_sell_per_unit` |
| Unit cost | DERIVED | blended total cost |
| Margin | DERIVED | as above |
| Reconciliation footer | DERIVED | asserts `sections + adjustment + overrides = quoted sell` for every tier |

**Blended vs per-SKU:** the stack is blended at quote level, with per-SKU stacks inside the
breakdown. A per-SKU top-level stack would require a SKU selector, which is switching under
another name. **Flagged for confirmation** — if the production stack is per-SKU today, this
is a deliberate change.

## Per-SKU breakdown

| UI element | Source | Field / note |
|---|---|---|
| Row per SKU | EXISTING | commercial attachments on the quote |
| Price per tier | EXISTING | `required_sell_per_unit` |
| Status chip | DERIVED | margin class vs target / floor |
| `PM-set` marker | EXISTING | `sell_price_override` non-null |
| Expanded section rows | DERIVED **from R10's nodes** | that SKU's own level-1 section nodes — not a re-derivation |

## Reference

| UI element | Source | Field / note |
|---|---|---|
| Client benchmark | EXISTING | `client_target_price_per_unit` |
| Headroom | DERIVED | `benchmark − quoted sell` |
| "most headroom" | DERIVED | max headroom across tiers |

> `client_target_price_per_unit` **classifies competitiveness and may propose an adjustment
> requiring a separate PM action.** It never changes a price, so it is not a node in the
> chain and appears only here.

## Trace entry (entry-at-node)

| UI element | Source | Field / note |
|---|---|---|
| Target node | DERIVED | `findPath(root, key)` over the R10 node tree |
| Breadcrumb | DERIVED | the ancestor chain, collapsed; each entry re-roots the trace |
| Everything below | — | **unchanged R10** — see `docs/r10-data-source-map.md` |

## Carried forward from R10, unchanged

- **No rounding in the engine.** 4dp at the NetSuite boundary only; the trace shows unrounded
  values so its arithmetic reconciles. Grid/stack show 2–4dp for scanning.
- **`origin` provenance is the pre-build question.** Actor / timestamp / document per input
  type. Without it chains cannot terminate in a human act.
- **Bulk Raw is provisional** — two unconnected representations; the chain uses the
  pricing-active one and says so. With Business Validation.
- **Customer View is excluded entirely** from this pattern. Build-time assertion on the
  customer subtree, not a runtime prop.
