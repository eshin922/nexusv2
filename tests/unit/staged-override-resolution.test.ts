/**
 * A staged override must reach the cell it names.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * A staging key is `{canonicalQuoteLeafId}::{tierId}`. `CostingCellOverride`
 * is keyed on `quoteSkuId`, the ENGINE's SKU id. Those are different fields on
 * the same rollup, and the preview builder split the key and named its first
 * half `quoteSkuId` — asserting the equivalence in a variable name.
 *
 * Both are UUID strings, so nothing objected. The engine matched the row
 * against nothing and dropped it. Observed: a staged direct price of $9.50 on
 * a cell whose committed blend was $2.16 produced a chip, and **zero deltas
 * anywhere on the surface**.
 *
 * A second site had the mirror of it: the filter that removes a committed
 * override when one is staged over it built a staging-shaped key out of the
 * committed row's ENGINE id and looked it up in the canonical-keyed working
 * set. It never matched, so the committed row was never removed. Repairing
 * only the emission would have left both rows in the array and made
 * replacement depend on the engine's map insertion order — correct by
 * accident.
 *
 * ── WHY THE EXISTING INVARIANTS MISSED IT ─────────────────────────────────
 *
 * `costing-input-fidelity.test.ts` asserts a staged override changes the input
 * at `cellOverrides` and nowhere else. It did. Structural isolation says the
 * change landed in the right FIELD; it says nothing about whether the row
 * inside that field addresses anything real. Hence `effect validity` below —
 * an assertion about output movement, which is the only kind that could have
 * caught a row the engine silently ignored.
 *
 * ── AND WHY THE IDS DIFFER HERE ───────────────────────────────────────────
 *
 * `canonicalQuoteLeafId` and `id` are deliberately DIFFERENT strings on every
 * SKU below. On production data they often coincide, and a fixture where they
 * coincide cannot fail — it would pass with the bug still in place, which is
 * exactly how this survived.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  cellKey,
  engineCellKey,
  parseCellKey,
  resolveEngineCell,
  type CellRef,
} from "../../src/lib/pricing-staging.ts";
import {
  computeQuoteCosting,
  type CostingCellOverride,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const TIER = "tier-1";

// The distinction the defect erased, made unmissable.
const ENGINE_A = "engine-sku-AAAA";
const CANON_A = "canonical-leaf-AAAA";
const ENGINE_B = "engine-sku-BBBB";
const CANON_B = "canonical-leaf-BBBB";

const SKUS = [
  { id: ENGINE_A, canonicalQuoteLeafId: CANON_A },
  { id: ENGINE_B, canonicalQuoteLeafId: CANON_B },
];

// ── resolution validity ───────────────────────────────────────────────────

test("a staged cell resolves to exactly one engine cell", () => {
  const ref: CellRef = { quoteLeafId: CANON_A, tierId: TIER };
  assert.deepEqual(resolveEngineCell(ref, SKUS), {
    quoteSkuId: ENGINE_A,
    tierId: TIER,
  });
});

test("resolution does not pass the canonical id through as an engine id", () => {
  // The whole defect in one assertion. If these two are ever equal in a
  // fixture, that fixture cannot detect the bug.
  const resolved = resolveEngineCell({ quoteLeafId: CANON_A, tierId: TIER }, SKUS);
  assert.notEqual(resolved?.quoteSkuId, CANON_A);
  assert.equal(resolved?.quoteSkuId, ENGINE_A);
});

test("an unknown canonical id fails closed", () => {
  assert.equal(
    resolveEngineCell({ quoteLeafId: "canonical-leaf-NOPE", tierId: TIER }, SKUS),
    null,
  );
});

test("an ambiguous canonical id fails closed rather than taking the first", () => {
  // Two SKUs claiming one attachment is a contract break upstream. Picking
  // either would move a price on a line nobody chose.
  const dupes = [
    { id: "engine-1", canonicalQuoteLeafId: CANON_A },
    { id: "engine-2", canonicalQuoteLeafId: CANON_A },
  ];
  assert.equal(resolveEngineCell({ quoteLeafId: CANON_A, tierId: TIER }, dupes), null);
});

test("a SKU with no canonical attachment is never matched", () => {
  const skus = [{ id: ENGINE_A, canonicalQuoteLeafId: null }];
  assert.equal(resolveEngineCell({ quoteLeafId: CANON_A, tierId: TIER }, skus), null);
  // And an empty-string canonical id must not match an empty-string lookup.
  assert.equal(resolveEngineCell({ quoteLeafId: "", tierId: TIER }, skus), null);
});

test("the key helpers round-trip, and the two key spaces stay apart", () => {
  const ref: CellRef = { quoteLeafId: CANON_A, tierId: TIER };
  assert.deepEqual(parseCellKey(cellKey(ref)), ref);
  // A staging key and an engine key for the same cell are different strings.
  const engine = resolveEngineCell(ref, SKUS)!;
  assert.notEqual(cellKey(ref), engineCellKey(engine));
});

// ── effect validity ───────────────────────────────────────────────────────
//
// The assertions the structural invariants could not make: the preview OUTPUT
// has to move.

function input(overrides: CostingCellOverride[] = []): QuoteCostingInput {
  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.45 },
    skus: [
      {
        id: ENGINE_A,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "A",
        productName: "Leaf A",
        sortOrder: 0,
        retailBenchmark: null,
        canonicalQuoteLeafId: CANON_A,
      },
      {
        id: ENGINE_B,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "B",
        productName: "Leaf B",
        sortOrder: 1,
        retailBenchmark: null,
        canonicalQuoteLeafId: CANON_B,
      },
    ],
    tiers: [{ id: TIER, label: "10K", qty: 10_000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [ENGINE_A, ENGINE_B].map((id, i) => ({
      quoteSkuId: id,
      tierId: TIER,
      lineGroupId: `lg-${i}`,
      unitCost: 2,
      qtyPerSellableUnit: 1,
      category: "Primary",
      markupPct: null,
    })),
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: overrides,
    cellTargets: [],
  };
}

/** What the preview builder does, in the shape the provider now uses. */
function stagedOverrideRows(
  working: Record<string, number>,
  skus: QuoteCostingInput["skus"],
): { rows: CostingCellOverride[]; replaced: Set<string>; unresolved: number } {
  const rows: CostingCellOverride[] = [];
  const replaced = new Set<string>();
  let unresolved = 0;
  for (const [key, value] of Object.entries(working)) {
    const engine = resolveEngineCell(parseCellKey(key), skus);
    if (engine === null) {
      unresolved++;
      continue;
    }
    replaced.add(engineCellKey(engine));
    rows.push({ ...engine, sellPriceOverride: value });
  }
  return { rows, replaced, unresolved };
}

