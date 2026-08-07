/**
 * OD-014 / C-2 — the governed SKU population.
 *
 * OD-014 settles that the commercial SKU for Pricing aggregation is the
 * quote-scoped leaf attachment, `quote_leaves.id`. C-2 is the finding that the
 * adapter discovered its population from `assembly_leaves` instead, so an
 * attachment's existence as a SKU depended on an assembly being present.
 *
 * These tests assert the POPULATION and its IDENTITY, not the resulting
 * numbers. That distinction is the whole lesson of the reverted increment 7:
 * its fixture asserted a value, on a structure where the right and the wrong
 * population happened to be the same set of entities, so it passed while the
 * semantics were wrong. A test that can only see the number cannot see that.
 *
 * The fixture below is therefore built to make the populations DIFFERENT by
 * construction, which production data cannot currently do — every one of the
 * 137 live attachments carries quantity 1, so weighted and unweighted means
 * are numerically identical on every real quote.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuoteCostingInputFromNewModel,
  type BuildQuoteCostingInputFromNewModelArgs,
  type AdapterQuoteLeafAttachmentRow,
} from "../../src/lib/costing-adapter.ts";

const QUOTE = "q-1";
const TIER_A = "tier-a";
const ASSEMBLY = "asy-1";

/**
 * Deliberately unlike production, and the reasons are the requirements:
 *
 *  - NESTED: three leaves under one assembly, so "one assembly" and "three
 *    SKUs" are different counts and a contributor population is observable.
 *  - UNEQUAL QUANTITIES (2, 3, 5): so a weighted mean and an unweighted mean
 *    cannot agree. Production is uniformly quantity 1 and cannot distinguish
 *    them, which is precisely why copying real shape is not sufficient here.
 *  - REPEATED LIBRARY LEAF: `lib-repeat` attaches twice. Its two attachments
 *    must stay distinct commercial lines, which is the property that rules
 *    `leaf_id` out as identity.
 *  - DIRECT ATTACHMENT: one leaf with no assembly at all, which is the shape
 *    ASY-optional quote authoring produces and which the old population source
 *    could not represent.
 */
function attachments(): AdapterQuoteLeafAttachmentRow[] {
  return [
    {
      quoteLeafId: "ql-grouped-1",
      assemblyLeafId: "al-1",
      assemblyId: ASSEMBLY,
      leafId: "lib-repeat",
      quantity: "2",
      position: 0,
      leafName: "Repeated component",
      leafSku: "LIB-R",
    },
    {
      quoteLeafId: "ql-grouped-2",
      assemblyLeafId: "al-2",
      assemblyId: ASSEMBLY,
      leafId: "lib-repeat", // same library leaf, second attachment
      quantity: "3",
      position: 1,
      leafName: "Repeated component",
      leafSku: "LIB-R",
    },
    {
      quoteLeafId: "ql-grouped-3",
      assemblyLeafId: "al-3",
      assemblyId: ASSEMBLY,
      leafId: "lib-other",
      quantity: "5",
      position: 2,
      leafName: "Other component",
      leafSku: "LIB-O",
    },
    {
      quoteLeafId: "ql-direct-1",
      assemblyLeafId: null, // no legacy row — direct canonical attachment
      assemblyId: null,
      leafId: "lib-direct",
      quantity: "7",
      position: 0,
      leafName: "Directly attached component",
      leafSku: "LIB-D",
    },
  ];
}

function args(
  over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {},
): BuildQuoteCostingInputFromNewModelArgs {
  return {
    quote: { id: QUOTE, globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.4 },
    tiers: [{ tierId: TIER_A, label: "T1", qty: 1000 }],
    assemblies: [{ id: ASSEMBLY, sku: "ASY-1", name: "Assembly one", position: 0 }],
    quoteLeafAttachments: attachments(),
    assemblyLeafInputs: [],
    assemblyProductionInputs: [],
    assemblyLeafOverrides: [],
    assemblyLeafTargets: [],
    freight: undefined,
    ...over,
  } as BuildQuoteCostingInputFromNewModelArgs;
}

const leafSkus = (a: BuildQuoteCostingInputFromNewModelArgs) =>
  buildQuoteCostingInputFromNewModel(a).skus.filter((s) => s.skuRole === "leaf");

