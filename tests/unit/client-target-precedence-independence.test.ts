/**
 * Target precedence and pricing precedence are independent.
 *
 * Two `tier ?? common` rules now run on the same quote and can name the same
 * tier:
 *
 *   CLIENT TARGET   tier target ?? common target      — what the client asked
 *   PRICING         tier adjustment ?? quote-wide     — what we decided
 *
 * They rhyme, which is exactly the risk: the same shape twice invites one to be
 * implemented in terms of the other, or a surface to resolve one and reuse the
 * answer for both. Nothing in the design connects them — a benchmark enters no
 * arithmetic and an adjustment names no benchmark — so the property to hold is
 * that moving either leaves the other untouched.
 *
 * THE CASE THE DISPOSITION NAMES: one sellable unit carrying
 *   · a common client target,
 *   · a tier-specific client target on tier T, and
 *   · a pricing tier override on that same tier T.
 *
 * If the two precedences were entangled, T is where it would show.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clientTargetFacts,
  indexClientTargets,
  resolveClientTarget,
} from "../../src/lib/client-target.ts";
import { planApply } from "../../src/lib/pricing-apply-plan.ts";

const UNIT = "asy-1";
const T1 = "tier-1";
const T2 = "tier-2";
const T3 = "tier-3";

/** Common $5.00, with T2 overridden to $4.60. */
const targets = indexClientTargets([
  { assemblyId: UNIT, quoteLeafId: null, tierId: null, clientTargetPricePerUnit: 5 },
  { assemblyId: UNIT, quoteLeafId: null, tierId: T2, clientTargetPricePerUnit: 4.6 },
]);

/** Quote-wide 20%, with T2 overridden to 10% — the same tier. */
const NONE = {
  intendedLifts: new Map<string, string>(),
  intendedOverrides: new Map<string, string>(),
  persistedLifts: new Map<string, string>(),
  persistedOverrides: new Map<string, string>(),
};
const plannedPricing = (args: {
  intended: Record<string, number>;
  persisted: Record<string, number>;
  globalFrom: number;
  globalTo: number;
}) => {
  const plan = planApply({
    ...NONE,
    intendedTierAdj: new Map(
      Object.entries(args.intended).map(([k, v]) => [k, String(v)]),
    ),
    persistedTierAdj: new Map(
      Object.entries(args.persisted).map(([k, v]) => [k, String(v)]),
    ),
    globalAdjFrom: String(args.globalFrom),
    globalAdjTo: String(args.globalTo),
  });
  const out = new Map(Object.entries(args.persisted));
  for (const r of plan.tierAdjRemoved) out.delete(r.key);
  for (const st of plan.tierAdjSet) out.set(st.key, Number(st.to));
  return out;
};

// ── the named case ────────────────────────────────────────────────────────

