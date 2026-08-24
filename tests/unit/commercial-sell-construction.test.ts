import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import {
  composeFromPlacements,
  constructCommercial,
  type ChargeEconomicsInput,
  type ChargePlacement,
} from "../../src/lib/commercial-recovery/construct.ts";
import type { RecoveryChargeKey } from "../../src/lib/commercial-recovery/registry.ts";

const SRC = "src/lib/commercial-recovery/construct.ts";
const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

// A spread of awkward values on purpose: 0.1/0.2/0.3 are the classic
// non-representable decimals, so any accidental subtract-and-re-add shows up.
const ECON: ChargeEconomicsInput[] = [
  { chargeKey: "project_setup", cost: 1000, recoverableSell: 1400 },
  { chargeKey: "tooling", cost: 0.1, recoverableSell: 0.14 },
  { chargeKey: "artwork_plate", cost: 0.2, recoverableSell: 0.28 },
  { chargeKey: "rd_formulation", cost: 0.3, recoverableSell: 0.42 },
];

const elect = (k: RecoveryChargeKey, mode: "included" | "separate" | "absorbed") => ({
  chargeKey: k,
  mode,
});

// ═══════════════════════════════════════════════════════════════════════
// GATE · THE CONSTRUCTOR CONSUMES `recoverableSell` VERBATIM.
//
// A second derivation of one number is a second authority for it. The two
// agree exactly until a rate moves, or a pin applies to one and not the other
// — which is not hypothetical: 93a5d4bb is `sent` and pins Production at 0.30
// against a live default of 0.40.
// ═══════════════════════════════════════════════════════════════════════

