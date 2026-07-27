# Matrix render fixes — Cluster 2 shipped, Cluster 1 needs repro

**To:** CA + Edward
**From:** CC
**Re:** Slice 11 matrix smoke render-bug clusters
**Status:** Cluster 2 partially fixed (2 of 3 items). Cluster 1 diagnosis
requires a screenshot / repro; theorized shape below.

---

## §0 · TL;DR

| # | Bug | Root cause | Status |
|---|---|---|---|
| C2-A | Unpriced tier renders `$0.00` instead of "quote on request" / "from $X" | Adapter treats null-cost → sell price = 0 (not null) | **FIXED** |
| C2-B | "Includes fees ($0.00)" note fires when there are no fees | Note gates on `hasCharges` (fees OR freight); should gate on real fees > 0 | **FIXED** |
| C2-C | $225 one-time fees never appear as line items | Upstream side ticket #5.1 (production persistence); fees never reached DB | **NOT A RENDER BUG** |
| C1 | `turnkey_only × tier_table` non-recommended tier shows bare "3" instead of $1,083 | Unclear — code inspection ruled out helpers/index/font paths; need visual repro | **DEFERRED** |

CA memo's F1.5 answer for C2-A/B: **case (b)** — the render tree consumed
data shapes the DOM preview didn't exercise. Specifically, the DOM preview
uses the pricing-classifier context which has the `isMissing` check; the
react-pdf adapter (`customer-view-resolver`) did not.

---

## §1 · Cluster 2A — null cost → null price signal

