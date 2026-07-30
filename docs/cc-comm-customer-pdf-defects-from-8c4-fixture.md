# Customer PDF defects surfaced by 8c-4 CB smoke

**Filed against:** Slice 11 customer-PDF workstream (currently in final QA).
**NOT scoped to:** Slice 12 Step 8c-4 (umbrella tab wire-in).
**Surfaced during:** CB walk of PR #154 fixture DPS-1032 (SMOKE-CB-8C4-...).
**Filed by:** CC per CA directive 2026-07-29.

Screenshots available from Edward.

Diagnosis below is code-based (screenshots not seen by CC); cross-check
against the shots before implementing.

---

## P1 — Flat-price SKUs render `—` on tier 2+ in the pricing table

**Symptom (CA report):** on DPS-1032, product rows render Tier 2 unit
price as `—` while Tier 1 shows `$0.20`. Tier 2 line-total renders
correctly (`$100`). Turnkey summary also renders correctly
(`$300 ($0.20 /unit)`).

**Code path:**
`src/components/pdf/customer-pdf-pricing-table.tsx:139-151`.

```tsx
if (p == null) {
  unitNode = <Text style={styles.priceReq}>quote on request</Text>;
} else if (isFlat && !isSingle && ti !== 0) {
  unitNode = <Text style={[styles.price, styles.priceDash]}>—</Text>;
} else {
  unitNode = <Text style={...}>{unit(p)}</Text>;
}
```

**Diagnosis:** the em-dash is INTENTIONAL per Pattern 30 CD canon
(`pdf-render.jsx:81-145`) — when `sku.shape === "flat"` (all tier
prices identical), the design DELIBERATELY shows the unit price only
in tier 1 and dashes it in tier 2+, so PMs visually recognize "the
price doesn't vary." A `Flat unit across all volume tiers` caption
renders in the product cell (line 128-131) to explain the dash.

**Why CB read this as a bug:** the 8c-4 fixture happened to set the
same $0.20 per leaf across both tiers (unit_cost $0.10 × 100% markup),
which triggered the flat-shape path. The "Flat unit across all volume
tiers" caption is the explanatory affordance that keeps the em-dash
from reading as missing data — CA should verify the caption RENDERS
and is legible on the screenshot.

**CA's own guidance:** "Note the fixture is $0.20 flat across tiers,
so this may be a same-value or zero-delta case rather than a Tier 2
case specifically. Test with genuinely differing per-tier prices
before concluding."

**Confirmation needed:**
1. Does the "Flat unit across all volume tiers" caption render in
   the product cell on Edward's screenshot? If yes → design working
   as intended; the em-dash is the CD-canonical treatment.
2. Re-run the fixture with genuinely differing tier prices (different
   markups per tier, or per-cell overrides) → confirm the em-dash
   goes away and real values render.

**If the flat-caption IS rendering and legible:**
Not a defect. Consider a fixture change: DPS-1032 fixture uses flat
pricing because it's the simplest fixture; a customer-PDF smoke
fixture should exercise differing tier prices to make the tier
column meaningful. Bank a "customer-PDF walk fixture uses varying
tier prices" ask for the next customer-PDF QA pass.

**If the flat-caption is NOT rendering:**
Real defect. The `.prodFlat` style at line 128 either isn't binding
(check `styles.prodFlat` in `customer-pdf-styles.ts`) OR
`sku.shape` is misclassified upstream (the adapter/resolver decides
flat vs varied based on tier_prices). Investigate the shape assignment
first.

**If Edward wants flat-shape to always show the value (not dash),
regardless of design canon:**
One-line change at line 143 — drop the `isFlat && !isSingle && ti !== 0`
branch, always fall through to the else. But this diverges from CD
canon; Pattern 30 dispensation needed from CA + Edward before the
implementation lands.

---

## P2 — `money()` formatter drops decimals at ≥$100

**Symptom (CA report):** Tier 1 line-totals render `$20.00`, `$60.00`.
Tier 2 line-totals render `$100`, `$300`. Same document, different
tiers, inconsistent decimals.

**Code path:**
`src/components/pdf/customer-pdf-helpers.ts:17-24`.

```ts
export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  const dp = Math.abs(n) >= 100 ? 0 : 2;
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}
```

**Diagnosis:** verbatim from CD's `pdf-render.jsx:15-19`. Deliberate
CD choice — values ≥$100 render at 0 decimal places, values <$100 at
2 decimal places. Rationale (inferred, not confirmed with CD): keeps
large numbers scannable (`$150,000` vs `$150,000.00`) while small
numbers keep cent precision.

**CA's position:** "This is customer-facing, which is stricter.
Should be `$100.00` and `$300.00`."

**Resolution requires disposition:**
The formatter is Pattern 30 canonical. Changing it violates canon.
Two ways forward:

- **(a) CD canon change.** CA + Edward raise with CD; CD updates
  `pdf-render.jsx:15-19` to always use 2dp; CC re-copies the helper
  verbatim (one-line diff). Preserves Pattern 30 discipline.
