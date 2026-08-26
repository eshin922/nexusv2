import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { readNodeValue } from "../../src/lib/costing-nodes.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

// ═══════════════════════════════════════════════════════════════════════
// THE PRICE BUILD RECONCILES TO THE CUSTOMER DOCUMENT.
//
// Its own heading says so — "ORDER RECONCILIATION · reconciles to the customer
// document" — and until this repair it did not, whenever a one-time charge sat
// in the unit price.
//
// ── WHAT SOAK RUN 3 MEASURED ────────────────────────────────────────────
//
//     Price Build   unit-price sell $3.6827   turnkey $18,413.64
//     document                      $3.3467           $16,733.64
//
// The gap is exactly the $1,680 recovery. `Base sell` already contained it as
// `Production sell per unit $0.3360` — a charge placed in the unit price
// enters through the production section — and the ladder then added
// "One-time charges recovered in the unit price +$0.3360" a second time.
//
// PRE-DATES value-invariance. Run 2's log records the same disagreement on the
// pre-repair release ($18,115.00 against $16,734.03). Both runs missed it by
// comparing document to document; only run 3 read the two surfaces against
// each other.
//
// ── WHAT IS AND IS NOT UNDER TEST ───────────────────────────────────────
//
// The governed economics are NOT changed by that repair and are not what this
// asserts. The engine, the customer document, the freeze and the NetSuite
// order already agreed at $16,733.64. This asserts that the OPERATOR's
// reconciliation agrees with them too, in every placement and under every
// lever — and, separately, that the decomposition survives rather than being
// flattened to make the sum work.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "88888888-8888-8888-8888-888888888888";
const LEAF_QL = "99999999-9999-9999-9999-999999999999";
const QTY = 5000;

function input(args: {
  gpa?: number;
  lift?: number | null;
  elections?: ChargeElection[];
}): QuoteCostingInput {
  const { gpa = 0, lift = null, elections = [] } = args;
  return {
    quote: { id: "quote", globalPriceAdjPct: gpa, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "FG", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const, skuLabel: "L", productName: "Component", sortOrder: 0, retailBenchmark: null, canonicalQuoteLeafId: LEAF_QL },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 1.85, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.4,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: TIER,
        allocateServiceFeesToCost: true,
        setupFeeTotal: 1200,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    ...(lift === null ? {} : { lifts: [{ quoteLeafId: LEAF_QL, tierId: TIER, liftPct: lift }] }),
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

/** The two figures that must agree: operator surface, and customer document. */
function surfaces(args: Parameters<typeof input>[0]) {
  const i = input(args);
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults, skus: i.skus,
    production: i.production, costing,
  } as unknown as HydrateSnapshot;
  const tier = projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!;

  const unitSell = readNodeValue(costing.graph, `quote/${TIER}/per-unit/unit-price-sell`);
  const separate = readNodeValue(costing.graph, `quote/${TIER}/separate-charges`) ?? 0;
  // The Price Build's own turnkey: what it puts in front of the operator.
  const priceBuildTurnkey = (unitSell ?? 0) * QTY + separate;

  return { priceBuildTurnkey, document: tier.tierCommercialTotal, costing };
}

function reconciles(args: Parameters<typeof input>[0], why: string) {
  const { priceBuildTurnkey, document } = surfaces(args);
  assert.ok(
    Math.abs(priceBuildTurnkey - document) < 0.005,
    `${why}: Price Build ${priceBuildTurnkey.toFixed(2)} vs document ${document.toFixed(2)}, delta ${(priceBuildTurnkey - document).toFixed(2)}`,
  );
}

const INCLUDED: ChargeElection[] = [{ chargeKey: "project_setup", mode: "included" }];
const SEPARATE: ChargeElection[] = [{ chargeKey: "project_setup", mode: "separate" }];

// ── THE SIX CASES ───────────────────────────────────────────────────────

test("legacy included", () => reconciles({ elections: [] }, "legacy included"));
test("elected included", () => reconciles({ elections: INCLUDED }, "elected included"));
test("separate", () => reconciles({ elections: SEPARATE }, "separate"));
test("nonzero lift", () => reconciles({ lift: 0.0167, elections: [] }, "nonzero lift"));
test("nonzero GPA", () => reconciles({ gpa: 0.2, elections: [] }, "nonzero GPA"));
test("combined levers", () =>
  reconciles({ gpa: 0.2, lift: 0.05, elections: [] }, "combined levers"));

test("and the elected half of each, under both levers", () => {
  for (const elections of [INCLUDED, SEPARATE]) {
    reconciles({ gpa: 0.2, lift: 0.05, elections }, "elected under both levers");
  }
});

// ── THE DECOMPOSITION SURVIVES ──────────────────────────────────────────
//
// A sum can always be made to reconcile by deleting rows. These assert the
// operator can still see WHY the number is what it is.

test("every displayed row sums to the stated total, exactly", () => {
  const { costing } = surfaces({ gpa: 0.2, lift: 0.05, elections: [] });
  const root = costing.graph.nodes.find((n) =>
    n.key === `quote/${TIER}/per-unit/unit-price-sell`,
  )!;
  assert.ok(root, "the Price Build root is missing");
  const summed = (root.operands ?? []).reduce((a, n) => a + n.value, 0);
  assert.ok(
    Math.abs(summed - root.value) < 1e-9,
    `rows sum to ${summed}, node states ${root.value}`,
  );
  // Not vacuous by emptiness: the levers are still named.
  const keys = (root.operands ?? []).map((o) => o.key);
  assert.ok(keys.some((k) => k.endsWith("/adj-delta")), "the adjustment row is gone");
  assert.ok(keys.some((k) => k.endsWith("/lift-delta")), "the lift row is gone");
  assert.ok(keys.some((k) => k.endsWith("/base")), "the base row is gone");
});

test("a charge inside the unit price is still DISCLOSED, on the row that holds it", () => {
  // The repair removes a double-counting ROW; it must not remove the fact. An
  // operator still has to know the unit price contains a one-time charge, and
  // how much — otherwise the reconciliation is honest and the surface is worse.
  const { costing } = surfaces({ elections: [] });
  const base = costing.graph.nodes
    .find((n) => n.key === `quote/${TIER}/per-unit/unit-price-sell`)!
    .operands!.find((o) => o.key.endsWith("/base"))!;
  assert.ok(base.note, "the base row says nothing about the charge inside it");
  assert.match(base.note!, /one-time charge recovery/);
  assert.match(base.note!, /0\.336/);
});

test("a quote with NO one-time charge gets no such note", () => {
  // The note is a fact about this quote, not decoration.
  const i = input({ elections: [] });
  i.production = [{ ...i.production[0], setupFeeTotal: null }] as typeof i.production;
  const costing = computeQuoteCosting(i);
  const base = costing.graph.nodes
    .find((n) => n.key === `quote/${TIER}/per-unit/unit-price-sell`)!
    .operands!.find((o) => o.key.endsWith("/base"))!;
  assert.equal(base.note, undefined);
});
