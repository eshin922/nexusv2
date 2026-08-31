/**
 * The customer document bills a member at `tierQty x qtyPerParent`.
 *
 * ── THE DEFECT THIS HOLDS CLOSED ────────────────────────────────────────
 *
 * `customer-view-resolver` took the governed per-line RATE and then rebuilt the
 * extension as `rate x TIER quantity`. That is the tier's fact, not the line's.
 * `projectCommercial` had already resolved the line's own quantity, and the
 * resolver discarded it.
 *
 * It agreed for as long as every member carried `qtyPerParent = 1`, because
 * then `tierQty === cell.quantity` — the two constructions matched by
 * coincidence, not by construction (Pattern 56). The first member in the estate
 * to carry 2 shorted its line and its tier total by exactly one multiple of the
 * rate, UNDER-billing the customer against a Sales Order that books the correct
 * quantity from the freeze.
 *
 * ── WHY THE q=1 CONTROLS MATTER MOST ────────────────────────────────────
 *
 * Every q=1 case below passes against BOTH the repair and the defect. They are
 * here to prove the historical population could never have exposed this — not
 * to prove the fix. Only the q=2 and q=3 cases can fail, which is what makes
 * them evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeQuoteCosting } from "@/lib/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import type { QuoteCostingInput } from "@/lib/costing";

const TIERS = [
  { id: "t1", label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
  { id: "t2", label: "Tier 2", qty: 2500, sortOrder: 1, tierPriceAdjPct: null },
  { id: "t3", label: "Tier 3", qty: 6000, sortOrder: 2, tierPriceAdjPct: null },
  { id: "t4", label: "Tier 4", qty: 15000, sortOrder: 3, tierPriceAdjPct: null },
];
const TIER_QTY = [1000, 2500, 6000, 15000];

/** One Item Group, three members at q = 1, 2 and 3, plus a Direct Product. */
function input(): QuoteCostingInput {
  const pkg = (leaf: string, cost: number) =>
    TIERS.map((t) => ({
      quoteSkuId: leaf,
      tierId: t.id,
      lineGroupId: `${leaf}-pkg`,
      unitCost: cost,
      qtyPerSellableUnit: 1,
      category: "Primary",
      markupPct: 0,
    }));

  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null, freightMarkupPct: 0 },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.45, Production: 0.4 },
    chargeElections: [],
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const,
        skuLabel: "IG", productName: "Group", sortOrder: 0, retailBenchmark: null },
      { id: "m1", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const,
        skuLabel: "M1", productName: "Member q1", sortOrder: 0, retailBenchmark: null },
      { id: "m2", parentSkuId: "asm", qtyPerParent: 2, skuRole: "leaf" as const,
        skuLabel: "M2", productName: "Member q2", sortOrder: 1, retailBenchmark: null },
      { id: "m3", parentSkuId: "asm", qtyPerParent: 3, skuRole: "leaf" as const,
        skuLabel: "M3", productName: "Member q3", sortOrder: 2, retailBenchmark: null },
      // Direct Product — no parent, so it has no membership multiplicity at all.
      { id: "dp", parentSkuId: null, qtyPerParent: null, skuRole: "leaf" as const,
        skuLabel: "DP", productName: "Direct", sortOrder: 3, retailBenchmark: null },
    ],
    tiers: TIERS,
    // Deliberately unequal, so a swap between members is visible in a total.
    packaging: [...pkg("m1", 1.37), ...pkg("m2", 0.21), ...pkg("m3", 0.44), ...pkg("dp", 0.63)],
    production: [],
    assemblyProduction: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

function project() {
  const costing = computeQuoteCosting(input());
  const inp = input();
  const bundle = {
    markupDefaults: inp.markupDefaults, skus: inp.skus,
    production: inp.production, assemblyProduction: inp.assemblyProduction, costing,
  } as never;
  return { costing, doc: projectCommercial(bundle) };
}

const lineFor = (doc: ReturnType<typeof project>["doc"], sku: string) =>
  doc.lines.find((l) => l.displaySku === sku || l.key.includes(sku));

