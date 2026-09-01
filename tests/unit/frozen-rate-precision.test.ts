import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

import {
  POSTED_RATE_SCALE,
  derivePostedRate,
} from "../../src/lib/commercial-rate.ts";
import { checkLinkB, exactRateTimesQuantity } from "../../src/lib/netsuite/reg4.ts";
import type { Reg4Line } from "../../src/lib/netsuite/reg4.ts";

// ═══════════════════════════════════════════════════════════════════════
// FROZEN RATE PRECISION — the accepted amount is the authority; the rate is
// its representation.
//
// NetSuite is sent quantity and rate and computes the amount itself, so a rate
// that does not reproduce the accepted amount posts a different commercial
// statement than the one the customer agreed to. At scale 4 the freeze rounded
// rate and amount INDEPENDENTLY from the same full-precision source, and the
// pair could disagree by up to 5e-5 × quantity.
//
// The witness is the ABH - Neoprene Bag quote, whose send REG-4 refused.
// ═══════════════════════════════════════════════════════════════════════

/** The three real frozen cells that failed. Amounts are the accepted figures. */
const ABH = [
  { tier: "1", qty: 5_000, oldRate: "6.7696", amount: "33848.09" },
  { tier: "2", qty: 10_000, oldRate: "3.0503", amount: "30503.04" },
  { tier: "3", qty: 20_000, oldRate: "1.5712", amount: "31424.86" },
] as const;

const line = (over: Partial<Reg4Line>): Reg4Line => ({
  sourceLineId: "abh",
  description: "ABH - Neoprene Bag",
  quantity: 1,
  rate: "1.00",
  amount: "1.00",
  ...over,
});

// ── 1 · the witness fails on the OLD behaviour ────────────────────────────
//
// Not "would have failed" as commentary — asserted, so the repair cannot be
// declared successful against a defect that was never reproduced here.

test("ABH: every frozen tier fails REG-4 under the old 4dp rate", () => {
  for (const c of ABH) {
    const failures = checkLinkB(
      [line({ quantity: c.qty, rate: c.oldRate, amount: c.amount })],
      Number(c.amount.replace(".", "")),
    );
    assert.equal(
      failures.length,
      1,
      `tier ${c.tier} should be refused at the old 4dp rate`,
    );
    assert.equal(failures[0].kind, "rate_times_quantity_inexact");
  }
});

test("ABH: the old shortfall is exactly the reported $0.04 / $0.09 / $0.86", () => {
  const shortfall = ABH.map((c) => {
    const product = exactRateTimesQuantity(c.oldRate, c.qty);
    const accepted = Number(c.amount.replace(".", ""));
    return (accepted - product.cents) / 100;
  });
  assert.deepEqual(shortfall, [0.09, 0.04, 0.86]);
});

// ── 2 · all three tiers reproduce their frozen amount after the repair ────

test("ABH: derived rates reproduce every accepted amount EXACTLY", () => {
  for (const c of ABH) {
    const derived = derivePostedRate(c.amount, c.qty);
    assert.ok(derived.ok, `tier ${c.tier} must be representable`);

    // NetSuite's own arithmetic, in exact integer cents.
    const product = exactRateTimesQuantity(derived.rate, c.qty);
    assert.ok(product.exact, `tier ${c.tier} must land on a whole cent`);
    assert.equal(
      product.cents,
      Number(c.amount.replace(".", "")),
      `tier ${c.tier}: ${c.qty} × ${derived.rate} must equal ${c.amount}`,
    );

    // And REG-4 itself now passes on the same numbers.
    assert.deepEqual(
      checkLinkB(
        [line({ quantity: c.qty, rate: derived.rate, amount: c.amount })],
        Number(c.amount.replace(".", "")),
      ),
      [],
    );
  }
});

test("ABH: the accepted amount is never altered to fit the arithmetic", () => {
  // The derivation reads the amount and returns only a rate. Asserting the
  // input is untouched is cheap and pins the property the whole slice rests on.
  for (const c of ABH) {
    const before = c.amount;
    const derived = derivePostedRate(c.amount, c.qty);
    assert.ok(derived.ok);
    assert.equal(c.amount, before);
  }
});

// ── 3 · no tolerance was introduced ───────────────────────────────────────
//
// The most valuable test here. A repair of this shape is exactly where a
// tolerance gets added "just for the last cent", and it would look like a pass.

test("a one-cent miss is still a refusal, not a tolerance", () => {
  const failures = checkLinkB(
    [line({ quantity: 10_000, rate: "3.05030000", amount: "30503.04" })],
    3_050_304,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "rate_times_quantity_inexact");
});

test("a fraction-of-a-cent product posts as the provider rounds it", () => {
  // CORRECTED 2026-09-01. This asserted that 3 × 0.005 = 0.015 must be
  // REFUSED, on the reasoning that "rounding it either way is a decision this
  // code is not entitled to make".
  //
  // The reasoning was right about the entitlement and wrong about the effect:
  // refusing does not stop the rounding, it only stops the send. The sandbox
  // showed NetSuite rounds half-up regardless, and ignores any amount sent
  // alongside. So the honest question is not "is there a remainder" but "does
  // the provider land on the accepted cents" — and 0.015 lands on 0.02.
  const product = exactRateTimesQuantity("0.00500000", 3);
  assert.equal(product.exact, true, "the rate is readable at the posted scale");
  assert.equal(product.cents, 2, "half a cent rounds UP, as measured");

  // Which means a line ACCEPTED at 0.01 is still refused — the provider would
  // store 0.02, and that is a real disagreement rather than an absorbed residue.
  assert.notEqual(product.cents, 1);
});

