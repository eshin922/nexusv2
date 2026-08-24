import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  projectCommercial,
  verifyProjectionTotals,
} from "../../src/lib/commercial-projection.ts";
import type { QuoteCostingResult } from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import { constructionRollup } from "../support/constructed-fixture.ts";

// ═══════════════════════════════════════════════════════════════════════
// The seven required proofs for the frozen commercial line set.
//
// Each is written to FAIL if the property is absent, not to pass if it is
// present. Where the property is about persistence rather than computation,
// the assertion is on the structural guarantee that makes recomputation
// impossible — a test that only checked a value would pass equally well
// against the recomputing implementation this slice replaces.
// ═══════════════════════════════════════════════════════════════════════

const TIER_A = "11111111-1111-1111-1111-111111111111";
const TIER_B = "22222222-2222-2222-2222-222222222222";

type PerTier = {
  tierId: string;
  requiredSellPerUnit: number;
  contributionCostPerUnit: number;
};

function bundle(opts: {
  skus: Array<{
    id: string;
    parentSkuId: string | null;
    skuRole: "leaf" | "assembly";
    skuLabel: string;
    productName: string;
    serviceIdentity?: string | null;
    qtyPerParent?: string | null;
  }>;
  rollups: Array<{ skuId: string; perTier: PerTier[] }>;
  production?: Array<Record<string, unknown>>;
  markupDefaults?: Record<string, number>;
  tierQty?: [number, number];
}): HydrateSnapshot {
  const [qa, qb] = opts.tierQty ?? [1000, 5000];
  const skuById = new Map(opts.skus.map((s) => [s.id, s]));
  const costingTiers: QuoteCostingResult["tiers"] = [
    { tierId: TIER_A, label: "Tier 1", qty: qa },
    { tierId: TIER_B, label: "Tier 2", qty: qb },
  ];
  return {
    markupDefaults: opts.markupDefaults ?? { Production: 0.4 },
    skus: opts.skus.map((s) => ({
      ...s,
      canonicalQuoteLeafId: s.id,
      qtyPerParent: s.qtyPerParent ?? null,
      sortOrder: 0,
      retailBenchmark: null,
    })),
    production: opts.production ?? [],
    costing: {
      // `tierId`, the engine's real key. Spelling this `id` is what the
      // original fixture did, agreeing with a cast in the projection instead
      // of with the engine — so eleven tests passed against a projection that
      // priced nothing at all. The fixture is now typed against the real
      // output shape below, which is what makes a repeat a compile error.
      tiers: costingTiers,
      skuRollups: opts.rollups.map((r) => {
        const s = skuById.get(r.skuId)!;
        // The construction the ENGINE would attach for this owner, built by
        // the engine's own functions. Charges live on the production row of a
        // LEAF and bubble to the assembly that owns it, so an assembly's rows
        // are those of its children — mirroring the engine rather than
        // restating it.
        const owned = (opts.production ?? []).filter((row) => {
          const leaf = skuById.get(row.quoteSkuId as string);
          return row.quoteSkuId === r.skuId || leaf?.parentSkuId === r.skuId;
        });
        const rate = (opts.markupDefaults ?? { Production: 0.4 }).Production ?? null;
        const construction = constructionRollup(r.skuId, owned as never, rate);
        const constructedByTier = new Map(
          construction.perTier.map((pt) => [pt.tierId, pt.constructed]),
        );
        return {
          skuId: r.skuId,
          canonicalQuoteLeafId: r.skuId,
          skuRole: s.skuRole,
          parentSkuId: s.parentSkuId,
          skuLabel: s.skuLabel,
          productName: s.productName,
          qtyPerParent: s.qtyPerParent ?? null,
          perTier: r.perTier.map((pt) => ({
            ...pt,
            constructed: constructedByTier.get(pt.tierId),
          })),
        };
      }).concat(
        // ASSEMBLY ROLLUPS THE ENGINE ALWAYS EMITS.
        //
        // A real bundle carries a rollup for every assembly; these fixtures
        // list only the rows a proof cares about. That was harmless while the
        // projection derived one-time charges itself, and is not now: the
        // charge amounts live on the owner's construction, so an absent
        // assembly rollup silently means "no charges" instead of "not stated".
        opts.skus
          .filter(
            (s) =>
              s.skuRole === "assembly" &&
              !opts.rollups.some((r) => r.skuId === s.id) &&
              (opts.production ?? []).some(
                (row) => skuById.get(row.quoteSkuId as string)?.parentSkuId === s.id,
              ),
          )
          .map((s) =>
            constructionRollup(
              s.id,
              (opts.production ?? []).filter(
                (row) => skuById.get(row.quoteSkuId as string)?.parentSkuId === s.id,
              ) as never,
              (opts.markupDefaults ?? { Production: 0.4 }).Production ?? null,
            ),
          ) as never,
      ),
    },
  } as unknown as HydrateSnapshot;
}