/** The repaired resolver's arithmetic: consume the governed extension. */
const repaired = (cell: { state: string; lineAmount?: number }) =>
  cell.state === "priced" ? (cell.lineAmount as number) : null;

/** The DEFECT: rebuild the extension from the TIER's quantity. */
const defective = (cell: { state: string; unitRate?: number }, ti: number) =>
  cell.state === "priced" ? (cell.unitRate as number) * TIER_QTY[ti] : null;

// ══════════════════════════════════════════════════════════════════════
// Governed quantity, per member, at every tier
// ══════════════════════════════════════════════════════════════════════

for (const [sku, q] of [["M1", 1], ["M2", 2], ["M3", 3], ["DP", 1]] as const) {
  test(`${sku} · membership q=${q} · line quantity is tierQty x q at all four tiers`, () => {
    const { doc } = project();
    const line = lineFor(doc, sku);
    assert.ok(line, `${sku} has no document line`);

    line.cells.forEach((cell, ti) => {
      assert.equal(cell.state, "priced", `${sku} tier ${ti} not priced`);
      if (cell.state !== "priced") return;

      // line identity, membership quantity, customer line quantity
      assert.equal(cell.quantity, TIER_QTY[ti] * q, `${sku} tier ${ti} customer quantity`);

      // INDEPENDENTLY computed: rate x governed customer quantity.
      const expected = cell.unitRate * (TIER_QTY[ti] * q);
      assert.ok(
        Math.abs(cell.lineAmount - expected) < 5e-6,
        `${sku} tier ${ti}: amount ${cell.lineAmount} != rate ${cell.unitRate} x qty ${TIER_QTY[ti] * q}`,
      );

      // What the resolver now consumes must equal that.
      assert.equal(repaired(cell), cell.lineAmount);
    });
  });
}

