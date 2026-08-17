/**
 * OD-017 — a Direct Component is economically valid.
 *
 * A Direct Component is a `quote_leaves` row with `assembly_id IS NULL`: a
 * component sold on its own, with no Finished Product wrapped around it. It has
 * always been STRUCTURALLY expressible. It was not ECONOMICALLY expressible,
 * because every leaf-level cost table keyed on `assembly_leaves.id` — a junction
 * row a Direct Component does not have — and every loader reached the quote by
 * joining through `assemblies`, which excluded it a second time.
 *
 * Migration 0066 re-keyed those tables onto `quote_leaves.id`. These tests prove
 * the economics that re-keying makes reachable, and — in the first test — prove
 * that they were NOT reachable before, so the fix is measured against a stated
 * failure rather than asserted against itself.
 *
 * WHAT THESE TESTS DO NOT COVER, deliberately:
 *   - Production, bulk raw and assembly service fees. Per the V1 disposition a
 *     Direct Component does not carry them; `assembly_production_inputs` stays
 *     keyed on `assembly_id` and was NOT re-keyed.
 *   - Historical stability across a Product Structure change. Send does not
 *     freeze the leaf set for ANY leaf today (OD-023). That is a separate V1
 *     blocker and not an OD-017 closure condition.
 *   - Reachability through the operator UI. Direct Components remain
 *     unreachable by design until OD-022.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeQuoteCosting } from "../../src/lib/costing.ts";
import {
  buildQuoteCostingInputFromNewModel,
  type BuildQuoteCostingInputFromNewModelArgs,
  type AdapterQuoteLeafAttachmentRow,
} from "../../src/lib/costing-adapter.ts";

const QUOTE = "q-od17";
const TIER_A = "tier-a";
const TIER_B = "tier-b";
const ASSEMBLY = "asy-1";

/** One Finished Product member and one Direct Component, side by side. */
function attachments(): AdapterQuoteLeafAttachmentRow[] {
  return [
    {
      quoteLeafId: "ql-member",
      assemblyLeafId: "al-member", // has a junction: Product-member Component
      assemblyId: ASSEMBLY,
      leafId: "lib-member",
      quantity: "2",
      position: 0,
      leafName: "Member component",
      leafSku: "LIB-M",
    },
    {
      quoteLeafId: "ql-direct",
      assemblyLeafId: null, // NO junction: Direct Component
      assemblyId: null,
      leafId: "lib-direct",
      quantity: "3",
      position: 0,
      leafName: "Direct component",
      leafSku: "LIB-D",
    },
  ];
}

const line = (quoteLeafId: string, tierId: string, unitCost: string) => ({
  quoteLeafId,
  tierId,
  lineGroupId: `lg-${quoteLeafId}`,
  pricingVendorHubspotCompanyId: null,
  pricingVendorNameSnapshot: null,
  unitCost,
  qtyPerSellableUnit: "1",
  category: "Primary",
  markupPct: null,
});

function args(
  over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {},
): BuildQuoteCostingInputFromNewModelArgs {
  return {
    quote: { id: QUOTE, globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.4 },
    tiers: [
      { id: TIER_A, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: TIER_B, label: "T2", qty: 5000, sortOrder: 1, tierPriceAdjPct: null },
    ],
    assemblies: [{ id: ASSEMBLY, sku: "ASY-1", name: "Assembly one", position: 0 }],
    quoteLeafAttachments: attachments(),
    assemblyLeafInputs: [],
    assemblyProductionInputs: [],
    assemblyLeafOverrides: [],
    clientTargets: [],
    lifts: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightComponentTierCosts: [],
    ...over,
  } as BuildQuoteCostingInputFromNewModelArgs;
}

const built = (over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {}) =>
  buildQuoteCostingInputFromNewModel(args(over));

const directSku = (a: BuildQuoteCostingInputFromNewModelArgs) =>
  buildQuoteCostingInputFromNewModel(a).skus.find(
    (s) => s.canonicalQuoteLeafId === "ql-direct",
  );

const costed = (over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {}) =>
  computeQuoteCosting(built(over));

// ---------------------------------------------------------------------------
// 0 · The falsification. What the pre-OD-017 state actually did.
// ---------------------------------------------------------------------------

test("FALSIFICATION: keyed on the legacy junction, a Direct Component's cost is unreachable", () => {
  // Before 0066 the cost row named its leaf by `assembly_leaf_id`. A Direct
  // Component has no junction row, so there was no value to put in that column
  // — its cost could not be addressed at all. Simulated here by keying a row on
  // the ONE identity a Direct Component does not have.
  //
  // This is the defect stated as a measurement. Without it, every test below
  // proves only that the current code agrees with itself.
  const withLegacyKeying = built({
    assemblyLeafInputs: [
      // The member's junction id — the shape every pre-0066 row used.
      { ...line("al-member", TIER_A, "10") },
    ],
  });
  // The row names an identity no SKU carries, so it reaches nothing.
  assert.equal(
    withLegacyKeying.packaging.filter((p) => p.quoteSkuId === "ql-direct").length,
    0,
  );
  assert.equal(
    withLegacyKeying.skus.filter((s) => s.id === "al-member").length,
    0,
    "the legacy junction id is not a SKU identity after OD-017",
  );

  // And the structure was never the problem: the Direct Component IS a SKU.
  // It was priceable-in-principle and unpriceable-in-fact, which is exactly the
  // condition OD-017 exists to end.
  assert.ok(directSku(args()), "the Direct Component was always a governed SKU");
});

