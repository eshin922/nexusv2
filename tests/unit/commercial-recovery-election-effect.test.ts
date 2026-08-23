import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import type { QuoteCostingResult } from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import {
  RecoveryPolicyError,
  refusalFor,
  type ChargeElection,
} from "../../src/lib/commercial-recovery/resolve.ts";

// ═══════════════════════════════════════════════════════════════════════
// WHAT AN ELECTION ACTUALLY DOES TO THE CUSTOMER'S TOTAL.
//
// Not what the model says it does — what the projection produces.
//
// ── THE MEASUREMENT THAT PRODUCED THE REFUSAL ────────────────────────────
//
// Before the refusal existed, these ran with a disagreeing election and
// measured the damage on a $1,000 fee at a 1.4 rate:
//
//     included, assembly NOT allocating  ->  $1,400 vanishes from the total
//     separate, assembly IS allocating   ->  $1,400 billed twice
//     absorbed, assembly NOT allocating  ->  $1,400 removed from what the
//                                            customer pays, with NO movement
//                                            in the tier revenue the floor
//                                            gate and the below-floor
//                                            fingerprint are computed from
//
// The election overrides PROJECTION only, and the costing engine decides
// whether a fee sits inside the unit price. So the projection can suppress or
// emit the customer's separate line; it cannot move the charge between the two
// places. Every election that changed anything mis-priced.
//
// Those calls now throw, which is the fix working. The evidence is preserved
// below in a form that cannot rot: the magnitude at stake is measured through
// a path that is still legal, and a TRIPWIRE fails the moment the refusal is
// lifted without the engine having been taught to honour the election.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "11111111-1111-1111-1111-111111111111";
const SETUP = 1000;
const RATE = 1.4;

function bundle(allocate: boolean): HydrateSnapshot {
  const tiers: QuoteCostingResult["tiers"] = [{ tierId: TIER, label: "Tier 1", qty: 1000 }];
  return {
    markupDefaults: { Production: 0.4 },
    skus: [
      { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "Group", canonicalQuoteLeafId: "asm", qtyPerParent: null, sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", canonicalQuoteLeafId: "leaf", qtyPerParent: "1", sortOrder: 0, retailBenchmark: null },
    ],
    production: [
      { quoteSkuId: "leaf", tierId: TIER, allocateServiceFeesToCost: allocate, setupFeeTotal: SETUP },
    ],
    costing: {
      tiers,
      skuRollups: [
        {
          skuId: "leaf",
          canonicalQuoteLeafId: "leaf",
          skuRole: "leaf",
          parentSkuId: "asm",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
          // Held IDENTICAL across both fixtures, which is the real system's
          // behaviour rather than a convenience: the costing engine never sees
          // an election, so nothing it produces can move in response to one.
          perTier: [{ tierId: TIER, requiredSellPerUnit: 1, contributionCostPerUnit: 0.5 }],
        },
      ],
    },
  } as unknown as HydrateSnapshot;
}

const total = (allocate: boolean, elections: ChargeElection[] = []) =>
  projectCommercial(bundle(allocate), elections).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;

const round = (n: number) => Math.round(n * 100) / 100;

// ── the magnitude at stake, measured through a legal path ───────────────

test("the OTC line the election would move is worth exactly the marked-up fee", () => {
  // Legacy boolean only, no elections — both states are correct today.
  // The gap between them is what an election claims to be able to relocate.
  const gap = round(total(false) - total(true));
  assert.equal(gap, SETUP * RATE);
  assert.ok(gap > 0, "allocation OFF should add a separately-billed fee line");
});

// ── the refusal, at the projection boundary ─────────────────────────────

test("a disagreeing election is refused by the projection, not applied", () => {
  for (const [mode, allocate] of [
    ["included", false],
    ["separate", true],
    ["absorbed", false],
    ["absorbed", true],
  ] as const) {
    assert.throws(
      () => total(allocate, [{ chargeKey: "project_setup", mode }]),
      RecoveryPolicyError,
      `${mode} at allocate=${allocate} reached the projection instead of refusing`,
    );
  }
});

test("an election that AGREES with the legacy boolean is exact", () => {
  // The only currently-correct elections are the ones that change nothing —
  // the finding stated as its passing case rather than buried in a comment.
  assert.equal(total(true, [{ chargeKey: "project_setup", mode: "included" }]), total(true));
  assert.equal(total(false, [{ chargeKey: "project_setup", mode: "separate" }]), total(false));
});

// ── the tripwire ────────────────────────────────────────────────────────

test("TRIPWIRE — if the refusal lifts, included and separate must be revenue-neutral", () => {
  // Vacuous today, and deliberately so: it asserts nothing while the refusal
  // stands, and becomes the governing invariant the moment someone lifts it.
  //
  // Written this way because the alternative is a comment saying "remember to
  // check revenue-neutrality when you wire the engine", and a comment does not
  // fail. This does — with the exact number, on the first run after the lift.
  const cases = [
    { allocate: false, mode: "included" as const },
    { allocate: true, mode: "separate" as const },
  ];

  for (const c of cases) {
    const stillRefused =
      refusalFor("project_setup", c.mode, { perAssemblyAllocate: c.allocate }) !== null;
    if (stillRefused) continue;

    const baseline = total(c.allocate);
    const elected = total(c.allocate, [{ chargeKey: "project_setup", mode: c.mode }]);
    assert.equal(
      round(elected),
      round(baseline),
      `The refusal on '${c.mode}' at allocate=${c.allocate} was lifted, but the ` +
        `customer's total still moves by ${round(Math.abs(elected - baseline))}. ` +
        `included <-> separate must be revenue-neutral: the charge has to be ` +
        `MOVED between the unit price and its own line, not added to or removed ` +
        `from one side. The costing engine has to consume the election.`,
    );
  }
});

test("TRIPWIRE — if absorbed opens, its reduction must reach the measured margin", () => {
  // Absorbed is the one mode that is SUPPOSED to move money, so
  // revenue-neutrality is the wrong check for it. What must hold instead is
  // that the reduction is visible to the control that governs it — the tier
  // revenue the floor gate and the below-floor fingerprint read.
  //
  // The projection cannot demonstrate that on its own, so this fails loudly
  // with the instruction rather than pretending to verify it.
  const open =
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: false }) === null ||
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: true }) === null;

  assert.equal(
    open,
    false,
    "`absorbed` was opened. Before this test is deleted, prove that the " +
      "reduction moves quoteRollup.totalRevenue — separately-billed fees are " +
      "recorded by the engine as 'not part of the per-unit sell', so today the " +
      "customer pays less and the measured margin does not move at all.",
  );
});
