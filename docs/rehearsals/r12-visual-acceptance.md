# R12 · visual acceptance

**Fixture:** `r12Visual` — permanent, in `tests/harness/fixtures/world.ts`.
**Run:** 2026-08-10, isolated validation environment, desktop width.

One quote carrying every presentation state at once, because **the states
interact**: a client-target marker sits beside a `needs N%` chip on one cell and
beside a `LIFTED` badge on another, and the question a sweep asks is whether
they read together. A fixture exercising them one at a time cannot answer it.

Permanent rather than walk-scoped: the density and spacing it was accepted at
are what a future change gets compared against.

## What it carries

| state | how |
|---|---|
| 6 SKUs × 4 tiers | production shape |
| below-floor cells | SKU 0 at 0.2 markup — breaches on every tier |
| applied lift | SKU 1 · T1, persisted in `quote_leaf_lifts`, with its audit row |
| direct-price override | SKU 2 · T2, persisted at $12.50 |
| client targets | SKUs 0 and 3 only — **4 of 6 rows carry none** |
| quote-wide adjustment | 2%, already in effect |
| provenance | audit rows for all three, so attribution renders SOURCED |
| worksheet freight | ocean + air + domestic |

Targets were chosen one below and one above the computed price, so **both
directions of the marker render on one screen**.

## Verified

| | |
|---|---|
| APPLIED bar | **3 pricing adjustments in effect** — lift, override, adjustment |
| client-target chips | on Bottle (`client target $12.00`) and Carton (`$4.50`); the other four rows carry **no chip and no markers** |
| headroom markers | **8 rendered, 0 empty** · 1 over, 7 under — both channels |
| colour channel | markers sit in their own muted channel; no cell is coloured by client target, and the verdict names it as context rather than a breach |
| verdict line | `TARGET 35% · FLOOR 25% · 1 OVER CLIENT TARGET · OVERRIDE APPLIED ON ONE TIER` |
| lift badge | `LIFTED 6.0%` on Cap · MOQ |
| override badge | `PM-SET` on Sprayer · T2 |
| SKU sub-labels | `BTL-100 … PMP-100` on all six rows |
| composition tiles | rendered in a **blocked** state — 6 SKUs · T2 · $186,797 · 52.2% |
| tier read | blended-margin footer row across all four tiers |
| correct-the-tier | strip present, one button per tier with outstanding cells |

§13's own verification was *"two SKUs carry a target, one does not, eight markers
render, zero empty ones."* This fixture reproduces that shape at production
scale and the count matches exactly.

## Fixture-harness corrections this exposed

Adding a fifth fixture invalidated three freight counts at once — instructively,
because the rates that had held were **fitted to a leg mix three of four
fixtures happened to share**:

- shipments now derive from the SPEC FLAGS (`1 + air + domestic`), and
  destinations and breaks derive from the shipments;
- membership and customs stay measured literals, with the reason recorded in
  place: both follow a combination of SKU count and leg mix that no single rate
  covers across five fixtures, and a formula fitting all five would be a curve
  through five points.

The reset's operator list was a **hardcoded literal that did not include the new
fixture**, so its project was never deleted and the next reseed died deleting
shared leaves it still referenced. Now derived from one exported constant — a
list maintained in three files is a list that will be maintained in two.

## Not covered

- **Sticky / scroll behaviour** — not swept.
- **Measured row-height and type-scale comparison** against the prototype.
  Composition, canvas and every state above were verified visually side by side;
  a numeric pass over spacing was not run.