// ---------------------------------------------------------------------------
// 1-9 · The closure bar.
// ---------------------------------------------------------------------------

test("1 · a Direct Component persists component cost", () => {
  const input = built({ assemblyLeafInputs: [line("ql-direct", TIER_A, "12.5")] });
  const rows = input.packaging.filter((p) => p.quoteSkuId === "ql-direct");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unitCost, 12.5);
});

test("2 · a Direct Component receives governed markup and category", () => {
  // Category resolves against the same `markupDefaults` authority every other
  // leaf uses. Nothing about the markup path is structure-aware.
  const input = built({ assemblyLeafInputs: [line("ql-direct", TIER_A, "10")] });
  const row = input.packaging.find((p) => p.quoteSkuId === "ql-direct")!;
  assert.equal(row.category, "Primary");
  assert.equal(row.markupPct, null, "no per-line override; the default governs");

  const r = costed({ assemblyLeafInputs: [line("ql-direct", TIER_A, "10")] });
  const cell = r.skuRollups
    .find((s) => s.skuId === "ql-direct")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  // 10 × (1 + 0.40) = 14 — the Primary default, applied.
  assert.equal(Number(cell.requiredSellPerUnit.toFixed(4)), 14);
});

test("3 · tier values propagate independently across tiers", () => {
  const r = costed({
    assemblyLeafInputs: [
      line("ql-direct", TIER_A, "10"),
      line("ql-direct", TIER_B, "8"),
    ],
  });
  const perTier = r.skuRollups.find((s) => s.skuId === "ql-direct")!.perTier;
  const a = perTier.find((t) => t.tierId === TIER_A)!;
  const b = perTier.find((t) => t.tierId === TIER_B)!;
  assert.equal(Number(a.requiredSellPerUnit.toFixed(4)), 14); // 10 × 1.4
  assert.equal(Number(b.requiredSellPerUnit.toFixed(4)), 11.2); // 8 × 1.4
  assert.notEqual(
    a.requiredSellPerUnit,
    b.requiredSellPerUnit,
    "a volume break must be observable, or tier propagation is untested",
  );
});

test("4 · a Direct Component participates in Freight and customs", () => {
  // `freight_leg_component_tier_costs` already keyed on `quote_leaf_id`, so the
  // freight OUTPUT was Direct-ready before this slice. What it lacked was any
  // authoring path that could put a Direct Component into a shipment. The
  // component cost below is addressed by canonical id and lands on the leaf.
  // The shipment break carries `memberSkuId` — the costing anchor the freight
  // workbook derives. That anchor used to come from `assembly_leaves`, which a
  // Direct Component has no row in; it now comes from `quote_leaves`, so a
  // Direct Component can BE the owner of a shipment's cost.
  const r = costed({
    assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
    freightShipmentBreaks: [
      {
        freightSubcategoryId: "sub-1",
        memberCount: 1,
        memberSkuId: "ql-direct", // canonical identity, no assembly involved
        tierId: TIER_A,
        treatment: "bundled",
        tierUnits: 1000,
        freightAmount: 500,
        freightMarkupPct: 0,
        dutyAmount: 100,
        dutyMarkupPct: 0,
        tariffAmount: 50,
        tariffMarkupPct: 0,
      },
    ],
  } as Partial<BuildQuoteCostingInputFromNewModelArgs>);
  const cell = r.skuRollups
    .find((s) => s.skuId === "ql-direct")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  // 500 freight over 1000 units = 0.50/unit; duty 100 + tariff 50 = 0.15/unit.
  assert.equal(Number(cell.totalContainerFreightBeforeMarkup.toFixed(4)), 0.5);
  assert.equal(Number(cell.totalDutyTariffBeforeMarkup.toFixed(4)), 0.15);
  assert.ok(
    cell.contributionCostPerUnit > 10,
    `freight/customs must reach a Direct Component (got ${cell.contributionCostPerUnit})`,
  );
});

test("5 · a Direct Component reconciles exactly once", () => {
  // Exactly once is the property. Appearing twice would double-count the quote;
  // appearing zero times would lose a commercial line silently — the failure
  // that made this slice necessary.
  const r = costed({
    assemblyLeafInputs: [
      line("ql-direct", TIER_A, "10"),
      line("ql-member", TIER_A, "20"),
    ],
  });
  assert.equal(r.skuRollups.filter((s) => s.skuId === "ql-direct").length, 1);
  const rollup = r.skuRollups.find((s) => s.skuId === "ql-direct")!;
  assert.equal(
    rollup.perTier.filter((t) => t.tierId === TIER_A).length,
    1,
    "the Direct Component contributes to its tier exactly once",
  );
  const tier = r.quoteRollup.find((t) => t.tierId === TIER_A);
  assert.ok(tier, "the tier resolves with a Direct Component present");
});

