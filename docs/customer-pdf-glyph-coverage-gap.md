# Customer PDF — glyph coverage gap in the vendored fonts

**Banked 2026-08-21. Not repaired. Deliberately excluded from #323 and #324
per Edward's directive.**

## The finding

Neither vendored font family contains **U+2605 BLACK STAR**. Every `★` in the
customer PDF is silently dropped at render — no tofu box, no error, no build
failure. The mark simply is not there.

A second gap surfaced from the same census: **Newsreader has no U+2192 (→)**,
which `tkInclTick` inherits via `tkIncl`'s `fontFamily: serif`. The tick marks
on Summary mode's "What this turnkey price includes" list are dropped too.

## Evidence — cmap census, with a positive control

Read directly from the `cmap` table of each TTF in `public/fonts/`. The control
column exists so the instrument can demonstrably report both outcomes; a census
that can only ever answer "absent" proves nothing.

| font | A (control) | U+2605 ★ | U+2192 → | U+00D7 × | U+2014 — | U+2022 • |
|---|---|---|---|---|---|---|
| JetBrainsMono-Regular | Y | **N** | Y | Y | Y | Y |
| JetBrainsMono-Italic | Y | **N** | Y | Y | Y | Y |
| JetBrainsMono-Medium | Y | **N** | Y | Y | Y | Y |
| JetBrainsMono-SemiBold | Y | **N** | Y | Y | Y | Y |
| Newsreader-Regular | Y | **N** | **N** | Y | Y | Y |
| Newsreader-Italic | Y | **N** | **N** | Y | Y | Y |

Corroborated visually in the Preview Quote surface at three independent ★ sites
— pricing-foot sentence, pricing-table tier header, Summary tier card — all
missing the mark.

## Affected sites

| file | style | glyph | family | status |
|---|---|---|---|---|
| `customer-pdf-pricing-foot.tsx:59` | (inherited) | ★ | serif | dropped |
| `customer-pdf-pricing-table.tsx:87` | `thRecStar` | ★ | serif | dropped |
| `customer-pdf-turnkey-summary.tsx:146` | `hTierStar` | ★ | **mono** | dropped |
| `customer-pdf-turnkey-summary.tsx:201` | `tkTierStar` | ★ | **mono** | dropped |
| `customer-pdf-turnkey-summary.tsx:74,81,91` | `tkInclTick` | → | serif | dropped |
| `customer-pdf-turnkey-summary.tsx:99,107` | `tkInclOutTick` | × | serif | **renders** |

★ is dead in both families, so switching family does not fix it. → is a
Newsreader-only gap and *is* fixable by family alone.

## Why nothing caught it

`verify:font-register-coverage` (ledger #77/#80) checks that every
`fontFamily × fontWeight × fontStyle` combination a StyleSheet requests has a
matching `Font.register` call. It says nothing about whether the registered
face contains the **codepoints** the components emit. Registration coverage and
glyph coverage are different properties, and only the first is gated.

Same shape as ledger #80: a platform with a silent fallback path hides the gap
until someone reads the rendered output. #80 whispered by substituting a wrong
weight; this one whispers by rendering nothing at all.

## Consequence

The ★ is the legend for the recommended-tier column marker. The pricing-foot
sentence reads "Tier 3 is our recommended first-PO tier" where it should read
"★ Tier 3 …", and the column it points at carries no marker either — so the
recommendation still reads correctly as prose, but the visual cross-reference
CD designed is absent from every customer PDF the firm has sent.

No commercial value is affected. This is presentation only.

## Fix options (not taken)

1. **`<Svg><Path>` star** — the port plan already anticipated exactly this:
   *"`★` glyph: inline Newsreader native (per port plan); fall back to
   `<Svg><Path>` if smoke surfaces a tofu box"*
   (`customer-pdf-turnkey-summary.tsx:11`). The prediction was right and the
   symptom was subtler than a tofu box.
2. **Vendor a symbol face** carrying U+2605 and register it as a third family.
   Heavier; adds a font file and a family to the register.
3. **→ only:** add `fontFamily: PDF_FONT_FAMILY.mono` to `tkInclTick`. One
   line, and JetBrains Mono already has the glyph.

Options 1 and 3 are independent and can land separately.

## Prevention candidate

Extend the font verifier, or add a sibling, that extracts string literals from
the `src/components/pdf/` tree, and fails the build on any codepoint above
U+00FF absent from the family that style resolves to. Same grep-shape
discipline as the existing verifier, one property along.

Deferred with the fix — logging it here so the next slice that touches the
customer PDF sees both the defect and the guard that would have caught it.