test("derivePostedRate returns only a rate it has verified against the provider", () => {
  // CORRECTED 2026-09-01. This expected a refusal for 0.01 at quantity 3 under
  // the old zero-residue rule: the derived rate is 0.00333333 and
  // 3 × 0.00333333 = 0.00999999, one hundred-thousandth short.
  //
  // NetSuite posts that as 0.01 — the accepted amount — so the refusal blocked
  // a send that would have been correct. What the function still guarantees is
  // unchanged: it never returns a rate whose posted result it has not checked.
  const r = derivePostedRate("0.01", 3);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.equal(r.ok && r.rate, "0.00333333");
  assert.equal(exactRateTimesQuantity("0.00333333", 3).cents, 1);
});

test("quantity 0 is refused — a per-unit rate is not defined there", () => {
  assert.equal(derivePostedRate("100.00", 0).ok, false);
});

// ── 4 · the checker cannot silently reshape its input ─────────────────────
//
// exactRateTimesQuantity previously hardcoded scale 4 and truncated with
// slice(0, 4). Handed an 8dp rate it would have discarded four digits and then
// blamed the provider for the disagreement.

test("a rate finer than the posted scale is refused, not truncated", () => {
  const nine = "1.000000005"; // 9dp
  const product = exactRateTimesQuantity(nine, 1_000_000);
  assert.equal(product.exact, false);
});

test("REG-4 reads the posted scale rather than repeating it", async () => {
  const src = codeOnly(
    await readFile(new URL("../../src/lib/netsuite/reg4.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /POSTED_RATE_SCALE/);
  assert.doesNotMatch(src, /10_000n/, "scale must not be hardcoded again");
  assert.doesNotMatch(src, /slice\(0, 4\)/, "the truncating parse must be gone");
});

test("both NetSuite payload emitters render at the posted scale", async () => {
  for (const f of ["sales-orders.ts", "mark-complete.ts"]) {
    const src = codeOnly(
      await readFile(new URL(`../../src/lib/netsuite/${f}`, import.meta.url), "utf8"),
    );
    assert.doesNotMatch(
      src,
      /rate[^\n]*\.toFixed\(4\)/,
      `${f} must not render a sell rate at 4 decimals`,
    );
    assert.match(src, /rate[^\n]*toFixed\(POSTED_RATE_SCALE\)/, `${f} emits at scale`);
  }
});

// ── 5 · shapes that were already correct stay correct ─────────────────────
//
// Regression cover for the witnesses this repair must not move: quantity-1
// charges, and grouped members whose rate already reproduced their amount.

test("quantity-1 charges are unchanged — rate equals amount", () => {
  for (const amount of ["140.00", "5250.00", "12400.00", "0.01"]) {
    const derived = derivePostedRate(amount, 1);
    assert.ok(derived.ok);
    assert.equal(Number(derived.rate), Number(amount));
    assert.deepEqual(
      checkLinkB(
        [line({ quantity: 1, rate: derived.rate, amount })],
        Number(amount.replace(".", "")),
      ),
      [],
    );
  }
});

test("rates that were already exact at 4dp are unmoved in value", () => {
  // A clean 4dp rate is still the same number at scale 8 — widening a scale
  // does not change a value, and the padded form must compare equal.
  const derived = derivePostedRate("17400.00", 10_000);
  assert.ok(derived.ok);
  assert.equal(derived.rate, "1.74000000");
  assert.equal(Number(derived.rate), 1.74);
});

test("a multi-line order still reconciles as a whole", () => {
  const lines = [
    line({ sourceLineId: "p", quantity: 10_000, rate: "3.05030400", amount: "30503.04" }),
    line({ sourceLineId: "otc", description: "Setup", quantity: 1, rate: "140.00000000", amount: "140.00" }),
  ];
  assert.deepEqual(checkLinkB(lines, 3_050_304 + 14_000), []);
});

// ── 6 · the provider-proven boundary ──────────────────────────────────────

test("scale is 8, and the sandbox-proven 8th decimal survives the arithmetic", () => {
  assert.equal(POSTED_RATE_SCALE, 8);
  // The exact pair posted to the sandbox: distinct rates, amounts one cent
  // apart. NetSuite returned both intact.
  const a = exactRateTimesQuantity("1.00000001", 1_000_000);
  const b = exactRateTimesQuantity("1.00000002", 1_000_000);
  assert.ok(a.exact && b.exact);
  assert.equal(b.cents - a.cents, 1);
});

test("scale 8 covers the quantities Nexus quotes", () => {
  // d > 2 + log10(qty). At 100,000 units the 8th decimal is the last one that
  // can matter; beyond that the derivation must refuse rather than approximate.
  for (const qty of [5_000, 10_000, 20_000, 50_000, 100_000]) {
    const amount = "31424.86";
    const derived = derivePostedRate(amount, qty);
    if (derived.ok) {
      const product = exactRateTimesQuantity(derived.rate, qty);
      assert.ok(product.exact);
      assert.equal(product.cents, 3_142_486, `qty ${qty}`);
    } else {
      // Refusal is an acceptable outcome; a wrong number is not.
      assert.match(derived.reason, /cannot represent/);
    }
  }
});
