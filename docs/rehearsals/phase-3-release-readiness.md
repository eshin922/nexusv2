# Phase 3 · V1 release-readiness pass

**Run:** 2026-08-10, against the mounted R12 surface and the permanent
`r12Visual` validation fixture.
**Verdict:** **no release-blocking defect found.** Two presentation items
dispositioned as post-V1 polish.

---

## 1 · Mechanical gates

| gate | result |
|---|---|
| `verify:types` | clean |
| `test:unit` (governed command) | **706 / 706** |
| `prebuild` (9 verifiers) | PASS — 0 failures |
| `next build` | compiled |
| **S-7 preservation** | **`541a75a041dd1a2912d077b555fbab575750329930e3b743089ec493bae44fb2`** — 24 quotes, every commercial scalar identical |
| fixture world | 10 projects · 10 quotes · 24 tiers · 44 canonical attachments · 0 invalid identity mappings · 0 invalid external ids |

S-7 has not moved across the whole of Phase 3 — Packages 1, 2 and the four R12
packages. Every change was consumer-side, and the digest is the evidence rather
than the claim.

## 2 · Surfaces

Every route on the fixture quote returns 200, including the customer PDF:

| surface | |
|---|---|
| `/pricing` · `/costs` · `/setup` · `/quote` | 200 |
| `/api/quotes/{id}/customer-pdf` | 200 · 42,311 bytes |

## 3 · Operator journey, on `r12Visual`

Verified in the isolated validation environment at desktop width.

| | |
|---|---|
| Blocked state reads correctly | `4 tiers below floor`, `Tier 4 at 22.6%`, `2.4pp below the 25% floor · 7 cells affected` |
| Composition tiles in a blocked state | 6 SKUs · T2 · $186,797 · 52.2% |
| APPLIED bar counts persisted levers | **3 pricing adjustments in effect** — lift, direct price, quote-wide adjustment |
| Compliant cell opens to a direct-price offer | *"needs no correction. Its price can still be set directly if the negotiation calls for it."* |
| Panel anchors beneath its row | the pressed cell stays visible while it is acted on |
| Lift path | `LIFTED 6.0%` badge · attribution on the panel |
| Direct-price path | `PM-SET` badge on the overridden cell |
| Client target | chips on 2 of 6 rows, 8 markers, both directions, own channel |
| Provenance | *"currently 2% · set by Validation PM · Aug 10, 2026"* on the adjustment panel |
| Tier read | blended-margin footer row · `Correct the tier` strip |

Staging → apply → reset → reload was verified end-to-end during Package 1
(persistence checklist, 11/11) and R3 (8/8) against this same code path; it was
not re-walked here, and the earlier records stand as its evidence.

## 4 · Sticky / scroll — **no usability failure**

Carried into this pass rather than given its own package, and dispositioned by
impact as instructed.

Observed while scrolling a full-length page at desktop width:

- the **left navigation rail stays fixed** while the content column scrolls;
- the **CellAction panel opens inline beneath its row** and stays anchored to
  it — the cell being acted on remains visible, which is the property R11 gave
  it and the one that would break first;
- **nothing overlaps, clips or double-sticks.** The staging and APPLIED bars
  scroll with the page, as the prototype's do;
- the trace expands in place without displacing the row that opened it.

**The compliance grid's header row is not sticky.** Neither is the prototype's,
so this is not a divergence — but at 6 SKUs the header leaves the viewport
before the last row does, and at 10+ SKUs a PM reading a lower row loses the
tier labels. That is a real ergonomic cost and a real improvement to make; it is
**not a V1 blocker**, because the tier columns are also labelled in the cost
stack and the per-cell panel names its own tier.

→ **Post-V1 polish:** a sticky grid header, and only if operator use shows the
column-label loss actually bites.

## 5 · Numeric spacing — **cosmetic, deferred**

Composition, canvas, section order and every presentation state were verified
side by side against the registered prototype at desktop width. The page reads
as R12.

A **measured** pass — row heights, gaps, type scale in numbers rather than by
eye — was not run. Nothing observed suggested a difference an operator would
notice, and the canonical stylesheets are adopted byte-identical to the bundle
(+14 lines of Pattern 30 header, nothing else), so any remaining difference is
in composition spacing rather than in the type or colour system.

→ **Post-V1 polish**, per the disposition rule: cosmetic difference from the
prototype does not block release.

## 6 · What this pass did NOT cover

Named rather than implied:

- **NetSuite handoff** was not exercised. The validation environment runs an
  isolated NetSuite provider by construction, so a real push cannot be walked
  here; `markComplete`'s projection is covered by S-7's tier revenue and by the
  Slice 12 walk records.
- **Customer View content** was verified as *reachable and rendering* (200,
  42KB PDF), not proof-read. Its data-source discipline is Pattern 45's
  boundary guard, which runs in `prebuild`.
- **Multi-user concurrency** beyond the cost-base guard's own scenario.
- **Production performance.** All timings here are dev-server cold compiles and
  are not evidence about production.

## 7 · Verdict

**No release-blocking defect found.** Phase 3's Pricing workspace is
release-ready on this evidence: the gates are green, S-7 is unmoved, every
surface renders, and the operator journey reads correctly across all the states
the permanent fixture carries at once.

The two carried presentation items are both post-V1 polish.
