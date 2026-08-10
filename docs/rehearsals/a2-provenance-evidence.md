# A-2 · provenance — evidence

**Settles:** [A-2](../gate-1b-canonical-node-tree.md) §15, including the
`NodeCandidate` model gap folded into its scope on 2026-08-09.
**Run:** 2026-08-10 · Phase 3 Package 2.

A-2 asked for three things: **a written query per governed input type**, **proven
against production**, **with the cost measured** — and, since the 2026-08-09
scope extension, **a place to put the answer**.

---

## 1 · One capability, three read sites

The trace, CellAction's override attribution and applied-lift provenance are
three questions with one answer. They resolve against **one map**:

```
node key ──► classifyNodeKey ──► {inputType, auditId} ──► audit row ──► NodeOrigin
                    │                                          │
              PROVENANCE_INPUTS                         one DISTINCT ON query
```

- `src/lib/pricing-provenance.ts` — classification, resolution, projection. Pure.
- `src/app/actions/pricing-provenance.ts` — the one query, and the identity bridge.
- `src/components/pricing-surface/pricing-provenance-context.tsx` — mounted once.

Three implementations of "who set this" would be three chances to disagree about
it, which is the failure two surfaces labelled "packaging" already produced by
answering one question with two formulas.

## 2 · The queries, proven against production

`scripts/rehearsal/a2-provenance-coverage.ts` runs the real loader and the real
resolver over a real quote's real graph.

**Production quote `2f29af72`** — 203 terminals walked:

| input type | terminals | sourced | thin | actor |
|---|---|---|---|---|
| `packaging_line_cost` | 9 | **9** | 0 | Ed Shin |
| `production_service_fee` | 39 | **26** | 13 | Ed Shin |
| `worksheet_freight_amount` | 18 | **9** | 9 | Ed Shin |
| `firm_margin_policy` | 1 | **1** | 0 | Ed Shin |
| `freight_markup` | 18 | 0 | 18 | *no audit rows* |
| `quote_target_margin` | 1 | 0 | 1 | *no audit rows* |

**Production quote `f88c22e3`** — 142 terminals: `production_service_fee` 26/26
sourced, `packaging_line_cost` 2/6, `firm_margin_policy` 1/1.

**Validation quote `a5672a11`** — SQL-seeded, so almost nothing carries an audit
row. The exception is the one act performed through the UI:
`applied_lift` **1/1 sourced, "Validation PM"** — Package 1's audit evidence,
read back through this capability.

## 3 · The cost, measured

| | validation | production |
|---|---|---|
| loader | **9ms** | **326–357ms** |
| entity ids | 117 | 28–41 |
| audit rows returned | 3 | 7–16 |

**This is why the loader is a separate action rather than part of
`getCostingBundle`.** A-2's own note says the provenance queries are the likely
cost and should be measured first; 326ms is real money on a path every Pricing
and Costs render already pays. The overlay fetches after first paint, and the
surface renders unattributed until it lands. Attribution arriving a moment late
is not a defect; a slower page is.

The query is a single `DISTINCT ON (entity_type, entity_id)` against
`audit_log_entity_idx`, bounded to ids derived from the quote — not a scan, and
not thirteen round trips against one index.

## 4 · Findings (F5) — governed inputs with no record

These are the finding A-2 asked for, not defects in the lookup:

| input type | why nothing resolves |
|---|---|
| `freight_markup` | `quote_freight_markup_updated` exists as an action; no rows on the quotes measured |
| `quote_target_margin` | `quote_target_margin_updated` exists; no rows on the quotes measured |
| `freight_component_cost` | legacy leg model; superseded by the worksheet on every quote measured |
| `customs_rate` | legacy leg model, same |
| `client_target` · `packaging_line_markup` · `production_policy` | no rows on the quotes measured |

The loader reports these itself, **by action rather than by entity type**. That
correction mattered: three input types share `entity_type = 'quote'`, so an
entity-type test reports all three as recorded the moment any one of them is —
the opposite of the finding.

## 5 · Unclassified terminals — all aggregates

411 terminals walked on the validation quote; 264 unclassified, and after the
classifier corrections **every one is a `quote/{tier}/…` aggregate**:
cost-stack contributors, per-unit rows, revenue and cost totals.

