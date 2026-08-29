import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import { measureRecoveryImpact } from "../../src/lib/commercial-recovery/impact.ts";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

const TIER = "11111111-1111-1111-1111-111111111111";
const SETUP = 1000;
const RATE = 1.4;

function input(opts: {
  gpa?: number;
  allocate?: boolean;
  elections?: ChargeElection[];
  override?: number;
  /** Fee amount, so a control can vary the one thing that must move. */
  setup?: number;
}): QuoteCostingInput {
  return {
    quote: {
      id: "quote",
      globalPriceAdjPct: opts.gpa ?? 0.2,
      targetMarginPct: null,
    },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: opts.elections ?? [],
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "Group", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const, skuLabel: "L", productName: "Leaf", sortOrder: 0, retailBenchmark: null },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 1, qtyPerSellableUnit: 1, category: "Production", markupPct: 0,
      },
    ],
    production: [],
    assemblyProduction: [
      {
        assemblyId: "asm", tierId: TIER,
        allocateServiceFeesToCost: opts.allocate ?? true,
        setupFeeTotal: opts.setup ?? SETUP,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides:
      opts.override === undefined
        ? []
        : [{ quoteSkuId: "leaf", tierId: TIER, sellPriceOverride: opts.override }],
    cellTargets: [],
  } satisfies QuoteCostingInput;
}

/** The customer's total, computed independently of the module under test. */
function total(i: QuoteCostingInput): number {
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults, skus: i.skus,
    production: i.production,
    assemblyProduction: i.assemblyProduction, costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.reduce(
    (a, t) => a + t.tierCommercialTotal,
    0,
  );
}
const r2 = (n: number) => Math.round(n * 100) / 100;
/** The precision a customer total is printed at, and compared at. */
const cents = (n: number) => Math.round(n * 100);

// ═══════════════════════════════════════════════════════════════════════
// THE FIGURE IS THE ENGINE'S, MEASURED AGAINST AN INDEPENDENT RUN.
// ═══════════════════════════════════════════════════════════════════════

test("the measured before and after are the engine's own totals", () => {
  const base = input({ allocate: true });
  const m = measureRecoveryImpact(base, "project_setup", "included")!;

  // Compared against a total this test computes for itself. Asserting only
  // "after !== before" would pass on any two numbers.
  assert.equal(m.customerTotalBefore, total(base));
  assert.equal(
    m.customerTotalAfter,
    total(input({ allocate: true, elections: [{ chargeKey: "project_setup", mode: "included" }] })),
  );
});

test("INVERSE REGRESSION · electing on a legacy-allocated quote moves NOTHING", () => {
  // ── THIS TEST USED TO ASSERT THE OPPOSITE, AND WAS RIGHT TO ─────────────
  //
  // It read "electing on a legacy-allocated quote MOVES the total, by the
  // ladder", and asserted the movement was exactly `recovery x 0.20` — the
  // quote adjustment reaching a legacy charge that an elected one escaped. That
  // was a faithful description of the engine, and the engine's own comments
  // named the asymmetry and deferred the question to Edward explicitly.
  //
  // He settled it on 2026-08-26: recovery placement is value-invariant, and a
  // price lever must not reach the recovery amount merely because it is
  // embedded. So the assertion is inverted rather than deleted — the movement
  // it measured is precisely what must no longer happen, and a deleted test
  // would leave nothing watching the boundary it was standing on.
  //
  // Soak run 2 is what made this concrete: an operator's FIRST election moved a
  // live customer total by $28.05.
  const m = measureRecoveryImpact(input({ allocate: true }), "project_setup", "included")!;
  assert.equal(
    r2(m.customerTotalAfter),
    r2(m.customerTotalBefore),
    "electing a legacy charge moved the customer total",
  );

  // The governed amount is unchanged by any of this — it was never the thing
  // in dispute. What changed is that nothing multiplies it any more.
  assert.equal(m.governedRecovery, SETUP * RATE);
  assert.equal(m.perUnit, (SETUP * RATE) / 1000);
  assert.equal(m.tierQuantity, 1000);

  // NON-VACUITY. The old test proved its instrument could see a movement by
  // seeing one. This one asserts equality, so it needs the opposite proof: the
  // same measurement on the same path DOES move when something real changes.
  const dearer = measureRecoveryImpact(
    input({ allocate: true, setup: SETUP * 2 }),
    "project_setup",
    "included",
  )!;
  assert.notEqual(cents(dearer.customerTotalBefore), cents(m.customerTotalBefore));
});

