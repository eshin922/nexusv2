/**
 * OD-032 — recovery decisions are per charge instance.
 *
 * ── WHAT CHANGED, AND WHY IT IS A CAPABILITY RATHER THAN A REFACTOR ──────
 *
 * `constructCommercial` matched elections by `chargeKey`. One Print plates
 * election therefore placed EVERY Print plates charge on the quote, so two
 * cartons could never be treated differently — and a concession absorbed on one
 * was unrepresentable without absorbing the other.
 *
 * The type is still the POLICY identity: which modes are permitted, which
 * NetSuite destination the amount reaches, what the customer document calls it.
 * It is no longer the COMMERCIAL identity.
 *
 * Legacy charges keep matching by type, and that is correct rather than a
 * concession: a production column IS its type. A quote has one `setupFeeTotal`,
 * and an election naming the type names the only charge it could mean.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type ComponentChargeInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";

const TIER = "44444444-4444-4444-4444-444444444444";
const LEAF_A = "55555555-5555-5555-5555-555555555555";
const LEAF_B = "77777777-7777-7777-7777-777777777777";

/** Two instances on LEAF_A, one on LEAF_B. Every amount distinct. */
const A1 = { id: "inst-a1", owner: LEAF_A, cost: 1450 };
const A2 = { id: "inst-a2", owner: LEAF_A, cost: 325 };
const B1 = { id: "inst-b1", owner: LEAF_B, cost: 600 };

const charge = (c: { id: string; owner: string; cost: number }): ComponentChargeInput => ({
  chargeInstanceId: c.id,
  tierId: TIER,
  chargeKey: "print_plates",
  ownerRef: c.owner,
  cost: c.cost,
  recoverableSell: c.cost,
});

const elect = (id: string, mode: ChargeElection["mode"]): ChargeElection => ({
  chargeKey: "print_plates",
  chargeInstanceId: id,
  mode,
});

function input(args: {
  componentCharges?: ComponentChargeInput[];
  elections?: ChargeElection[];
  setupFee?: number | null;
}): QuoteCostingInput {
  const { componentCharges = [], elections = [], setupFee = null } = args;
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    componentCharges,
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const,
        skuLabel: "IG", productName: "Finished good", sortOrder: 0, retailBenchmark: null },
      { id: "leafA", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const,
        skuLabel: "A", productName: "Carton", sortOrder: 0, retailBenchmark: null,
        canonicalQuoteLeafId: LEAF_A },
      { id: "leafB", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const,
        skuLabel: "B", productName: "Sleeve", sortOrder: 1, retailBenchmark: null,
        canonicalQuoteLeafId: LEAF_B },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: ["leafA", "leafB"].map((id) => ({
      quoteSkuId: id, tierId: TIER, lineGroupId: `pkg-${id}`,
      unitCost: 2, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.4,
    })),
    production: ["leafA", "leafB"].map((id) => ({
      quoteSkuId: id, tierId: TIER,
      allocateServiceFeesToCost: true,
      setupFeeTotal: id === "leafA" ? setupFee : null,
      toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
      rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
      fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
      actualUnitsProduced: null,
    })),
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

/** Every placed charge, at the level it was authored against. */
function placed(args: Parameters<typeof input>[0]) {
  const i = input(args);
  const out: {
    key: string; instance?: string; owner?: string;
    placement: string; source: string; cost: number; revenue: number | null;
  }[] = [];
  for (const r of computeQuoteCosting(i).skuRollups) {
    if (r.skuId !== "leafA" && r.skuId !== "leafB") continue;
    for (const pt of r.perTier) {
      for (const c of pt.constructed.charges) {
        out.push({
          key: c.chargeKey, instance: c.chargeInstanceId, owner: c.ownerRef,
          placement: c.placement, source: c.source,
          cost: c.cost, revenue: c.revenueContribution,
        });
      }
    }
  }
  return out;
}

const byInstance = (args: Parameters<typeof input>[0]) =>
  new Map(placed(args).filter((c) => c.instance).map((c) => [c.instance!, c]));