test("the constructor never re-resolves a rate or recomputes a recovery", async () => {
  const src = codeOnly(await read(SRC));
  for (const forbidden of [
    /resolveMarkupStrict/,
    /markupDefaults/,
    /MARKUP_CATEGORY/,
    /1 \+ /,
    /\* \(1/,
  ]) {
    assert.doesNotMatch(
      src,
      forbidden,
      `the constructor re-derives a priced amount (${forbidden}) instead of consuming it`,
    );
  }
});

// Arithmetic gates run over PLACEMENTS, not elections. Every election that
// changes anything is currently refused — correctly, until this layer is wired
// into the projection — so exercising the arithmetic through resolution is
// impossible today. Bypassing resolution to force one would test a path that
// cannot happen; this tests the function that actually runs, and the same one
// runs when the refusals lift.
// The arithmetic gates run over placements. Provenance is irrelevant to them
// — the totals do not depend on it — so they declare "election", which is the
// path the neutral contract governs.
const all = (p: ChargePlacement) => () => ({ placement: p, source: "election" as const });

test("cost and recoverableSell are copied through, not transformed", () => {
  for (const p of ["unit_price", "separate_line", "absorbed"] as const) {
    const out = composeFromPlacements(ECON, all(p));
    for (const [i, c] of out.charges.entries()) {
      assert.equal(c.cost, ECON[i].cost, "cost was transformed");
      assert.equal(c.recoverableSell, ECON[i].recoverableSell, "recovery was recomputed");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GATE · ONE recoverableSell ENTERS EXACTLY ONE PLACEMENT.
// ═══════════════════════════════════════════════════════════════════════

test("every charge lands in exactly one bucket, and the buckets partition", () => {
  const placement: Record<string, ChargePlacement> = {
    project_setup: "unit_price",
    tooling: "separate_line",
    artwork_plate: "unit_price",
    rd_formulation: "absorbed",
  };
  const out = composeFromPlacements(ECON, (e) => ({ placement: placement[e.chargeKey], source: "election" as const }));

  assert.equal(out.charges.length, ECON.length);

  // The three buckets account for every charge's recovery exactly once:
  // nothing counted twice, nothing dropped.
  const everyRecovery = ECON.reduce((a, e) => a + (e.recoverableSell ?? 0), 0);
  const partitioned =
    (out.unitPriceRecovery ?? 0) + (out.separateLineRecovery ?? 0) + out.absorbedRecovery;
  // `absorbed` contributes 0 to revenue, so the partition is over the amounts
  // themselves rather than over contributions — which is the claim: each
  // recoverableSell is placed once.
  const absorbedAmount = ECON.filter((e) => placement[e.chargeKey] === "absorbed")
    .reduce((a, e) => a + (e.recoverableSell ?? 0), 0);
  assert.equal(
    Math.round((partitioned + absorbedAmount) * 1e10),
    Math.round(everyRecovery * 1e10),
    "a recovery was double-counted or dropped",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// GATE · included <-> separate PRESERVES TOTAL REVENUE, BIT-FOR-BIT.
// ═══════════════════════════════════════════════════════════════════════

test("unit_price and separate_line produce a BIT-IDENTICAL revenue total", () => {
  const inUnit = composeFromPlacements(ECON, all("unit_price"));
  const inLine = composeFromPlacements(ECON, all("separate_line"));

  // Not "equal to the cent". IDENTICAL. The same value is placed in a
  // different bucket; nothing is subtracted and re-added, so there is no
  // OD-025 residue to round away.
  assert.equal(
    Object.is(inUnit.totalChargeRevenue, inLine.totalChargeRevenue),
    true,
    `revenue moved: ${inUnit.totalChargeRevenue} vs ${inLine.totalChargeRevenue}`,
  );
  // And the composition genuinely changed — otherwise this proves nothing.
  assert.notEqual(inUnit.unitPriceRecovery, inLine.unitPriceRecovery);
  assert.equal(inLine.unitPriceRecovery, 0);
});

test("revenue is bit-identical across EVERY placement combination", () => {
  // The placement-independent sum order is what makes this hold. Summing per
  // bucket and adding the buckets would make the addend order depend on
  // placement, and float addition is not associative.
  const baseline = composeFromPlacements(ECON, all("unit_price")).totalChargeRevenue;

  for (let mask = 0; mask < 1 << ECON.length; mask += 1) {
    const out = composeFromPlacements(ECON, (e) => {
      const i = ECON.findIndex((x) => x.chargeKey === e.chargeKey);
      return {
        placement: ((mask >> i) & 1 ? "separate_line" : "unit_price") as ChargePlacement,
        source: "election" as const,
      };
    });
    assert.equal(
      Object.is(out.totalChargeRevenue, baseline),
      true,
      `mask ${mask} moved revenue: ${out.totalChargeRevenue} vs ${baseline}`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GATE · absorbed RETAINS COST AND REMOVES EXACTLY THE RECOVERABLE SELL.
// ═══════════════════════════════════════════════════════════════════════

test("absorbed keeps the cost and removes exactly that charge's recovery", () => {
  const base = composeFromPlacements(ECON, all("separate_line"));
  const absorbed = composeFromPlacements(ECON, (e) => ({
    placement: e.chargeKey === "project_setup" ? "absorbed" : "separate_line",
    source: "election" as const,
  }));

  // Cost truth is invariant. Not approximately — identically.
  assert.equal(Object.is(absorbed.totalChargeCost, base.totalChargeCost), true);

  // And revenue falls by EXACTLY the absorbed charge's recoverable sell.
  const delta = (base.totalChargeRevenue ?? 0) - (absorbed.totalChargeRevenue ?? 0);
  assert.equal(Math.round(delta * 1e10) / 1e10, 1400);
  assert.equal(absorbed.charges[0].revenueContribution, 0);
  assert.equal(absorbed.charges[0].cost, 1000, "absorbing discarded the cost");
});

// ═══════════════════════════════════════════════════════════════════════
// UNKNOWN RECOVERY IS NOT ZERO RECOVERY.
// ═══════════════════════════════════════════════════════════════════════

test("an unknown recovery makes the total unknown, not smaller", () => {
  // BV-013: no governed rate means no price, not a price computed at cost.
  // A total containing an unknown is unknown; reporting a number would state a
  // figure nothing governs.
  const withUnknown: ChargeEconomicsInput[] = [
    { chargeKey: "project_setup", cost: 1000, recoverableSell: 1400 },
    { chargeKey: "tooling", cost: 300, recoverableSell: null },
  ];
  const out = composeFromPlacements(withUnknown, all("separate_line"));
  assert.equal(out.totalChargeRevenue, null);
  assert.equal(out.separateLineRecovery, null);
  // Cost is still known — the rate is what was missing, not the charge.
  assert.equal(out.totalChargeCost, 1300);
});

test("absorbing an unknown recovery is still a KNOWN zero contribution", () => {
  // Giving up an unknown amount need not be known to know the customer pays
  // nothing for it. So absorbed never poisons the total.
  const withUnknown: ChargeEconomicsInput[] = [
    { chargeKey: "project_setup", cost: 1000, recoverableSell: 1400 },
    { chargeKey: "tooling", cost: 300, recoverableSell: null },
  ];
  const out = composeFromPlacements(withUnknown, (e) => ({
    placement: e.chargeKey === "tooling" ? "absorbed" : "separate_line",
    source: "election" as const,
  }));
  assert.equal(out.totalChargeRevenue, 1400);
  assert.equal(out.charges[1].revenueContribution, 0);
  assert.equal(out.charges[1].recoverableSell, null, "the unknown was invented as a number");
});

// ═══════════════════════════════════════════════════════════════════════
// POLICY IS STILL THE BOUNDARY.
// ═══════════════════════════════════════════════════════════════════════

test("the constructor refuses an election policy denies", () => {
  // It does not re-implement the refusal; resolution raises it. The surface
  // refuses too, but the surface is not the boundary.
  assert.throws(() =>
    constructCommercial(
      [{ chargeKey: "rd_formulation", cost: 100, recoverableSell: 130 }],
      [elect("rd_formulation", "included")],
      true,
    ),
  );
});

test("with no elections the constructor reproduces legacy placement", () => {
  // Absence of a row is the load-bearing state, and it survives this layer.
  const allocated = constructCommercial(ECON, [], true);
  const notAllocated = constructCommercial(ECON, [], false);
  assert.deepEqual(
    allocated.charges.map((c) => c.placement),
    ECON.map(() => "unit_price"),
  );
  assert.deepEqual(
    notAllocated.charges.map((c) => c.placement),
    ECON.map(() => "separate_line"),
  );
  // Revenue-neutral across the legacy boolean too — same values, different
  // bucket, and the total does not care.
  assert.equal(
    Object.is(allocated.totalChargeRevenue, notAllocated.totalChargeRevenue),
    true,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// REVENUE-NEUTRALITY MUST NOT ERASE THE ACCOUNTING DISTINCTION.
//
// "The customer pays the same either way" is a statement about the AMOUNT. It
// says nothing about the INVOICE. Accounting has to know a charge was
// amortized and must not bill it separately, so the frozen record has to
// distinguish a $1,400 setup fee embedded at $0.14 across 10,000 units from a
// $1,400 setup fee on its own line. Same revenue; different invoices.
// ═══════════════════════════════════════════════════════════════════════

const SETUP_ECON: ChargeEconomicsInput[] = [
  { chargeKey: "project_setup", cost: 1000, recoverableSell: 1400 },
];

test("an amortized charge states its total AND its per-unit basis", () => {
  const out = composeFromPlacements(
    SETUP_ECON,
    () => ({ placement: "unit_price", source: "election" as const }),
    10_000,
  );
  const c = out.charges[0];
  assert.equal(c.placement, "unit_price");
  assert.deepEqual(c.amortization, {
    totalRecovered: 1400,
    tierQuantity: 10_000,
    perUnit: 0.14,
  });
  // The governed recovery is unchanged BY the amortization — spreading it is
  // not repricing it.
  assert.equal(c.recoverableSell, 1400);
  assert.equal(c.revenueContribution, 1400);
});

test("a separately-billed charge has NO amortization basis", () => {
  // Not zero, and not a basis of one. It was not spread over anything, and
  // emitting a number would let a reader take it for an amortized charge.
  const out = composeFromPlacements(
    SETUP_ECON,
    () => ({ placement: "separate_line", source: "election" as const }),
    10_000,
  );
  assert.equal(out.charges[0].amortization, null);
  assert.equal(out.charges[0].revenueContribution, 1400);
});

test("placement answers 'invoice separately?' and the answer differs", () => {
  const q = 10_000;
  const included = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "unit_price", source: "election" as const }), q,
  ).charges[0];
  const separate = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "separate_line", source: "election" as const }), q,
  ).charges[0];

  // Same money...
  assert.equal(included.revenueContribution, separate.revenueContribution);
  // ...different instruction. This is the pair the frozen record must keep
  // apart, and it is exactly what neutrality would have collapsed.
  assert.notEqual(included.placement, separate.placement);
  assert.ok(included.amortization !== null);
  assert.equal(separate.amortization, null);
});

test("absorbed states no recovery and no basis, and keeps the cost", () => {
  const out = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "absorbed", source: "election" as const }), 10_000,
  );
  const c = out.charges[0];
  assert.equal(c.revenueContribution, 0);
  assert.equal(c.amortization, null, "an absorbed charge was never amortized into a price");
  assert.equal(c.cost, 1000, "absorbing discarded the cost DPS still pays");
});

test("provenance is carried, because legacy and elected are priced differently", () => {
  // Legacy keeps historical behaviour — the adjustment reaches an allocated
  // fee, which is what every existing quote was priced with. An election is
  // neutral. Without the discriminator the engine can honour only one, and
  // honouring one either reprices 89 quotes or leaves relocation a price lever.
  const legacy = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "unit_price", source: "legacy" as const }), 10_000,
  );
  const elected = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "unit_price", source: "election" as const }), 10_000,
  );
  assert.equal(legacy.charges[0].source, "legacy");
  assert.equal(elected.charges[0].source, "election");
  assert.equal(legacy.unitPriceCostLegacy, 1000);
  assert.equal(legacy.unitPriceCostElected, 0);
  assert.equal(elected.unitPriceCostElected, 1000);
  assert.equal(elected.unitPriceRecoveryElected, 1400);
  // The undifferentiated bucket still sums both, so a consumer that does not
  // care about provenance is unaffected.
  assert.equal(legacy.unitPriceCost, elected.unitPriceCost);
});

test("no amortization basis when the recovery is unknown", () => {
  // A basis computed from an unknown recovery would be a number standing in
  // for one nothing governs (BV-013).
  const out = composeFromPlacements(
    [{ chargeKey: "project_setup", cost: 1000, recoverableSell: null }],
    () => ({ placement: "unit_price", source: "election" as const }),
    10_000,
  );
  assert.equal(out.charges[0].amortization, null);
  assert.equal(out.charges[0].revenueContribution, null);
});

test("no amortization basis at zero quoted quantity", () => {
  // Dividing by zero units leaves the per-unit figure UNDEFINED, and undefined
  // is not zero — the same contract the engine already applies to its per-unit
  // allocations.
  const out = composeFromPlacements(
    SETUP_ECON, () => ({ placement: "unit_price", source: "election" as const }), 0,
  );
  assert.equal(out.charges[0].amortization, null);
});
