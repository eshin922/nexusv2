# BV-010 — Blended Margin Definition

## Status

**Dispositioned by Edward, 2026-08-10.** Recorded here because the decision is
a business definition of a derived commercial quantity, not an implementation
choice.

BV-004 lists "gross profit and gross margin" among the quantities Nexus
deterministically derives, but never defines the blended form. Three different
derivations shipped under that name as a result. This document supplies the
definition BV-004 assumed.

## The decision

> The Cost Stack Margin is the canonical blended margin for that tier:
> **(Σ revenue − Σ cost) / Σ revenue.**
>
> The engine `QuotePerTierRollup.blendedMarginPct` and graph
> `quote/{tier}/margin` already agree exactly, so they represent the same
> governed quantity.
>
> — Edward, 2026-08-10

**One quantity may be called "blended margin" on the Pricing surface.** Any
surface presenting a blended margin for a tier presents this one.

## Why the question arose

The Phase 3 mount ([PR #244](https://github.com/eshin922/nexusv2/pull/244))
reported that the Cost Stack's Margin column rendered `min_margin_pct` — the
worst SKU's margin in the tier — under the bare label "Margin", in a row whose
every other cell is a blended-across-SKUs per-unit figure. Investigating which
quantity the row was *intended* to carry surfaced that "blended margin" named
three different numbers in the codebase.

### The Design Authority already answered worst-versus-blended, twice

R11 designer notes §12.1, which is where the compliance surfaces were
reorganised:

> Blended margin per tier is a genuine independent fact: it is what the quote
> earns at that tier, and it is the number the Sales Order tab's tier decision
> consumes. It survives.
>
> Worst margin + exemplar SKU was never an independent fact. It was *a pointer
> at a cell* — a summary standing in for the thing it was pointing at.

And in the canonical prototype, `app/r11/data.js:88` computes both as separate
fields on the same tier object — `margin` from weighted means, `worstMargin` as
`Math.min(...)` beside it. The Cost Stack renders `margin`.

This also satisfies Pattern 57 in the Design Authority's own vocabulary: a
financial stack carries independently governed commercial quantities, and
§12.1 says in those terms which of the two is one.

## The three quantities, measured

`scripts/gate-1b/probe-cost-stack-margin.ts`, read-only, 2026-08-10, over 24
quotes / 52 tiers / 37 tiers with readable revenue.

| | Derivation | Verdict |
|---|---|---|
| **A** | `QuotePerTierRollup.blendedMarginPct` — revenue-weighted `(ΣR − ΣC)/ΣR` over top-level SKUs | **Canonical** |
| **B** | graph `quote/{tier}/margin` — units-weighted means of sell and cost over leaves | **Canonical** — identical to A |
| **C** | `TierRollup.blended_margin_pct` — unweighted arithmetic mean of per-cell margin **percentages** | **Not governed** |

- **A vs B — 0 disagreements of 37.** Same governed quantity, two expressions.
- **A vs C — 18 of 37 disagree, up to 2.29pp.**
- **worst-SKU vs blended — 18 of 52 tiers differ, up to 2.1pp.**

C is a mean of ratios rather than a ratio of sums: it weights a $0.20 label the
same as a $4.90 bottle. It is what the Per-tier compliance table currently
renders under the heading "BLENDED" — so the divergence was not only in the
Cost Stack; it was on the labelled column one section above it.

Worked example, quote `27581262` at the 5K tier against a 35% target:

| | value | verdict at 35% target |
|---|---|---|
| governed blended (A/B) | 35.00% | at target |
| mean of cell margins (C) | 35.11% | at target |
| worst cell | 33.3% | below target |

## Consequences

1. The Cost Stack Margin column reads `quote/{tier}/margin`.
2. Its colour and verdict come from the **blended** tier status. A blended
   figure tinted by a worst-cell verdict is the same defect one layer down.
3. The compliance table's BLENDED column reads the same governed quantity.
4. **The unweighted mean-of-cell-margins derivation is removed** if it has no
   other governed consumer. Per Edward's disposition: *"Do not relabel the
   existing mean-of-cell margins merely to preserve it. If that quantity has a
   future business purpose, it needs its own explicit contract."*
5. Margin trace entry and `marginPointsDelta` mount only after the above.

**Worst-cell margin is not deleted, and is not demoted.** It remains the
compliance signal, on the surfaces that own compliance — the per-cell grid and
the Per-tier table's "WORST MARGIN" column, both of which label it. §12.1
retired it as a *summary* precisely because the per-cell grid now carries it
directly. What is corrected is its appearance, unlabelled, in a row of blended
quantities.

## Coverage required

An adversarial fixture in which governed blended margin, mean-of-cell margin,
and worst-cell margin **fall on different sides of the target threshold**. The
page must present one answer to "blended margin". The three-way straddle is the
case that distinguishes a correct implementation from one that merely agrees
with the old behaviour on today's data — 18 of 37 tiers already disagree, but
none of the current fixtures straddle a threshold.

## Related

- BV-004 — Business Decision Matrix (lists gross margin as system-derived;
  does not define the blended form)
- BV-005 — Below-Floor Margin Approval (consumes margin verdicts)
- OD-019 — How a margin is represented in the canonical graph (created
  `quote/{tier}/margin`, the node this definition adopts)
- Pattern 57 — a financial stack contains only independently governed
  commercial quantities
- Pattern 50 — compliance-basis intersection state (two subsystems, different
  bases, agreeing by coincidence)