const priced = (t: string, sell: number): PerTier => ({
  tierId: t,
  requiredSellPerUnit: sell,
  contributionCostPerUnit: sell * 0.5,
});
const unpriced = (t: string): PerTier => ({
  tierId: t,
  requiredSellPerUnit: 0,
  contributionCostPerUnit: 0,
});

// ── PROOF 1 · Direct Service priced/unpriced states survive exactly ──────

test("1 · a Direct Service is a priced line of its own, classified as a service", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "svc",
          parentSkuId: null,
          skuRole: "leaf",
          skuLabel: "SVC-FORMULATION",
          productName: "Formulation",
          serviceIdentity: "formulation",
        },
      ],
      rollups: [
        { skuId: "svc", perTier: [priced(TIER_A, 2), priced(TIER_B, 2)] },
      ],
    }),
  );
  const line = p.lines.find((l) => l.displaySku === "SVC-FORMULATION");
  assert.ok(line, "the service is present as a commercial line");
  assert.equal(line.kind, "direct_service");
  assert.equal(line.serviceIdentity, "formulation");
  assert.equal(line.owningAssemblyId, null, "a service is top-level");
  assert.deepEqual(
    line.cells.map((c) => c.state),
    ["priced", "priced"],
  );
  // Its economics reach the tier total — the #298 defect was precisely that
  // a service could be present and contribute nothing.
  assert.equal(p.tiers[0].unitSubtotal, 2000);
});

test("1b · an UNPRICED Direct Service stays unpriced and never becomes $0.00", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "svc",
          parentSkuId: null,
          skuRole: "leaf",
          skuLabel: "SVC-OTHER",
          productName: "Other Service",
          serviceIdentity: "other_service",
        },
      ],
      rollups: [
        { skuId: "svc", perTier: [unpriced(TIER_A), unpriced(TIER_B)] },
      ],
    }),
  );
  const line = p.lines[0];
  assert.deepEqual(
    line.cells.map((c) => c.state),
    ["quote_on_request", "quote_on_request"],
  );
  assert.equal(p.tiers[0].unitSubtotal, 0);
  assert.equal(
    p.tiers[0].isProvisional,
    true,
    "an unpriced unit line makes the total a floor",
  );
});

// ── PROOF 2 · quote_on_request remains explicit ──────────────────────────

test("2 · unpriced is a STATE, not a null amount", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "a",
          parentSkuId: null,
          skuRole: "leaf",
          skuLabel: "A",
          productName: "A",
        },
        {
          id: "b",
          parentSkuId: null,
          skuRole: "leaf",
          skuLabel: "B",
          productName: "B",
        },
      ],
      rollups: [
        { skuId: "a", perTier: [priced(TIER_A, 4), unpriced(TIER_B)] },
        { skuId: "b", perTier: [priced(TIER_A, 1), priced(TIER_B, 1)] },
      ],
    }),
  );
  const a = p.lines.find((l) => l.displaySku === "A")!;
  // A discriminated union: the unpriced cell carries NO rate field at all, so
  // a consumer cannot read a rate off it and get a plausible zero.
  assert.equal(a.cells[1].state, "quote_on_request");
  assert.ok(
    !("unitRate" in a.cells[1]),
    "no rate is even readable on an unpriced cell",
  );
  assert.equal(p.tiers[0].isProvisional, false, "tier 1 is fully priced");
  assert.equal(p.tiers[1].isProvisional, true, "tier 2 is not");
});