test("relocating between two ELECTED contracts moves nothing", () => {
  const elected = input({
    allocate: true,
    elections: [{ chargeKey: "project_setup", mode: "included" }],
  });
  const m = measureRecoveryImpact(elected, "project_setup", "separate")!;

  // Neutral to the CENT, which is what a customer total is.
  //
  // Not bit-for-bit, and the difference is worth being precise about. The
  // constructor's placement-independence IS exact — it sums the charges in a
  // fixed order regardless of placement, so no subtraction is trusted. The
  // customer TOTAL is then summed through the projection, where the unit and
  // one-time subtotals arrive in a different order on each side, and float
  // addition is not associative: 2600 against 2599.9999999999995.
  //
  // Asserting exact equality here would have been asserting a property of
  // IEEE-754 summation order rather than of the contract. It also surfaced a
  // real defect in the surface, which compared the two exactly and rendered a
  // 4.5e-13 artifact as a movement, emphasised, beside two identical printed
  // figures.
  assert.equal(cents(m.customerTotalAfter), cents(m.customerTotalBefore));

  // Where the exactness DOES belong: the charge's own governed recovery is the
  // same value in both placements, bit-for-bit, because one value is placed in
  // one bucket rather than added on one side and subtracted from the other.
  const other = measureRecoveryImpact(elected, "project_setup", "included")!;
  assert.equal(m.governedRecovery, other.governedRecovery);
  assert.equal(m.governedRecovery, SETUP * RATE);

  // NON-VACUITY, REWRITTEN. This used to point at the legacy comparison and
  // assert that IT moved — a fair guard while legacy recovery rode the pricing
  // ladder and elected recovery did not. Value-invariance removed that
  // difference deliberately (Edward, 2026-08-26), so the old guard now asserts
  // the very defect the repair fixed.
  //
  // The guard still has to exist, or cent-rounding could be hiding everything
  // and nothing here would say so. Rearmed against a movement that IS real: a
  // larger fee recovers more, whatever its placement.
  const dearer = measureRecoveryImpact(
    input({ allocate: true, elections: [{ chargeKey: "project_setup", mode: "included" }], setup: SETUP * 2 }),
    "project_setup",
    "separate",
  )!;
  assert.notEqual(cents(dearer.customerTotalBefore), cents(m.customerTotalBefore));
  assert.equal(dearer.governedRecovery, SETUP * 2 * RATE);
});

test("clearing back to legacy restores the legacy total exactly", () => {
  const elected = input({
    allocate: true,
    elections: [{ chargeKey: "project_setup", mode: "included" }],
  });
  const m = measureRecoveryImpact(elected, "project_setup", null)!;
  // Bit-for-bit, not rounded: the negative proof is that legacy is restored,
  // not approximated.
  assert.equal(m.customerTotalAfter, total(input({ allocate: true })));
  assert.equal(m.mode, null, "the cleared case reports a mode it does not have");
});

// ═══════════════════════════════════════════════════════════════════════
// WHY A CLOSED FORM WOULD HAVE BEEN WRONG.
//
// "recovery x gpa" is the delta in the ordinary case, and it is tempting. Under
// a TERMINAL cell override the override replaces the rung beneath it, so the
// recovery never reaches the unit price from either side — and the formula
// would report a movement the engine does not.
// ═══════════════════════════════════════════════════════════════════════

test("under a terminal override the formula and the engine disagree", () => {
  const base = input({ allocate: true, override: 5 });
  const m = measureRecoveryImpact(base, "project_setup", "included")!;

  const formulaDelta = SETUP * RATE * 0.2; // what "recovery x gpa" would claim
  const measuredDelta = m.customerTotalBefore - m.customerTotalAfter;

  assert.notEqual(
    r2(measuredDelta),
    r2(formulaDelta),
    `the formula happens to agree here (measured ${r2(measuredDelta)} vs formula ${r2(formulaDelta)}) — this fixture no longer demonstrates the hazard`,
  );
  // And the measurement is not trivially zero on both sides: the override
  // fixture has to be a real quote for the disagreement to mean anything.
  assert.notEqual(m.customerTotalBefore, 0);
  assert.notEqual(m.customerTotalAfter, 0);
  // The engine is the authority, and this is what it says.
  assert.equal(m.customerTotalBefore, total(base));
  assert.equal(
    m.customerTotalAfter,
    total(input({
      allocate: true, override: 5,
      elections: [{ chargeKey: "project_setup", mode: "included" }],
    })),
  );
});

// ═══════════════════════════════════════════════════════════════════════
// THE MEASUREMENT DOES NOT DISTURB WHAT IT MEASURES.
// ═══════════════════════════════════════════════════════════════════════

test("the caller's input is not mutated", () => {
  const base = input({ allocate: true });
  const snapshot = JSON.stringify(base);
  measureRecoveryImpact(base, "project_setup", "included");
  assert.equal(
    JSON.stringify(base),
    snapshot,
    "the input moved under the caller — the 'before' figure would describe a state that no longer exists",
  );
});

test("a charge the quote does not carry measures nothing", () => {
  // Null, not a zero-delta impact. A zero delta would say "electing this
  // changes nothing", which is a different claim from "there is nothing here".
  assert.equal(
    measureRecoveryImpact(input({ allocate: true }), "tooling", "separate"),
    null,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// STRUCTURE: NO SECOND AUTHORITY FOR THE LADDER OR THE RATE.
// ═══════════════════════════════════════════════════════════════════════

test("the impact module resolves no rate and reimplements no ladder", async () => {
  const src = codeOnly(
    await readFile(
      new URL("../../src/lib/commercial-recovery/impact.ts", import.meta.url),
      "utf8",
    ),
  );
  for (const forbidden of [/resolveMarkupStrict/, /MARKUP_CATEGORY/, /1 \+ /, /globalPriceAdjPct/]) {
    assert.doesNotMatch(src, forbidden, `the impact module derives ${forbidden}`);
  }
  // It gets the answer the only way that keeps one authority: run the engine.
  assert.match(src, /computeQuoteCosting\(/);
  assert.match(src, /projectCommercial\(/);
});

test("the per-unit basis is suppressed when instances disagree", async () => {
  // Guarding a real defect: nulling `perUnit` on disagreement is not enough,
  // because the next matching instance finds it null and re-sets it — so
  // [0.14, 0.20, 0.14] would report 0.14 as agreed.
  const src = codeOnly(
    await readFile(
      new URL("../../src/lib/commercial-recovery/impact.ts", import.meta.url),
      "utf8",
    ),
  );
  assert.match(src, /basisDisagreed/);
  assert.match(src, /perUnit === null && !basisDisagreed/);
});
