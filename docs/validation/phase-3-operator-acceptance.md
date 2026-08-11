# Pricing Phase 3 · operator acceptance review

**Edward operating. 2026-08-10.** Technical closure of Phase 3 and P3-017 remains
intact; this review does not reopen either. Findings are recorded here as they
are observed and are **not repaired** unless Edward dispositions them.

A finding reopens completed engineering only if the observed behaviour violates
an accepted contract or creates a material V1 operator/business failure.
Everything else is a recommendation or post-V1.

**Environment.** `http://127.0.0.1:3100` — isolated validation instance on the
release branch. Production is **not** the review surface: `b6de377` (P3-016),
`b4ebbd5` (Cost Stack restoration) and `3d5564e` are all release-branch only, so
production still serves the R6 stack and the write-at-click path.

**Quote.** Acme Beauty 6 SKU launch · `a5672a11-aae8-4e8d-8b47-40acc20685c1` —
1 assembly, 6 leaves, 4 tiers (1k / 10k / 25k / 50k), firm target 35% / floor
25%. One pre-existing direct price of `$12.5000` on Sprayer × 10,000, left by a
test run and deliberately not cleared.

---

## V1 blocker

### B-1 · A staged bulk lift gives no feedback where the operator is looking

**Observed (step 1, reported early):** *"none of the 'Lift all 1 to floor'
buttons work."*

**They work.** Measured on the deployed branch, `r3Volume`:

| | |
|---|---|
| buttons found | 4, all enabled, all functional |
| click result | stages correctly — chip reads *"Lift Bottle · MOQ · 1,000 units by 5.3%"* |
| chip position | `y = −851` — **1196px above the button**, off-screen |
| both visible at once | **never**; viewport is 720px |
| at the point of action | unchanged: still 4 buttons, still *"Lift all 1 to floor"* |
| console / page errors | none |

**Not a contract violation.** Staging behaves exactly as P3-016 specified, and
the compliance grid is *correct* to stay still: the classifier describes
COMMITTED state, so a staged lift must not move the grid. Both halves are right
on their own terms.

**It is a material V1 operator failure.** The only evidence the action landed is
a chip 1196px above the fold. From the operator's seat a working control is
indistinguishable from a dead one — the product owner, who commissioned the
feature, read it as broken.

**The consequence is one this codebase has already paid for.** The reflex when a
button appears dead is to press it again. That reflex produced P3-016 in
production: `null → 0.1884 → 0.4123`, two writes 727ms apart, compounding.
Staging is idempotent so repeat presses are harmless *here* — but the surface is
still teaching the operator that habit, and AM-005 records the same quote being
double-pressed again on 2026-08-10 at 20:57.

**Not repaired.** The fix is a design decision, not a correction — feedback at
the point of action, scroll-to-staging-bar, a per-tier staged marker on the grid
row, or some combination. Each says something different about where the
operator's attention belongs. **Disposition owed from Edward.**

**Scope note:** this is the bulk control in the compliance grid
(`compliance-grid.tsx:407`). Whether the per-cell *"Lift {label} to floor"*
(`cell-action.tsx:400`) and the recommendation CTAs share the shape is
**unmeasured** — not yet walked, and not assumed.

## Recommendation

### R-1 · Cost Stack trace placement — **DISPOSITIONED: inline. Shipped.**

**Observed (step 9, reported early):** pressing a Cost Stack cell opens the trace
at the bottom of the page rather than in line.

**Contract position: NOT a violation.** The Design Authority renders the stack
trace *below* the stack, not inline — `pricing-page.jsx:978` places
`<StackTrace>` as a sibling after `<CostStack>`, and the panel's own scope copy
says *"…that is a row **in the stack above**."* The inline behaviour was the R6
table's, where tiers were rows and there was a row to pin beneath; the transpose
to the accepted R11/R12 shape removed that. The canonical keeps inline traces for
the **per-SKU** breakdown only (`SkuTrace`, rendered inside the SKU block).

**Two things make the correct placement read wrongly, and the first is a
regression introduced by the restoration:**

1. **A gap that the Authority does not specify.** Canonical `.r11-tracewrap`
   carries `border-top: 1px solid var(--accent)` and butts flush against the
   element above, so the panel reads as that box expanding. The restoration
   added an outer `.psr-stack-tracewrap { margin-top: 10px }`
   (`r12-pricing-workspace-overrides.css`), which breaks the join. Nothing in the
   Authority asks for it. **Author error, not a design decision.**

2. **The scope note is not rendered.** Canonical `StackTrace` passes a
   `scopeNote` naming what the chain explains and what the quoted price carries
   beyond it — *"This chain explains sell before adjustment ($X). The quoted
   blended price ($Y) also carries N% price adjustment and one surgical lift —
   those are rows in the stack above."* Production's `renderStackTrace`
   (`pricing-surface-shell.tsx`) passes no scope note, and `PricingTrace` has no
   parameter for one. **Pre-existing; predates the restoration.** It is the
   sentence that ties a below-the-stack panel back to the pressed cell, so its
   absence compounds (1).

Also unimplemented from canonical `StackTrace`: the **synthetic `blended-root`**
that roots the chain at `Sell before adjustment · blended` with the five section
blends as its operands, and the `meta` line (`{units} units across {n} SKUs ·
margin on quoted {pct}`).

### Disposition — Edward, 2026-08-10: **make it inline.** Shipped.

The trace now opens as the element immediately after the row whose cell was
pressed, keeping the canonical `.r11-tracewrap` register (accent top-rule, flush
against what it expands). The `.psr-stack-tracewrap` gap is deleted.

**This is an accepted Nexus extension (Pattern 39), not a fidelity gap**, and it
is recorded as one in `detail-zone.tsx` and in the overrides stylesheet so a
later audit finds the reason rather than re-raising the divergence. The
prototype already uses an inline trace for the per-SKU breakdown (`SkuTrace`),
so the vocabulary is canonical even where this placement is not.

Which row owns the open trace is resolved by **matching the traced node key
against the keys each row rendered** — not by parsing `quote/{tier}/{name}`,
which would be identity derivation in the layout layer and would break silently
the first time the grammar gained a segment.

Pinned by `tests/e2e/costing/cost-stack-inline-trace.spec.ts`, which asserts
**adjacency** — that the panel is the next DOM sibling of its row — rather than
mere visibility. The previous placement would have satisfied any test that only
checked the panel existed.

**Still open, and NOT part of this disposition:** item (2), the missing scope
note, plus the synthetic root and meta line. Recorded as R-2.

### R-2 · The stack trace is thinner than the Authority's

Independent of placement. Canonical `StackTrace` (`pricing-page.jsx:996`)
carries three things production does not:

- a **scope note** — *"This chain explains sell before adjustment ($X). The
  quoted blended price ($Y) also carries N% price adjustment and one surgical
  lift — those are rows in the stack above."* `renderStackTrace` passes none,
  and `PricingTrace` has no parameter for one.
- a synthetic **`blended-root`** rooting the chain at *Sell before adjustment ·
  blended*, with the five section blends as its operands.
- a **meta** line — `{units} units across {n} SKUs · margin on quoted {pct}`.

Pre-existing; predates the Cost Stack restoration. Less acute now that placement
is inline, since adjacency supplies by position most of what the scope note
supplied by words — but the sentence also names what the quoted price carries
*beyond* the traced chain, which adjacency cannot say.

## Post-V1

*(none recorded yet)*
