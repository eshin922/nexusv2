/**
 * The legacy OTC column loop is the authority for COLUMNS, and for nothing else.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `commercial-projection.ts` has two OTC producers: a loop over the fixed
 * `OTC_FEES` column list, and a loop over component charge instances. The
 * column loop found its charge with
 *
 *     .find((c) => c.chargeKey === chargeKey)
 *
 * — key only, no owner. Three component charge types share a key with a legacy
 * column, so a component-owned charge of one of those types was emitted TWICE:
 * once here, attributed to the assembly, and once by the component loop.
 *
 *   tooling         <-> toolingTotal
 *   artwork_plate   <-> artworkTotal
 *   other_service   <-> otherServiceTotal
 *
 * `print_plates` and `samples` have no column and were never exposed.
 *
 * ── WHY THE NULL COLUMN DID NOT SAVE IT ─────────────────────────────────
 *
 * The loop gates on "does this assembly have a production ROW", then reads the
 * amount from the CONSTRUCTED charge — never from the column. An Item Group
 * carrying no production still has a row with every column NULL, which is its
 * ordinary state, so the gate passed and a NULL column emitted a real amount.
 *
 * ── MEASURED ON O3 ──────────────────────────────────────────────────────
 *
 * DPS-1074, one component-owned Tooling on a leaf, all legacy columns NULL.
 * Frozen customer document: $16,848 of one-time fees at Tier 2. Governed
 * frozen instructions: $9,168. The difference was one $7,680 tooling charge,
 * counted twice, in a SENT artifact.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────
 *
 * Both directions, for every key in the overlap: an assembly-owned charge
 * still emits exactly once, and a component-owned charge of the same key emits
 * only through the component path. A repair that merely de-duplicated after
 * projection would satisfy the count and leave the wrong producer producing,
 * so the negative is asserted at the LINE KEY: no `otc:<assembly>:<column>`
 * line may exist for a charge nobody put in that column.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  chargeEconomicsFor,
  componentChargeEconomics,
} from "../../src/lib/costing.ts";
import { constructCommercial } from "../../src/lib/commercial-recovery/construct.ts";
import {
  COMPONENT_CHARGE_KEYS,
  OTC_COLUMN_TO_CHARGE,
} from "../../src/lib/commercial-recovery/registry.ts";
import type { QuoteCostingResult } from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";

const TIER = "11111111-1111-1111-1111-111111111111";
const ASM = "asm";
const LEAF = "leaf";
const INST = "inst-1111";

/** The three keys that share a name with a legacy column. */
const OVERLAP = [
  { key: "tooling", column: "toolingTotal", priceable: true },
  { key: "artwork_plate", column: "artworkTotal", priceable: true },
  // `other_service` is deliberately UNCLASSIFIED in the component markup
  // authority, so a component-owned one resolves no rate and prices nothing
  // (BV-013). It is still in the overlap — the legacy loop could still reach
  // it by key — but it can never produce a component line to double.
  { key: "other_service", column: "otherServiceTotal", priceable: false },
] as const;

/** The two that do not. Controls: they must be unaffected by the repair. */
const NON_OVERLAP = [
  { key: "print_plates", category: "Tooling" },
  { key: "samples", category: "Manufacturing" },
] as const;

const MARKUPS: Record<string, number> = { Tooling: 0.2, Manufacturing: 0.3, Production: 0.4 };

/**
 * A bundle carrying an assembly with a production row, and optionally a
 * component-owned charge on a leaf inside it.
 *
 * Both economics sets are concatenated into ONE `constructCommercial` call,
 * exactly as `computeQuoteCosting` does — a fixture that kept them apart would
 * not reproduce the state the projection actually reads.
 */
