/**
 * R12 load-bearing 22 — the cost base a staged decision was evaluated against.
 *
 * A PM stages three lifts, Logistics updates a freight leg, the PM applies —
 * against which costs? Apply must refuse rather than commit silently against
 * numbers nobody reviewed.
 *
 * **The half that matters more is what it does NOT fire on.** A guard that
 * refuses on the operator's own staging act, or on row order out of Postgres,
 * gets ignored — and an ignored guard is worse than none, because everyone
 * believes it is working.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { costBaseFingerprint } from "../../src/lib/pricing-cost-base.ts";
import type { QuoteCostingInput } from "../../src/lib/costing.ts";

const SKU = "sku-1";
const TIER_A = "tier-a";
const TIER_B = "tier-b";

function base(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: {
      id: "q-1",
      globalPriceAdjPct: 0,
      targetMarginPct: null,
      freightMarkupPct: 0.1,
    },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.4, Secondary: 0.3 },
    skus: [
      {
        id: SKU,
        canonicalQuoteLeafId: "ql-1",
        parentSkuId: null,
        qtyPerParent: 1,
        skuRole: "leaf",
        skuLabel: "BTL",
        productName: "Bottle",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [
      { id: TIER_A, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: TIER_B, label: "T2", qty: 5000, sortOrder: 1, tierPriceAdjPct: null },
    ],
    packaging: [
      {
        quoteSkuId: SKU,
        tierId: TIER_A,
        lineGroupId: "lg-1",
        unitCost: 1.25,
        qtyPerSellableUnit: 1,
        category: "Primary",
        markupPct: 0.4,
      },
      {
        quoteSkuId: SKU,
        tierId: TIER_B,
        lineGroupId: "lg-1",
        unitCost: 1.1,
        qtyPerSellableUnit: 1,
        category: "Primary",
        markupPct: 0.4,
      },
    ],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightComponentTierCosts: [],
    freightShipmentBreaks: [],
    cellOverrides: [],
    cellTargets: [],
    lifts: [],
    ...over,
  } as QuoteCostingInput;
}

// ── what must NOT move it ─────────────────────────────────────────────────

test("staging a LIFT does not move the fingerprint", () => {
  // The load-bearing case. A guard that fires on the operator's own act is a
  // guard nobody will read.
  const a = costBaseFingerprint(base());
  const b = costBaseFingerprint(
    base({ lifts: [{ quoteLeafId: "ql-1", tierId: TIER_A, liftPct: 0.077 }] }),
  );
  assert.equal(a, b);
});

test("staging a DIRECT PRICE does not move it", () => {
  const a = costBaseFingerprint(base());
  const b = costBaseFingerprint(
    base({ cellOverrides: [{ quoteSkuId: SKU, tierId: TIER_A, sellPriceOverride: 9.5 }] }),
  );
  assert.equal(a, b);
});

test("moving the QUOTE-WIDE adjustment does not move it", () => {
  const a = costBaseFingerprint(base());
  const b = costBaseFingerprint(
    base({ quote: { ...base().quote, globalPriceAdjPct: 0.25 } }),
  );
  assert.equal(a, b);
});

test("moving a PER-TIER adjustment does not move it", () => {
  const a = costBaseFingerprint(base());
  const shifted = base();
  shifted.tiers = shifted.tiers.map((t) =>
    t.id === TIER_A ? { ...t, tierPriceAdjPct: 0.13 } : t,
  );
  assert.equal(a, costBaseFingerprint(shifted));
});

test("row ORDER does not move it", () => {
  // Order out of Postgres is not a fact about the quote. A fingerprint that
  // moved with it would refuse Apply for a reason nobody could explain.
  const a = base();
  const b = base();
  b.packaging = [...b.packaging].reverse();
  b.tiers = [...b.tiers].reverse();
  b.skus = [...b.skus].reverse();
  assert.equal(costBaseFingerprint(a), costBaseFingerprint(b));
});

test("float noise below a millionth does not move it", () => {
  const b = base();
  b.packaging = b.packaging.map((p) => ({ ...p, unitCost: p.unitCost! + 1e-9 }));
  assert.equal(costBaseFingerprint(base()), costBaseFingerprint(b));
});

// ── what MUST move it ─────────────────────────────────────────────────────

test("a packaging unit cost moving is a moved base", () => {
  const b = base();
  b.packaging = b.packaging.map((p) =>
    p.tierId === TIER_A ? { ...p, unitCost: 1.26 } : p,
  );
  assert.notEqual(costBaseFingerprint(base()), costBaseFingerprint(b));
});

test("a tier QUANTITY moving is a moved base", () => {
  // Every per-unit allocation divides by it.
  const b = base();
  b.tiers = b.tiers.map((t) => (t.id === TIER_A ? { ...t, qty: 1200 } : t));
  assert.notEqual(costBaseFingerprint(base()), costBaseFingerprint(b));
});

test("the firm floor moving is a moved base", () => {
  // It changes what compliant MEANS. A lift staged to clear a 25% floor is not
  // the same decision under a 30% one.
  assert.notEqual(
    costBaseFingerprint(base()),
    costBaseFingerprint(
      base({ firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.3 } }),
    ),
  );
});

test("a markup default moving is a moved base", () => {
  assert.notEqual(
    costBaseFingerprint(base()),
    costBaseFingerprint(base({ markupDefaults: { Primary: 0.45, Secondary: 0.3 } })),
  );
});

test("a SKU leaving the quote is a moved base", () => {
  // Population changes what is blended.
  assert.notEqual(costBaseFingerprint(base()), costBaseFingerprint(base({ skus: [] })));
});

test("a freight amount moving is a moved base — the case §7 names", () => {
  // "A PM stages three lifts, Logistics updates a freight leg, the PM applies."
  assert.notEqual(
    costBaseFingerprint(base()),
    costBaseFingerprint(
      base({
        freightComponentTierCosts: [
          {
            freightLegId: "leg-1",
            quoteLeafId: "ql-1",
            tierId: TIER_A,
            actualFreightCost: 400,
          },
        ],
      }),
    ),
  );
});

test("a CLIENT TARGET move is not a moved base", () => {
  // REVERSED by disposition, 2026-08-15. This asserted the opposite, on the
  // reasoning that a target decides the competitive verdict a PM may have
  // staged against. True, and not sufficient: a client target is an EXTERNAL
  // BENCHMARK that does not participate in quoted-sell arithmetic. Nothing
  // about the staged price changes when one moves, so refusing the Apply is a
  // false stale — and false stales are what teach operators to click through
  // the real ones.
  //
  // It also put a benchmark inside the cost base, which is a category error:
  // Client Target, Margin Target and Final Quoted Sell are three concepts and
  // this fingerprint is about the third one's inputs.
  assert.equal(
    costBaseFingerprint(base()),
    costBaseFingerprint(
      base({
        cellTargets: [
          { quoteSkuId: SKU, tierId: TIER_A, clientTargetPricePerUnit: 5 },
        ],
      }),
    ),
  );
});

// ── the guard's wiring ────────────────────────────────────────────────────

test("the guard is checked on apply and skipped on baseline", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL(
      "../../src/components/pricing-surface/pricing-staging-context.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(src, /intent === "apply" && stagedAgainst\.current !== null/);
  // Return to baseline removes every lever, so it is safe against ANY base —
  // there is no staged figure to commit against the wrong numbers, and
  // refusing it would strand an operator with adjustments they chose to drop.
  // The literal sentence moved into `staleMessage` when the client and server
  // refusals were aligned — they compare different reads on purpose, so an
  // operator can meet either, and two different sentences for one condition
  // read as two problems. The property here is that the client REFUSES, not
  // which words it uses; the wording itself is asserted where it now lives.
  assert.match(src, /setCommitError\(staleMessage\(\{ stale: true, kind: "economic_basis" \}\)\)/);
  // Captured when staging begins, released when it ends.
  assert.match(src, /if \(changes\.length === 0\) stagedAgainst\.current = null;/);
});
