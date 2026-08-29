import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";
import { liftToClear } from "../../src/lib/pricing-suggestions.ts";

// ═══════════════════════════════════════════════════════════════════════
// RECOVERY PLACEMENT IS VALUE-INVARIANT.
//
// Edward's commercial disposition, 2026-08-26, settling the question the
// engine had been deferring to him in as many words:
//
//   Electing a governed one-time recovery charge between included and separate
//   may change WHERE the customer sees and pays it, but must not change total
//   customer consideration. A SKU/global/tier pricing lift must not apply to
//   the recovery amount itself merely because that recovery is embedded in a
//   unit-price line.
//
// ── WHAT SOAK RUN 2 MEASURED ────────────────────────────────────────────
//
// On a live quote at `2e3581d`, moving one $1,200 setup fee from the unit
// price to its own line moved the customer's all-in total:
//
//     in unit price   turnkey 16,734.03
//     separate line   turnkey 16,705.98      delta -28.05
//
// Both documents reconciled INTERNALLY. They disagreed with each other, which
// is the shape the standing rule warns about — exact reconciliation is
// necessary but not sufficient.
//
// The gap was the SKU's own lift riding the embedded recovery:
// 1,708.05 / 1,680.00 = 1.0167, exactly that cell's 1.67%.
//
// ── THE TWO PROVENANCES ─────────────────────────────────────────────────
//
// An ELECTED unit-price charge was already invariant: it is added AFTER the
// ladder, so no lever reaches it. A LEGACY one — a fee with no election row,
// which is every charge on every quote that has never been touched — enters as
// cost, is marked up with everything else, and is then carried by the
// adjustment and any lift.
//
// So the asymmetry is not between included and separate. It is between a
// charge someone has elected and one nobody has, and an operator's FIRST
// election is what makes the difference visible — by moving a total that
// should not move.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "22222222-2222-2222-2222-222222222222";
const LEAF_QL = "33333333-3333-3333-3333-333333333333";
const SETUP = 1200;
const RATE = 1.4; // Production markup 0.4 -> governed recovery 1,680
const RECOVERY = SETUP * RATE;
const QTY = 5000;

