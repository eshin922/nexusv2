/**
 * Recommendations respect pricing authority, and never write a no-op row.
 *
 *   global operator adjustment      -> global
 *   global recommendation           -> global
 *   explicit tier adjustment        -> tier
 *   surgical/per-tier recommendation-> tier
 *   no-op recommendation            -> no write
 *
 * ZERO IS NOT REDEFINED. An operator-authored tier 0% suppresses the quote-wide
 * adjustment for that tier and stays in force; what is refused is manufacturing
 * one from a recommendation that proposed no economic change.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  planGlobalRecommendation,
  planSurgicalRecommendation,
} from "../../src/lib/pricing-recommendation-stage.ts";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("effective 0 + suggested 0 stages NOTHING", () => {
  // The exact live state: right after a global Apply clears tier rates, the
  // effective rate is the global and a stale suggestion composes to the same
  // number. This wrote 0.0000 on four tiers and suppressed a 300% global.
  assert.deepEqual(planSurgicalRecommendation("t1", 0, 0), { kind: "none" });
  assert.deepEqual(planGlobalRecommendation(0, 0), { kind: "none" });
});

test("effective NONZERO + suggested 0 stages nothing either", () => {
  // Composition is multiplicative, so a zero lift returns the rate unchanged.
  // Staging it would rewrite a tier's existing rate as a "change" and, on a
  // tier that had none, invent one.
  assert.deepEqual(planSurgicalRecommendation("t1", 0.4, 0), { kind: "none" });
  assert.deepEqual(planGlobalRecommendation(0.4, 0), { kind: "none" });
});

test("a genuinely changing surgical recommendation DOES write its tier rate", () => {
  // The guard must not swallow real recommendations. (1 + 0.4)(1 + 0.1) - 1.
  assert.deepEqual(planSurgicalRecommendation("t3", 0.4, 0.1), {
    kind: "tier",
    tierId: "t3",
    adjPct: 0.54,
  });
  // Composed against the tier's EFFECTIVE rate, so a tier inheriting the
  // global is lifted from where it stands rather than from zero.
  assert.notDeepEqual(
    planSurgicalRecommendation("t3", 0.4, 0.1),
    planSurgicalRecommendation("t3", 0, 0.1),
  );
});

test("a global recommendation moves the GLOBAL, never per-tier rows", () => {
  const plan = planGlobalRecommendation(0.1, 0.2);
  assert.equal(plan.kind, "global");
  assert.equal((plan as { adjPct: number }).adjPct, 0.32); // (1.1)(1.2) - 1
  // There is no shape in which this returns a tier. Asserted on the type's
  // behaviour rather than trusted from the name.
  for (const lift of [-0.5, 0.001, 5]) {
    const p = planGlobalRecommendation(0.1, lift);
    assert.notEqual(p.kind, "tier", `lift ${lift} must not produce a tier row`);
  }
});

test("a lift too small to store is not a change", () => {
  // Storage scale is four decimals. A lift that rounds away would otherwise
  // write a row recording no movement.
  assert.deepEqual(planGlobalRecommendation(0.1, 1e-9), { kind: "none" });
  assert.deepEqual(planSurgicalRecommendation("t1", 0.1, 1e-9), { kind: "none" });
});

test("the component delegates and does not compose per-tier for a global", () => {
  // The fan-out was a loop over every tier in the shell. Its absence is the
  // repair, so its absence is what gets asserted — comments stripped first,
  // since the rationale describes the loop it removed.
  const shell = stripComments(
    readFileSync("src/components/pricing-surface/pricing-surface-shell.tsx", "utf8"),
  );
  assert.doesNotMatch(
    shell,
    /for \(const tierUuid of idMap\.numericToUuid\.values\(\)\)[\s\S]{0,200}?stageTierAdj/,
    "a global recommendation must not fan out into per-tier rows",
  );
  assert.match(shell, /planGlobalRecommendation\(committed\.globalAdj, sugg\.global\.lift_pct\)/);
  assert.match(shell, /if \(global\.kind === "global"\) stageGlobalAdj\(global\.adjPct\);/);
  // Surgical still stages a tier, and only when the plan says so.
  assert.match(shell, /if \(surgical\.kind === "tier"\) stageTierAdj\(/);
  // And the raw composition is no longer called at the staging site — the
  // decision, including the no-op guard, lives in the pure module.
  assert.doesNotMatch(shell, /stageTierAdj\([\s\S]{0,80}?composePricingAdjustment/);
});

test("an explicitly authored tier 0 is still a lever, and this module never erases one", () => {
  // Behavioural, not a grep — the first version searched the source for "null"
  // and matched its own comment saying zero is not null. The property that
  // matters is that no INPUT produces an output which clears a rate: every
  // result is either a rate to stage or nothing at all.
  for (const effective of [0, 0.0001, 0.25, 1, 3, -0.2]) {
    for (const lift of [-0.9, -0.25, 0, 1e-9, 0.1, 2]) {
      for (const plan of [
        planSurgicalRecommendation("t", effective, lift),
        planGlobalRecommendation(effective, lift),
      ]) {
        assert.ok(
          plan.kind === "none" || typeof (plan as { adjPct: number }).adjPct === "number",
          `unexpected shape for (${effective}, ${lift}): ${JSON.stringify(plan)}`,
        );
        if (plan.kind !== "none") {
          assert.notEqual((plan as { adjPct: number | null }).adjPct, null);
        }
      }
    }
  }
  // A recommendation ON a tier already at 0 that genuinely lifts it still works.
  assert.deepEqual(planSurgicalRecommendation("t2", 0, 0.25), {
    kind: "tier",
    tierId: "t2",
    adjPct: 0.25,
  });
});