**Symptom:** unpriced Tier 2 in the CHARGES quote renders as `$0.00` in
both `itemized` (should be "from $X") and `turnkey_only` (should be "quote
on request" / "total on request") modes.

**Root cause:** DB inspection of `smoke-matrix-charges-0727`
(`93a5d4bb-…`) shows:
```
Tier 1 packaging: unit_cost=$0.20
Tier 2 packaging: unit_cost=null   ← no cost data entered
```

The math layer's `computeQuoteCosting` returns `requiredSellPerUnit=0`
for a leaf with no cost data (numeric 0, not null). The adapter
(`customer-view-resolver.ts:191-195`) passes this through:
```ts
const tierPrices = tiers.map((t) => {
  const pt = rollup.perTier.find((p) => p.tierId === t.id);
  return pt ? pt.requiredSellPerUnit : null;   // ← 0 passes through as 0
});
```

Downstream `tierGrand()` treats 0 as "priced" (`p == null` check only
catches null, not 0). So `hasUnpriced = false` and `total = 0 × qty +
serviceFees`. Renders as $0.00.

**Fix:** apply the same `isMissing` check the pricing-classifier context
already uses (per `src/components/pricing-surface/pricing-classifier-context.tsx:281-282`):
```ts
if (pt.requiredSellPerUnit === 0 && pt.contributionCostPerUnit === 0) {
  return null;   // treat as unpriced
}
```

Now tierPrices[1] = null → tierGrand sees `p == null` → `hasUnpriced =
true` → render tree emits the proper placeholder per shape (`from
$X` / `quote on request` / `total on request`).

**Ledger analog:** this is Pattern 50 (compliance-basis intersection state)
in a different form — two consumers of the same math output (pricing
classifier vs customer-view resolver) used different `isMissing`
definitions. Same fix shape as the P0 A2 asymmetry gate.

---

## §2 · Cluster 2B — "includes fees" note fires when there are no fees

**Symptom:** the turnkey "includes" note in GrandTotalRow +
TurnkeySummary Included block renders `"One-time project & SKU fees of
$0.00, folded into the total"` — claiming fees are folded when there
are none.

**Root cause:** the note gates on `foldFees`, which the document
passes as `hasCharges`. `hasCharges = view.serviceFees.length > 0 ||
view.freightLines.length > 0` (per adapter). If freight is
pass-through (freightLines populated) but there are no service fees,
the OR fires → foldFees=true → note fires → `serviceFeesTotal([])` =
`0` → renders "$0.00".

**Fix:** tighten the gate to `foldFees && serviceFeesTotal(serviceFees) > 0`.
Two files, identical rule:
- `src/components/pdf/customer-pdf-grand-total-row.tsx` (itemized modes)
- `src/components/pdf/customer-pdf-turnkey-summary.tsx` (turnkey Included block)

The freight-related note (`freightAtCost` "Plus" block) is unaffected
— it correctly gates on freight, not fees.

---

## §3 · Cluster 2C — the $225 fees themselves are the upstream persistence bug

**Symptom:** CHARGES quote has "Additional charges" header render with
no line items, and the turnkey "includes" note says "$0.00".

**Root cause (upstream, not a render bug):** DB inspection shows the
production_inputs row for the CHARGES quote has ALL fee columns null:
```
Tier 2 (only production row): setup=null tool=null rd=null other=null
```

The fees CB entered ($150 setup + $75 tooling) never persisted to the
DB. This is **side ticket #5.1 (PROD cost-line persistence)** manifesting
on service-fee columns.

The render tree is correct — there are no fees in the data, so no line
items render. The "$0.00" in the includes note is the C2-B bug (now
fixed); once C2-B ships, the note stops firing when there are no fees.

**Verifying the fees persistence bug** would require CB re-entering
the fees, saving, reloading, and confirming they persist. Then the
render tree can be re-verified with real fee data.

---

## §4 · Cluster 1 — the "bare 3" mystery (deferred)

**Symptom:** `turnkey_only × tier_table` non-recommended tier renders
"3" where `$1,083` should appear. Recommended tier renders correctly.

**Code inspection ruled out:**

1. **`money()` output shape** — verified in a standalone script:
   - `money(3)` = `"$3.00"` (with dp)
   - `money(1083)` = `"$1,083"` (no dp, comma)
   - `money("3")` = `"$3"` (no dp — the string path COULD produce
     "bare 3" reading, but tierPrices is typed `number | null` and the
     resolver produces numbers)
   - No path produces literal "3" without any dollar sign or decimal
2. **`tierGrand()` math** — same helper used by GrandTotalRow (which
   passes in `tier_table × itemized`), so the math is fine
3. **Adapter (`customer-view-to-cpdf.ts`)** — direct pass-through of
   `tierPrices` array; no re-indexing
4. **Font resolution** — tkTotal uses Newsreader 500 non-italic; the
   Step 7 italic-500 add doesn't overlap this weight/style slot
5. **Recommended card negative margins** (`marginHorizontal: -0.75`)
   — 0.75pt is too small to visually clip "$1,083" (6 chars × ~10pt
   at Newsreader 18pt ≈ 60pt total, well within a ~230pt-wide half-card)
6. **String slicing / substring** — none anywhere in the render tree
   that would leave a bare "3"

**Remaining theories (need visual repro to confirm/eliminate):**

- (a) React-pdf tabular-figures (`fontFeatureSettings: '"tnum"'`)
  rendering artifact on Newsreader 500 for specific glyph sequences
- (b) Layout collision where the negative-margin recommended card
  visually overlaps Tier 2's text
- (c) Data-side bug I haven't identified — the reported "3" could
  correspond to some other value ($3.00 total, tier index 3
  somewhere, etc.)
- (d) A pre-Step-7-fix cached render being served (browser cache of
  the iframe URL — CB could hard-reload)

**Ask for CB:**
1. Take a screenshot of the "3" rendering in the tier card
2. Right-click → View Page Source on the iframe URL; grab the raw
   text of what's rendered in that Text element
3. Confirm the deploy timestamp — the fix from Step 7 (Newsreader
   italic 500 register) needs to be live for consistent behavior
4. Reproduce with a different 2-tier configuration (e.g. Tier 1
   qty=2000, Tier 2 qty=8000) — does the value change?

If (a)/(b): CD-fidelity concern, may need a react-pdf-side workaround
(explicit `overflow: 'visible'` on tkCard? explicit `wrap={false}`
on the Text?). If (c): may be a real translator bug we haven't found.
If (d): non-issue after re-smoke.

---

## §5 · What ships in this PR

1. **`src/lib/customer-view-resolver.ts`** — Cluster 2A fix (null-cost →
   null-price signal, mirrors pricing-classifier isMissing check)
2. **`src/components/pdf/customer-pdf-grand-total-row.tsx`** — Cluster
   2B fix (fees note only when serviceFees > 0)
3. **`src/components/pdf/customer-pdf-turnkey-summary.tsx`** — Cluster
   2B fix (same rule in the turnkey Included block)

Verified: tsc clean; all 5 prebuild verifiers green.

---

## §6 · Re-smoke plan

CB re-smokes on the fresh preview:

1. **CHARGES quote** — re-enter setup $150 + tooling $75, save, reload:
   - If fees now persist → verify they render as line items
   - If fees still don't persist → confirms side ticket #5.1 blocks
     the full CHARGES matrix smoke; escalate #5.1 fix ahead of matrix
2. **CHARGES quote (unpriced Tier 2)** — verify:
   - Itemized: Tier 2 line reads "from $X" (not $0.00)
   - Turnkey_only: Tier 2 total reads "quote on request" / "total on
     request" (not $0.00)
3. **PURE quote (Cluster 1)** — with fresh cache, screenshot the "3"
   and paste raw text of the tier card

---

## §7 · Bank on close

Per CA §6, banking as §0.5 catches when resolved:

- **C2-A (Pattern 50 analog):** two adapters/consumers of the math
  layer diverged on `isMissing` definition; second consumer
  (customer-view-resolver) treats numeric 0 as valid while first
  (pricing-classifier-context) treats it as null. Any future consumer
  MUST use the same `isMissing` check.
- **C2-B (over-permissive OR gate):** UI gate composed of OR-of-flags
  fires when ANY flag is true, but the copy the gate opens is only
  correct when a SPECIFIC flag is true. Right pattern: the gate for
  each conditional copy chunk should match the shape of the data that
  chunk describes.
- **F1.5 lesson (banked):** DOM preview verification does NOT prove
  the react-pdf render path renders correctly. The two are distinct
  consumers with distinct adapters. Every future PDF-touching slice
  needs verification on the actual react-pdf output, not the DOM
  preview.

Cluster 1 pattern (whatever it turns out to be) banks on repro.

---

## §8 · Sequencing

1. Ship this fix (Cluster 2A + 2B)
2. CB re-smokes as §6
3. Cluster 1 diagnosis via screenshot / repro
4. Side ticket #5.1 (fees persistence) — separate track; blocking
   CHARGES quote full matrix but not gating the fix ship
5. #124 (linkage hotfix) + #122 (close-out) still queued for merge
   post-matrix-clean