test("every canonical attachment becomes exactly one commercial SKU", () => {
  const leaves = leafSkus(args());
  assert.equal(leaves.length, 4);
  assert.deepEqual(
    leaves.map((s) => s.canonicalQuoteLeafId).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("the population is the attachment set, not the assembly set", () => {
  // One assembly, three grouped attachments. If these two numbers were allowed
  // to be conflated, a blend over "products" would divide by the wrong count.
  const built = buildQuoteCostingInputFromNewModel(args());
  assert.equal(built.skus.filter((s) => s.skuRole === "assembly").length, 1);
  assert.equal(built.skus.filter((s) => s.skuRole === "leaf").length, 4);
});

test("repeated uses of one library leaf stay distinct commercial lines", () => {
  const leaves = leafSkus(args());
  const repeats = leaves.filter((s) => s.skuLabel === "LIB-R");
  assert.equal(repeats.length, 2);
  // Distinct by canonical identity...
  assert.notEqual(repeats[0].canonicalQuoteLeafId, repeats[1].canonicalQuoteLeafId);
  // ...and by the id the math layer keys on, or they would collapse into one
  // rollup and the quote would silently lose a line.
  assert.notEqual(repeats[0].id, repeats[1].id);
  // Their differing quantities must survive, since that is the blend weight.
  assert.deepEqual(repeats.map((r) => r.qtyPerParent).sort(), [2, 3]);
});

test("a direct canonical attachment is a SKU without any assembly", () => {
  const direct = leafSkus(args()).find((s) => s.canonicalQuoteLeafId === "ql-direct-1");
  assert.ok(direct, "direct attachment must be present in the population");
  assert.equal(direct.parentSkuId, null);
  assert.equal(direct.skuRole, "leaf");
  assert.equal(direct.qtyPerParent, 7);
  // With no legacy row, identity falls back to the canonical id. This is the
  // shape ASY-optional quote authoring produces.
  assert.equal(direct.id, "ql-direct-1");
});

test("a quote with no assemblies at all still has a SKU population", () => {
  // The end state of ASY-optional authoring. Under the previous population
  // source this quote had zero SKUs, because the query reached the quote
  // through `assemblies`.
  const built = buildQuoteCostingInputFromNewModel(
    args({
      assemblies: [],
      quoteLeafAttachments: attachments().filter((a) => a.assemblyId === null),
    }),
  );
  assert.equal(built.skus.length, 1);
  assert.equal(built.skus[0].canonicalQuoteLeafId, "ql-direct-1");
});

test("dropping the legacy row removes cost data but never the SKU", () => {
  // Compatibility data is not population. An attachment whose legacy row is
  // missing must still be a governed SKU — otherwise the absence of a
  // transitional artefact silently deletes a commercial line.
  const stripped = attachments().map((a) => ({ ...a, assemblyLeafId: null }));
  const leaves = leafSkus(args({ quoteLeafAttachments: stripped }));
  assert.equal(leaves.length, 4);
  assert.deepEqual(
    leaves.map((s) => s.id).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("unequal quantities are preserved, so weighting is observable", () => {
  // The guard against the increment-7 failure mode. Production is uniformly
  // quantity 1, where a weighted and an unweighted mean coincide; if this
  // fixture ever drifts to uniform quantities it stops being able to tell a
  // correct blend from an incorrect one, and would pass either way.
  const weights = leafSkus(args()).map((s) => s.qtyPerParent);
  assert.deepEqual(weights, [2, 3, 5, 7]);
  assert.equal(
    new Set(weights).size,
    weights.length,
    "quantities must stay distinct or weighting becomes unobservable",
  );
});

test("production data anchors to the lowest-position leaf, by canonical order", () => {
  // Per-assembly production coerces onto an anchor leaf. The anchor must be
  // chosen from the canonical population; picking it from the legacy set would
  // reintroduce the dependency this change removes.
  const built = buildQuoteCostingInputFromNewModel(
    args({
      assemblyProductionInputs: [
        {
          assemblyId: ASSEMBLY,
          tierId: TIER_A,
          customerShipsRaws: false,
          allocateServiceFeesToCost: true,
          fillingBlendingCost: "100",
          cmAssemblyTotal: null,
          setupFeeTotal: null,
          toolingArtworkTotal: null,
          rdTotal: null,
          otherServiceTotal: null,
          bulkRawCost: null,
          actualUnitsProduced: null,
        },
      ],
    }),
  );
  assert.equal(built.production.length, 1);
  assert.equal(built.production[0].quoteSkuId, "al-1"); // position 0
});