test("the parent tier quantity is untouched by member multiplicity", () => {
  const { doc } = project();
  doc.tiers.forEach((t, ti) => {
    assert.equal(t.quantity, TIER_QTY[ti], `tier ${ti} quantity moved`);
  });
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFICATION — reintroduce the defect
// ══════════════════════════════════════════════════════════════════════

test("FALSIFY · the old tierQty reconstruction fails q>1 and passes q=1", () => {
  const { doc } = project();

  for (const [sku, q] of [["M1", 1], ["DP", 1]] as const) {
    const line = lineFor(doc, sku)!;
    line.cells.forEach((cell, ti) => {
      if (cell.state !== "priced") return;
      // THE CONTROL. Both constructions agree, which is exactly why the
      // historical population — every member at q=1 — could never expose this.
      assert.ok(
        Math.abs((defective(cell, ti) as number) - (repaired(cell) as number)) < 5e-6,
        `${sku} at q=${q} should be indistinguishable under both constructions`,
      );
    });
  }

  for (const [sku, q] of [["M2", 2], ["M3", 3]] as const) {
    const line = lineFor(doc, sku)!;
    line.cells.forEach((cell, ti) => {
      if (cell.state !== "priced") return;
      const bad = defective(cell, ti) as number;
      const good = repaired(cell) as number;
      assert.notEqual(bad, good, `${sku} tier ${ti} must be distinguishable`);
      // The defect divides the correct amount by exactly the multiplicity —
      // it bills one of every q consumed.
      assert.ok(
        Math.abs(bad * q - good) < 5e-6,
        `${sku} tier ${ti}: defect ${bad} x ${q} should equal ${good}`,
      );
    });
  }
});

test("FALSIFY · the tier total is short by exactly the missed multiples", () => {
  const { doc, costing } = project();
  doc.tiers.forEach((t, ti) => {
    const repairedTotal = doc.lines.reduce((sum, l) => {
      const c = l.cells[ti];
      return sum + (c.state === "priced" ? c.lineAmount : 0);
    }, 0);
    const defectiveTotal = doc.lines.reduce((sum, l) => {
      const c = l.cells[ti];
      return sum + (c.state === "priced" ? (defective(c, ti) as number) : 0);
    }, 0);

    // The repaired document agrees with the ENGINE — and for the right reason:
    // both count the same governed quantity, not because two errors cancel.
    assert.ok(
      Math.abs(repairedTotal - costing.quoteRollup[ti].totalRevenue) < 5e-4,
      `tier ${ti}: document ${repairedTotal} != engine ${costing.quoteRollup[ti].totalRevenue}`,
    );

    // The defect UNDER-states. Never over — it drops multiples, never adds.
    assert.ok(defectiveTotal < repairedTotal, `tier ${ti}: defect must under-state`);

    // Short by exactly the missed multiples of M2 (x1) and M3 (x2).
    const m2 = lineFor(doc, "M2")!.cells[ti];
    const m3 = lineFor(doc, "M3")!.cells[ti];
    const missed =
      (m2.state === "priced" ? m2.unitRate * TIER_QTY[ti] * 1 : 0) +
      (m3.state === "priced" ? m3.unitRate * TIER_QTY[ti] * 2 : 0);
    assert.ok(
      Math.abs(repairedTotal - defectiveTotal - missed) < 5e-6,
      `tier ${ti}: shortfall ${repairedTotal - defectiveTotal} != missed ${missed}`,
    );
  });
});

test("rates are untouched by the repair — only quantity and extension move", () => {
  const { doc } = project();
  // A rate is per unit of the component's own line. Multiplicity scales the
  // QUANTITY, never the price of one unit.
  // The fixture prices at markup 0, so the rate IS the component cost. What
  // matters is that it does not carry q: M2 at q=2 must still price at its own
  // 0.21, not 0.42. A rate that moved with multiplicity would double-count,
  // because the quantity already carries it.
  for (const [sku, cost] of [["M1", 1.37], ["M2", 0.21], ["M3", 0.44], ["DP", 0.63]] as const) {
    const cell = lineFor(doc, sku)!.cells[0];
    if (cell.state !== "priced") throw new Error(`${sku} unpriced`);
    assert.ok(
      Math.abs(cell.unitRate - cost) < 5e-6,
      `${sku} rate ${cell.unitRate} != ${cost} — multiplicity leaked into the rate`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════
// Fixed charges must NOT scale with membership multiplicity
// ══════════════════════════════════════════════════════════════════════

test("the resolver reads OTC amounts, and never multiplies them", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/lib/customer-view-resolver.ts"),
    "utf8",
  );

  // A one-time charge is billed once. The OTC path already consumed the
  // governed amount and must keep doing so — this repair must not have
  // introduced any quantity arithmetic on that path.
  assert.match(src, /tierAmounts: l\.cells\.map\(\(c\) => \(c\.state === "priced" \? c\.lineAmount : null\)\)/);
  assert.match(src, /tierLineTotals: line\.cells\.map\(/);
  // No IMPORT and no call site remain. The name still appears in the comment
  // recording what was removed and why, which is the point -- asserting on the
  // bare mention would delete the explanation along with the defect.
  assert.doesNotMatch(src, /import \{[^}]*composeLineTotals/);
  assert.doesNotMatch(src, /tierLineTotals: composeLineTotals/);
  // No ARITHMETIC on multiplicity. The identifier appears in the comment
  // explaining why the extension is consumed rather than rebuilt; what must
  // never appear is a second formula that multiplies by it here.
  assert.doesNotMatch(src, /[*]\s*qtyPerParent|qtyPerParent\s*[*]/,
    "CustomerView must not compute its own multiplicity");
});

test("composeLineTotals is deleted, not merely unused", () => {
  const money = readFileSync(
    path.join(process.cwd(), "src/lib/customer-money.ts"),
    "utf8",
  );
  assert.doesNotMatch(money, /export function composeLineTotals/);
  // The reason is recorded where it stood, so it cannot come back as a tidy-up.
  assert.match(money, /composeLineTotals` STOOD HERE/);
});
