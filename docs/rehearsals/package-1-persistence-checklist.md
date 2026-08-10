# Package 1 · Persistence-dependent operator checklist

The Phase 3 §4 Operator Validation Checklist has items that could not be run
before an applied adjustment had anywhere to live. Those items are collected
here, walked, and recorded.

**Run:** 2026-08-10 · isolated validation environment · R3 fixture
(6 leaf SKUs × 4 tiers, 24 cells) · quote `a5672a11`.

Everything below was walked through the real UI and confirmed against the
database, not asserted from code.

---

## The walk

| # | Check | Evidence | |
|---|---|---|---|
| 1 | The APPLIED bar reads from what the quote CARRIES, not from what this session did | Fresh page load, no session history: **"1 pricing adjustment in effect on this quote"** — the seeded direct price | ✓ |
| 2 | Staging still writes nothing | Cell panel opened, lift staged, chip shown; `quote_leaf_lifts` empty, `assembly_leaf_overrides` unchanged | ✓ |
| 3 | Apply writes the staged set | `Apply 1 change` → one row: `lift_pct 0.0527` on `(quote_leaf, MOQ tier)` | ✓ |
| 4 | Apply writes audit evidence | Root `pricing_adjustments_applied` on the quote + derived `pricing_lift_applied` on `quote_leaf_lift`, linked by `caused_by_audit_id` | ✓ |
| 5 | **The adjustment survives navigation** | Pricing → Costs → Pricing. Bottle · MOQ: **21.0% / $15.14 → 25.0% / $15.93**, held | ✓ |
| 6 | The price reflects it, not just the bar | Blocked tiers **4 → 3**; next move narrows from "lift T1, T2, T3, T4" to "lift T2, T3, T4" | ✓ |
| 7 | The bar counts what is in effect after reload | "1 pricing adjustment in effect on this quote" on a fresh load, with no staged state | ✓ |
| 8 | Return to baseline removes every lever | Override, tier adjustment and quote-wide adjustment all cleared in one act | ✓ |
| 9 | Removal survives reload | `assembly_leaf_overrides` empty · all four `tier_price_adj_pct` NULL · `global_price_adj_pct` 0 | ✓ |
| 10 | Removal writes its own audit | Root **`pricing_adjustments_cleared`** — "Returned pricing to the computed baseline" — plus one derived row per lever | ✓ |
| 11 | The quote returns EXACTLY to its computed base | Every cell back to its pre-adjustment value; blocked tiers back to 4; blended back to 41.7% | ✓ |

## What the walk found

**A persisted adjustment the bar did not count.** `applySurgicalAdj` — a path
that predates this package — writes `quote_tiers.tier_price_adj_pct`
immediately. Applying the recommended surgical lift from the action zone put
`0.1334` on the MOQ tier, moved every price on it, and left the bar reading
"1 pricing adjustment in effect" when the quote carried two.

Return to baseline would also have left it standing, so the control would have
promised a return to the computed base and delivered a quote still carrying a
lever.

Both are inside this package's remit — *"the APPLIED bar accurately represents
persisted in-effect adjustments"* and *"removal / return-to-baseline survives
navigation and reload."* Fixed rather than deferred:

- the count includes per-tier adjustments, **subscribed from the store** rather
  than seeded, so it is right the moment the operator applies one rather than
  after the next navigation;
- Return to baseline clears them, with a `tier_price_adj_updated` audit row
  carrying `source: "pricing_apply"` so one column's history stays one
  timeline;
- an ordinary Apply passes them back unchanged, so it plans no change to them —
  without that, Apply would silently revert an adjustment made moments earlier.

Confirmed after the fix: reload showed **"2 pricing adjustments in effect on
this quote"**, and Return to baseline cleared both.

## Not covered here

- **Rollback behaviour** — that is [R1](R1-rollback-after-first-apply.md),
  run separately and settling OD-003.
- **Volume** — R3 already established staging legibility and timing at
  production shape; this walk is about persistence, on the same fixture.
- **Sent and accepted quotes** — lifts are draft-only authoring data. The write
  path refuses a non-draft quote and the staging bar disables its controls with
  a stated reason, but a full lifecycle walk belongs with the lifecycle guards,
  not here.
- **A many-lift quote.** One lift, applied and removed. The write path diffs
  per row and the 23 untouched cells show the isolation, but a large set was
  not walked.
