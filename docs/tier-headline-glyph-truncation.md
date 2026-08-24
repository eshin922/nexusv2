# Tier headline truncation — the producer is sound, the renderer is not

> **CLOSED 2026-08-24. The array shape was the Vercel trigger. Cluster-1 is
> closed.** Certified against the deployed artifact on `6e61058`, quote
> `52bd0077`. All four headlines now draw **10 glyphs** where three drew 6:
>
> ```
> $14,906.00    $31,405.12    $75,140.00    $69,800.00
> ```
>
> Decoded from the PDF's own ToUnicode CMaps, not read off the screen. They are
> character-for-character the values §2.3 below RECONSTRUCTED from the font
> subset before any fix existed — which independently confirms the diagnosis,
> because the prediction was made and then met.
>
> Quantities and per-unit values reconcile unchanged: 14,906.00/1,000 = 14.906
> → `$14.91`; 31,405.12/5,000 = 6.281024 → `$6.28`; 75,140.00/10,000 = 7.514 →
> `$7.51`; 69,800.00/20,000 = 3.49 → `$3.49`. Every printed pair agrees.
>
> **The experiment discriminated, as designed.** Computed font weight stayed
> 500; only the react-pdf style SHAPE changed, from a bare style object to a
> two-element array. The three broken headlines rendered whole. So the shape is
> the trigger and `pdf-fonts.ts` is exonerated — the shared 400/500/600
> variable-font registration was NOT the cause and needs no change.
>
> **The standing rule this leaves.** In react-pdf on Vercel, a `<Text>` whose
> `style` is a bare object can draw short where the identical computed style
> passed as a single-element-or-longer ARRAY draws whole. Both known instances
> of this bug — 2026-07-27 and 2026-08-24 — were style-shape sensitive and
> neither reproduced locally. Prefer an array for any `<Text>` rendering money.

**Operator finding, 2026-08-24.** The customer PDF's turnkey tier cards read:

| tier | qty | headline as drawn | per-unit as drawn |
|---|---|---|---|
| Tier 1 | 1k | `906.00` | `$14.91` |
| Tier 2 | 5k | `405.12` | `$6.28` |
| Tier 3 | 10k | `$75,140.00` | `$7.51` |
| Tier 4 | 20k | `800.00` | `$3.49` |

Three headlines cannot be the product of their own per-unit and quantity, and
the disposition classified it as a material commercial math defect and a
merge/release blocker.

**It is not a math defect.** No commercial figure is wrong. Three of the four
headlines are DRAWN INCOMPLETELY: the leading four glyphs are missing.

---

## 1 · The classification, against the five candidates

The disposition listed five candidate causes — wrong field mapped into the
headline, per-unit/extended-unit confusion, one-time fee substituted for total,
tier-index misalignment, or a second commercial construction.

It is **none of them.** It is a sixth: a react-pdf font-subsetting/draw defect,
downstream of every commercial layer.

## 2 · The evidence, strongest first

### 2.1 The formatter cannot produce the drawn string

`money` is `extendedAmount` → `formatMoney`, whose only return is

```ts
return (rounded < 0 ? "-$" : "$") + digits;
```

**Every** return value begins with `$` or `-$`. There is no input — no field
mapping, no index misalignment, no second construction — that makes
`formatMoney` emit `906.00`. A producer defect can change the DIGITS; it cannot
remove the currency symbol. The drawn string therefore is not what the producer
returned.

### 2.2 The PDF's own font subset contains the missing characters

Inflating the artifact's streams and reading the ToUnicode CMaps, one embedded
subset has exactly this charset:

```
$14,906.35278          (14 glyphs)
```

That is the union of the characters in the four full headline strings:

```
$14,906.00   $31,405.12   $75,140.00   $69,800.00
   union  =  { $ , . 0 1 2 3 4 5 6 7 8 9 }
```

The subset was built from the COMPLETE strings, `$` and thousands separator
included. The producer emitted them; the subsetter was told about them; the
draw step then emitted six glyphs out of ten.

This is also what reconstructs the true values: only one string ends in
`906.00`, uses only subset characters, and lies inside the band its own printed
per-unit implies.

### 2.3 Every tier reconciles once reconstructed

`$14.91` is a 2dp rounding of the true per-unit, so the check is a band, not an
equality:

| qty | producer | drawn | glyphs | per-unit band | in band |
|---|---|---|---|---|---|
| 1,000 | `$14,906.00` | `906.00` | 10 → 6 | [14,905 · 14,915) | yes |
| 5,000 | `$31,405.12` | `405.12` | 10 → 6 | [31,375 · 31,425) | yes |
| 10,000 | `$75,140.00` | `$75,140.00` | 10 → 10 | [75,050 · 75,150) | yes |
| 20,000 | `$69,800.00` | `800.00` | 10 → 6 | [69,700 · 69,900) | yes |

Every loss is exactly four leading glyphs — `$14,` `$31,` `$69,`.

`tierGrand`'s stated invariant `perUnit × quantity === total` holds throughout;
the T-1 repair that established it (2026-08-11) is intact.

### 2.4 Tier 3 is spared because it takes the other branch

Tier 3 is the recommended tier. `customer-pdf-turnkey-summary.tsx` renders the
recommended headline through `style={[styles.tkTotal, styles.tkTotalRec]}`
(serif **600**) and every other headline through `style={styles.tkTotal}`
(serif **500**). Different variant, different subset, different outcome.

That is not a coincidence — it is the same discriminator as the known bug.

## 3 · This is Slice 11 Cluster-1, not fully fixed

The component carries a comment describing the identical failure:

> On Vercel serverless (not local Node), the non-rec path with the `{}` empty-
> object second style triggered react-pdf font-subsetting to include ONLY the
> LAST glyph of the `money()` output — rendering "$1,733" as bare "3".

The 2026-07-27 repair split the branch to remove the `{}` fallback. That
changed the severity — all-but-one glyph became all-but-six — and did not
remove the cause. The bug is Vercel-only, which is why local rendering and the
unit suite have never seen it.

## 4 · What must NOT be done

- **Do not patch the displayed numbers.** They are not computed wrongly.
- **Do not rebuild the total in the renderer.** `tierGrand` is correct and is
  the single producer for both the headline and the per-unit.
- **Do not treat the frozen commercial construction as suspect.** Nothing in
  recovery, projection or the costing layer contributed to this.

## 5 · Where the repair belongs

The render/font layer, and it needs its own certification because the failure
does not reproduce locally:

1. Establish why the serif-500 subset draws six glyphs while serif-600 draws
   ten — the two differ only in weight, so the variant is the variable.
2. Whatever the repair, certify it **against a deployed artifact**, by
   inflating the PDF and counting drawn glyphs per headline. A local render
   cannot express this failure, so a local pass is not evidence (the same trap
   that produced the "12 pre-existing failures" report).
3. Add a gate that compares, per money-formatted string, the glyph count drawn
   against the character count of the producer's output. `verify:font-register-
   coverage` checks that a variant is REGISTERED; it cannot see a variant that
   is registered and then drawn short.

## 6 · Method note

The first reading of this came from a screenshot, and a screenshot cannot
distinguish "computed 906" from "computed $14,906.00 and drew six glyphs" —
opposite defects with opposite repairs. Two instruments were tried and rejected
before one that could express the difference was found:

- the resolver-based producer trace could not load outside Next (Clerk
  transitive import) and was deleted rather than shipped broken;
- a naive stream inflate reported "0 streams with text", which was the
  inflater failing, not the artifact lacking text — 18 streams were found and
  0 inflated, and reporting the second number is what exposed it.

The artifact's own font subset was the instrument that could answer.
