/**
 * ROUND-1 — one governed money-display path.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * Two customer-facing surfaces disagreed about the same number. 75ml Aluminum
 * Wax Stick · Tier 3, quoted sell 2.8350 exactly: Pricing printed `$2.84`, the
 * customer PDF printed `$2.83`.
 *
 * Not two rounding POLICIES — two instruments measuring different things.
 * `Intl.NumberFormat` rounds the decimal value, so an exact half goes up.
 * `toFixed` rounds the IEEE-754 double, and 2.8350 is stored as
 * `2.8349999999999999645`, which is below the half.
 *
 * A second, independent divergence in the same pair: the PDF's `money()`
 * switched to 0 dp at `Math.abs(n) >= 100` while Pricing held 2 dp, so
 * `$100.50` printed to the customer as `$101`.
 *
 * ── WHY THESE TESTS ARE SHAPED THIS WAY ───────────────────────────────────
 *
 * The witnessed cell is gone — the quote's pricing has since moved, and 75ml
 * Tier 3 now reads $3.14. A test pinned to one value would have been dead on
 * arrival, and would never have caught the ~9,600 other values that disagreed.
 * So the properties are asserted over the value SPACE, and the named witnesses
 * are included as named cases rather than as the whole coverage.
 *
 * The central assertion is not "the formatter produces X". It is that **the two
 * instruments can no longer disagree** — checked by running both over every
 * thousandth under $200, which is the failure the operator actually saw.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  extendedAmount,
  formatMoney,
  ladderAmount,
  roundMoney,
  unitPrice,
} from "../../src/lib/money-display.ts";
import { money, unit } from "../../src/components/pdf/customer-pdf-helpers.ts";

/** The two instruments that disagreed, applied to an ALREADY-ROUNDED value. */
const viaIntl = (v: number, dp: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const viaToFixed = (v: number, dp: number) => "$" + v.toFixed(dp);

// ── the named witnesses ───────────────────────────────────────────────────

test("2.8350 — the witnessed cell", () => {
  // Pricing said $2.84, the PDF said $2.83. Both now say $2.84: the exact half
  // rounds away from zero on the DECIMAL value, which is what an operator
  // reading "2.8350" expects.
  assert.equal(unitPrice(2.835), "$2.84");
  assert.equal(unit(2.835), "$2.84");
  assert.equal(unitPrice(2.835), unit(2.835));
});

test("0.0150, 0.0450, 0.0750 — exact halves at small magnitude", () => {
  for (const [v, want] of [
    [0.015, "$0.02"],
    [0.045, "$0.05"],
    [0.075, "$0.08"],
  ] as const) {
    assert.equal(unitPrice(v), want, `${v} on Pricing`);
    assert.equal(unit(v), want, `${v} on the customer PDF`);
  }
});

test("$100.50 — trailing cents survive the magnitude threshold", () => {
  // The second defect, and the one that cost real money on a customer
  // document: `money()` dropped to 0 dp at >= $100 and printed `$101`.
  assert.equal(money(100.5), "$100.50");
  assert.equal(extendedAmount(100.5), "$100.50");
  assert.notEqual(money(100.5), "$101");
});

test("the magnitude threshold is gone entirely, not moved", () => {
  // Asserted either side of the old boundary AND far past it, because a
  // threshold that merely moved would still pass a check at $100.50.
  assert.equal(money(99.5), "$99.50");
  assert.equal(money(100.5), "$100.50");
  assert.equal(money(90475), "$90,475.00");
  assert.equal(money(1234567.891), "$1,234,567.89");
});

// ── the property that actually fixes it ───────────────────────────────────

test("FALSIFICATION — the two instruments cannot disagree at 2 dp", () => {
  // Before the repair, 9,600 of the 20,000 exact-half thousandths under $200
  // disagreed. This runs BOTH original instruments over every thousandth, on
  // the pre-rounded value, and requires zero disagreements.
  //
  // This is the assertion to keep if any other is ever dropped: a caller that
  // reaches for `toFixed` downstream still cannot reintroduce the divergence,
  // which is stronger than everyone agreeing to call the same formatter.
  const disagreements: string[] = [];
  for (let i = 1; i < 200_000; i++) {
    const v = i / 1000;
    const r = roundMoney(v, 2);
    if (viaIntl(r, 2) !== viaToFixed(r, 2)) {
      if (disagreements.length < 5) {
        disagreements.push(`${v}: Intl ${viaIntl(r, 2)} vs toFixed ${viaToFixed(r, 2)}`);
      }
    }
  }
  assert.deepEqual(disagreements, []);
});

test("FALSIFICATION — every exact-half thousandth rounds away from zero", () => {
  // The half-case, exhaustively rather than at the three witnessed values.
  // `0.145 * 100` is `14.499999999999998224` — the scaled product carries its
  // own noise, so correcting only the input is not enough. That case is inside
  // this sweep.
  const wrong: string[] = [];
  for (let i = 5; i < 200_000; i += 10) {
    const v = i / 1000;
    const got = roundMoney(v, 2);
    const want = (i + 5) / 1000;
    if (Math.abs(got - want) > 1e-9) {
      if (wrong.length < 5) wrong.push(`${v} -> ${got}, want ${want}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("0.145 specifically — the scaled product rounds the wrong way uncorrected", () => {
  // Named because it is the case that proves the SECOND toPrecision is needed.
  // A repair that corrected only the input value passes every other test here.
  assert.equal(Number((0.145 * 100).toPrecision(20)), 14.499999999999998);
  assert.equal(unitPrice(0.145), "$0.15");
});

// ── Pricing and the customer PDF agree on the same semantic amount ────────

test("the same amount renders identically on Pricing and the customer PDF", () => {
  // Per-unit prices: Pricing's cell figure vs the PDF's unit price.
  // Extended amounts: Pricing's order value vs the PDF's grand total.
  const values = [
    0.015, 0.045, 0.075, 0.105, 0.145, 0.155, 1.005, 2.675, 2.835, 4.53, 12.0,
    99.5, 100.5, 100.505, 28_350, 90_475, 90_475.005,
  ];
  for (const v of values) {
    assert.equal(unitPrice(v), unit(v), `per-unit disagreement at ${v}`);
    assert.equal(extendedAmount(v), money(v), `extended disagreement at ${v}`);
  }
});

test("the PDF formatters ARE the governed path, not a copy of it", () => {
  // A copy drifts. Identity does not.
  assert.equal(unit, unitPrice);
  assert.equal(money, extendedAmount);
});

// ── precision is explicit, never inferred ─────────────────────────────────

test("precision comes from the call site or a semantic formatter", () => {
  assert.equal(formatMoney(2.835, 2), "$2.84");
  assert.equal(formatMoney(2.835, 4), "$2.8350");
  // The ladder keeps 4 dp: at 2 dp a $0.0035 surgical lift displays as +$0.00
  // and the visible column stops adding up.
  assert.equal(ladderAmount(0.0035), "$0.0035");
  assert.equal(unitPrice(0.0035), "$0.00");
});

test("nothing infers precision from magnitude", () => {
  // Same number of decimals either side of every plausible threshold.
  const dp = (s: string) => (s.split(".")[1] ?? "").length;
  for (const v of [0.5, 9.5, 99.5, 100.5, 999.5, 1000.5, 1_000_000.5]) {
    assert.equal(dp(extendedAmount(v)), 2, `extended dp changed at ${v}`);
    assert.equal(dp(ladderAmount(v)), 4, `ladder dp changed at ${v}`);
  }
});

// ── edges ─────────────────────────────────────────────────────────────────

test("negatives round away from zero and carry the sign outside the symbol", () => {
  // `Math.round` alone rounds half toward +Infinity, which would give -$2.83.
  assert.equal(unitPrice(-2.835), "-$2.84");
  assert.equal(extendedAmount(-100.5), "-$100.50");
});

test("a value that rounds to zero never renders as negative zero", () => {
  // "-$0.00" reads as a real negative amount.
  assert.equal(unitPrice(-0.001), "$0.00");
  assert.equal(unitPrice(-0), "$0.00");
  assert.equal(unitPrice(0), "$0.00");
});

test("absent and non-finite values render as an em dash on both surfaces", () => {
  for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(unitPrice(v as never), "—");
    assert.equal(unit(v as never), "—");
    assert.equal(money(v as never), "—");
  }
});

// ── display authority only ────────────────────────────────────────────────

test("the module reads nothing and computes nothing but a glyph", async () => {
  // Display authority: it must not become a place where money is decided.
  // An import of the engine or the schema here would make a rounding rule into
  // an arithmetic one, which is exactly what the disposition excluded.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../../src/lib/money-display.ts", import.meta.url),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /^import /m, "the governed formatter took a dependency");
});