// ── PROOF 3 · tier_commercial_total = unit subtotal + separately billed OTC

test("3 · the tier total is exactly its unit subtotal plus its separately billed OTC", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "asm",
          parentSkuId: null,
          skuRole: "assembly",
          skuLabel: "IG",
          productName: "Group",
        },
        {
          id: "leaf",
          parentSkuId: "asm",
          skuRole: "leaf",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
        },
      ],
      rollups: [
        { skuId: "leaf", perTier: [priced(TIER_A, 3), priced(TIER_B, 2)] },
      ],
      production: [
        {
          quoteSkuId: "leaf",
          tierId: TIER_A,
          allocateServiceFeesToCost: false,
          setupFeeTotal: 1000,
        },
        {
          quoteSkuId: "leaf",
          tierId: TIER_B,
          allocateServiceFeesToCost: false,
          setupFeeTotal: 1000,
        },
      ],
    }),
  );
  // Marked up at the governed Production rate (BV-013, 40%), not billed at cost.
  assert.equal(p.productionMarkupPct, 0.4);
  assert.equal(p.tiers[0].otcSubtotal, 1400);
  assert.equal(p.tiers[0].unitSubtotal, 3000);
  assert.equal(p.tiers[0].tierCommercialTotal, 4400);
  assert.deepEqual(
    verifyProjectionTotals(p),
    [],
    "totals equal the sum of their own cells",
  );
});

test("3b · with no governed Production rate the OTC line is unpriced, never at cost", () => {
  const p = projectCommercial(
    bundle({
      markupDefaults: { Other: 0.3 }, // no Production authority
      skus: [
        {
          id: "asm",
          parentSkuId: null,
          skuRole: "assembly",
          skuLabel: "IG",
          productName: "Group",
        },
        {
          id: "leaf",
          parentSkuId: "asm",
          skuRole: "leaf",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
        },
      ],
      rollups: [
        { skuId: "leaf", perTier: [priced(TIER_A, 3), priced(TIER_B, 2)] },
      ],
      production: [
        {
          quoteSkuId: "leaf",
          tierId: TIER_A,
          allocateServiceFeesToCost: false,
          setupFeeTotal: 1000,
        },
      ],
    }),
  );
  assert.equal(p.productionMarkupPct, null);
  assert.equal(
    p.tiers[0].otcSubtotal,
    0,
    "no rate ⇒ no priced OTC line, not a cost-priced one",
  );
});

// ── PROOF 4 · per-tier, not folded ───────────────────────────────────────

test("4 · a fee entered at ONE tier is billed at that tier only (no MAX fold)", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "asm",
          parentSkuId: null,
          skuRole: "assembly",
          skuLabel: "IG",
          productName: "Group",
        },
        {
          id: "leaf",
          parentSkuId: "asm",
          skuRole: "leaf",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
        },
      ],
      rollups: [
        { skuId: "leaf", perTier: [priced(TIER_A, 1), priced(TIER_B, 1)] },
      ],
      production: [
        {
          quoteSkuId: "leaf",
          tierId: TIER_A,
          allocateServiceFeesToCost: false,
          setupFeeTotal: 1000,
        },
        {
          quoteSkuId: "leaf",
          tierId: TIER_B,
          allocateServiceFeesToCost: false,
          setupFeeTotal: null,
        },
      ],
    }),
  );
  assert.equal(p.tiers[0].otcSubtotal, 1400);
  assert.equal(
    p.tiers[1].otcSubtotal,
    0,
    "tier 2 has no fee entered; MAX-across-tiers would have billed it 1400 anyway",
  );
});