/** What the customer pays for the tier, all in. */
function turnkey(args: Parameters<typeof input>[0]): number {
  const i = input(args);
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults, skus: i.skus,
    production: i.production, costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;
}

const ALL = [charge(A1), charge(A2), charge(B1)];

// ══════════════════════════════════════════════════════════════════════
// 1 · two same-type charges on DIFFERENT components, placed differently
// ══════════════════════════════════════════════════════════════════════

test("two same-type charges on different components can be placed differently", () => {
  const got = byInstance({
    componentCharges: [charge(A1), charge(B1)],
    elections: [elect(A1.id, "included"), elect(B1.id, "separate")],
  });

  assert.equal(got.get(A1.id)?.placement, "unit_price");
  assert.equal(got.get(B1.id)?.placement, "separate_line");
  // And each landed on the component that caused it.
  assert.equal(got.get(A1.id)?.owner, LEAF_A);
  assert.equal(got.get(B1.id)?.owner, LEAF_B);
});

// ══════════════════════════════════════════════════════════════════════
// 2 · two same-type charges on the SAME component, placed differently
// ══════════════════════════════════════════════════════════════════════

test("two same-type charges on the SAME component can be placed differently", () => {
  // The case type-grained matching could not express at all. Both charges share
  // chargeKey AND owner; only the instance separates them.
  const got = byInstance({
    componentCharges: [charge(A1), charge(A2)],
    elections: [elect(A1.id, "included"), elect(A2.id, "separate")],
  });

  assert.equal(got.get(A1.id)?.placement, "unit_price");
  assert.equal(got.get(A2.id)?.placement, "separate_line");
  assert.equal(got.get(A1.id)?.owner, got.get(A2.id)?.owner, "same component");
  assert.equal(got.get(A1.id)?.key, got.get(A2.id)?.key, "same type");

  // `absorbed` would be the sharper case — a concession on one plate set and
  // not the other — but it is REFUSED today for a reason unrelated to grain:
  // an absorbed charge would currently drop its COST as well as its revenue,
  // so the quote would stop reflecting money DPS is still paying. Asserted as
  // a control below rather than assumed.

  // Cost truth untouched on both.
  assert.equal(got.get(A1.id)?.cost, A1.cost);
  assert.equal(got.get(A2.id)?.cost, A2.cost);
  // And each recovers its own amount, so the two are independently priced.
  assert.equal(got.get(A1.id)?.revenue, A1.cost);
  assert.equal(got.get(A2.id)?.revenue, A2.cost);
  assert.notEqual(A1.cost, A2.cost, "the fixture cannot detect a swap");
});

// ══════════════════════════════════════════════════════════════════════
// 3 · changing one instance does not alter its sibling
// ══════════════════════════════════════════════════════════════════════