function bundle(opts: {
  column?: { field: string; amount: number };
  component?: { key: string; cost: number; elected: "separate" | "included" };
}): HydrateSnapshot {
  const tiers: QuoteCostingResult["tiers"] = [{ tierId: TIER, label: "Tier 1", qty: 1000 }];
  const prodRow: any = {
    assemblyId: ASM,
    tierId: TIER,
    allocateServiceFeesToCost: false,
    ...(opts.column ? { [opts.column.field]: opts.column.amount } : {}),
  };

  const legacy = chargeEconomicsFor(prodRow, MARKUPS.Production);
  const component = opts.component
    ? componentChargeEconomics(
        [
          {
            chargeInstanceId: INST,
            tierId: TIER,
            chargeKey: opts.component.key as never,
            ownerRef: LEAF,
            cost: opts.component.cost,
          },
        ],
        MARKUPS,
      )
    : [];

  const elections = opts.component
    ? [{ chargeKey: opts.component.key as never, chargeInstanceId: INST, mode: opts.component.elected }]
    : [];

  const constructed = constructCommercial(
    [...legacy, ...component] as never,
    elections as never,
    false,
    1000,
  );

  return {
    markupDefaults: MARKUPS,
    skus: [
      { id: ASM, parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "Group", canonicalQuoteLeafId: ASM, qtyPerParent: null, sortOrder: 0, retailBenchmark: null },
      { id: LEAF, parentSkuId: ASM, skuRole: "leaf", skuLabel: "L", productName: "Leaf", canonicalQuoteLeafId: LEAF, qtyPerParent: "1", sortOrder: 0, retailBenchmark: null },
    ],
    production: [],
    assemblyProduction: [prodRow],
    componentChargeMeta: opts.component
      ? [{ chargeInstanceId: INST, chargeKey: opts.component.key, label: null, quoteLeafId: LEAF }]
      : [],
    costing: {
      tiers,
      skuRollups: [
        { skuId: ASM, skuRole: "assembly", perTier: [{ tierId: TIER, constructed }] },
        {
          skuId: LEAF,
          canonicalQuoteLeafId: LEAF,
          skuRole: "leaf",
          parentSkuId: ASM,
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
          perTier: [{ tierId: TIER, requiredSellPerUnit: 1, contributionCostPerUnit: 0.5 }],
        },
      ],
    },
  } as unknown as HydrateSnapshot;
}

const otcLines = (b: HydrateSnapshot) =>
  projectCommercial(b).lines.filter((l: any) => l.kind === "otc");
/** Lines the LEGACY COLUMN loop produced — identified by its key shape. */
const columnLines = (b: HydrateSnapshot) =>
  otcLines(b).filter((l: any) => l.key.startsWith(`otc:${ASM}:`));
/** Lines the COMPONENT loop produced. */
const componentLines = (b: HydrateSnapshot) =>
  otcLines(b).filter((l: any) => !l.key.startsWith(`otc:${ASM}:`));

// ══════════════════════════════════════════════════════════════════════
// The overlap set — both directions, per key
// ══════════════════════════════════════════════════════════════════════