test("4b · one ALLOCATED tier does not suppress the tiers that bill separately", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "asm",
          parentSkuId: null,
          skuRole: "assembly",
          skuLabel: "IG",
          productName: "Group",
        },
        {
          id: "leaf",
          parentSkuId: "asm",
          skuRole: "leaf",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
        },
      ],
      rollups: [
        { skuId: "leaf", perTier: [priced(TIER_A, 1), priced(TIER_B, 1)] },
      ],
      production: [
        // Tier 1 folds the fee into unit cost; tier 2 bills it separately.
        {
          quoteSkuId: "leaf",
          tierId: TIER_A,
          allocateServiceFeesToCost: true,
          setupFeeTotal: 1000,
        },
        {
          quoteSkuId: "leaf",
          tierId: TIER_B,
          allocateServiceFeesToCost: false,
          setupFeeTotal: 1000,
        },
      ],
    }),
  );
  assert.equal(
    p.tiers[0].otcSubtotal,
    0,
    "allocated ⇒ already inside the unit price, never billed twice",
  );
  assert.equal(
    p.tiers[1].otcSubtotal,
    1400,
    "OR-across-tiers would have silenced this line entirely",
  );
  const otc = p.lines.find((l) => l.kind === "otc")!;
  assert.deepEqual(otc.allocationByTier, ["allocated", "separately_billed"]);
  // An allocated cell is unpriced HERE but must not make the total provisional
  // — the economics are present, in the unit lines.
  assert.equal(p.tiers[0].isProvisional, false);
});

// ── PROOF 5 · ONE projection, two consumers ──────────────────────────────
//
// "PDF totals match the frozen matrix for every tier" is asserted as a
// property of the wiring, not by computing both and comparing. Comparing two
// reconstructions is exactly the check that passed while the PDF and the
// Sales Order disagreed.

test("5 · the PDF and the freeze consume the same projection instance", async () => {
  const resolver = await readFile("src/lib/customer-view-resolver.ts", "utf8");
  const quotes = await readFile("src/app/actions/quotes.ts", "utf8");

  // The resolver builds it once...
  const built = resolver.match(/projectCommercial\(/g) ?? [];
  assert.equal(
    built.length,
    1,
    "the projection is constructed exactly once per resolve",
  );
  // ...renders the customer document from it...
  assert.match(resolver, /const unitLines = projection\.lines\.filter/);
  assert.match(resolver, /projection\.lines[\s\S]{0,40}kind === "otc"/);
  // ...and hands the SAME object to the send path.
  assert.match(resolver, /commercial: projection,/);
  assert.match(
    quotes,
    /freezeCommercialLineSet\(tx, snapshot\.id, resolved\.commercial\)/,
  );

  // The freeze must not be able to build its own.
  const freeze = await readFile("src/lib/commercial-freeze.ts", "utf8");
  assert.doesNotMatch(
    freeze,
    /projectCommercial\(/,
    "the freeze takes a projection; it must never construct one",
  );
  assert.doesNotMatch(
    freeze,
    /getCostingBundle/,
    "and must never reach for costs of its own",
  );
});

// ── PROOF 6 · ACCEPT selects; it does not recompute ──────────────────────

test("6 · the accepted total is READ from the frozen matrix", async () => {
  const freeze = await readFile("src/lib/commercial-freeze.ts", "utf8");
  // It selects the accepted tier's stored total...
  assert.match(
    freeze,
    /eq\(quoteSnapshotTierTotals\.tierId, quote\.acceptedTierId\)/,
  );
  // ...and there is no second stored "accepted total" column to drift from it.
  const schema = await readFile("src/db/schema.ts", "utf8");
  assert.doesNotMatch(
    schema,
    /accepted_commercial_total/,
    "one number, read twice — never a second stored copy",
  );
  // The current version is found with IS NULL. `= NULL` is never true and
  // would have returned no snapshot for every quote, always.
  assert.match(freeze, /isNull\(quoteSnapshots\.supersededAt\)/);
});

// ── PROOF 7 · post-send immutability, structurally ───────────────────────

test("7 · the frozen matrix has no writer outside the send transaction", async () => {
  const files = [
    "src/app/actions/quotes.ts",
    "src/lib/commercial-freeze.ts",
    "src/lib/netsuite/mark-complete.ts",
  ];
  let writers = 0;
  for (const f of files) {
    const src = await readFile(f, "utf8");
    writers += (
      src.match(/insert\(quoteSnapshot(Lines|LineTiers|TierTotals)\)/g) ?? []
    ).length;
    assert.doesNotMatch(
      src,
      /update\(quoteSnapshot(Lines|LineTiers|TierTotals)\)/,
      `${f} must never UPDATE a frozen line`,
    );
  }
  assert.equal(
    writers,
    3,
    "exactly the three inserts in the freeze, and nowhere else",
  );
});

test("7b · the freeze refuses to persist a matrix that disagrees with itself", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        {
          id: "a",
          parentSkuId: null,
          skuRole: "leaf",
          skuLabel: "A",
          productName: "A",
        },
      ],
      rollups: [
        { skuId: "a", perTier: [priced(TIER_A, 4), priced(TIER_B, 4)] },
      ],
    }),
  );
  // Corrupt a stated total the way a future divergence would.
  const corrupted = {
    ...p,
    tiers: [
      {
        ...p.tiers[0],
        tierCommercialTotal: p.tiers[0].tierCommercialTotal + 1,
      },
      p.tiers[1],
    ],
  };
  const bad = verifyProjectionTotals(corrupted);
  assert.equal(
    bad.length,
    1,
    "the check can express the failure it exists to exclude",
  );
  assert.equal(bad[0].tierId, TIER_A);
});