test("6 · a Direct Component produces a correct quoted sell", () => {
  const r = costed({ assemblyLeafInputs: [line("ql-direct", TIER_A, "10")] });
  const cell = r.skuRollups
    .find((s) => s.skuId === "ql-direct")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  // Stated as arithmetic, not as a snapshot: 10 cost, 40% Primary markup.
  assert.equal(Number(cell.contributionCostPerUnit.toFixed(4)), 10);
  assert.equal(Number(cell.requiredSellPerUnit.toFixed(4)), 14);
});

test("7 · a Direct Component survives reload with the same quote_leaf_id", () => {
  // The identity is stable across an independent rebuild from the same rows —
  // it is not minted, positional, or derived from anything transient.
  const rows = [line("ql-direct", TIER_A, "10")];
  const first = built({ assemblyLeafInputs: rows });
  const second = built({ assemblyLeafInputs: rows });
  const idOf = (b: typeof first) =>
    b.skus.find((s) => s.canonicalQuoteLeafId === "ql-direct")!.id;
  assert.equal(idOf(first), "ql-direct");
  assert.equal(idOf(first), idOf(second));
  assert.equal(
    first.packaging.find((p) => p.quoteSkuId === "ql-direct")!.quoteSkuId,
    "ql-direct",
    "the cost row addresses the leaf by the same identity after a reload",
  );
});

test("8 · Direct Components and Finished Product members coexist economically", () => {
  const r = costed({
    assemblyLeafInputs: [
      line("ql-direct", TIER_A, "10"),
      line("ql-member", TIER_A, "20"),
    ],
  });
  const direct = r.skuRollups.find((s) => s.skuId === "ql-direct")!;
  const member = r.skuRollups.find((s) => s.skuId === "ql-member")!;
  const cell = (s: typeof direct) => s.perTier.find((t) => t.tierId === TIER_A)!;
  assert.equal(Number(cell(direct).requiredSellPerUnit.toFixed(4)), 14);
  assert.equal(Number(cell(member).requiredSellPerUnit.toFixed(4)), 28);
  // Distinct lines, distinct numbers, one quote. Mixed structure is valid.
  assert.notEqual(direct.skuId, member.skuId);
});

test("9 · existing Finished Product costing is unchanged by the re-key", () => {
  // The regression that matters most. A member's economics must not move
  // because the identity naming it changed.
  const r = costed({ assemblyLeafInputs: [line("ql-member", TIER_A, "20")] });
  const cell = r.skuRollups
    .find((s) => s.skuId === "ql-member")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  assert.equal(Number(cell.contributionCostPerUnit.toFixed(4)), 20);
  assert.equal(Number(cell.requiredSellPerUnit.toFixed(4)), 28); // 20 × 1.4
});

// ---------------------------------------------------------------------------
// 9b · DIRECT-ONLY freight. The case OD-017 could not close on until `0067`.
//
// Not "a Direct Component joins a Finished Product's shipment" — that already
// worked once membership was canonical. This is a shipment with NO assembly at
// all, which the schema forbade until `assembly_id` became nullable.
// ---------------------------------------------------------------------------

/** A quote whose ONLY commercial line is a Direct Component. No assembly. */
const directOnly = (over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {}) =>
  buildQuoteCostingInputFromNewModel(
    args({
      assemblies: [],
      quoteLeafAttachments: attachments().filter((a) => a.assemblyId === null),
      ...over,
    }),
  );

const directOnlyShipment = {
  freightSubcategoryId: "sub-direct",
  memberCount: 1,
  memberSkuId: "ql-direct",
  tierId: TIER_A,
  treatment: "bundled" as const,
  tierUnits: 1000,
  freightAmount: 500,
  freightMarkupPct: 0,
  dutyAmount: 100,
  dutyMarkupPct: 0,
  tariffAmount: 50,
  tariffMarkupPct: 0,
};

test("9b · a direct-only quote carries freight with no assembly anywhere", () => {
  const input = directOnly({
    assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
    freightShipmentBreaks: [directOnlyShipment],
  } as Partial<BuildQuoteCostingInputFromNewModelArgs>);
  // Precondition of the test itself: there is genuinely no assembly to lean on.
  assert.equal(input.skus.filter((s) => s.skuRole === "assembly").length, 0);
  assert.equal(input.skus.length, 1);

  const r = computeQuoteCosting(input);
  const cell = r.skuRollups
    .find((s) => s.skuId === "ql-direct")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  assert.equal(Number(cell.totalContainerFreightBeforeMarkup.toFixed(4)), 0.5);
  assert.equal(Number(cell.totalDutyTariffBeforeMarkup.toFixed(4)), 0.15);
});

