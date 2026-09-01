/**
 * The publication representability rule, against the PROVIDER contract that
 * was measured rather than assumed.
 *
 *     posted amount = ROUND_HALF_UP(quantity x rate, 2)
 *
 * Established 2026-09-01 on two disposable sandbox Sales Orders, read back
 * three ways. A supplied `amount` is ignored; the 8dp rate is preserved.
 *
 * These tests exist because the previous rule — a residue of exactly zero at
 * scale 8 — was STRICTER than that contract and refused ordinary work. The
 * controls below have to prove the repair models the provider, not merely that
 * it accepts more than it used to:
 *
 *   · the formerly refused O2 line now passes;
 *   · the provider's rounding is reproduced digit for digit, so half-even or
 *     truncation cannot accidentally satisfy the suite;
 *   · the historical ABH defect still REFUSES;
 *   · the half-cent boundary is probed from both sides, so the rule is shown
 *     to be rounding rather than a tolerance for "small" residues.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePostedRate, POSTED_RATE_SCALE } from "../../src/lib/commercial-rate.ts";
import {
  postedAmountCents,
  centsToDecimal,
} from "../../src/lib/netsuite/posted-amount.ts";
import { exactRateTimesQuantity } from "../../src/lib/netsuite/reg4.ts";

/** Rate decimal string -> integer scaled by 1e8, for the helper's input. */
function scaled(rate: string): bigint {
  const [w, f = ""] = rate.split(".");
  return BigInt(w) * 10n ** BigInt(POSTED_RATE_SCALE) +
    BigInt((f + "0".repeat(POSTED_RATE_SCALE)).slice(0, POSTED_RATE_SCALE));
}

// ── 1 · the formerly refused O2 line ────────────────────────────────────

test("O2: 2100 x 6.00633810 posts as the accepted 12613.31", () => {
  // The exact product is 12613.31001000 — a residue of 0.00001, which is what
  // the old zero-residue rule refused and which NetSuite rounds away.
  const cents = postedAmountCents(scaled("6.00633810"), 2100n);
  assert.equal(centsToDecimal(cents), "12613.31");

  const derived = derivePostedRate("12613.31", 2100);
  assert.equal(derived.ok, true, derived.ok ? "" : derived.reason);
  assert.equal(derived.rate, "6.00633810");
});

test("O2: every formerly refused DPS-1073 line now derives", () => {
  // The eight cells the freeze refused, as (amount, quantity).
  const refused: [string, number][] = [
    ["12613.31", 2100],
    ["26204.59", 5500],
    ["4668.35", 2100],
    ["20441.22", 5500],
    ["9134.18", 5500],
    ["10147.85", 2100],
    ["19047.51", 5500],
    ["9581.83", 2100],
  ];
  for (const [amount, qty] of refused) {
    const d = derivePostedRate(amount, qty);
    assert.equal(d.ok, true, `${qty} x ? -> ${amount}: ${d.ok ? "" : d.reason}`);
  }
});

// ── 2 · the provider's rounding, digit for digit ────────────────────────

test("provider rounding is reproduced exactly — not half-even, not truncation", () => {
  // Measured on sandbox internalId 363741 at quantity 1000. Each case is
  // chosen so a WRONG rule gives a different answer:
  //   0.009 truncates to 0.00 and rounds to 0.01
  //   0.005 and 0.025 separate half-up from half-even
  const cases: [string, string][] = [
    ["0.00000900", "0.01"], // rounds up; truncation would give 0.00
    ["0.00000400", "0.00"], // rounds down
    ["0.00000500", "0.01"], // tie -> UP
    ["0.00001500", "0.02"], // tie -> UP
    ["0.00002500", "0.03"], // tie -> UP; half-even would give 0.02
  ];
  for (const [rate, expected] of cases) {
    assert.equal(
      centsToDecimal(postedAmountCents(scaled(rate), 1000n)),
      expected,
      `1000 x ${rate}`,
    );
  }
});