function input(args: {
  gpa?: number;
  lift?: number | null;
  elections?: ChargeElection[];
  allocate?: boolean;
}): QuoteCostingInput {
  const { gpa = 0, lift = null, elections = [], allocate = true } = args;
  return {
    quote: { id: "quote", globalPriceAdjPct: gpa, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "Group", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const, skuLabel: "L", productName: "Leaf", sortOrder: 0, retailBenchmark: null, canonicalQuoteLeafId: LEAF_QL },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 1.85, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.4,
      },
    ],
    production: [],
    assemblyProduction: [
      {
        assemblyId: "asm", tierId: TIER,
        allocateServiceFeesToCost: allocate,
        setupFeeTotal: SETUP,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    ...(lift === null
      ? {}
      : { lifts: [{ quoteLeafId: LEAF_QL, tierId: TIER, liftPct: lift }] }),
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

/** The customer's all-in total for the tier — what they actually pay. */
function turnkey(args: Parameters<typeof input>[0]): number {
  const i = input(args);
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults,
    skus: i.skus,
    production: i.production,
    assemblyProduction: i.assemblyProduction,
    costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Money equality, at the cent.
 *
 * NOT `cents(a) === cents(b)`: two totals differing by a thousandth of a cent
 * round to different cents when they straddle a boundary, so that form reports
 * a movement where none exists. The claim is that the customer pays the same
 * amount, and a difference below half a cent is not an amount.
 */
function sameMoney(a: number, b: number, why: string) {
  assert.ok(
    Math.abs(a - b) < 0.005,
    `${why}: ${cents(a)} vs ${cents(b)}, delta ${a - b}`,
  );
}

const INCLUDED: ChargeElection[] = [{ chargeKey: "project_setup", mode: "included" }];
const SEPARATE: ChargeElection[] = [{ chargeKey: "project_setup", mode: "separate" }];

// ── THE INVARIANT ───────────────────────────────────────────────────────

test("placement does not move the total — no lever", () => {
  sameMoney(turnkey({ elections: INCLUDED }), turnkey({ elections: SEPARATE }), "placement moved the total");
});

test("placement does not move the total — under a SURGICAL LIFT", () => {
  // The soak's exact shape. Non-zero lift is what made the defect reachable;
  // at lift 0 the two placements coincide and the assertion is vacuous.
  const lift = 0.0167;
  const inc = turnkey({ lift, elections: INCLUDED });
  const sep = turnkey({ lift, elections: SEPARATE });
  sameMoney(inc, sep, "a lift made placement non-neutral");
});

test("placement does not move the total — under a GLOBAL ADJUSTMENT", () => {
  for (const gpa of [0.2, 0.5]) {
    const inc = turnkey({ gpa, elections: INCLUDED });
    const sep = turnkey({ gpa, elections: SEPARATE });
    sameMoney(inc, sep, `gpa ${gpa} made placement non-neutral`);
  }
});

test("placement does not move the total — LEGACY included vs elected separate", () => {
  // THE SOAK'S ACTUAL TRANSITION. The fixture had no election row at all, so
  // the charge was LEGACY, and the operator's first click moved it to an
  // elected separate line. That transition is what moved $28.05.
  const lift = 0.0167;
  const legacyIncluded = turnkey({ lift, allocate: true, elections: [] });
  const electedSeparate = turnkey({ lift, allocate: true, elections: SEPARATE });
  sameMoney(legacyIncluded, electedSeparate, "the operator's first election moved the total");
});

test("placement does not move the total — under BOTH levers at once", () => {
  const inc = turnkey({ gpa: 0.2, lift: 0.05, elections: INCLUDED });
  const sep = turnkey({ gpa: 0.2, lift: 0.05, elections: SEPARATE });
  sameMoney(inc, sep, "both levers together made placement non-neutral");
});

// ── THE LEVER STILL WORKS ───────────────────────────────────────────────
//
// An invariant is trivially satisfiable by making the lever do nothing. These
// are the controls that stop the repair from buying invariance with a dead
// lever — the failure mode that would otherwise pass everything above.

test("CONTROL · product sell still responds to the lift", () => {
  const none = turnkey({ lift: null, elections: INCLUDED });
  const lifted = turnkey({ lift: 0.1, elections: INCLUDED });
  assert.ok(lifted > none, "a 10% lift moved nothing — the lever is dead");
});

test("CONTROL · the lift moves the PRODUCT portion and only that", () => {
  // The product portion is everything except the governed recovery, so a lift
  // of L must move the total by exactly `L x (total - recovery)`.
  const L = 0.1;
  const base = turnkey({ lift: null, elections: INCLUDED });
  const lifted = turnkey({ lift: L, elections: INCLUDED });
  assert.equal(
    cents(lifted - base),
    cents((base - RECOVERY) * L),
    "the lift did not act on exactly the non-recovery portion",
  );
});

test("CONTROL · the recovery amount itself does not respond to the lift", () => {
  // Stated as its own claim rather than inferred from the one above: the
  // separate line is the recovery in isolation, and no lever may touch it.
  for (const lift of [null, 0.0167, 0.5]) {
    const i = input({ lift, elections: SEPARATE });
    const costing = computeQuoteCosting(i);
    const bundle = {
      markupDefaults: i.markupDefaults, skus: i.skus,
      production: i.production,
      assemblyProduction: i.assemblyProduction, costing,
    } as unknown as HydrateSnapshot;
    const tier = projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!;
    assert.equal(cents(tier.otcSubtotal), cents(RECOVERY), `lift ${lift} moved the separate line`);
  }
});

test("CONTROL · the global adjustment still moves the product", () => {
  assert.ok(
    turnkey({ gpa: 0.5, elections: INCLUDED }) > turnkey({ gpa: 0, elections: INCLUDED }),
    "a 50% adjustment moved nothing",
  );
});

// ── THE SOLVER MUST FOLLOW THE ARITHMETIC ───────────────────────────────
//
// OD-023 is the precedent and the warning: holding a component out of the
// lever basis without teaching the RECOMMENDATION about it left "Lift to
// floor" short by exactly `component x lift`. The same trap is one line away
// here, so the solve is asserted, not assumed.

test("liftToClear solves against a fixed addend rather than the whole sell", () => {
  // sell = (S - R)(1 + L) + R, so clearing to `required` needs
  // L = (required - R)/(S - R) - 1 — NOT `required/S - 1`.
  const S = 4.0;   // current cell sell, per unit
  const R = 0.336; // governed recovery inside it, per unit
  const cost = 3.2;
  const floor = 0.25;
  const required = cost / (1 - floor); // 4.2666…

  const L = liftToClear(S, cost, floor, R);
  assert.ok(L !== null, "no lift offered for a below-floor cell");

  const achieved = (S - R) * (1 + L!) + R;
  assert.ok(
    achieved >= required - 1e-9,
    `the offered lift lands at ${achieved}, short of the ${required} it promised`,
  );

  // Non-vacuous: the naive solve would NOT have cleared it.
  const naive = S * (1 + (required / S - 1));
  const naiveAchieved = (S - R) * (1 + (required / S - 1)) + R;
  assert.ok(
    naiveAchieved < required - 1e-9,
    `the naive solve already clears — the fixture cannot express the failure (naive ${naive})`,
  );
});

test("liftToClear with no recovery is unchanged", () => {
  // The whole existing estate passes zero here. Same answer as before, or the
  // repair is a silent change to every cell that carries no recovery.
  assert.equal(liftToClear(4, 3.2, 0.25, 0), liftToClear(4, 3.2, 0.25));
});