test("on the tier carrying BOTH overrides, each resolves from its own rule", () => {
  // Client target on T2: the tier's own, not the common one.
  assert.deepEqual(resolveClientTarget(targets.get(UNIT), T2), {
    value: 4.6,
    source: "tier",
  });
  // Pricing on T2: the tier's own, not the quote-wide one.
  const pricing = plannedPricing({
    intended: { [T2]: 0.1 },
    persisted: { [T2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(pricing.get(T2), 0.1);
  // And neither answer came from the other: a 10% adjustment and a $4.60
  // target share a tier and nothing else.
  assert.notEqual(resolveClientTarget(targets.get(UNIT), T2).value, 0.1);
});

test("a tier with only ONE of the two overrides inherits the other", () => {
  // T1 has neither: common target, quote-wide adjustment.
  assert.equal(resolveClientTarget(targets.get(UNIT), T1).source, "common");
  const pricing = plannedPricing({
    intended: { [T2]: 0.1 },
    persisted: { [T2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(pricing.has(T1), false, "T1 follows the quote-wide rate");
});

// ── moving one must not move the other ────────────────────────────────────

test("clearing the client target on T2 leaves the pricing override standing", () => {
  const cleared = indexClientTargets([
    { assemblyId: UNIT, quoteLeafId: null, tierId: null, clientTargetPricePerUnit: 5 },
  ]);
  assert.deepEqual(resolveClientTarget(cleared.get(UNIT), T2), {
    value: 5,
    source: "common",
  });
  // The pricing plan is computed from pricing inputs alone; no client-target
  // value appears in it at any point.
  const pricing = plannedPricing({
    intended: { [T2]: 0.1 },
    persisted: { [T2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(pricing.get(T2), 0.1);
});

test("a new quote-wide adjustment clears the pricing override and NOT the target", () => {
  // The governed clearing rule: a global Apply removes standing tier
  // adjustments. It has no reach into client targets — a different table, a
  // different authority, and one the operator set on Setup.
  const pricing = plannedPricing({
    intended: { [T2]: 0.1 },
    persisted: { [T2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.3,
  });
  assert.equal(pricing.has(T2), false, "the pricing override is cleared");
  assert.deepEqual(
    resolveClientTarget(targets.get(UNIT), T2),
    { value: 4.6, source: "tier" },
    "the client target is untouched by a pricing act",
  );
});

test("clearing the COMMON target does not disturb pricing at any tier", () => {
  const onlyTier = indexClientTargets([
    { assemblyId: UNIT, quoteLeafId: null, tierId: T2, clientTargetPricePerUnit: 4.6 },
  ]);
  assert.equal(resolveClientTarget(onlyTier.get(UNIT), T1).value, null);
  assert.equal(resolveClientTarget(onlyTier.get(UNIT), T2).value, 4.6);
  const pricing = plannedPricing({
    intended: { [T2]: 0.1 },
    persisted: { [T2]: 0.1 },
    globalFrom: 0.2,
    globalTo: 0.2,
  });
  assert.equal(pricing.get(T2), 0.1);
  assert.equal(pricing.has(T1), false);
});

// ── the gap composes them without merging them ────────────────────────────

test("the gap subtracts a priced number from a benchmark, and changes neither", () => {
  // Base $4.00. T2 carries a 10% pricing override → $4.40; its own target is
  // $4.60, so T2 is $0.20 BELOW the client's number.
  const t2 = clientTargetFacts({
    target: resolveClientTarget(targets.get(UNIT), T2).value,
    quotedSellPerUnit: 4 * 1.1,
    costPerUnit: 2,
  });
  assert.ok(Math.abs(t2!.gapAbs! + 0.2) < 1e-9);

  // T3 follows both defaults: common $5.00 target, quote-wide 20% → $4.80, so
  // $0.20 below. Same magnitude as T2 by arithmetic coincidence — and reached
  // through four independent resolutions, which is the point.
  const t3 = clientTargetFacts({
    target: resolveClientTarget(targets.get(UNIT), T3).value,
    quotedSellPerUnit: 4 * 1.2,
    costPerUnit: 2,
  });
  assert.equal(resolveClientTarget(targets.get(UNIT), T3).source, "common");
  assert.ok(Math.abs(t3!.gapAbs! + 0.2) < 1e-9);
});

// ── no structural entanglement ────────────────────────────────────────────

test("neither module imports the other", async () => {
  // The strongest guarantee available without running both engines: the
  // client-target rule cannot consult a pricing lever, and the pricing planner
  // cannot consult a benchmark, because neither can see the other's code.
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const src = (rel: string) =>
    readFile(fileURLToPath(new URL(`../../src/lib/${rel}`, import.meta.url)), "utf8");

  const target = await src("client-target.ts");
  assert.doesNotMatch(target, /pricing-apply-plan|tierPriceAdj|globalAdj/);

  const plan = await src("pricing-apply-plan.ts");
  assert.doesNotMatch(plan, /client-target|clientTarget|client_target/);
});