test("9b · direct-only freight reaches costing EXACTLY once", () => {
  const r = computeQuoteCosting(
    directOnly({
      assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
      freightShipmentBreaks: [directOnlyShipment],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
  );
  const rollups = r.skuRollups.filter((s) => s.skuId === "ql-direct");
  assert.equal(rollups.length, 1);
  const cell = rollups[0].perTier.filter((t) => t.tierId === TIER_A);
  assert.equal(cell.length, 1);

  // Exactly once, stated as arithmetic rather than as a count: 10 component
  // + 0.50 freight + 0.15 duty/tariff. Twice would read 10.65 + 0.65.
  assert.equal(Number(cell[0].contributionCostPerUnit.toFixed(4)), 10.65);
});

test("9b · reconciliation includes direct-only freight", () => {
  const withFreight = computeQuoteCosting(
    directOnly({
      assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
      freightShipmentBreaks: [directOnlyShipment],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
  );
  const withoutFreight = computeQuoteCosting(
    directOnly({
      assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
  );
  const tierOf = (r: typeof withFreight) =>
    r.quoteRollup.find((t) => t.tierId === TIER_A)!;
  assert.ok(tierOf(withFreight), "the quote rollup resolves with no assembly present");
  // The tier rollup MOVED by exactly the freight — so freight is included in
  // reconciliation, not merely present on the leaf.
  //
  // The tier breakdown is absolute dollars for the tier, not per-unit: 0.65 per
  // unit over 1000 units is 650. Both are asserted so the units are explicit
  // and the two figures have to agree with each other.
  const perUnit = withFreight.skuRollups
    .find((s) => s.skuId === "ql-direct")!
    .perTier.find((t) => t.tierId === TIER_A)!;
  const freightPerUnit =
    perUnit.totalContainerFreightBeforeMarkup + perUnit.totalDutyTariffBeforeMarkup;
  assert.equal(Number(freightPerUnit.toFixed(4)), 0.65);

  const delta =
    tierOf(withFreight).costBreakdown.freight -
    tierOf(withoutFreight).costBreakdown.freight;
  assert.equal(Number(delta.toFixed(4)), 650);
  assert.equal(Number((freightPerUnit * 1000).toFixed(4)), Number(delta.toFixed(4)));
});

test("9b · no ASY is synthesized to carry a direct-only shipment", () => {
  const input = directOnly({
    assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
    freightShipmentBreaks: [directOnlyShipment],
  } as Partial<BuildQuoteCostingInputFromNewModelArgs>);
  const r = computeQuoteCosting(input);
  // Nothing anywhere in the computed result may be an assembly. If freight had
  // required an owner product, this is where the invented one would appear.
  assert.equal(input.skus.filter((s) => s.skuRole === "assembly").length, 0);
  assert.equal(r.skuRollups.filter((s) => s.skuRole === "assembly").length, 0);
  assert.equal(
    r.skuRollups.every((s) => s.skuId === "ql-direct"),
    true,
  );
});

test("PATTERN 58 · the anchor moves attribution, never the arithmetic", () => {
  // The required evidence for the ratified invariant: identical economic
  // contribution under two DIFFERENT attribution anchors.
  //
  // Both quotes carry the same two leaves and the same shipment. Only the
  // anchor differs. Everything the invariant names — freight amount, markup,
  // customs, landed cost, quoted sell — is asserted at the level where it is
  // genuinely invariant: the QUOTE. Per-leaf placement is expected to differ,
  // because that is precisely what "attribution" means; a test asserting
  // per-leaf equality would be asserting that attribution does nothing.
  //
  // ── WHY THE TWO ANCHORS CARRY DIFFERENT ECONOMICS ────────────────────────
  //
  // The earlier form of this test gave both candidate anchors the SAME markup
  // and no per-cell pricing lever, so every route through the sell ladder
  // multiplied the freight portion by the same scalar and the invariant held
  // for a reason the test never stated. A fixture that cannot distinguish the
  // anchors cannot certify that the anchor does not matter — it can only
  // report that nothing in it varied. Pattern 58 demands a falsification, so
  // each case below makes the two anchors deliberately UNALIKE on one
  // SKU-level pricing lever at a time, holding shipment, freight amount,
  // membership and quantities identical and moving only ownership.
  //
  // Measured on production quote 2f29af72: three leaves share position 0 in
  // one assembly, so the lowest-position anchor is a tie the copy is free to
  // break differently. One of those leaves carries a cell override. Anchored
  // there the shipment's governed freight sell vanished into the operator's
  // stated price; anchored on a sibling it survived — Tier 2 revenue 107,225
  // against 113,105 for the same costs. Case (b) is that quote in miniature.
  const shipment = (memberSkuId: string) => ({
    freightSubcategoryId: "sub-1",
    memberSkuId,
    tierId: TIER_A,
    treatment: "bundled" as const,
    tierUnits: 1000,
    freightAmount: 500,
    freightMarkupPct: 0.1,
    dutyAmount: 100,
    dutyMarkupPct: 0.1,
    tariffAmount: 50,
    tariffMarkupPct: 0.1,
  });

  // Quantities equalised. See the FINDING test below: the invariant is
  // currently guaranteed only where leaf quantity is 1, which is every live
  // attachment — so it holds on production data but not by construction.
  const uniform = attachments().map((a) => ({ ...a, quantity: "1" }));

  // The two anchors already differ in COST and in MARKUP CATEGORY, so their
  // effective sell ratios differ in every case below before any per-cell lever
  // is added: 10 at Primary 0.40 against 20 at Secondary 1.50.
  const runUniform = (
    memberSkuId: string,
    extra: Partial<BuildQuoteCostingInputFromNewModelArgs> = {},
  ) =>
    computeQuoteCosting(
      buildQuoteCostingInputFromNewModel(
        args({
          markupDefaults: { Primary: 0.4, Secondary: 1.5 },
          quoteLeafAttachments: uniform,
          assemblyLeafInputs: [
            line("ql-direct", TIER_A, "10"),
            { ...line("ql-member", TIER_A, "20"), category: "Secondary" },
          ],
          freightShipmentBreaks: [shipment(memberSkuId)],
          ...extra,
        } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
      ),
    );

  const tierOf = (r: ReturnType<typeof runUniform>) =>
    r.quoteRollup.find((t) => t.tierId === TIER_A)!;
  const leafFreight = (r: ReturnType<typeof runUniform>, skuId: string) =>
    r.skuRollups.find((s) => s.skuId === skuId)!.perTier.find((t) => t.tierId === TIER_A)!
      .totalContainerFreightBeforeMarkup;

  /**
   * `expect: "invariant"` — moving the anchor moves nothing commercial.
   *
   * `expect: "absorbed"` — the anchor DOES move quote revenue, by exactly the
   * freight sell and no more. That happens when the anchor lands on a cell
   * whose price an operator has SET DIRECTLY: a stated price is terminal, so
   * the freight riding on that cell is inside the operator's number rather than
   * added to it (P-Direct-1).
   *
   * The exception is asserted with a MAGNITUDE rather than skipped. "Revenue
   * may differ here" would license any difference; "it differs by exactly the
   * freight" fails the moment something else starts moving too.
   */
  function invariant(
    label: string,
    extra: Partial<BuildQuoteCostingInputFromNewModelArgs> = {},
    expect: "invariant" | { movesBy: number } = "invariant",
  ) {
    const onDirect = runUniform("ql-direct", extra);
    const onMember = runUniform("ql-member", extra);

    // Freight amount, markup, customs and landed cost — one figure covering
    // all four, because they compose into it and a change in any would move it.
    assert.equal(
      tierOf(onDirect).costBreakdown.freight,
      tierOf(onMember).costBreakdown.freight,
      `${label}: freight/customs contribution must not depend on the anchor`,
    );
    assert.equal(
      tierOf(onDirect).costBreakdown.freightContainer,
      tierOf(onMember).costBreakdown.freightContainer,
      `${label}: container freight`,
    );
    assert.equal(
      tierOf(onDirect).costBreakdown.dutyAndTariff,
      tierOf(onMember).costBreakdown.dutyAndTariff,
      `${label}: duty and tariff`,
    );
    // Landed cost, quoted sell and margin at the quote level.
    assert.equal(
      tierOf(onDirect).totalCost,
      tierOf(onMember).totalCost,
      `${label}: landed cost`,
    );
    if (expect === "invariant") {
      assert.equal(
        tierOf(onDirect).totalRevenue,
        tierOf(onMember).totalRevenue,
        `${label}: quoted sell`,
      );
      assert.equal(
        tierOf(onDirect).blendedMarginPct,
        tierOf(onMember).blendedMarginPct,
        `${label}: margin`,
      );
    } else {
      const moved = Math.abs(
        tierOf(onDirect).totalRevenue - tierOf(onMember).totalRevenue,
      );
      assert.ok(
        Math.abs(moved - expect.movesBy) < 1e-9,
        `${label}: revenue moved ${moved}, expected exactly ${expect.movesBy} — ` +
          `the exception is bounded to what the operator's lever did to the freight`,
      );
      // Cost is NOT absorbed. The freight still reaches contribution, so margin
      // reports the truth about what the operator's price gave away.
      assert.equal(
        tierOf(onDirect).totalCost,
        tierOf(onMember).totalCost,
        `${label}: landed cost must stay invariant even when sell is absorbed`,
      );
    }

    // And the anchor DID do something — otherwise these assertions would pass
    // on a build where attribution was silently dropped altogether.
    assert.ok(leafFreight(onDirect, "ql-direct") > 0, `${label}: attribution present`);
    assert.equal(leafFreight(onDirect, "ql-member"), 0, `${label}: attribution exclusive`);
    assert.ok(leafFreight(onMember, "ql-member") > 0, `${label}: attribution moves`);
    assert.equal(leafFreight(onMember, "ql-direct"), 0, `${label}: attribution moves`);

    // P3-017 · the ladder still reconciles on every cell.
    //
    // Holding freight out of the lift and out of the override changes two of
    // these four rungs, and no pre-existing fixture combines freight with
    // either lever — so without this the identity would be unasserted in
    // exactly the configuration that moved. Checked per CELL, which is where
    // the rungs are produced; the tier-scope aggregation of the same identity
    // is p3-017-tier-ladder-authority.test.ts.
    for (const r of [onDirect, onMember])
      for (const s of r.skuRollups)
        for (const pt of s.perTier) {
          const rungs =
            pt.sellBeforeAdjustmentPerUnit +
            pt.adjDeltaPerUnit +
            pt.liftDeltaPerUnit +
            pt.overrideDeltaPerUnit;
          assert.ok(
            Math.abs(rungs - pt.requiredSellPerUnit) < 1e-9,
            `${label}: ladder reconciles on ${s.skuId} — ` +
              `${rungs} vs ${pt.requiredSellPerUnit}`,
          );
        }
  }

  // (a) Unequal cost and unequal markup category, no per-cell lever.
  invariant("markup");

  // (b) One anchor is priced by operator override — a TERMINAL value that
  //     replaces the computed chain. This is the production case.
  invariant(
    "cell override",
    {
      assemblyLeafOverrides: [
        { quoteLeafId: "ql-direct", tierId: TIER_A, sellPriceOverride: "5" },
      ],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>,
    // P-Direct-1 · a stated price absorbs the whole freight riding on its cell,
    // so moving the anchor onto or off that cell moves revenue by all of it.
    //   F x Q  where F = (500 + 100 + 50) x 1.1 / 1000 per unit, Q = 1000
    { movesBy: (500 + 100 + 50) * 1.1 },
  );

  // (c) One anchor carries a surgical lift — a per-cell multiplier the other
  //     anchor does not have.
  //
  //     P-Lift-1 · a lift multiplies the cell the operator sees, freight
  //     included, because that is the number the "lift to floor" solver
  //     predicts against. So the anchor moves revenue by what the LIFT did to
  //     the freight — F x lift — not by all of F.
  invariant(
    "surgical lift",
    {
      lifts: [{ quoteLeafId: "ql-direct", tierId: TIER_A, liftPct: "0.2" }],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>,
    { movesBy: (500 + 100 + 50) * 1.1 * 0.2 },
  );

  // (d) Both levers at once, on opposite anchors — the arrangement in which a
  //     partial repair still reads as a pass.
  invariant(
    "override and lift on opposite anchors",
    {
      assemblyLeafOverrides: [
        { quoteLeafId: "ql-direct", tierId: TIER_A, sellPriceOverride: "5" },
      ],
      lifts: [{ quoteLeafId: "ql-member", tierId: TIER_A, liftPct: "0.2" }],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>,
    // Anchored on the overridden cell the freight is absorbed entirely;
    // anchored on the lifted cell it arrives multiplied. So the move is the
    // whole lifted freight: F x (1 + lift).
    { movesBy: (500 + 100 + 50) * 1.1 * 1.2 },
  );
});

test("PATTERN 58 (was the OD-025 tripwire) · anchor invariance, now permanent", () => {
  // INVERTED, not deleted. This assertion was `notEqual` while OD-025 was open:
  // a tripwire holding the defect in place so it could not go silent, and so
  // that repairing it would fail the test and force the finding closed.
  //
  // OD-025 is repaired — `rollUpAssemblyPerTier` is dimension-aware — so the
  // same fixture now states the invariant itself. The history is kept because
  // the failure it once encoded is the reason this test exists at all: freight
  // was amortised per sellable unit, attributed to a leaf, and then scaled
  // again by that leaf's BOM multiplicity.
  //
  // Full falsification set: tests/unit/od-025-attribution-arithmetic.test.ts.
  const shipment = (memberSkuId: string) => ({
    freightSubcategoryId: "sub-1",
    memberSkuId,
    tierId: TIER_A,
    treatment: "bundled" as const,
    tierUnits: 1000,
    freightAmount: 500,
    freightMarkupPct: 0,
    dutyAmount: 100,
    dutyMarkupPct: 0,
    tariffAmount: 50,
    tariffMarkupPct: 0,
  });
  // The fixture's own quantities are deliberately unequal (2 and 3).
  const run = (memberSkuId: string) =>
    costed({
      assemblyLeafInputs: [
        line("ql-direct", TIER_A, "10"),
        line("ql-member", TIER_A, "20"),
      ],
      freightShipmentBreaks: [shipment(memberSkuId)],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>);
  const freightOf = (r: ReturnType<typeof run>) =>
    r.quoteRollup.find((t) => t.tierId === TIER_A)!.costBreakdown.freight;

  assert.equal(
    freightOf(run("ql-member")),
    freightOf(run("ql-direct")),
    "the attribution anchor must not move commercial arithmetic",
  );
  // And the money is right in absolute terms, not merely consistent: a $500
  // shipment over 1000 units is $500, whichever leaf carries it.
  assert.equal(freightOf(run("ql-member")), 650);
  assert.equal(freightOf(run("ql-direct")), 650);
});

// ---------------------------------------------------------------------------
// 10-13 · Structural contracts. Source-level, because these are properties of
// the code's shape rather than of any single computation.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(p, "utf8");

test("10 · there is ONE cost-input identity — no `assemblyLeafId ?? quoteLeafId` fallback", () => {
  const adapter = read("src/lib/costing-adapter.ts");
  assert.doesNotMatch(
    adapter,
    /assemblyLeafId\s*\?\?\s*row\.quoteLeafId|row\.assemblyLeafId\s*\?\?/,
    "two interchangeable identifiers in steady state is the ambiguity OD-017 removes",
  );
  assert.match(
    adapter,
    /function mathSkuId\([\s\S]{0,400}return row\.quoteLeafId;/,
    "the math layer keys a leaf canonically, unconditionally",
  );
});

test("11 · no leaf-level cost loader reaches the quote through `assemblies`", () => {
  // The join that excluded Direct Components. Each of these loaders must scope
  // through `quote_leaves`, which is the FK that says which quote a cost row
  // belongs to regardless of structure.
  for (const [file, table] of [
    ["src/app/actions/costing.ts", "assemblyLeafInputs"],
    ["src/app/actions/costing.ts", "assemblyLeafOverrides"],
    // `assemblyLeafTargets` was here. Its loader is gone: Client Target moved
    // to `quote_client_targets`, keyed to the top-level sellable unit, which
    // carries `quote_id` directly and so needs no join at all to say which
    // quote a row belongs to. The OD-017 property this asserted — that a
    // Direct Component is never excluded by scoping through `assemblies` — is
    // satisfied more strongly by a table that does not scope through anything.
  ] as const) {
    const src = read(file);
    const loader = new RegExp(
      `from\\(${table}\\)[\\s\\S]{0,400}?\\.where\\(`,
    ).exec(src);
    assert.ok(loader, `${table} loader not found in ${file}`);
    assert.doesNotMatch(
      loader[0],
      /assemblies\.quoteId/,
      `${table} must not reach the quote through assemblies`,
    );
    assert.match(
      loader[0],
      /quoteLeaves\.id,\s*\w+\.quoteLeafId/,
      `${table} must join through the canonical leaf`,
    );
  }
});

test("12 · Freight authoring requires no assembly — membership is canonical", () => {
  const worksheet = read("src/app/actions/freight-worksheet.ts");
  const workbook = read("src/lib/freight-workbook.ts");

  // Eligibility is quote-scoped. The previous rule — members must belong to the
  // subcategory's assembly — could not express a Direct Component at all.
  assert.match(
    worksheet,
    /from\(quoteLeaves\)\.where\(eq\(quoteLeaves\.quoteId, quote\.id\)\)/,
  );
  assert.doesNotMatch(
    worksheet,
    /from\(assemblyLeaves\)\.where\(eq\(assemblyLeaves\.assemblyId/,
    "assembly-scoped membership eligibility is what excluded Direct Components",
  );
  // Membership persists canonically...
  assert.match(worksheet, /freightSubcategoryItems\)\.values\([\s\S]{0,200}quoteLeafId/);
  // ...and the workbook no longer derives its anchor from the junction.
  assert.doesNotMatch(workbook, /from\(assemblyLeaves\)/);
  assert.match(workbook, /from\(quoteLeaves\)/);
});

test("14 · the freight container is not ASY-owned, in schema and in the action", () => {
  const schema = read("src/db/schema.ts");
  const worksheet = read("src/app/actions/freight-worksheet.ts");
  const block = /export const freightSubcategories = pgTable\([\s\S]*?\n\);/.exec(schema)!;
  assert.doesNotMatch(
    block[0],
    /assemblyId: uuid\("assembly_id"\)\s*\.notNull\(\)/,
    "a shipment must not require an assembly",
  );
  // Still recorded where it is real — nullable, not removed.
  assert.match(block[0], /assemblyId: uuid\("assembly_id"\)\.references/);
  // And the action must not reimpose the requirement it just lost.
  assert.match(worksheet, /const assemblyId = str\(fd, "assemblyId"\) \|\| null;/);
  assert.doesNotMatch(
    worksheet,
    /if \(!quoteId \|\| !assemblyId \|\|/,
    "assemblyId must not be a precondition for creating a shipment",
  );
});

test("15 · the identity guard validates through quote_leaf_id, not the junction", () => {
  // The database-layer half of the same rule. Migration 0068 replaced the guard
  // that resolved membership through `assembly_leaf_id` — a column that is
  // legitimately NULL for a Direct Component, which made the guard reject it.
  const file = read("drizzle/0068_freight_identity_guard_canonical.sql");
  // Assert against the FUNCTION BODY, not the file: the header comment names
  // the dropped clause in order to explain it, and a whole-file assertion would
  // read that explanation as the thing it describes.
  const guard = file.slice(file.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.match(guard, /SELECT quote_id INTO related_quote FROM quote_leaves WHERE id = NEW\.quote_leaf_id/);
  // Same-Quote enforcement is PRESERVED — that is the guard's real job.
  assert.match(guard, /sub_quote <> related_quote THEN/);
  // Assembly equality is deliberately gone: it cannot be satisfied by a mixed
  // shipment, and it is the assembly-ownership assumption stated twice.
  assert.doesNotMatch(guard, /sub_assembly <> related_assembly/);
  // 0066 and 0067 are applied migrations and must not be edited after the fact.
  assert.match(
    read("drizzle/0067_freight_container_not_assembly_owned.sql"),
    /ALTER COLUMN "assembly_id" DROP NOT NULL/,
  );
});

test("13 · the legacy column is retained, nullable, and read by nothing", () => {
  // Retained so the drop is a separate, evidenced migration; nullable because a
  // Direct Component has no junction; read by nothing so its removal cannot
  // change behaviour. All three are required for the cleanup to be safe.
  const schema = read("src/db/schema.ts");
  for (const table of [
    "assemblyLeafInputs",
    "assemblyLeafOverrides",
    "assemblyLeafTargets",
    "freightSubcategoryItems",
  ]) {
    const block = new RegExp(
      `export const ${table} = pgTable\\([\\s\\S]*?\\n\\);`,
    ).exec(schema);
    assert.ok(block, `${table} not found`);
    assert.match(
      block[0],
      /quoteLeafId: uuid\("quote_leaf_id"\)[\s\S]{0,200}?\.notNull\(\)/,
      `${table}.quote_leaf_id must be NOT NULL — it is the identity`,
    );
    assert.doesNotMatch(
      block[0],
      /assemblyLeafId: uuid\("assembly_leaf_id"\)\s*\n?\s*\.notNull\(\)/,
      `${table}.assembly_leaf_id must be nullable — a Direct Component has none`,
    );
  }
});

test("P-Direct-1 · a price the operator typed is the price", () => {
  // Reported from the Pricing grid: 50ml Plastic Stick, Tier 3. Computed sell
  // was ~3.96, the operator set 4.00 directly, and Nexus displayed 5.06 — then
  // told them the product "is set directly to $5.06".
  //
  // Measured cause: the cell root had become a SUM of the operator's price and
  // the cell's freight. But the 3.96 they overrode ALREADY CONTAINED that
  // freight, so the sum counted it twice against a number they chose while
  // looking at the first count.
  //
  // Fixture mirrors the shape: freight rides the same cell the price is set on.
  const shipment = {
    freightSubcategoryId: "sub-1",
    memberCount: 1,
    memberSkuId: "ql-direct",
    tierId: TIER_A,
    treatment: "bundled" as const,
    tierUnits: 1000,
    freightAmount: 500,
    freightMarkupPct: 0,
    dutyAmount: 0,
    dutyMarkupPct: 0,
    tariffAmount: 0,
    tariffMarkupPct: 0,
  };
  const run = (over: Partial<BuildQuoteCostingInputFromNewModelArgs>) =>
    computeQuoteCosting(
      buildQuoteCostingInputFromNewModel(
        args({
          quoteLeafAttachments: attachments().map((a) => ({ ...a, quantity: "1" })),
          assemblyLeafInputs: [line("ql-direct", TIER_A, "10")],
          freightShipmentBreaks: [shipment],
          ...over,
        } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
      ),
    );

  const cell = (r: ReturnType<typeof run>) =>
    r.skuRollups.find((s) => s.skuId === "ql-direct")!.perTier.find((t) => t.tierId === TIER_A)!;

  // Precondition: freight really is on this cell, so the test is exercising the
  // reported configuration and not a cell with nothing to double-count.
  const computed = cell(run({}));
  assert.ok(
    computed.totalLandedFreightWithMarkup > 0,
    "the fixture must put freight on the cell being priced",
  );
  // And the computed price the operator would have been shown INCLUDES it.
  assert.ok(
    computed.requiredSellPerUnit > computed.totalLandedFreightWithMarkup,
    "the computed price must contain the freight the override will absorb",
  );

  const overridden = cell(
    run({
      assemblyLeafOverrides: [
        { quoteLeafId: "ql-direct", tierId: TIER_A, sellPriceOverride: "4" },
      ],
    } as Partial<BuildQuoteCostingInputFromNewModelArgs>),
  );

  assert.equal(overridden.requiredSellPerUnit, 4, "the typed price IS the price");
  assert.equal(overridden.sellSource, "cell_override");
  assert.equal(overridden.revenue, 4 * 1000, "and it is what the tier collects");

  // The freight COST is untouched — absorbed into the sell, still counted
  // against it, so margin reports what the decision gave away rather than
  // hiding it.
  assert.equal(
    overridden.totalLandedFreightBeforeMarkup,
    computed.totalLandedFreightBeforeMarkup,
  );
  assert.equal(overridden.contributionCostPerUnit, computed.contributionCostPerUnit);

  // The chain the price replaced stays reachable, so "what would this have
  // been" still has an answer.
  const root = overridden;
  assert.ok(root.computedSellPerUnit > 0);
});
