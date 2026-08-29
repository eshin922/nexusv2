/**
 * OD-032 — tiers are alternative scenarios and are never additive.
 *
 * ── THE DIMENSIONAL RULE ────────────────────────────────────────────────
 *
 *   owners within the same tier   MAY be additive — two cartons each causing
 *                                 print plates really do cost the sum of both,
 *                                 in that scenario
 *   tiers                         are ALTERNATIVE SCENARIOS. The customer buys
 *                                 one. They are never additive.
 *
 * The workspace did both in one loop. `ownedPlacedCharges` yields per (owner,
 * tier), and the legacy row summed the whole list — so a flat charge was
 * multiplied by the tier count, and a varying one got a figure true of no tier
 * at all.
 *
 * Measured on production 2026-08-27, quote 4781e4bb, four tiers:
 *
 *   Tooling        $500 flat            → row showed $2,000 cost / $2,800
 *   Artwork        $2,000 flat          → $8,000 / $11,200
 *   Project setup  100/500/1000/1000    → $2,600
 *
 * The customer document on the SAME PAGE stated Tooling at $700 per tier. The
 * card said $2,800. And $2,600 is not an overstatement of a real figure — it
 * is a figure with no referent, since no tier costs that.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ─────────────────────────────────────
 *
 * EVERY pre-existing fixture is single-tier, which is exactly why none of them
 * could see this: with one tier, "sum across tiers" and "the tier's amount"
 * are the same number. The dimension has to be built into the fixture before
 * any assertion about it can fail.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecoveryWorkspace,
  displayCost,
  displayRecovery,
  tierVector,
} from "../../src/lib/commercial-recovery/workspace-view.ts";
import type { ConstructedRollups } from "../../src/lib/commercial-recovery/construct.ts";

const T1 = "tier-1", T2 = "tier-2", T3 = "tier-3", T4 = "tier-4";
const TIERS = [T1, T2, T3, T4];
const LEAF_A = "leaf-a";
const LEAF_B = "leaf-b";
const isLeaf = (id: string) => id === LEAF_A || id === LEAF_B;

/** A legacy production-column charge: no instance, placed by inheritance. */
function legacy(cost: number, rate = 0.4) {
  return {
    chargeKey: "project_setup",
    ownerKind: "assembly",
    placement: "unit_price",
    source: "legacy",
    cost,
    recoverableSell: cost * (1 + rate),
    revenueContribution: cost * (1 + rate),
    separateInvoiceAmount: 0,
    amortization: null,
  };
}

/** A component-owned charge, identified by instance. */
function component(instanceId: string, owner: string, cost: number, ask: number | null) {
  return {
    chargeKey: "print_plates",
    chargeInstanceId: instanceId,
    ownerKind: "component",
    ownerRef: owner,
    placement: "separate_line",
    source: "election",
    cost,
    recoverableSell: ask,
    revenueContribution: ask,
    separateInvoiceAmount: ask,
    amortization: null,
  };
}

/** Rollups over N tiers. `per` returns the charges for (leafId, tierId). */
function rollups(
  leaves: string[],
  tiers: string[],
  per: (leaf: string, tier: string) => unknown[],
): ConstructedRollups {
  return {
    skuRollups: leaves.map((skuId) => ({
      skuId,
      perTier: tiers.map((tierId) => ({ tierId, constructed: { charges: per(skuId, tierId) } })),
    })),
  } as unknown as ConstructedRollups;
}

const build = (costing: ConstructedRollups) =>
  buildRecoveryWorkspace({ costing, isLeaf, elections: [], allocationStates: [false] });

// ══════════════════════════════════════════════════════════════════════
// Legacy — flat and varying
// ══════════════════════════════════════════════════════════════════════

test("LEGACY FLAT · four tiers at $500 is $500, not $2,000", () => {
  const rows = build(rollups([LEAF_A], TIERS, () => [legacy(500)]));
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;

  // The vector is the authority, and it keeps all four scenarios.
  assert.equal(setup.perTier.length, 4);
  assert.deepEqual(setup.perTier.map((t) => t.cost), [500, 500, 500, 500]);

  // The display collapses to ONE amount because the tiers agree.
  assert.deepEqual(displayCost(setup.perTier), { kind: "single", value: 500 });
  assert.deepEqual(displayRecovery(setup.perTier), { kind: "single", value: 700 });

  // NON-VACUOUS: the pre-repair figures, named so the regression has a shape.
  const summedCost = setup.perTier.reduce((a, t) => a + t.cost, 0);
  assert.equal(summedCost, 2000, "the sum this used to show");
  assert.notEqual(displayCost(setup.perTier).kind, "range");
});

