/**
 * TIER-PREV-1 — the staged preview must show what Apply will produce.
 *
 * Operator reproduction: committed quote-wide 20% with a 10% override on Tier 2;
 * stage a new quote-wide 30%. The staged Price Build showed Tier 2 SURVIVING at
 * 10% / $4.8151. Apply cleared it and committed 30% / $5.6905 — $0.8754/unit on
 * a tier the operator had just reviewed. One set of economics reviewed, another
 * committed.
 *
 * The server clearing rule is the intended authority model and is untouched.
 * What was wrong is that the preview read the operator's INTENT (`working`)
 * where it should read the planned RESULT, and the planner that knows the rule
 * lives server-side.
 *
 * So the preview now asks the same planner. These tests hold that seam shut from
 * both ends: the rule behaves this way for a preview's inputs, and the component
 * gets its tier figures from the plan rather than from the working set.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { planApply } from "../../src/lib/pricing-apply-plan.ts";

const NONE = {
  intendedLifts: new Map<string, string>(),
  intendedOverrides: new Map<string, string>(),
  persistedLifts: new Map<string, string>(),
  persistedOverrides: new Map<string, string>(),
};

const TIER_2 = "tier-2";
const TIER_3 = "tier-3";

/** The derivation the preview performs, over the plan the planner returns. */
function plannedTierAdj(args: {
  committed: Record<string, number>;
  working: Record<string, number>;
  globalFrom: number;
  globalTo: number;
}): Map<string, number> {
  const plan = planApply({
    ...NONE,
    intendedTierAdj: new Map(
      Object.entries(args.working).map(([k, v]) => [k, String(v)]),
    ),
    persistedTierAdj: new Map(
      Object.entries(args.committed).map(([k, v]) => [k, String(v)]),
    ),
    globalAdjFrom: String(args.globalFrom),
    globalAdjTo: String(args.globalTo),
  });
  const out = new Map(Object.entries(args.committed));
  for (const r of plan.tierAdjRemoved) out.delete(r.key);
  for (const s of plan.tierAdjSet) out.set(s.key, Number(s.to));
  return out;
}

test("TIER-PREV-1 — staging a new quote-wide rate previews the tier override GONE", () => {
  // The exact operator reproduction. `working` still carries the override,
  // because the operator did not touch it — which is precisely why reading the
  // working set previewed it surviving.
  const planned = plannedTierAdj({
    committed: { [TIER_2]: 0.1 },
    working: { [TIER_2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.3,
  });
  assert.equal(planned.has(TIER_2), false);
});

test("every tier override clears, not only the ones the operator looked at", () => {
  const planned = plannedTierAdj({
    committed: { [TIER_2]: 0.1, [TIER_3]: 0.45 },
    working: { [TIER_2]: 0.1, [TIER_3]: 0.45 },
    globalFrom: 0.2,
    globalTo: 0.3,
  });
  assert.equal(planned.size, 0);
});

test("a tier set in the SAME staged act as a new global survives it", () => {
  // Clearing is what an unrelated global does to standing overrides. An override
  // the operator staged alongside the global is a decision, not a leftover, and
  // previewing it as cleared would be the same defect pointing the other way.
  const planned = plannedTierAdj({
    committed: {},
    working: { [TIER_2]: 0.15 },
    globalFrom: 0.2,
    globalTo: 0.3,
  });
  assert.equal(planned.get(TIER_2), 0.15);
});

test("with the global unmoved, a standing override is previewed as standing", () => {
  const planned = plannedTierAdj({
    committed: { [TIER_2]: 0.1 },
    working: { [TIER_2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(planned.get(TIER_2), 0.1);
});

test("a staged REMOVAL is still previewed as removed", () => {
  // The property the old direct read did have, which the repair must not lose:
  // unstaging an override has to be visible in the figures before Apply.
  const planned = plannedTierAdj({
    committed: { [TIER_2]: 0.1 },
    working: {},
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(planned.has(TIER_2), false);
});

// ── the seam ──────────────────────────────────────────────────────────────

test("the preview takes its tier figures from the plan, not from the working set", async () => {
  const src = await readFile(
    new URL(
      "../../src/components/pricing-surface/pricing-staging-context.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  // Comments are stripped: this file explains the defect by quoting the shape
  // that caused it, and an instrument that cannot tell prose from code would
  // report the defect present in its own explanation.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  assert.match(code, /planApply\(\{/);
  assert.match(code, /tierPriceAdjPct:[\s\S]{0,80}?plannedTierAdj/);
  // The direct read is what produced TIER-PREV-1.
  assert.doesNotMatch(code, /tierPriceAdjPct:\s*working\.tierAdj/);
  // Clearing semantics are the planner's. Reproducing them here is how the two
  // drift apart again, and drift IS the defect.
  assert.doesNotMatch(code, /tierAdj[\s\S]{0,40}?delete[\s\S]{0,60}?globalAdj/);
});