test("changing one instance leaves every sibling untouched", () => {
  const before = byInstance({
    componentCharges: ALL,
    elections: [elect(A1.id, "included"), elect(A2.id, "included"), elect(B1.id, "included")],
  });
  const after = byInstance({
    componentCharges: ALL,
    elections: [elect(A1.id, "separate"), elect(A2.id, "included"), elect(B1.id, "included")],
  });

  assert.equal(before.get(A1.id)?.placement, "unit_price");
  assert.equal(after.get(A1.id)?.placement, "separate_line", "the edited one moved");

  for (const sib of [A2.id, B1.id]) {
    assert.deepEqual(
      after.get(sib),
      before.get(sib),
      `${sib} moved when a sibling was re-elected`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════
// 4 · a group action is N individual elections, not type-grained state
// ══════════════════════════════════════════════════════════════════════

test("a group action places each instance individually", () => {
  // "Set all Print plates → One-time fee" emits one election PER INSTANCE.
  // Asserting the engine consumes that shape is what keeps the ergonomics of a
  // group from re-introducing the grain it replaced.
  const group = [A1, A2, B1].map((c) => elect(c.id, "separate"));
  const got = byInstance({ componentCharges: ALL, elections: group });

  for (const c of [A1, A2, B1]) {
    assert.equal(got.get(c.id)?.placement, "separate_line", `${c.id} not placed`);
    assert.equal(got.get(c.id)?.source, "election");
  }

  // NON-VACUOUS, and this is the point: the same outcome from ONE type-grained
  // election must NOT be reachable. If it were, the group action would be
  // indistinguishable from type state and nothing would stop it regressing.
  const viaType = byInstance({
    componentCharges: ALL,
    elections: [{ chargeKey: "print_plates", mode: "separate" }],
  });
  for (const c of [A1, A2, B1]) {
    assert.equal(
      viaType.get(c.id)?.placement,
      "unplaced",
      "a type-grained election reached a component charge — the collapse is back",
    );
  }
});

test("a group action can be partial without touching the rest", () => {
  const got = byInstance({
    componentCharges: ALL,
    elections: [elect(A1.id, "separate"), elect(A2.id, "separate")],
  });
  assert.equal(got.get(A1.id)?.placement, "separate_line");
  assert.equal(got.get(A2.id)?.placement, "separate_line");
  assert.equal(got.get(B1.id)?.placement, "unplaced", "an unnamed instance stays unplaced");
});

// ══════════════════════════════════════════════════════════════════════
// 5 · unplaced is representable, and is not absorbed
// ══════════════════════════════════════════════════════════════════════

test("a charge nobody elected is UNPLACED, and says so", () => {
  const got = byInstance({ componentCharges: [charge(A1)], elections: [] });
  const c = got.get(A1.id)!;

  assert.equal(c.placement, "unplaced");
  assert.equal(c.source, "unplaced");
  // Cost is real — DPS paid it.
  assert.equal(c.cost, A1.cost);
  // Revenue is NULL, not zero. Zero would assert the customer pays nothing for
  // it, which is a commercial claim nobody has made.
  assert.equal(c.revenue, null);
});

test("unplaced is distinguishable from every DECIDED placement", () => {
  const un = byInstance({ componentCharges: [charge(A1)], elections: [] }).get(A1.id)!;

  for (const mode of ["included", "separate"] as const) {
    const decided = byInstance({
      componentCharges: [charge(A1)],
      elections: [elect(A1.id, mode)],
    }).get(A1.id)!;

    assert.notEqual(un.placement, decided.placement);
    assert.notEqual(un.source, decided.source);
    // A decided charge states a recovery. An undecided one states none — the
    // difference between "the customer pays this much for it" and "nobody has
    // said yet", which a zero would erase.
    assert.equal(decided.revenue, A1.cost);
    assert.equal(un.revenue, null);
  }
});

test("CONTROL · `absorbed` is refused today, and the refusal explains itself", () => {
  // Not a grain question, and worth pinning so a later reader does not take the
  // absence of an absorbed test for an oversight: absorbing would currently
  // drop the charge's COST as well as its revenue, so the quote would stop
  // reflecting money DPS is still paying. The concession case OD-032 describes
  // opens when that is fixed, not here.
  assert.throws(
    () =>
      byInstance({
        componentCharges: [charge(A1)],
        elections: [elect(A1.id, "absorbed")],
      }),
    /Absorbing is not a placement/,
  );
});

// ══════════════════════════════════════════════════════════════════════
// 6 · legacy behaviour is unchanged
// ══════════════════════════════════════════════════════════════════════

test("CONTROL · a legacy charge still resolves by TYPE", () => {
  // For a production column the type IS the identity, so a type-grained
  // election is the right instrument and must keep working.
  const rows = placed({
    setupFee: 1200,
    elections: [{ chargeKey: "project_setup", mode: "separate" }],
  });
  const legacy = rows.filter((r) => r.key === "project_setup");

  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].placement, "separate_line");
  assert.equal(legacy[0].source, "election");
  assert.equal(legacy[0].instance, undefined, "a legacy charge carries no instance");
});

test("CONTROL · a legacy charge with no election keeps its default, never unplaced", () => {
  // The distinction that makes `unplaced` safe to add: a column has a
  // pre-recovery treatment to inherit, so its absence of an election means
  // something already. Only an authored charge can be undecided.
  const legacy = placed({ setupFee: 1200, elections: [] })
    .filter((r) => r.key === "project_setup");

  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].source, "legacy");
  assert.notEqual(legacy[0].placement, "unplaced");
});