const COMMITTED = computeQuoteCosting(input());
const sellOf = (r: ReturnType<typeof computeQuoteCosting>) =>
  r.quoteRollup[0].totalRevenue;

test("a staged direct price moves the preview output", () => {
  // The defect's signature was this assertion failing while the input LOOKED
  // correctly staged: chip present, `cellOverrides` changed, output identical.
  const { rows } = stagedOverrideRows(
    { [cellKey({ quoteLeafId: CANON_A, tierId: TIER })]: 9.5 },
    input().skus,
  );
  const preview = computeQuoteCosting({ ...input(), cellOverrides: rows }, "preview");
  assert.ok(
    sellOf(preview) > sellOf(COMMITTED),
    `preview revenue ${sellOf(preview)} did not move from ${sellOf(COMMITTED)}`,
  );
});

test("staging the canonical id directly, as the bug did, moves nothing", () => {
  // The counter-proof. Without resolution the row is inert — which is what
  // makes the test above meaningful rather than tautological.
  const inert: CostingCellOverride[] = [
    { quoteSkuId: CANON_A, tierId: TIER, sellPriceOverride: 9.5 },
  ];
  const preview = computeQuoteCosting({ ...input(), cellOverrides: inert }, "preview");
  assert.equal(sellOf(preview), sellOf(COMMITTED));
});

test("a staged override REPLACES a committed one on the same cell", () => {
  const committedRow: CostingCellOverride = {
    quoteSkuId: ENGINE_A,
    tierId: TIER,
    sellPriceOverride: 4,
  };
  const { rows, replaced } = stagedOverrideRows(
    { [cellKey({ quoteLeafId: CANON_A, tierId: TIER })]: 9.5 },
    input().skus,
  );
  const merged = [
    ...input([committedRow]).cellOverrides.filter((o) => !replaced.has(engineCellKey(o))),
    ...rows,
  ];
  // Exactly one row for the cell. Not two resolved by insertion order.
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sellPriceOverride, 9.5);

  const withCommitted = computeQuoteCosting(input([committedRow]));
  const preview = computeQuoteCosting({ ...input(), cellOverrides: merged }, "preview");
  assert.ok(sellOf(preview) > sellOf(withCommitted), "9.50 must beat the committed 4.00");
});

test("an unresolvable staged override emits no row at all", () => {
  // Never emit something the engine cannot consume: an ignored row is
  // indistinguishable from no override while still showing a chip.
  const { rows, unresolved } = stagedOverrideRows(
    { [cellKey({ quoteLeafId: "canonical-leaf-GONE", tierId: TIER })]: 9.5 },
    input().skus,
  );
  assert.equal(unresolved, 1);
  assert.deepEqual(rows, []);
});

// ── lifts are unchanged ───────────────────────────────────────────────────

test("lift staging still uses canonical identity, untranslated", () => {
  // `CostingLift.quoteLeafId` is canonical by design. The repair must not have
  // dragged lifts across the boundary with overrides.
  const key = cellKey({ quoteLeafId: CANON_A, tierId: TIER });
  const { quoteLeafId, tierId } = parseCellKey(key);
  assert.equal(quoteLeafId, CANON_A);
  const lifted = computeQuoteCosting(
    { ...input(), lifts: [{ quoteLeafId, tierId, liftPct: 0.1 }] },
    "preview",
  );
  assert.ok(
    sellOf(lifted) > sellOf(COMMITTED),
    "a canonical-keyed lift must still reach the engine",
  );
});

test("a lift keyed on the ENGINE id instead would not apply", () => {
  // Symmetric counter-proof: the two identities are not interchangeable in
  // either direction, so neither path can be 'simplified' into the other.
  const wrong = computeQuoteCosting(
    { ...input(), lifts: [{ quoteLeafId: ENGINE_A, tierId: TIER, liftPct: 0.1 }] },
    "preview",
  );
  assert.equal(sellOf(wrong), sellOf(COMMITTED));
});
