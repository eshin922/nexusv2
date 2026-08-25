# Gate A — HTML ↔ PDF semantic parity

**Deployed `e53ba4b`.** Both renderers driven from the same resolved
`CustomerView`; PDF content extracted by inflating its streams and decoding the
drawn runs through their ToUnicode CMaps.

---

## Result

| # | item | evidence | result |
|---|---|---|---|
| 1 | tier quantities | `1k/5k/10k/20k` identical, all quotes | **PASS** |
| 2 | unit prices | 16 values identical and in order (`4781e4bb`, `52bd0077`) | **PASS** |
| 3 | tier totals | `$23,247.60·$52,520.60·$97,222.20·$109,327.60` · `$14,906.00·$31,405.12·$75,140.00·$69,800.00` · `$16,077.79·$36,933.91` | **PASS** |
| 4 | fee lines + amounts | 5 lines · 2 lines · 0 lines — identical each time | **PASS** |
| 5 | Separate → present exactly once | tooling `$700.00`, artwork `$2,800.00`, tooling+artwork `$1,400.00` | **PASS** |
| 6 | In-unit-price → absent from fees | Project setup, Other service both absent | **PASS** |
| 7 | labels | fee labels + section headings identical | **PASS** |
| 8 | unpriced / on request | `3761d2ad` — `quote on request` ×3 in both; `$0.00` ×6 in both | **PASS** |
| 9 | payment terms | `Net 30` both | **PASS** |
| 10 | lead time | `weeks` both | **PASS** |
| 11 | Incoterms | `FOB` both | **PASS** |
| 12 | customer note | `f88c22e3` — "Hi you're Ed", `NOTES` heading in PDF | **PASS** |
| 13 | Terms & Conditions | exact heading + body, all quotes | **PASS** |
| — | presentation state | recommended ×1; **no recommendation** on two quotes | **PASS** |
| — | zero comparable content = failure | 45/37, 26/22, 16/16, 9/9 values | **PASS** |

## Coverage set

| quote | exercises |
|---|---|
| `4781e4bb` | 5 fee lines, recommendation present, mixed placement, both Separate and In-unit-price |
| `52bd0077` | **no recommendation** (the `feeBasisTierIdx` fallback), 2 fee lines |
| `f88c22e3` | **customer note**, **no fee section at all**, no recommendation |
| `3761d2ad` | **unpriced cells**, **zero-quantity tiers**, computed `$0.00` alongside unpriced |

## Item 8, traced state → view → HTML → PDF

**Producing state:** draft `3761d2ad`, 2 leaves — one carrying no cost inputs at
any tier — and all tiers at quantity 0.

```
CustomerView   3 cells with a null unit price; 6 extended amounts genuinely 0
HTML           "quote on request" x3 ; $0.00 x6 ; no bare "on request"
PDF            "quote on request" x3 cells ; $0.00 x6
```

**Unpriced was not conflated with zero.** The zeros arise because the tiers
carry quantity zero, so the extended amounts really are zero, and both
documents print the same six in the same places. A zero that is computed is a
price; an unpriced cell is a request state. Pinned in
`customer-monetary-facts-preservation.test.ts` by asserting the two are
**distinguishable**, not merely each correct — a test that only checked
"unpriced gives null" would still pass if a computed zero also began giving
null.

---

## Findings, all closed

Four, every one a presentation decision or label left to a renderer.

| | finding | fix |
|---|---|---|
| 1 | fee section quoted a different tier column in each renderer | `feeBasisTierIdx` on the projection |
| 2 | tier total folded fees in one renderer and not the other — up to $7,700 apart | `foldFeesIntoTotal` on the projection |
| 3 | T&Cs body in both, heading in the PDF only | heading added to the live renderer |
| 4 | unpriced cell called `quote on request` vs `on request` | aligned to the PDF's wording |

None was reachable by review or by types: both renderers were internally
consistent every time, and only comparing their **output** exposed them. That
is the argument for building the second renderer before swapping rather than
after.

A separate defect was found and fixed en route — Terms & Conditions never
reached the customer at all, dropped by the PDF adapter. It surfaced the same
way: a second renderer read a field the first ignored.

---

## One difference OUTSIDE the enumerated thirteen

**The PDF carries an unpriced footnote the live renderer does not.**

```
customer-pdf-pricing-foot.tsx:64
  quote on request — pricing finalizes once the noted milestone clears.
```

Confirmed in the artifact: four runs render the phrase — three 16-glyph cells,
and one 69-glyph sentence. The live renderer has the three cells and no
footnote.

It is not in the thirteen items and it is not styling: it is customer-facing
content present in one document and absent from the other. Reported rather than
absorbed into Gate B, because deciding whether it is content or chrome is not
mine to make.

---

## Status

**Gate A: SEMANTIC PARITY VERIFIED — 13/13.** Accepted by Edward 2026-08-25.

The unpriced explanatory footnote is recorded as a **bounded content-fidelity
item**, not as a reason to reopen Gate A:

> `quote on request — pricing finalizes once the noted milestone clears.`

The live renderer lacks that sentence. It carries into the live-renderer
fidelity work and **parity on it is required before the iframe is replaced**.

Gate B has not started. The iframe is unchanged. No fidelity inventory, no
G4/Card 2.
