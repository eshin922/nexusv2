/**
 * OD-032 phase 2 — component-owned charges, as the engine sees them.
 *
 * Phase 2 is storage, registry and costing input. No UI, no customer document.
 * So what has to be proved is that a charge an operator will one day hang off a
 * carton reaches the engine as EXACTLY the amount they entered, once, and that
 * nothing on the way in or out is able to move it.
 *
 * ── THE FIXTURE IS BUILT TO BE ABLE TO FAIL ─────────────────────────────
 *
 * A component that appears THREE TIMES per finished good, borrowed from
 * `recovery-dimension-qty-per-parent`. `qtyPerParent = 1` is the coincidence
 * that hides this entire class of defect: at 1 a fixed amount and a scaled one
 * are the same number, and every assertion below would pass against an
 * implementation that multiplies. At 3 they are different numbers.
 *
 * Every assertion reads a customer-payable total or a governed economics row.
 * None reads the emitter, so none can be satisfied by an implementation that
 * merely looks right.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type ComponentChargeInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";
import {
  COMPONENT_CHARGE_KEYS,
  isComponentChargeKey,
  labelRequiredFor,
} from "../../src/lib/commercial-recovery/registry.ts";

const TIER = "44444444-4444-4444-4444-444444444444";
const TIER_B = "66666666-6666-6666-6666-666666666666";
const LEAF_QL = "55555555-5555-5555-5555-555555555555";
const LEAF_QL_2 = "77777777-7777-7777-7777-777777777777";

const QTY_PER_PARENT = 3;
const TIER_QTY = 1000;
const UNIT_COST = 2;

/** What the operator entered against the carton. Not derived from anything. */
const PLATES = 1450;

function charge(over: Partial<ComponentChargeInput> = {}): ComponentChargeInput {
  return {
    chargeInstanceId: "ci-1",
    tierId: TIER,
    chargeKey: "print_plates",
    ownerRef: LEAF_QL,
    cost: PLATES,
    recoverableSell: PLATES,
    ...over,
  };
}