Nobody authors a total, so nothing is looked up for one and nothing appears
where an answer would be misleading.

The breakdown is by key SHAPE rather than a count, deliberately. A bare count
cannot distinguish "an aggregate nobody authored" from "a governed input the
classifier does not know about", and those are opposite findings. Reading the
shapes is what surfaced three real gaps, all now closed:

- `{sku}/{tier}/raw/cost/total` — bulk raw is the same per-(assembly, tier) row
  as the service fees, under a different section name
- `{sku}/{tier}/frt/shipment/…` — the classifier only knew the legacy `leg`
  shape; the worksheet model is the authoritative one
- **known-input-but-unlocatable was being reported as unknown-key** — a missing
  bridge entry now classifies and resolves `thin`, which is the true statement

## 6 · The model gap, closed

`NodeCandidate` was `{ label, value, chosen, unavailableReason }`. A resolution
ends a chain legitimately, but the value it resolves TO was still set by
somebody — the firm's target margin is a person's decision, entered in Admin —
and a rung had nowhere to hold that. R10's `Resolution` renders
`node.chosen.origin`; ours had no such field.

Two fields close it, and the second is what makes it safe:

```ts
provenanceKey?: string;   // WHICH AUTHORITY set this rung, in the key grammar
origin?: NodeOrigin;      // filled by the overlay, never by the engine
```

Without the address the resolver would have to match on `label`, and the day
someone improved the wording of "Firm default" the firm's target margin would
silently stop being attributable.

`quote-wide/target-margin` now has two addressable authorities —
`/quote-override` and `/firm-default` — and **every rung** is attributed, not
only the winner: a losing rung is what makes the winner legible.

The standing assertion in `pricing-trace-projection.test.ts` said "when the gap
closes this test fails, and whoever closes it updates the note." It did, and it
is updated — including the part that still holds, that the **engine** must
leave `origin` empty because it cannot read the audit trail.

## 7 · Operator checklist

Walked in the isolated validation environment, R3 fixture, quote `a5672a11`.

| # | Check | Evidence | |
|---|---|---|---|
| 1 | An applied lift is attributed in CellAction | **"Applied by Validation PM on Aug 9, 2026."** | ✓ |
| 2 | A terminal with no record says so | trace on BTL-100: **"not yet attributed · END OF CHAIN — NO RECORDED AUTHOR FOR THIS INPUT"** | ✓ |
| 3 | No placeholder actor is ever rendered | asserted permanently in `pricing-trace-projection.test.ts` | ✓ |
| 4 | Attribution survives an optimistic edit | the map is keyed by node key and merged at read time; it is not part of what gets rebuilt | ✓ |
| 5 | The overlay reaches a superseded chain | unit-asserted — an override demotes the computed chain and both are attributed | ✓ |
| 6 | Production attribution names real people | "Ed Shin" across four input types on two production quotes | ✓ |

### What the walk found

**The classifier never forwarded an applied lift.** Package 1 made a lift
persist; nothing carried that into `Cell.lift_applied_pct`, so it was null on
every cell and CellAction's `lift_applied` branch was unreachable — the panel
said *"needs no correction"* on a cell that plainly carried one. The price was
right, because the engine applies the lift; only the description was wrong.

Fixed by **reading the node**, not by adding a scalar. Gate 1B §0: every
commercial value a surface displays is a node in the graph, read — never
recomputed. A new field on `SkuPerTierRollup` would be a second place the same
fact lives, and S-7 digests that shape. One walk of the graph builds the map for
every cell; a `resolveNode` per cell would be a full traversal per cell.

Confirmed after the fix: the grid renders **LIFTED 5.3%** and the panel offers
**"Remove lift on Bottle · MOQ · 1,000 units"** with its attribution.

## 8 · Known exclusions

- **No production WALK.** Attribution against production was measured by script,
  not clicked through. The rendering path is the same one the validation walk
  exercised.
- **Rejected lifts are not attributed.** A refused lift is `flagged-out` with a
  reason, not an authored input; the reason is the answer.
- **The Costs surface does not mount the overlay.** Its trace consumes the same
  graph and would need only the provider; not in this package's scope.
- **`freight_breaks_updated` attributes freight, duty and tariff to one act.**
  That is true rather than a simplification — one edit of a destination's breaks
  sets all three — but a future split of those editors would need three specs.