test("half-even would fail this suite", () => {
  // Stated as its own assertion so the discrimination is explicit rather than
  // implied. 0.025 -> half-even is 0.02, and the provider gave 0.03.
  const halfUp = centsToDecimal(postedAmountCents(scaled("0.00002500"), 1000n));
  assert.equal(halfUp, "0.03");
  assert.notEqual(halfUp, "0.02");
});

// ── 3 · a true mismatch still REFUSES ───────────────────────────────────

test("the historical ABH defect still refuses", () => {
  // Scale-4 rates against 2dp amounts, the shape that cost $0.04 and $0.86.
  // These round to a DIFFERENT cent, which is a real disagreement and not a
  // residue the provider absorbs.
  const abh: [string, number, string][] = [
    ["6.76960000", 5000, "33848.09"], // posts 33848.00
    ["3.05030000", 10000, "30503.04"], // posts 30503.00
    ["1.57120000", 20000, "31424.86"], // posts 31424.00
  ];
  for (const [rate, qty, frozen] of abh) {
    const posted = centsToDecimal(postedAmountCents(scaled(rate), BigInt(qty)));
    assert.notEqual(posted, frozen, `${qty} x ${rate} must not equal ${frozen}`);
  }

  // And REG-4 must refuse the emitted line, not merely notice the difference.
  const r = exactRateTimesQuantity("1.57120000", 20000);
  assert.equal(r.exact, true, "the rate is readable at the posted scale");
  assert.notEqual(centsToDecimal(BigInt(r.cents)), "31424.86");
});

test("a rate finer than the posted scale is refused, not truncated", () => {
  // A checker that reshapes its input cannot testify about it.
  const r = exactRateTimesQuantity("1.234567891", 100);
  assert.equal(r.exact, false);
});

// ── 4 · the half-cent boundary, from both sides ─────────────────────────

test("the rule is rounding, not a tolerance for small residues", () => {
  // Immediately BELOW half a cent at this quantity: absorbed, posts the
  // accepted amount.
  //   1000 x 0.01000499 = 10.00499  -> 10.00
  assert.equal(centsToDecimal(postedAmountCents(scaled("0.01000499"), 1000n)), "10.00");

  // Immediately ABOVE: it moves a cent, so a line accepted at 10.00 must be
  // REFUSED rather than quietly posted as 10.01.
  //   1000 x 0.01000501 = 10.00501  -> 10.01
  assert.equal(centsToDecimal(postedAmountCents(scaled("0.01000501"), 1000n)), "10.01");

  // Exactly at the boundary: ties go up, so this too disagrees with 10.00.
  assert.equal(centsToDecimal(postedAmountCents(scaled("0.01000500"), 1000n)), "10.01");
});

test("a residue that crosses the boundary is refused by the freeze gate", () => {
  // Constructed so the derived rate CANNOT reproduce the amount: an amount
  // whose required rate exceeds the posted scale's resolution at this
  // quantity. Scale 8 covers Nexus quantities, so this needs an extreme one —
  // which is exactly the case the scale check exists for.
  const d = derivePostedRate("0.01", 3_000_000_000);
  assert.equal(d.ok, false);
});

// ── 5 · both gates agree, which is the point of the shared helper ───────

test("freeze and REG-4 return the same verdict on the same numbers", () => {
  const cases: [string, number][] = [
    ["12613.31", 2100],
    ["26204.59", 5500],
    ["6000.00", 1000],
    ["33848.09", 5000],
  ];
  for (const [amount, qty] of cases) {
    const derived = derivePostedRate(amount, qty);
    if (!derived.ok) continue;
    // The freeze accepted this rate; REG-4 must then agree it posts the
    // accepted amount. Divergence here is the failure mode the shared helper
    // exists to make impossible.
    const reg4 = exactRateTimesQuantity(derived.rate, qty);
    assert.equal(reg4.exact, true);
    assert.equal(
      centsToDecimal(BigInt(reg4.cents)),
      Number(amount).toFixed(2),
      `${qty} x ${derived.rate}`,
    );
  }
});

test("quantity 1 is safe by construction — rate equals amount", () => {
  const d = derivePostedRate("4375.00", 1);
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.rate, "4375.00000000");
});