test("LEGACY VARYING · 100/500/1000/1000 is a RANGE, never $2,600", () => {
  const amounts: Record<string, number> = { [T1]: 100, [T2]: 500, [T3]: 1000, [T4]: 1000 };
  const rows = build(rollups([LEAF_A], TIERS, (_l, t) => [legacy(amounts[t], 0)]));
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;

  assert.deepEqual(setup.perTier.map((t) => t.cost), [100, 500, 1000, 1000]);
  assert.deepEqual(displayCost(setup.perTier), { kind: "range", min: 100, max: 1000 });

  // ── THE FIGURE WITH NO REFERENT ────────────────────────────────────────
  //
  // $2,600 is not an overstatement of a real amount. There is no tier in which
  // project setup costs $2,600, so the row stated a number the customer could
  // never be charged in any scenario they could buy.
  assert.ok(
    !setup.perTier.some((t) => t.cost === 2600),
    "no scenario costs the sum, which is why the sum could not be displayed",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Owners within a tier ARE additive
// ══════════════════════════════════════════════════════════════════════

test("TWO OWNERS, ONE TIER · additive, because both are paid in that scenario", () => {
  // Two leaves each carrying the charge, across four tiers.
  const rows = build(rollups([LEAF_A, LEAF_B], TIERS, (leaf) => [legacy(leaf === LEAF_A ? 300 : 200, 0)]));
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;

  // Summed WITHIN each tier — 300 + 200 — and not across them.
  assert.equal(setup.perTier.length, 4, "still four tiers, not eight entries");
  assert.deepEqual(setup.perTier.map((t) => t.cost), [500, 500, 500, 500]);
  assert.deepEqual(displayCost(setup.perTier), { kind: "single", value: 500 });

  // NON-VACUOUS: eight entries existed; the old code would have shown 4,000.
  assert.notEqual(
    setup.perTier.reduce((a, t) => a + t.cost, 0),
    500,
    "the fixture really does have eight (owner, tier) entries",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Component instances — the collapse that blocked the walk
// ══════════════════════════════════════════════════════════════════════

test("ONE INSTANCE across four tiers → ONE row", () => {
  const costs: Record<string, number> = { [T1]: 1450, [T2]: 1400, [T3]: 1350, [T4]: 1300 };
  const rows = build(
    rollups([LEAF_A], TIERS, (_l, t) => [component("inst-1", LEAF_A, costs[t], costs[t])]),
  );
  const mine = rows.filter((r) => r.chargeInstanceId === "inst-1");

  assert.equal(mine.length, 1, "one charge, one decision row");
  assert.equal(mine[0].perTier.length, 4, "and all four scenarios beneath it");
  assert.deepEqual(displayRecovery(mine[0].perTier), { kind: "range", min: 1300, max: 1450 });

  // Never the sum. $5,500 is the number Edward named as meaningless, and it is
  // what four rows of a summing row would have implied.
  assert.notEqual(
    displayRecovery(mine[0].perTier),
    { kind: "single", value: 5500 },
  );
});

test("TWO INSTANCES of one type → TWO rows, and that is real multiplicity", () => {
  // ── THE DISTINCTION THE WHOLE FILE TURNS ON ────────────────────────────
  //
  // Four tier entries of ONE charge is not four charges. Two charges IS two.
  // A fixture with only one instance cannot tell the two apart, so this one
  // carries both dimensions at once: 2 instances x 4 tiers = 8 entries.
  const rows = build(
    rollups([LEAF_A], TIERS, () => [
      component("inst-1", LEAF_A, 1450, 1450),
      component("inst-2", LEAF_A, 600, 600),
    ]),
  );
  const plates = rows.filter((r) => r.chargeInstanceId);
  assert.equal(plates.length, 2, "two instances, two decisions");
  assert.deepEqual(
    plates.map((r) => r.chargeInstanceId).sort(),
    ["inst-1", "inst-2"],
  );
  // Each keeps its own four scenarios, and neither absorbs the other's.
  for (const r of plates) assert.equal(r.perTier.length, 4);
  assert.deepEqual(displayCost(plates.find((r) => r.chargeInstanceId === "inst-1")!.perTier), {
    kind: "single",
    value: 1450,
  });
  assert.deepEqual(displayCost(plates.find((r) => r.chargeInstanceId === "inst-2")!.perTier), {
    kind: "single",
    value: 600,
  });
});

test("TIER COUNT ALONE CANNOT MOVE THE AMOUNT", () => {
  // ── THE PROPERTY, STATED DIRECTLY ──────────────────────────────────────
  //
  // The same charge, at the same cost, on quotes with one / two / four tiers.
  // The displayed amount must be identical. This is the assertion the old code
  // failed by construction — its answer was proportional to the tier count.
  const shown = [1, 2, 4].map((n) => {
    const tiers = TIERS.slice(0, n);
    const rows = build(rollups([LEAF_A], tiers, () => [legacy(500)]));
    const setup = rows.find((r) => r.chargeKey === "project_setup")!;
    return { n, tiers: setup.perTier.length, display: displayRecovery(setup.perTier) };
  });
  assert.deepEqual(shown.map((s) => s.tiers), [1, 2, 4], "the fixture really varies tier count");
  for (const s of shown) {
    assert.deepEqual(
      s.display,
      { kind: "single", value: 700 },
      `${s.n} tier(s) must show the same amount`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════
// The group control counts instances, never tier entries
// ══════════════════════════════════════════════════════════════════════

test("ONE instance across four tiers produces NO group control", () => {
  // The control appears when a type has two or more ROWS. With one instance
  // rendering four times it appeared for a group of one, offering "All 4 print
  // plates charges" — and using it would have sent four proposals carrying the
  // same instance id, which `persistChargeRecoverySet` refuses outright.
  const rows = build(
    rollups([LEAF_A], TIERS, () => [component("inst-1", LEAF_A, 1450, 1450)]),
  );
  const plates = rows.filter((r) => r.chargeInstanceId && r.chargeKey === "print_plates");
  assert.equal(plates.length, 1, "one row means the card renders no group control");
});

test("TWO instances DO produce a group of two", () => {
  const rows = build(
    rollups([LEAF_A], TIERS, () => [
      component("inst-1", LEAF_A, 1450, 1450),
      component("inst-2", LEAF_A, 600, 600),
    ]),
  );
  const plates = rows.filter((r) => r.chargeInstanceId && r.chargeKey === "print_plates");
  assert.equal(plates.length, 2);
  // One proposal per instance — the ids are distinct, so the duplicate-instance
  // refusal in `persistChargeRecoverySet` has nothing to refuse.
  assert.equal(new Set(plates.map((r) => r.chargeInstanceId)).size, 2);
});

test("collision labelling counts INSTANCES, not tier entries", () => {
  // One instance over four tiers is unambiguous and must carry no owner label;
  // labelling it would put lineage on a row nothing collides with.
  const one = build(rollups([LEAF_A], TIERS, () => [component("inst-1", LEAF_A, 1450, 1450)]));
  assert.equal(one.find((r) => r.chargeInstanceId === "inst-1")!.qualifier, null);
});

// ══════════════════════════════════════════════════════════════════════
// The collapse itself
// ══════════════════════════════════════════════════════════════════════

test("tierVector sums owners within a tier and keeps tiers apart", () => {
  const v = tierVector([
    { ownerRef: LEAF_A, ownerKind: "component" as const, tierId: T1, charge: legacy(300, 0) as never, manualAllInSell: false },
    { ownerRef: LEAF_B, ownerKind: "component" as const, tierId: T1, charge: legacy(200, 0) as never, manualAllInSell: false },
    { ownerRef: LEAF_A, ownerKind: "component" as const, tierId: T2, charge: legacy(300, 0) as never, manualAllInSell: false },
  ]);
  assert.equal(v.length, 2);
  assert.equal(v.find((t) => t.tierId === T1)!.cost, 500, "owners add inside a tier");
  assert.equal(v.find((t) => t.tierId === T2)!.cost, 300, "tiers do not add together");
});

test("an unknown recovery in ANY tier makes the whole display unknown", () => {
  // BV-013. Printing the known tiers would state a figure for a decision whose
  // economics are not fully governed — and the decision is one decision.
  const rows = build(
    rollups([LEAF_A], TIERS, (_l, t) => [
      component("inst-1", LEAF_A, 1000, t === T3 ? null : 1400),
    ]),
  );
  const row = rows.find((r) => r.chargeInstanceId === "inst-1")!;
  assert.deepEqual(displayRecovery(row.perTier), { kind: "unpriced" });
  // The cost is still known, and still a range-or-single on its own terms.
  assert.deepEqual(displayCost(row.perTier), { kind: "single", value: 1000 });
});

test("a flat charge does not become a range through floating-point noise", () => {
  const rows = build(rollups([LEAF_A], TIERS, () => [legacy(0.1 + 0.2, 0)]));
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(displayCost(setup.perTier).kind, "single");
});