function input(args: {
  componentCharges?: ComponentChargeInput[];
  lift?: number | null;
  gpa?: number;
  tierAdj?: number | null;
  elections?: ChargeElection[];
  unitCost?: number;
  secondLeaf?: boolean;
  tiers?: { id: string; qty: number }[];
}): QuoteCostingInput {
  const {
    componentCharges = [],
    lift = null,
    gpa = 0,
    tierAdj = null,
    elections = [],
    unitCost = UNIT_COST,
    secondLeaf = false,
    tiers = [{ id: TIER, qty: TIER_QTY }],
  } = args;

  const leaves = [
    {
      id: "leaf",
      parentSkuId: "asm",
      qtyPerParent: QTY_PER_PARENT,
      skuRole: "leaf" as const,
      skuLabel: "L",
      productName: "Carton",
      sortOrder: 0,
      retailBenchmark: null,
      canonicalQuoteLeafId: LEAF_QL,
    },
    ...(secondLeaf
      ? [
          {
            id: "leaf2",
            parentSkuId: "asm",
            qtyPerParent: 1,
            skuRole: "leaf" as const,
            skuLabel: "L2",
            productName: "Sleeve",
            sortOrder: 1,
            retailBenchmark: null,
            canonicalQuoteLeafId: LEAF_QL_2,
          },
        ]
      : []),
  ];

  return {
    quote: { id: "quote", globalPriceAdjPct: gpa, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    componentCharges,
    skus: [
      {
        id: "asm",
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "assembly" as const,
        skuLabel: "IG",
        productName: "Finished good",
        sortOrder: 0,
        retailBenchmark: null,
      },
      ...leaves,
    ],
    tiers: tiers.map((t, i) => ({
      id: t.id,
      label: `Tier ${i + 1}`,
      qty: t.qty,
      sortOrder: i,
      tierPriceAdjPct: tierAdj,
    })),
    packaging: leaves.flatMap((l) =>
      tiers.map((t) => ({
        quoteSkuId: l.id,
        tierId: t.id,
        lineGroupId: `pkg-${l.id}`,
        unitCost,
        qtyPerSellableUnit: 1,
        category: "Production",
        markupPct: 0.4,
      })),
    ),
    production: leaves.flatMap((l) =>
      tiers.map((t) => ({
        quoteSkuId: l.id,
        tierId: t.id,
        allocateServiceFeesToCost: true,
        setupFeeTotal: null,
        toolingArtworkTotal: null,
        toolingTotal: null,
        artworkTotal: null,
        rdTotal: null,
        testingMicrosTotal: null,
        otherServiceTotal: null,
        fillingBlendingCost: null,
        cmAssemblyTotal: null,
        bulkRawCost: null,
        actualUnitsProduced: null,
      })),
    ),
    ...(lift === null
      ? {}
      : { lifts: [{ quoteLeafId: LEAF_QL, tierId: TIER, liftPct: lift }] }),
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
  } as unknown as QuoteCostingInput;
}

/** What the customer pays for the tier, all in. */
function turnkey(args: Parameters<typeof input>[0], tierId = TIER): number {
  const i = input(args);
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults,
    skus: i.skus,
    production: i.production,
    costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.find((t) => t.tierId === tierId)!
    .tierCommercialTotal;
}

/**
 * Every component-owned economics row, READ AT THE AUTHORITATIVE LEVEL.
 *
 * TOP-LEVEL RECORDS ONLY, which is not a convenience — it is where the engine
 * itself reads them. A leaf's economics are carried up to its assembly
 * "CONCATENATED, NOT SCALED... because the tier rollup reads TOP-LEVEL records
 * only", so the same row is legitimately present at both levels and walking
 * every rollup counts it twice.
 *
 * That duplication is an artefact of ENUMERATION, not of emission, and the
 * money assertions are what establish which: F7 measures a customer-payable
 * total and finds the charge contributed exactly once. Had the amount actually
 * been emitted twice, that test fails and no accessor could hide it.
 */
function componentEconomics(args: Parameters<typeof input>[0]) {
  const i = input(args);
  const topLevel = new Set(
    (i.skus as unknown as { id: string; parentSkuId: string | null }[])
      .filter((s) => s.parentSkuId === null)
      .map((s) => s.id),
  );
  return computeQuoteCosting(i)
    .skuRollups.filter((r) => topLevel.has(r.skuId))
    .flatMap((r) => r.perTier)
    .flatMap((pt) => pt.chargeEconomics ?? [])
    .filter((e) => e.ownerKind === "component");
}

const cents = (n: number) => Math.round(n * 100) / 100;
function sameMoney(a: number, b: number, why: string) {
  assert.ok(
    Math.abs(a - b) < 0.005,
    `${why}: ${cents(a)} vs ${cents(b)}, delta ${a - b}`,
  );
}

const INCLUDED: ChargeElection[] = [
  { chargeKey: "print_plates", mode: "included" },
];
const SEPARATE: ChargeElection[] = [
  { chargeKey: "print_plates", mode: "separate" },
];

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 7 · exactly once per tier, never times component quantity
// ══════════════════════════════════════════════════════════════════════

test("F7 · a component charge contributes EXACTLY its stated amount, once", () => {
  const withCharge = turnkey({
    componentCharges: [charge()],
    elections: INCLUDED,
  });
  const without = turnkey({ componentCharges: [], elections: INCLUDED });

  sameMoney(
    withCharge - without,
    PLATES,
    `contributed ${cents(withCharge - without)} where the operator entered ${PLATES}`,
  );

  // NON-VACUOUS, twice over. A filter that never matches would make the
  // difference ZERO and prove nothing here; a scaling implementation would
  // make it a number the fixture can distinguish.
  assert.ok(
    withCharge - without > 0,
    "the charge reached the engine at all — a never-matching owner filter " +
      "would contribute nothing while every surface reported it as elected",
  );
  assert.notEqual(
    cents(PLATES),
    cents(PLATES * QTY_PER_PARENT),
    "the fixture cannot express the failure — is qtyPerParent 1?",
  );
});

test("F7 · not multiplied by qtyPerParent — stated directly", () => {
  const contributed =
    turnkey({ componentCharges: [charge()], elections: INCLUDED }) -
    turnkey({ componentCharges: [], elections: INCLUDED });

  assert.ok(
    Math.abs(contributed - PLATES * QTY_PER_PARENT) > 1,
    `scaled by qtyPerParent: ${cents(contributed)} = ${PLATES} x ${QTY_PER_PARENT}`,
  );
  assert.ok(
    Math.abs(contributed - PLATES * TIER_QTY) > 1,
    `scaled by tier quantity: ${cents(contributed)} = ${PLATES} x ${TIER_QTY}`,
  );
});

test("F7 · CONTROL · component COST still scales by qtyPerParent", () => {
  // The other half of the dimension. An implementation that stopped scaling
  // everything would satisfy both assertions above and be catastrophically
  // wrong.
  const base = turnkey({ unitCost: UNIT_COST, elections: INCLUDED });
  const dearer = turnkey({ unitCost: UNIT_COST + 1, elections: INCLUDED });

  sameMoney(
    dearer - base,
    1 * 1.4 * QTY_PER_PARENT * TIER_QTY,
    "component cost stopped scaling by qtyPerParent",
  );
});

test("F7 · per-tier economics are independent, not shared", () => {
  const tiers = [
    { id: TIER, qty: TIER_QTY },
    { id: TIER_B, qty: TIER_QTY * 5 },
  ];
  // The operator entered a DIFFERENT amount for tier 2. Nothing derives one
  // from the other: division is the operator's statement, not a calculation.
  const charges = [
    charge({ chargeInstanceId: "ci", tierId: TIER }),
    charge({
      chargeInstanceId: "ci",
      tierId: TIER_B,
      cost: 900,
      recoverableSell: 900,
    }),
  ];

  const t1 =
    turnkey({ componentCharges: charges, elections: INCLUDED, tiers }, TIER) -
    turnkey({ componentCharges: [], elections: INCLUDED, tiers }, TIER);
  const t2 =
    turnkey({ componentCharges: charges, elections: INCLUDED, tiers }, TIER_B) -
    turnkey({ componentCharges: [], elections: INCLUDED, tiers }, TIER_B);

  sameMoney(t1, PLATES, "tier 1 did not receive its own entered amount");
  sameMoney(t2, 900, "tier 2 did not receive its own entered amount");
  assert.notEqual(cents(t1), cents(t2), "the two tiers cannot be distinguished");
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 8 · no lever reaches the recovered fixed charge
// ══════════════════════════════════════════════════════════════════════

const LEVERS = [
  ["a SKU lift", { lift: 0.2 }],
  ["a global price adjustment", { gpa: 0.15 }],
  ["a tier price adjustment", { tierAdj: 0.1 }],
] as const;

for (const [name, lever] of LEVERS) {
  test(`F8 · ${name} does not move the charge's contribution`, () => {
    const plain =
      turnkey({ componentCharges: [charge()], elections: INCLUDED }) -
      turnkey({ componentCharges: [], elections: INCLUDED });
    const levered =
      turnkey({ ...lever, componentCharges: [charge()], elections: INCLUDED }) -
      turnkey({ ...lever, componentCharges: [], elections: INCLUDED });

    sameMoney(
      levered,
      plain,
      `${name} reached the fixed charge — ${cents(plain)} became ${cents(levered)}`,
    );
    sameMoney(
      plain,
      PLATES,
      "the baseline contribution is not the stated amount",
    );
  });

  test(`F8 · CONTROL · ${name} DOES move the priceable base`, () => {
    // Without this, the assertion above passes against a lever that does
    // nothing at all, and proves nothing about the charge.
    const off = turnkey({ componentCharges: [], elections: INCLUDED });
    const on = turnkey({ ...lever, componentCharges: [], elections: INCLUDED });
    assert.notEqual(
      cents(off),
      cents(on),
      `${name} moved nothing — the control cannot detect a lever that works`,
    );
  });
}

test("F8 · the ENGINE places the charge correctly under both elections", () => {
  // In scope for phase 2: the engine's constructed state. The amount and the
  // placement are decided here, once, and every later layer reads them.
  const placedOf = (elections: ChargeElection[]) =>
    computeQuoteCosting(input({ componentCharges: [charge()], elections }))
      .skuRollups.find((r) => r.skuId === "asm")!
      .perTier.find((pt) => pt.tierId === TIER)!
      .constructed.charges.find((x) => x.chargeKey === "print_plates");

  const included = placedOf(INCLUDED);
  const separate = placedOf(SEPARATE);

  assert.ok(included, "the charge was not placed under `included`");
  assert.ok(separate, "the charge was not placed under `separate`");
  assert.equal(included!.placement, "unit_price");
  assert.equal(separate!.placement, "separate_line");

  // COST TRUTH IS INVARIANT UNDER PLACEMENT. What DPS paid does not depend on
  // how the customer is asked for it.
  assert.equal(included!.cost, PLATES);
  assert.equal(separate!.cost, PLATES);
  // And the charge recovers the same figure either way, which is the property
  // that makes placement a presentation choice rather than a commercial one.
  sameMoney(
    included!.revenueContribution ?? NaN,
    separate!.revenueContribution ?? NaN,
    "placement changed what the charge recovers",
  );
});

test("BOUNDARY · a separately-placed component charge has no document line yet", () => {
  // ── A RECORDED PHASE BOUNDARY, NOT A PASSING PROPERTY ────────────────
  //
  // Phase 2 is storage, registry and costing input only — no UI and no
  // customer-document behaviour. The document enumerates its OTC lines from a
  // FIXED LIST OF PRODUCTION FEE COLUMNS (`OTC_FEES` in
  // `commercial-projection.ts`). A component charge has no such column, so
  // `separate_line` placement currently produces no billed line, and the
  // amount leaves the tier total instead of moving to a line of its own.
  //
  // THE ENGINE IS CORRECT. The test above proves it places and prices the
  // charge identically under both elections. Only the projection cannot yet
  // render what the engine placed.
  //
  // Unreachable in production: nothing can author a component charge until the
  // phase-4 sheet ships, so no quote has one and no document is affected.
  // Pattern 32 tolerance applies — the exposing feature does not exist yet.
  //
  // ASSERTED RATHER THAN OMITTED so the gap cannot be forgotten, and so the
  // phase that closes it FAILS HERE and has to come and say so.
  //
  // TODO(od-032-phase-4): enumerate component-owned charges as OTC lines, then
  // replace this with the placement-invariance assertion its legacy sibling
  // makes in `recovery-dimension-qty-per-parent`.
  const included = turnkey({ componentCharges: [charge()], elections: INCLUDED });
  const separate = turnkey({ componentCharges: [charge()], elections: SEPARATE });

  sameMoney(
    included - separate,
    PLATES,
    "the document boundary moved — if the projection now renders component " +
      "OTC lines, this test has done its job and should become the " +
      "placement-invariance assertion described above",
  );
});

test("BOUNDARY CONTROL · a LEGACY charge is placement-invariant today", () => {
  // The same measurement on a charge that DOES have a production column. This
  // is what makes the boundary above specific to the missing column, rather
  // than a general break in placement invariance that phase 2 introduced.
  const base = input({
    elections: [{ chargeKey: "project_setup", mode: "included" }],
  });
  const totalFor = (mode: "included" | "separate") => {
    const i = {
      ...input({ elections: [{ chargeKey: "project_setup", mode }] }),
      production: (base.production as unknown as Record<string, unknown>[]).map(
        (p, idx) => (idx === 0 ? { ...p, setupFeeTotal: 1200 } : p),
      ),
    } as unknown as QuoteCostingInput;
    const costing = computeQuoteCosting(i);
    const bundle = {
      markupDefaults: i.markupDefaults,
      skus: i.skus,
      production: i.production,
      costing,
    } as unknown as HydrateSnapshot;
    return projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!
      .tierCommercialTotal;
  };

  sameMoney(
    totalFor("included"),
    totalFor("separate"),
    "placement invariance broke for a LEGACY charge — phase 2 was supposed " +
      "to leave these untouched",
  );
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 1 & 2 · two owners, and two instances per owner
// ══════════════════════════════════════════════════════════════════════

test("F1 · two components on one quote each own the same charge type", () => {
  const both = [
    charge({ chargeInstanceId: "ci-a", ownerRef: LEAF_QL }),
    charge({
      chargeInstanceId: "ci-b",
      ownerRef: LEAF_QL_2,
      cost: 600,
      recoverableSell: 600,
    }),
  ];
  const contributed =
    turnkey({ componentCharges: both, elections: INCLUDED, secondLeaf: true }) -
    turnkey({ componentCharges: [], elections: INCLUDED, secondLeaf: true });

  // BOTH, summed. The pre-phase model could hold one `print_plates` per quote;
  // an implementation still keyed that way contributes one of these, and the
  // two amounts differ so it cannot pass by picking either.
  sameMoney(
    contributed,
    PLATES + 600,
    "only one of two same-type component charges reached the engine",
  );
  assert.notEqual(
    cents(PLATES),
    cents(600),
    "the fixture cannot tell the two owners apart",
  );
});

test("F1 · each contribution lands on the component that caused it", () => {
  const rows = componentEconomics({
    componentCharges: [
      charge({ chargeInstanceId: "ci-a", ownerRef: LEAF_QL }),
      charge({
        chargeInstanceId: "ci-b",
        ownerRef: LEAF_QL_2,
        cost: 600,
        recoverableSell: 600,
      }),
    ],
    elections: INCLUDED,
    secondLeaf: true,
  });

  // Attribution, not just arithmetic: the totals could reconcile with both
  // amounts on one carton.
  assert.deepEqual(
    rows.map((r) => [r.ownerRef, r.cost]).sort(),
    [
      [LEAF_QL, PLATES],
      [LEAF_QL_2, 600],
    ].sort(),
    "a charge was attributed to a component that did not cause it",
  );
});

test("F2 · one component owns two instances of the same type", () => {
  const two = [
    charge({ chargeInstanceId: "ci-a" }),
    charge({ chargeInstanceId: "ci-b", cost: 325, recoverableSell: 325 }),
  ];
  const contributed =
    turnkey({ componentCharges: two, elections: INCLUDED }) -
    turnkey({ componentCharges: [], elections: INCLUDED });

  sameMoney(
    contributed,
    PLATES + 325,
    "two instances of one type on one component did not both contribute",
  );
});

test("F2 · the two instances stay separately identified", () => {
  // Identity travels to the engine as the source, so a downstream reader can
  // tell which row an amount came from. A column-sourced model cannot.
  const rows = componentEconomics({
    componentCharges: [
      charge({ chargeInstanceId: "ci-a" }),
      charge({ chargeInstanceId: "ci-b", cost: 325, recoverableSell: 325 }),
    ],
    elections: INCLUDED,
  });

  assert.deepEqual(
    rows.map((r) => r.sourceColumn).sort(),
    [
      "quote_charge_instance_tiers:ci-a",
      "quote_charge_instance_tiers:ci-b",
    ],
    "the two instances are not separately identified in the economics",
  );
});

test("F2 · the causal owner travels with the economics, uncoerced", () => {
  const rows = componentEconomics({
    componentCharges: [charge()],
    elections: INCLUDED,
  });
  assert.deepEqual(
    rows.map((r) => r.ownerRef),
    [LEAF_QL],
    "the causal owner did not survive into the economics",
  );
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 6 · legacy charges resolve exactly as before
// ══════════════════════════════════════════════════════════════════════

test("F6 · an empty component set changes nothing", () => {
  // The whole legacy population is this case: no component charge exists, and
  // none can until the phase-4 sheet ships. Byte-equality of the full costing
  // output, not just the total.
  const withField = computeQuoteCosting(
    input({ componentCharges: [], elections: INCLUDED }),
  );
  const withoutField = computeQuoteCosting({
    ...input({ elections: INCLUDED }),
    componentCharges: undefined,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(withField)),
    JSON.parse(JSON.stringify(withoutField)),
    "supplying an empty component set is not identical to omitting it",
  );
});

test("F6 · a legacy production charge still resolves through its own path", () => {
  // A `project_setup` fee is quote-owned and unchanged by this phase. It must
  // still carry the governed production rate, which a component charge
  // deliberately does not.
  const base = input({
    elections: [{ chargeKey: "project_setup", mode: "included" }],
  });
  const withFee = {
    ...base,
    production: (base.production as unknown as Record<string, unknown>[]).map(
      (p, idx) => (idx === 0 ? { ...p, setupFeeTotal: 1200 } : p),
    ),
  } as unknown as QuoteCostingInput;

  const legacy = computeQuoteCosting(withFee)
    // Top-level only, for the reason `componentEconomics` documents above.
    .skuRollups.filter((r) => r.skuId === "asm")
    .flatMap((r) => r.perTier)
    .flatMap((pt) => pt.chargeEconomics ?? [])
    .filter((e) => e.chargeKey === "project_setup");

  assert.equal(legacy.length, 1, "the legacy charge did not resolve");
  assert.equal(legacy[0]!.ownerKind, "assembly", "legacy ownership changed");
  assert.equal(
    legacy[0]!.ownerRef,
    undefined,
    "a legacy charge acquired a causal owner — it must stay engagement-owned",
  );
  assert.equal(
    legacy[0]!.ratePct,
    0.4,
    "the governed production rate stopped applying to a legacy charge",
  );
  assert.equal(legacy[0]!.rateCategory, "Production");
});

test("F6 · a component charge asserts no governed rate", () => {
  const rows = componentEconomics({
    componentCharges: [charge()],
    elections: INCLUDED,
  });

  assert.equal(rows.length, 1);
  // Recording a category here would claim a governed rate resolved it, and
  // none did — the amount is the operator's, entered directly.
  assert.equal(rows[0]!.rateCategory, null);
  assert.equal(rows[0]!.ratePct, null);
  assert.equal(rows[0]!.cost, PLATES, "cost truth is not the operator's figure");
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 4 · an unelected charge is still a valid charge
// ══════════════════════════════════════════════════════════════════════

test("F4 · a charge with no election is a cost fact and not a recovery", () => {
  // Deleting an election must leave the instance valid and simply unplaced:
  // DPS still paid for the plates, and the customer is not being asked for
  // them. Cost is unchanged; there is no governed recovery.
  const rows = componentEconomics({
    componentCharges: [charge({ recoverableSell: null })],
    elections: [],
  });

  assert.equal(
    rows.length,
    1,
    "the charge vanished when its election was removed",
  );
  assert.equal(rows[0]!.cost, PLATES, "cost truth moved with the election");
  // NULL survives as NULL. Coercing it to 0 would convert "nothing governs
  // what this recovers" into "this recovers nothing" — a different claim.
  assert.equal(
    rows[0]!.recoverableSell,
    null,
    "an ungoverned recovery was coerced to zero",
  );
});

test("F4 · an instance with no economics entered yet is not a cost fact", () => {
  const rows = componentEconomics({
    componentCharges: [charge({ cost: 0, recoverableSell: null })],
    elections: INCLUDED,
  });
  assert.equal(rows.length, 0, "a zero-cost charge was emitted as a cost fact");
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 3 · identity is generated, so a label edit cannot move it
// ══════════════════════════════════════════════════════════════════════

test("F3 · the engine identifies a charge by instance id, never by label", () => {
  // The economics carry NO label. There is nothing for a label edit to change,
  // which is the structural form of "editing a label does not change identity"
  // — stronger than asserting that some id happened to stay the same.
  const rows = componentEconomics({
    componentCharges: [charge()],
    elections: INCLUDED,
  });

  assert.equal(rows.length, 1);
  assert.equal(
    JSON.stringify(rows[0]).includes("label"),
    false,
    "a label reached the economics, where a label edit could move identity",
  );
  assert.match(rows[0]!.sourceColumn, /^quote_charge_instance_tiers:ci-1$/);
});

// ══════════════════════════════════════════════════════════════════════
// The V1 vocabulary, as dispositioned
// ══════════════════════════════════════════════════════════════════════

test("the component vocabulary is exactly the dispositioned five", () => {
  assert.deepEqual(
    [...COMPONENT_CHARGE_KEYS].sort(),
    [
      "artwork_plate",
      "other_service",
      "print_plates",
      "samples_proofs",
      "tooling",
    ],
  );
});

test("project_setup is NOT component-owned", () => {
  // Its absence is the rule, not an omission: engagement-level setup is a
  // different commercial fact and stays quote-owned.
  assert.equal(isComponentChargeKey("project_setup"), false);
  assert.equal(isComponentChargeKey("container_freight"), false);
  assert.equal(isComponentChargeKey("print_plates"), true);
});

test("only `other` requires an operator label", () => {
  assert.equal(labelRequiredFor("other_service"), true);
  for (const k of COMPONENT_CHARGE_KEYS) {
    if (k !== "other_service") assert.equal(labelRequiredFor(k), false);
  }
});

test("artwork_plate is NOT renamed", () => {
  // It appears in frozen instructions, which are the record of what Accounting
  // was told. Renaming it in place would rewrite that record.
  assert.equal(isComponentChargeKey("artwork_plate"), true);
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION 5 · deleting the owning component cannot orphan a charge
//
// A schema claim, so it is asserted against the schema. "I read the migration
// and it cascades" is exactly the claim a later edit invalidates silently.
// ══════════════════════════════════════════════════════════════════════

const phase2 = () =>
  readFileSync(
    "drizzle/0109_od_032_phase_2_component_owned_charges.sql",
    "utf8",
  );

test("F5 · the causal owner is a REAL reference that cascades", () => {
  const sql = phase2();

  // `owner_ref` is text and text cannot carry a foreign key, so a component
  // charge whose leaf was deleted would point at a uuid resolving to nothing —
  // attribution to a cause that no longer exists. The typed column is what
  // makes that state unrepresentable rather than merely discouraged.
  assert.match(
    sql,
    /ADD COLUMN "owner_quote_leaf_id" uuid\s+REFERENCES "quote_leaves"\("id"\) ON DELETE CASCADE/,
    "the causal owner is not a cascading FK to quote_leaves",
  );
});

test("F5 · the two owner columns cannot disagree", () => {
  const sql = phase2();

  // Without this, a row could name one leaf in text and another in the FK, and
  // the cascade would protect an owner the costing layer never reads.
  assert.match(sql, /CONSTRAINT "quote_charge_instances_owner_agrees"/);
  assert.match(
    sql,
    /"owner_ref" = '@quote' AND "owner_quote_leaf_id" IS NULL/,
    "an engagement-owned charge is not pinned to having no leaf",
  );
  assert.match(
    sql,
    /"owner_quote_leaf_id" IS NOT NULL AND "owner_ref" = "owner_quote_leaf_id"::text/,
    "a component-owned charge's two owner columns are not tied together",
  );
});

test("F5 · per-tier economics cascade from the instance and the tier", () => {
  const sql = phase2();
  const table = sql.slice(sql.indexOf('CREATE TABLE "quote_charge_instance_tiers"'));

  // Deleting the charge takes its economics; deleting a tier takes that tier's
  // row. Neither can leave economics addressed to something that is gone.
  assert.match(
    table,
    /REFERENCES "quote_charge_instances"\("id"\) ON DELETE CASCADE/,
  );
  assert.match(table, /REFERENCES "quote_tiers"\("id"\) ON DELETE CASCADE/);
  assert.match(
    table,
    /PRIMARY KEY \("charge_instance_id", "tier_id"\)/,
    "one row per (instance, tier) is not enforced",
  );
});

test("F5 · there is no `basis` column", () => {
  // Every component-owned charge is one-time — no exceptions, and the sheet
  // never asks. A column that can hold only one value can one day hold another.
  assert.equal(
    /basis/.test(phase2()),
    false,
    "a basis column appeared — the one-time class rule is now optional",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The contraction is DEFERRED, and deliberately so
// ══════════════════════════════════════════════════════════════════════

test("the temporary quote-wide unique is dropped in its own migration", () => {
  // It must not be dropped in 0109: the DEPLOYED writer's ON CONFLICT still
  // names it, so dropping it before phase 2's code ships breaks every
  // election. Same expand-then-contract discipline as 0107/0108.
  assert.equal(
    /DROP CONSTRAINT "quote_charge_recovery_legacy_quote_charge_unique"/.test(
      phase2(),
    ),
    false,
    "0109 contracts the schema — it is the additive half and must not",
  );

  const contraction = readFileSync(
    "drizzle/0110_od_032_phase_2_drop_legacy_charge_unique.sql",
    "utf8",
  );
  assert.match(
    contraction,
    /DROP CONSTRAINT "quote_charge_recovery_legacy_quote_charge_unique"/,
  );
  // Self-evidencing as an unapplied draft, which is what keeps `db:migrate`
  // from running it before the writer is live.
  assert.match(contraction, /DRAFT/);
  assert.match(contraction, /_journal\.json/);
});

test("the election writer no longer depends on the constraint being dropped", () => {
  // The reason 0110 is safe at all. If this writer still conflicted on
  // (quote_id, charge_key), dropping that unique would break every election —
  // and the target it now uses is also the correct one on its own terms, since
  // (quote, charge_key) can only ever address one charge of a type per quote.
  const writer = readFileSync(
    "src/app/actions/commercial-recovery-persist.ts",
    "utf8",
  );
  assert.match(writer, /target: \[quoteChargeRecovery\.chargeInstanceId\]/);
  assert.equal(
    /target: \[quoteChargeRecovery\.quoteId, quoteChargeRecovery\.chargeKey\]/.test(
      writer,
    ),
    false,
    "the writer still names the unique that 0110 drops",
  );
});
