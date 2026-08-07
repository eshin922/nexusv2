/**
 * Gate 1B increment 2.5 — the reconciler, proven to bite.
 *
 * The graph was making a stronger promise than its verifier enforced: markup
 * and allocation nodes advertised arithmetic that `findGraphViolations` did not
 * check. A node that shows an operation and asserts nothing is the R6 failure
 * in miniature — it teaches operators that the explanation is decorative.
 *
 * Every checker here is tested in BOTH directions: a well-formed node passes,
 * and a node whose operation has been perturbed fails with a message that says
 * what the arithmetic actually produced. A checker only ever exercised on
 * correct input has not been tested — that is the lesson `FALLBACK_MARKUP`
 * taught, where a perturbation changed nothing and the check still passed.
 *
 * These perturbations are permanent tests rather than one-off source mutations,
 * so the proof that the guards work is itself regression-tested.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { findGraphViolations, type CostingNode } from "../../src/lib/costing-nodes.ts";

const usd = (key: string, value: number): CostingNode => ({
  key,
  kind: "origin",
  label: key,
  value,
  unit: "usd",
  origin: { grade: "thin", actor: null, when: null, doc: null },
});

const pct = (key: string, value: number): CostingNode => ({
  key,
  kind: "resolution",
  label: key,
  value,
  unit: "pct",
  op: "ladder",
  candidates: [{ label: "only", value, chosen: true, unavailableReason: null }],
});

const only = (n: CostingNode) => {
  const v = findGraphViolations(n);
  assert.equal(v.length, 1, `expected exactly one violation, got ${JSON.stringify(v)}`);
  return v[0].problem;
};

// ------------------------------------------------------------------- sum

test("sum · reconciles when the operands add up", () => {
  const n: CostingNode = {
    key: "s", kind: "sum", label: "S", value: 7, unit: "usd", op: "a + b",
    operands: [usd("a", 3), usd("b", 4)],
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("sum · FAILS when an operand is perturbed", () => {
  const n: CostingNode = {
    key: "s", kind: "sum", label: "S", value: 7, unit: "usd", op: "a + b",
    operands: [usd("a", 3), usd("b", 4.01)],
  };
  assert.match(only(n), /operands sum to 7\.01, node value is 7/);
});

// ---------------------------------------------------------------- markup

test("markup · reconciles base x (1 + rate)", () => {
  const n: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 13, unit: "usd", op: "10 x 1.3",
    operands: [usd("cost", 10), pct("rate", 0.3)],
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("markup · FAILS when the rate is perturbed", () => {
  const n: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 13, unit: "usd", op: "10 x 1.3",
    operands: [usd("cost", 10), pct("rate", 0.31)],
  };
  // Loose on the float tail deliberately: 10 x 1.31 is 13.100000000000001 in
  // IEEE, and pinning the full expansion would make this test about float
  // representation rather than about the checker catching the perturbation.
  assert.match(only(n), /10 x \(1 \+ 0\.31\) = 13\.1/);
});

test("markup · FAILS when the base is perturbed", () => {
  const n: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 13, unit: "usd", op: "10 x 1.3",
    operands: [usd("cost", 11), pct("rate", 0.3)],
  };
  assert.match(only(n), /node value is 13/);
});

test("markup · identifies base and rate by UNIT, not by position", () => {
  // A positional convention would silently reconcile the wrong pair the first
  // time an emitter ordered its operands differently — and the number would
  // still look plausible.
  const n: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 13, unit: "usd", op: "10 x 1.3",
    operands: [pct("rate", 0.3), usd("cost", 10)],
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("markup · FAILS when it cannot tell base from rate", () => {
  const n: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 13, unit: "usd", op: "?",
    operands: [usd("a", 10), usd("b", 3)],
  };
  assert.match(only(n), /exactly one usd operand and one pct operand, found 2 and 0/);
});

// ------------------------------------------------------------ allocation

test("allocation · reconciles numerator over divisor", () => {
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 3, unit: "usd",
    op: "3000 / 1000 units", divisor: 1000,
    operands: [usd("fill", 1800), usd("cm", 1200)],
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("allocation · FAILS when the divisor is perturbed", () => {
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 3, unit: "usd",
    op: "3000 / 1000 units", divisor: 1500,
    operands: [usd("fill", 1800), usd("cm", 1200)],
  };
  assert.match(only(n), /3000 \/ 1500 = 2, node value is 3/);
});

test("allocation · FAILS when the numerator is perturbed", () => {
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 3, unit: "usd",
    op: "3000 / 1000 units", divisor: 1000,
    operands: [usd("fill", 1800), usd("cm", 1300)],
  };
  assert.match(only(n), /3100 \/ 1000 = 3\.1, node value is 3/);
});

test("allocation · FAILS when it carries no divisor at all", () => {
  // The divisor used to live only inside the `op` string, which meant the
  // node advertised an operation nothing could check.
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 3, unit: "usd",
    op: "3000 / 1000 units",
    operands: [usd("fill", 1800), usd("cm", 1200)],
  };
  assert.match(only(n), /carries no divisor/);
});

test("allocation · zero divisor allocates to zero while the numerator stays visible", () => {
  // The established zero-quantity semantics: there is nothing to spread the
  // total over. The numerator is still a real fact and remains in the chain —
  // it is the answer to "why is this zero".
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 0, unit: "usd",
    op: "3000 / 0 units", divisor: 0,
    operands: [usd("fill", 1800), usd("cm", 1200)],
  };
  assert.deepEqual(findGraphViolations(n), []);
  assert.equal((n.operands ?? []).reduce((s, o) => s + o.value, 0), 3000);
});

test("allocation · FAILS when a zero divisor is paired with a non-zero value", () => {
  const n: CostingNode = {
    key: "a", kind: "allocation", label: "A", value: 3, unit: "usd",
    op: "3000 / 0 units", divisor: 0,
    operands: [usd("fill", 1800), usd("cm", 1200)],
  };
  assert.match(only(n), /3000 \/ 0 = 0, node value is 3/);
});

// ------------------------------------------------------------ adjustment

test("adjustment · reconciles base x (1 + A), and FAILS when perturbed", () => {
  const good: CostingNode = {
    key: "adj", kind: "adjustment", label: "Adj", value: 10.25, unit: "usd",
    op: "10 x 1.025", operands: [usd("before", 10), pct("A", 0.025)],
  };
  assert.deepEqual(findGraphViolations(good), []);

  const bad: CostingNode = { ...good, value: 10.5 };
  assert.match(only(bad), /node value is 10\.5/);
});

// ----------------------------------------------------------- flagged-out

test("flagged-out · is a structural assertion, not arithmetic", () => {
  const n: CostingNode = {
    key: "f", kind: "flagged-out", label: "Bulk raw", value: 0, unit: "usd",
    reason: "Customer ships raws — $5000 excluded",
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("flagged-out · FAILS when it asserts a non-zero contribution", () => {
  // An excluded input contributes nothing by definition. A non-zero one claims
  // both that the input is out of the chain and that it is in the price.
  const n: CostingNode = {
    key: "f", kind: "flagged-out", label: "Bulk raw", value: 5, unit: "usd",
    reason: "Customer ships raws",
  };
  assert.match(only(n), /flagged-out asserts 5; an excluded input contributes nothing/);
});

test("flagged-out · still requires its reason", () => {
  const n: CostingNode = {
    key: "f", kind: "flagged-out", label: "Bulk raw", value: 0, unit: "usd",
  };
  assert.match(only(n), /carries no reason/);
});

// ----------------------------------------------------------------- scale

test("tolerance scales with magnitude rather than being a fixed absolute", () => {
  // A fixed epsilon is wrong in both directions on multiplicative relations:
  // too strict on large values, where float error grows with the operands, and
  // too loose on tiny ones.
  const large: CostingNode = {
    key: "m", kind: "markup", label: "M", value: 250000 * 1.32, unit: "usd", op: "x",
    operands: [usd("cost", 250000), pct("rate", 0.32)],
  };
  assert.deepEqual(findGraphViolations(large), []);

  const tiny: CostingNode = {
    key: "m2", kind: "markup", label: "M", value: 0.0004 * 1.3, unit: "usd", op: "x",
    operands: [usd("cost", 0.0004), pct("rate", 0.3)],
  };
  assert.deepEqual(findGraphViolations(tiny), []);

  // …and a real discrepancy at small magnitude is still caught.
  const tinyWrong: CostingNode = { ...tiny, value: 0.0006 };
  assert.equal(findGraphViolations(tinyWrong).length, 1);
});

// ------------------------------------------------- deliberately unchecked

// ------------------------------------------------------------------ rate

test("rate · reconciles basis x rate", () => {
  const n: CostingNode = {
    key: "r", kind: "rate", label: "Duty", value: 0.5, unit: "usd",
    op: "10 x 0.05", basis: { label: "Factory cost per unit", value: 10 },
    operands: [pct("pct", 0.05)],
  };
  assert.deepEqual(findGraphViolations(n), []);
});

test("rate · FAILS when the percentage is perturbed", () => {
  const n: CostingNode = {
    key: "r", kind: "rate", label: "Duty", value: 0.5, unit: "usd",
    op: "10 x 0.05", basis: { label: "Factory cost per unit", value: 10 },
    operands: [pct("pct", 0.06)],
  };
  assert.match(only(n), /10 x 0\.06 = 0\.6, node value is 0\.5/);
});

test("rate · FAILS when the BASIS is perturbed even though the rate is right", () => {
  // The case the basis requirement exists for. $0.50 of duty could be 5% of
  // factory cost or 2% of landed cost; without the basis stated, both look
  // correct and an operator cannot tell whether the right base was used.
  const n: CostingNode = {
    key: "r", kind: "rate", label: "Duty", value: 0.5, unit: "usd",
    op: "10 x 0.05", basis: { label: "Landed cost per unit", value: 25 },
    operands: [pct("pct", 0.05)],
  };
  assert.match(only(n), /25 x 0\.05 = 1\.25, node value is 0\.5/);
});

test("rate · FAILS when it states no basis at all", () => {
  const n: CostingNode = {
    key: "r", kind: "rate", label: "Duty", value: 0.5, unit: "usd", op: "? x 0.05",
    operands: [pct("pct", 0.05)],
  };
  assert.match(only(n), /carries no basis, so the dollar amount it applies to is ambiguous/);
});

test("rate is NOT the markup shape — basis x rate, never basis x (1 + rate)", () => {
  // Collapsing the two would reconcile duty at 104% of factory cost and
  // report it as correct: a markup ADDS to a cost, a rate IS the charge.
  const n: CostingNode = {
    key: "r", kind: "rate", label: "Duty", value: 10 * 1.05, unit: "usd",
    op: "wrong shape", basis: { label: "Factory cost per unit", value: 10 },
    operands: [pct("pct", 0.05)],
  };
  assert.match(only(n), /10 x 0\.05 = 0\.5, node value is 10\.5/);
});

// ----------------------------------------------------------------- blend

const blendOf = (value: number, weights: number[] | undefined, values: number[]): CostingNode => ({
  key: "b", kind: "blend", label: "Blended", value, unit: "usd",
  op: "Sigma(value x units) / Sigma(units)",
  ...(weights ? { weights } : {}),
  operands: values.map((v, i) => usd("c" + i, v)),
});

test("blend · reconciles a weighted mean", () => {
  // 10 at 1000 units and 20 at 3000 units blends to 17.5, not to 15. The
  // weights are the whole difference, which is why they must be data.
  assert.deepEqual(findGraphViolations(blendOf(17.5, [1000, 3000], [10, 20])), []);
});

test("blend · FAILS when a contributor value is perturbed", () => {
  assert.match(only(blendOf(17.5, [1000, 3000], [10, 21])), /weighted mean is 18\.25, node value is 17\.5/);
});

test("blend · FAILS when a weight is perturbed", () => {
  assert.match(only(blendOf(17.5, [1000, 1000], [10, 20])), /weighted mean is 15, node value is 17\.5/);
});

test("blend · FAILS when a contributor is missing", () => {
  // The weight list still describes three contributors; only two are present.
  // A truncated blend would otherwise reconcile over a subset and report it
  // as correct.
  assert.match(only(blendOf(17.5, [1000, 3000, 1000], [10, 20])), /2 contributors and 3 weights/);
});

test("blend · FAILS when it carries no weights at all", () => {
  assert.match(only(blendOf(15, undefined, [10, 20])), /carries no weights/);
});

test("blend · zero total weight blends to zero, contributors intact", () => {
  assert.deepEqual(findGraphViolations(blendOf(0, [0, 0], [10, 20])), []);
  assert.match(only(blendOf(15, [0, 0], [10, 20])), /weighted mean is 0, node value is 15/);
});