- **(b) Nexus extension per Pattern 39.** CC updates the helper here
  with a comment: "Nexus extension — CD canon uses magnitude-dependent
  precision; DPS customer-facing docs require uniform 2dp per CA
  disposition YYYY-MM-DD." Documented delta from canon; CD refresh
  won't overwrite it.

**Working assumption if fix authorized:**
One-line change — drop the ternary, always 2dp:
```ts
return "$" + n.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
```

Related consideration: `unit()` at line 27-29 ALREADY uses 2dp
unconditionally. Making `money()` uniform is internal consistency
between the two helpers — probably strengthens the case for the
change regardless of canon.

---

## P3 — Header overflow: PREPARED FOR name collides with PREPARED BY

**Symptom (CA report):** customer name runs into "The DPS" on the
right; no truncation, no wrap, no max-width.

**Code path:**
`src/components/pdf/customer-pdf-parties.tsx:33-47` + styles
`src/components/pdf/customer-pdf-styles.ts:177-198`.

```ts
parties: { flexDirection: "row", marginTop: 13.5 },
party:   { flex: 1, paddingRight: 18, flexDirection: "column" },
pname:   { fontSize: 12, fontWeight: 500, color: PP_INK, marginBottom: 1.5 },
```

**Diagnosis:** two columns, 50/50 split via `flex: 1`. `.pname` has
no `flexShrink`, no `maxWidth`, no explicit `overflow`/`wordBreak`.

React-pdf's `Text` breaks at whitespace + hyphens by default, so a
hyphenated string like `SMOKE-CB-8C4-DELETE-ME-2026-07-29T04-45-42`
SHOULD wrap at the hyphens. The 8c-4 fixture's exaggerated 42-char
name still ought to wrap into 3-4 lines rather than overflow — if
Edward's screenshot shows literal overflow into the neighbor column,
something is preventing the break.

**Candidate root causes (verify against screenshot):**
1. **`flexShrink` default.** React-pdf `flex: 1` shorthand may not
   set `flexShrink: 1` implicitly in all versions. If `.party` has
   `flexShrink: 0`, a long `.pname` forces the container wider than
   50%. Fix: add `flexShrink: 1` on `.party`.
2. **Container width overflow.** If `.parties` doesn't have a
   `width: "100%"` or a bounded parent, the row might grow past the
   page margin. Fix: add `maxWidth: "100%"` on `.parties` or the
   page container.
3. **Text-level `overflow` behavior.** React-pdf Text ignores CSS's
   `overflow: hidden` in some versions; the workaround is to give
   `.pname` an explicit `maxWidth` in points. Fix:
   `maxWidth: "50%"` on `.pname` (or the container width minus
   `paddingRight`).

**Reproducibility:** real DPS customers with long legal-entity
names ("Roman Health Ventures, Incorporated" — 34 chars, includes
commas + spaces so breakable; "Buildwithroot.co" — 16 chars, no
break points) could hit the same overflow if any of the above 3
constraints are missing. CA is right that this needs a wrap /
truncate rule regardless of my fixture's name length.

**Working assumption if fix authorized:**
Belt-and-suspenders — add all three constraints:

```ts
party: {
  flex: 1,
  flexShrink: 1,      // ← explicit, don't rely on flex shorthand
  paddingRight: 18,
  maxWidth: "50%",    // ← hard cap
  flexDirection: "column",
},
pname: {
  fontSize: 12, fontWeight: 500, color: PP_INK, marginBottom: 1.5,
  // If the name is one un-broken token, force character-level break.
  // react-pdf 3.x+ respects "break-all"; older versions may need
  // <Text hyphenationCallback={...}> instead.
  wordBreak: "break-all",
},
```

Cross-check via customer-PDF QA smoke with:
- Short name ("Nemah") — should look identical to today
- Medium hyphenated name ("Roman-Health-Ventures") — should wrap at hyphens
- Long comma-separated name ("Roman Health Ventures, Incorporated") — should wrap at spaces
- 8c-4-style pathological all-hyphen name — should wrap OR break-all

---

## Priority + scope

- **P1** — blocker if flat-caption isn't rendering; otherwise a
  fixture-cosmetic issue. Verify against screenshot before scoping.
- **P2** — disposition-blocked. Not shippable to real customers as-is;
  canon-vs-nexus-extension question needs CA + Edward.
- **P3** — real defect regardless of fixture name length; needs a
  wrap/truncate rule. Non-blocking on the current CB walk but
  blocking on any customer PDF that lands with a longer-than-average
  legal name.

## What this doesn't touch

None of these defects touch 8c-4 code (umbrella tab, sub-tab 5,
markComplete wiring). All three are in the customer-PDF renderer
under `src/components/pdf/`.

None of these change the sample fixture (DPS-1032). If CB is
mid-walk on the umbrella tab, they can continue; the customer PDF
preview is a separate surface CB is auditing as part of the same
walk pass but the umbrella send flow is unaffected.