for (const { key, column, priceable } of OVERLAP) {
  test(`${key} · an ASSEMBLY-owned column charge still emits exactly once`, () => {
    // The repair must not cost the legacy path its own charges.
    const lines = columnLines(bundle({ column: { field: column, amount: 1000 } }));
    assert.equal(lines.length, 1, `${column} must still produce its line`);
    assert.equal(lines[0].key, `otc:${ASM}:${column}`);
  });

  test(`${key} · a COMPONENT-owned charge is NOT emitted by the legacy loop`, () => {
    // The defect, stated at the LINE KEY rather than as a count. A repair that
    // de-duplicated afterwards would still produce this key, for a charge
    // nobody put in that column.
    const b = bundle({ component: { key, cost: 500, elected: "separate" } });
    assert.deepEqual(
      columnLines(b).map((l: any) => l.key),
      [],
      `no otc:${ASM}:${column} line may exist for a component-owned ${key}`,
    );
  });

  test(`${key} · the component path emits it ${priceable ? "once when elected separate" : "NEVER — no governed rate (BV-013)"}`, () => {
    const b = bundle({ component: { key, cost: 500, elected: "separate" } });
    const lines = componentLines(b);
    if (!priceable) {
      // Unknown is not zero. An unclassified charge declines to state an
      // amount rather than billing one at cost, so there is no line to double
      // in the first place — and the legacy loop must still not invent one.
      assert.deepEqual(lines.map((l: any) => l.key), []);
      return;
    }
    assert.equal(lines.length, 1, "elected separate emits exactly one component line");
    assert.equal(lines[0].quoteLeafId, LEAF, "and it is owned by the component");
  });

  test(`${key} · BOTH together emit exactly two lines, one per owner`, () => {
    // The real O3 shape once a column is also in use: two genuinely different
    // charges of one type, each emitted by its own authority. Collapsing to one
    // would be the opposite defect.
    const b = bundle({
      column: { field: column, amount: 1000 },
      component: { key, cost: 500, elected: "separate" },
    });
    assert.equal(columnLines(b).length, 1, "the column's own charge");
    assert.equal(
      componentLines(b).length,
      priceable ? 1 : 0,
      priceable ? "the component's own charge" : "unclassified: no component line to emit",
    );
  });

  test(`${key} · an INCLUDED component charge emits no separate line at all`, () => {
    const b = bundle({ component: { key, cost: 500, elected: "included" } });
    assert.deepEqual(columnLines(b).map((l: any) => l.key), []);
    assert.deepEqual(componentLines(b).map((l: any) => l.key), []);
  });
}

// ══════════════════════════════════════════════════════════════════════
// The controls — keys with no column were never exposed, and must not move
// ══════════════════════════════════════════════════════════════════════

for (const { key } of NON_OVERLAP) {
  test(`${key} · has no legacy column, and is unchanged by the repair`, () => {
    const b = bundle({ component: { key, cost: 500, elected: "separate" } });
    assert.deepEqual(columnLines(b).map((l: any) => l.key), [], "never had a column to collide with");
    assert.equal(componentLines(b).length, 1, "and still emits once through its own path");
  });
}

// ══════════════════════════════════════════════════════════════════════
// The repair is at the boundary, not a post-hoc filter
// ══════════════════════════════════════════════════════════════════════

test("the legacy loop discriminates on OWNER, positively", () => {
  const src = readFileSync("src/lib/commercial-projection.ts", "utf8");
  assert.match(
    src,
    /c\.chargeKey === chargeKey && c\.ownerKind === "assembly"/,
    "the column loop must consume assembly-owned charges only",
  );
});

test("nothing de-duplicates OTC lines after projection", () => {
  // A filter on label, amount, SKU or key would satisfy every count above and
  // leave the illegitimate producer producing — the line would simply be
  // dropped later, by a rule nobody could point at.
  const src = readFileSync("src/lib/commercial-projection.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const shape of [
    /dedupe/i,
    /\.filter\([^)]*displayName\s*===/,
    /new Set\([^)]*displayName/,
    /\.filter\([^)]*lineAmount\s*===/,
  ]) {
    assert.doesNotMatch(src, shape, "OTC emission must be decided at the producer");
  }
});

test("the overlap set is exactly these three keys", () => {
  // DERIVED from the two registries by importing them, not by parsing their
  // source. The first version of this read the file with a regex and reported
  // a set that was wrong in both directions — a measurement that cannot see
  // what it is measuring.
  //
  // A new component charge type that acquires a legacy column joins the exposed
  // set silently; this fails when it does, and every key here needs its own
  // falsification above.
  const columnKeys = new Set(Object.values(OTC_COLUMN_TO_CHARGE));
  const overlap = COMPONENT_CHARGE_KEYS.filter((k) => columnKeys.has(k)).slice().sort();
  assert.deepEqual(overlap, ["artwork_plate", "other_service", "tooling"]);
  assert.deepEqual(
    OVERLAP.map((o) => o.key).slice().sort(),
    overlap,
    "the fixture's overlap list must match the registries'",
  );
  // And the controls really have no column.
  for (const { key } of NON_OVERLAP) {
    assert.ok(!columnKeys.has(key), `${key} must have no legacy column`);
  }
});
