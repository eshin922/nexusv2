import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const HTML = "src/components/quote/customer-view-live.tsx";
const PDF = "src/components/pdf/customer-pdf-grand-total-row.tsx";

/**
 * The preview and the artifact must state the same commercial thing.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The live renderer IS the customer document an operator reviews; the react-pdf
 * tree produces the file the customer actually receives. They disagreed: the
 * preview showed Unit-price subtotal and Separate charges above the turnkey
 * total, and the PDF showed only the total.
 *
 * So the thing that was approved and the thing that was sent were different
 * commercial statements — the worst shape for a divergence, because reviewing
 * more carefully cannot find it.
 *
 * Both now read the same two composed figures, gated on the same flag.
 */

test("both renderers show the same two components", async () => {
  const html = codeOnly(await read(HTML));
  const pdf = codeOnly(await read(PDF));
  for (const label of ["Unit-price subtotal", "One-time fees"]) {
    assert.ok(html.includes(label), `the live document must show "${label}"`);
    assert.ok(pdf.includes(label), `the PDF must show "${label}"`);
  }
});

test("both place the components ABOVE the turnkey total", async () => {
  const html = codeOnly(await read(HTML));
  assert.ok(
    html.indexOf("Unit-price subtotal") < html.indexOf('className="pp-grand"'),
    "live: components precede the total",
  );
  const pdf = codeOnly(await read(PDF));
  assert.ok(
    pdf.indexOf("Unit-price subtotal") < pdf.indexOf("styles.grand"),
    "pdf: components precede the total",
  );
});

test("both gate on the same flag, in the same sense", async () => {
  // `foldFees` on the PDF side and `hasCharges` on the live side are both
  // `view.foldFeesIntoTotal`. An inverted gate here would show the rows on
  // exactly the quotes that must not have them — and the first draft of this
  // did, because the flag reads like it means the opposite.
  const html = codeOnly(await read(HTML));
  const pdf = codeOnly(await read(PDF));
  assert.match(html, /hasCharges = view\.foldFeesIntoTotal/);
  assert.match(html, /\{hasCharges && \(/);
  assert.match(pdf, /\{foldFees && \(/);
  assert.doesNotMatch(pdf, /\{!foldFees && \(/, "the gate must not be inverted");

  const cpdf = codeOnly(await read("src/lib/customer-view-to-cpdf.ts"));
  assert.match(cpdf, /hasCharges = view\.foldFeesIntoTotal/);
});

test("the same flag decides the total the components compose", async () => {
  // If the rows said goods + fees while the total showed goods alone, the
  // document would print a reconciliation that does not close.
  const helpers = codeOnly(await read("src/components/pdf/customer-pdf-helpers.ts"));
  assert.match(helpers, /total: foldFees \? m\.turnkeyTotal : m\.goodsTotal/);
});

test("neither renderer computes — both read composed figures", async () => {
  const pdf = codeOnly(await read(PDF));
  const block = pdf.slice(pdf.indexOf("{foldFees && ("), pdf.indexOf("styles.grand"));
  assert.match(block, /m\.goodsTotal/);
  assert.match(block, /m\.feesTotal/);
  // No summing, no multiplication, no subtraction in the render path.
  for (const arith of [/\+\s*m\./, /m\.\w+\s*[-*/]\s*/, /reduce\(/]) {
    assert.doesNotMatch(block, arith, "the renderer must not do arithmetic on money");
  }
});

test("the PDF keeps the components and the total as one unwrappable unit", async () => {
  // A page break between a total and the two figures it is composed of would
  // orphan the reconciliation across pages.
  const pdf = codeOnly(await read(PDF));
  const wrapAt = pdf.indexOf("wrap={false}");
  assert.ok(wrapAt > 0, "the block must be atomic");
  assert.ok(wrapAt < pdf.indexOf("{foldFees && ("), "components sit inside it");
  assert.ok(wrapAt < pdf.indexOf("styles.grand"), "and so does the total");
});

test("the PDF styles are declared at pt scale, not px", async () => {
  // Pattern 48: a CSS px value carried verbatim into react-pdf renders ~33%
  // oversized. The live rules are 7px padding, 1px rule, 12px type.
  const styles = await read("src/components/pdf/customer-pdf-styles.ts");
  const block = styles.slice(styles.indexOf("componentRow: {"), styles.indexOf("grand: {"));
  assert.match(block, /paddingVertical:\s*5\.25/);
  assert.match(block, /borderBottomWidth:\s*0\.75/);
  assert.match(block, /fontSize:\s*9\b/);
  assert.doesNotMatch(block, /fontSize:\s*12\b/, "12 would be the px value carried through");
});

// ═══════════════════════════════════════════════════════════════════════
// AN UNPRICED TIER HAS NO SUBTOTAL, AND $0.00 IS NOT THE ANSWER
// ═══════════════════════════════════════════════════════════════════════
//
// Caught by rendering a real PDF and looking at it. Tier 2 of DPS-1012 read:
//
//     Unit-price subtotal      $1,560.00          $0.00
//     Separate charges           $292.50          $0.00
//     Turnkey total            $1,852.50   total on request
//
// The total correctly said the tier is not priced; the two rows above it told
// the customer the goods cost nothing. That is OD-005 -- unpriced is not zero
// -- and a false figure is worse than an omission, because the customer reads
// a number and believes it.
//
// The rows now carry an em dash on exactly the tiers whose total is on
// request, gated on the SAME `perUnit === null` the total uses, so the two
// cannot disagree about whether a tier is priced.

test("neither renderer prints $0.00 on an unpriced tier", async () => {
  const html = codeOnly(await read(HTML));
  const pdf = codeOnly(await read(PDF));
  assert.match(html, /perUnitTurnkey === null[\s\S]{0,40}\u2014/);
  assert.match(pdf, /fullyUnpriced \? "\u2014"/);
});

test("the guard uses the same condition the total uses", async () => {
  // A second predicate for "is this tier priced" could drift, and then the
  // total would say on-request while the components printed figures.
  const pdf = codeOnly(await read(PDF));
  // ONE computation on colData, read by both. Held apart they drifted at once:
  // the components tested `perUnit === null` while the total tested
  // `hasUnpriced && perUnit == null`, so a tier could print figures above a
  // total that declared it unpriced.
  assert.match(pdf, /fullyUnpriced: grand\.hasUnpriced && grand\.perUnit == null/);
  assert.match(pdf, /\{fullyUnpriced \? \(\s*<Text style=\{styles\.grandNum\}>total on request/);
  // and neither reader recomputes it
  assert.doesNotMatch(
    pdf,
    /const fullyUnpriced =/,
    "the predicate must not be recomputed inside a renderer",
  );
});
