/**
 * P3-017 · the Cost Stack's reconciliation strip, as a predicate.
 *
 * The strip states that every column adds up:
 *
 *     sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell
 *
 * WHICH IS ONLY WORTH RENDERING IF IT CAN SAY NO. On a correct graph it never
 * will, so the only way to observe the failing answer is to hand the predicate
 * numbers that do not reconcile. That is what these tests do, and it is the
 * whole reason the predicate is a separate exported function instead of an
 * expression inside the JSX: a `filter` buried in a component can be asserted
 * about only by rendering the component with a corrupted graph, which is a much
 * heavier and much less direct way to ask the same question.
 *
 * The COMPANION test — `p3-017-tier-ladder-authority.test.ts` — pins the other
 * half: that the five governed quantities this predicate reads are each derived
 * from their own lever's rate rather than by subtracting one published level
 * from another. Without that, this identity would telescope and the ✕ branch
 * below would be unreachable in production no matter what the data did.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { tiersFailingReconciliation } from "../../src/lib/cost-stack-reconciliation.ts";

/** A column that reconciles. 10 + 1 + 0.5 − 0.25 = 11.25. */
const OK = {
  sellBefore: 10,
  adjDelta: 1,
  liftDelta: 0.5,
  overrideDelta: -0.25,
  sell: 11.25,
};

test("a reconciling column is not reported", () => {
  assert.deepEqual(tiersFailingReconciliation([OK]), []);
});

test("every column reconciling reports nothing", () => {
  const rows = [
    OK,
    { sellBefore: 4, adjDelta: 0, liftDelta: 0, overrideDelta: 0, sell: 4 },
    { sellBefore: 0, adjDelta: 0, liftDelta: 0, overrideDelta: 0, sell: 0 },
  ];
  assert.deepEqual(tiersFailingReconciliation(rows), []);
});

// ─────────────────────────────────────────── the assertion can say NO

test("a corrupted quoted sell is reported — the strip can fail", () => {
  const corrupted = { ...OK, sell: OK.sell + 0.01 };
  const bad = tiersFailingReconciliation([corrupted]);
  assert.equal(bad.length, 1, "a column that does not add up must be reported");
  assert.equal(bad[0], corrupted);
});

test("a corrupted CONTRIBUTION is reported, not only a corrupted total", () => {
  // The failure mode that matters most: the levels look right, one lever's
  // contribution does not. A strip that only watched the ends would miss it.
  for (const field of ["adjDelta", "liftDelta", "overrideDelta"] as const) {
    const corrupted = { ...OK, [field]: OK[field] + 0.02 };
    assert.equal(
      tiersFailingReconciliation([corrupted]).length,
      1,
      `a corrupted ${field} must be reported`,
    );
  }
});

test("a corrupted starting level is reported", () => {
  assert.equal(
    tiersFailingReconciliation([{ ...OK, sellBefore: OK.sellBefore + 0.5 }]).length,
    1,
  );
});

test("only the failing columns are reported, and they are identifiable", () => {
  const good = { ...OK };
  const bad1 = { ...OK, sell: 99 };
  const bad2 = { ...OK, adjDelta: 99 };
  const out = tiersFailingReconciliation([good, bad1, good, bad2]);
  assert.equal(out.length, 2);
  assert.ok(out.includes(bad1) && out.includes(bad2));
  assert.ok(!out.includes(good));
});

// ──────────────────────────────────────────────────── the tolerance

test("float noise below 1e-9 reconciles; a real cent does not", () => {
  // Blending sums weighted per-cell values, so exact equality would report
  // healthy quotes. The tolerance absorbs representation error and nothing
  // commercial: a hundredth of a cent is eight orders of magnitude above it.
  assert.deepEqual(tiersFailingReconciliation([{ ...OK, sell: OK.sell + 1e-12 }]), []);
  assert.equal(
    tiersFailingReconciliation([{ ...OK, sell: OK.sell + 0.0001 }]).length,
    1,
  );
});

test("no columns is not a failure — there is nothing to assert about", () => {
  assert.deepEqual(tiersFailingReconciliation([]), []);
});