// ── a line's quantity is its own, not the tier's ─────────────────────────

test("unitRate × quantity === lineAmount on every priced cell", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "G" },
        { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", qtyPerParent: "2" },
      ],
      rollups: [{ skuId: "leaf", perTier: [priced(TIER_A, 3), priced(TIER_B, 2)] }],
      production: [
        { quoteSkuId: "leaf", tierId: TIER_A, allocateServiceFeesToCost: false, setupFeeTotal: 100 },
      ],
    }),
  );
  for (const line of p.lines) {
    line.cells.forEach((c, i) => {
      if (c.state !== "priced") return;
      assert.equal(
        c.unitRate * c.quantity,
        c.lineAmount,
        `${line.displayName} @ tier ${i}: rate × quantity must be the amount`,
      );
    });
  }
});

test("a one-time charge is quantity 1, not the tier's unit count", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "G" },
        { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", qtyPerParent: "1" },
      ],
      rollups: [{ skuId: "leaf", perTier: [priced(TIER_A, 1), priced(TIER_B, 1)] }],
      production: [
        { quoteSkuId: "leaf", tierId: TIER_A, allocateServiceFeesToCost: false, setupFeeTotal: 100 },
      ],
    }),
  );
  const otc = p.lines.find((l) => l.kind === "otc")!;
  const cell = otc.cells[0];
  assert.equal(cell.state, "priced");
  if (cell.state !== "priced") return;
  // The tier ships 1,000 units. The fee is charged once. Storing the tier's
  // quantity here made `quantity × rate` read $140,000 for a $140 charge.
  assert.equal(cell.quantity, 1);
  assert.equal(cell.unitRate, cell.lineAmount);
});

test("a member's quantity expands by qty-per-parent, and the amount follows", () => {
  const p = projectCommercial(
    bundle({
      skus: [
        { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "G" },
        { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", qtyPerParent: "3" },
      ],
      rollups: [{ skuId: "leaf", perTier: [priced(TIER_A, 2), priced(TIER_B, 2)] }],
      tierQty: [1000, 5000],
    }),
  );
  const member = p.lines.find((l) => l.kind === "item_group_member")!;
  const cell = member.cells[0];
  if (cell.state !== "priced") throw new Error("expected priced");
  // Three of this component per finished unit, 1,000 units ordered.
  assert.equal(cell.quantity, 3000);
  assert.equal(cell.lineAmount, 6000);
});

test("the freeze writes the line quantity, not the tier's", async () => {
  const src = await readFile("src/lib/commercial-freeze.ts", "utf8");
  assert.match(src, /quantity: cell\.state === "priced" \? cell\.quantity : tier\.quantity/);
});