// ══════════════════════════════════════════════════════════════════════
// 7 · placement moves presentation, never cost truth or the total
// ══════════════════════════════════════════════════════════════════════

test("cost truth is invariant across every placement", () => {
  // `absorbed` is refused today — see the control above.
  const modes = ["included", "separate"] as const;
  const costs = modes.map((m) => {
    const c = byInstance({
      componentCharges: [charge(A1)],
      elections: [elect(A1.id, m)],
    }).get(A1.id)!;
    return c.cost;
  });
  const unplacedCost = byInstance({
    componentCharges: [charge(A1)],
    elections: [],
  }).get(A1.id)!.cost;

  for (const c of [...costs, unplacedCost]) assert.equal(c, A1.cost);
});

test("placement does not move what the charge recovers", () => {
  // The invariant at the layer that decides it. Moving a charge between the
  // unit price and its own line changes WHERE the customer is asked for it,
  // never HOW MUCH — the engine hands both placements the same governed figure.
  const inc = byInstance({
    componentCharges: [charge(A1)],
    elections: [elect(A1.id, "included")],
  }).get(A1.id)!;
  const sep = byInstance({
    componentCharges: [charge(A1)],
    elections: [elect(A1.id, "separate")],
  }).get(A1.id)!;

  assert.equal(inc.revenue, sep.revenue);
  assert.equal(inc.cost, sep.cost);
  assert.notEqual(inc.placement, sep.placement, "the placements did differ");
});

test("BOUNDARY · the customer TOTAL still moves, and that is the phase-4 gap", () => {
  // ── A RECORDED BOUNDARY, NOT A PASSING PROPERTY ────────────────────────
  //
  // The engine holds the invariant above. The customer DOCUMENT does not yet,
  // because it enumerates OTC lines from a fixed list of production fee columns
  // and a component charge has no column — so a separately-placed one produces
  // no billed line and its amount leaves the tier total.
  //
  // Recorded and asserted in phase 2, restated here because the contract asks
  // that placement not move total customer consideration, and at document level
  // it currently does. Unreachable in production: nothing can author a
  // component charge until the phase-4 sheet ships.
  //
  // TODO(od-032-phase-4): enumerate component charges as OTC lines, then this
  // becomes the equality its sibling above already holds.
  const inc = turnkey({
    componentCharges: [charge(A1)],
    elections: [elect(A1.id, "included")],
  });
  const sep = turnkey({
    componentCharges: [charge(A1)],
    elections: [elect(A1.id, "separate")],
  });

  assert.ok(
    Math.abs(inc - sep - A1.cost) < 0.005,
    "the document boundary moved — if the projection now renders component " +
      "OTC lines, this test has done its job and should become an equality",
  );
});

// ══════════════════════════════════════════════════════════════════════
// 8 · the owner that travels is causal, never an anchor
// ══════════════════════════════════════════════════════════════════════

test("each placed charge carries its CAUSAL owner", () => {
  const got = byInstance({
    componentCharges: ALL,
    elections: [elect(A1.id, "included"), elect(A2.id, "included"), elect(B1.id, "included")],
  });
  assert.equal(got.get(A1.id)?.owner, LEAF_A);
  assert.equal(got.get(A2.id)?.owner, LEAF_A);
  assert.equal(got.get(B1.id)?.owner, LEAF_B);

  // NON-VACUOUS: the two owners are different values, so an implementation
  // that returned one anchor for everything would fail here.
  assert.notEqual(LEAF_A, LEAF_B);
});
