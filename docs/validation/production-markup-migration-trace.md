# Production markup — migration trace and repricing impact

**Traced and measured 2026-08-17 against `7fa1739`.** Authority:
[BV-013](../business-validation/BV-013-production-markup-authority.md).

**Reports only. Nothing here authorizes a migration or a reprice.**

---

## 1. Every markup path today

Four resolution sites, two constants, one firm-level fallback.

| # | Site | Category | Fallback |
|---|---|---|---|
| 1 | `costing.ts:1768` — production value | `PRODUCTION_MARKUP_CATEGORY = "Manufacturing"` | `"Other"` (implicit default arg) |
| 2 | `costing.ts:1871` — production trace node | same | same |
| 3 | `costing.ts:1772` — raw value | `RAW_MARKUP_CATEGORY = "Raw ingredients"` | **`"Other"` explicitly** |
| 4 | `costing.ts:1902` — raw trace node | same | same |
| — | `costing.ts:1618` — packaging | per-line `category` | unchanged by BV-013 |

`resolveMarkup` walks a ladder and takes the first available rung: the
category, then `fallbackCategory`, then `FALLBACK_MARKUP = 0.3`.

**Live resolution, measured:** `markup_defaults` holds seven rows —
`Freight 0.20`, `Manufacturing 0.30`, `Other 0.30`, `Primary 0.45`,
`Secondary 0.50`, `Soft Goods 0.35`, `Tooling 0.20`. There is **no
`Raw ingredients` row**, so bulk raw resolves at rung two: `Other`, 30%.

### 1.a Competing fallbacks that must not survive the migration

Three, and each would silently keep pricing if the constants alone were
re-pointed:

1. **`Raw ingredients → Other`.** BV-013 §1.a removes this as pricing
   authority. Deleting the constant is not enough — if `Production` were ever
   absent, rung two would resolve raw at `Other` again and nothing would say
   so.
2. **The implicit `"Other"` default arg** on `lookupMarkup`. Site 1 does not
   pass a fallback, so it inherits `"Other"` silently. A `Production` category
   that failed to exist would price production at 30% and look correct.
3. **`FALLBACK_MARKUP = 0.3`.** The last rung, firm-wide. It happens to equal
   today's Manufacturing and Other rates, which is precisely why a
   misconfiguration here would be invisible: the wrong path produces the right
   number today and a wrong one the moment any rate moves.

**The migration's real risk is not changing the rate. It is leaving a rung
below `Production` that still resolves to 30% and therefore never fails
loudly.**

### 1.b Stale assertions to correct

Five comments state that bulk raw has a markup authority *distinct* from
Manufacturing. Under BV-013 that becomes false:

`costing.ts:736`, `costing.ts:3454`, `cost-stack-header.tsx:63`,
`cost-stack-header.tsx:490`, `production-drilldown.tsx:527`.

The T-4 finding they support — that bulk raw is an independently governed
*quantity* with its own node and its own Cost Stack section — **remains true**.
Only the claim about a separate markup authority changes.

### 1.c Usage counting

`listMarkupDefaultReferenceCounts` groups `assembly_leaf_inputs.category` —
packaging lines only. Production resolves through a hardcoded constant and
carries no per-line category, so it contributes **zero** to the count. The
category reads as unused in Firm Settings while it prices every quote with
production economics. BV-013 §1.d requires this to change.

---

## 2. Repricing impact — measured, not estimated

Method: for every quote, read each `(sku, tier)`'s `productionCostPerUnit` and
`rawCostPerUnit` from `getCostingBundle`, and apply
`delta = cost × (0.40 − current_rate)`.

**The model was validated before it was used.** For every cost base, the
engine's marked-up total was checked against `cost × (1 + rate)`:
**98 exact, 0 mismatched.** The arithmetic below is derived from a model the
engine agreed with on every single instance, not from an assumption about how
markup composes.

| status | quotes affected | revenue before | revenue after | delta |
|---|---|---|---|---|
| **sent** | **3** | $4,727,139.45 | $4,859,379.45 | **+$132,240.00 (+2.80%)** |
| draft | 6 | $3,182,930.15 | $3,237,513.75 | +$54,583.60 (+1.71%) |

No `accepted` or `complete` quote carries production economics, so none appears
above. That is a property of today's data, not a guarantee — an accepted quote
with production would be affected identically.

**Sent quotes affected:** all three are `SAMPLE — Aurora Botanica · Hydra-Glow
Serum` (Alt 2, Alt 3, and `5K / 15K / 50K — China sources`).

### 2.a Why sent quotes move at all

Markup is resolved **at compute time from live `markup_defaults`**. It is not
snapshotted per quote. Pattern 52's draft-lock protects columns a quote owns;
it does not protect a firm-level policy value the engine reads on every
recompute.

So changing the firm default changes what a sent quote computes, today,
without anyone touching that quote.

**What this does and does not reach:**

- The **PDF the customer received** is a persisted file at `quotes.pdf_url`.
  That artifact does not change.
- Every **internal** view of a sent quote — Pricing, Costs, the compliance
  grid, margin verdicts, any recompute — would show numbers that differ from
  what was sent.
- Any **downstream read** of a sent quote's computed revenue would use the new
  figure.

That divergence between the sent artifact and the live recomputation is the
decision this trace exists to surface. It is not resolved by BV-013.

---

## 3. What a safe migration would have to establish

Recorded as the shape of the problem, not as a plan:

1. Whether existing quotes reprice at all, and if not, by what mechanism they
   are held — a per-quote snapshot of the rate, a status gate in resolution, or
   an accepted divergence.
2. That no rung below `Production` can silently resolve production or raw
   (§1.a) — a missing `Production` category must fail visibly, not price at
   30%.
3. That the five stale comments are corrected without weakening T-4 (§1.b).
4. That usage counting recognises Production consumption (§1.c).
5. A before/after invariance witness over the affected quotes, of the shape
   used for the authoring re-key — except that here the numbers are *expected*
   to move, so the witness proves they moved **only** where intended and by
   **exactly** the predicted amount.
