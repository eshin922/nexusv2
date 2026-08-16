/**
 * Two stale guards, two refusal classes, and the boundary between them.
 *
 * A staged commercial decision is made against a state the operator could see.
 * Committing after that state moved is last-write-wins on a price — the quote
 * silently becomes something nobody reviewed. The staged path had no guard of
 * any kind on the server.
 *
 * The classes are separate because the REMEDY is separate. "Costs changed"
 * sends the operator to Costs; "pricing changed" sends them to reload Pricing.
 * A single "something changed" tells them neither.
 *
 * THE ECONOMIC FINGERPRINT IS NOT DEFINED FOR THIS. `costBaseFingerprint`
 * already existed and is reused. What was missing was server-side enforcement
 * of it and the authority guard, which did not exist at all.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { costBaseFingerprint } from "../../src/lib/pricing-cost-base.ts";
import {
  detectStale,
  pricingAuthorityBaseline,
  staleMessage,
} from "../../src/lib/pricing-stale-guard.ts";
import type { QuoteCostingInput } from "../../src/lib/costing.ts";

const SKU = "sku-1";
const TIER = "tier-a";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q", globalPriceAdjPct: 0.1, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.4 },
    skus: [{
      id: SKU, canonicalQuoteLeafId: "ql-1", parentSkuId: null, qtyPerParent: null,
      skuRole: "leaf", skuLabel: "SKU-1", productName: "Product One",
      sortOrder: 0, retailBenchmark: null,
    }],
    tiers: [{ id: TIER, label: "1000", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [{
      quoteSkuId: SKU, tierId: TIER, lineGroupId: "g1",
      unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0.4,
    }],
    production: [{
      quoteSkuId: SKU, tierId: TIER, customerShipsRaws: false,
      allocateServiceFeesToCost: true, fillingBlendingCost: 1, cmAssemblyTotal: 2,
    } as QuoteCostingInput["production"][number]],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
    ...over,
  };
}

const fp = (over?: Partial<QuoteCostingInput>) => costBaseFingerprint(input(over));

const authority = (over: Partial<{
  globalAdj: string;
  tierAdj: [string, string][];
  lifts: [string, string][];
  overrides: [string, string][];
}> = {}) =>
  pricingAuthorityBaseline({
    globalAdj: over.globalAdj ?? "0.1",
    tierAdj: new Map(over.tierAdj ?? []),
    lifts: new Map(over.lifts ?? []),
    overrides: new Map(over.overrides ?? []),
  });

const verdict = (args: Partial<Parameters<typeof detectStale>[0]> = {}) =>
  detectStale({
    baseline: authority(),
    persisted: authority(),
    previewFingerprint: fp(),
    currentFingerprint: fp(),
    ...args,
  });

// ── economic basis ────────────────────────────────────────────────────────

test("packaging cost change → economic stale refusal", () => {
  const moved = fp({
    packaging: [{
      quoteSkuId: SKU, tierId: TIER, lineGroupId: "g1",
      unitCost: 11, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0.4,
    }],
  });
  assert.notEqual(moved, fp());
  const v = verdict({ currentFingerprint: moved });
  assert.deepEqual(v, { stale: true, kind: "economic_basis" });
});

test("a packaging MARKUP change is economic too", () => {
  // Markup is part of the base price, not a pricing lever — it converts cost
  // into sell before any adjustment applies.
  const moved = fp({
    packaging: [{
      quoteSkuId: SKU, tierId: TIER, lineGroupId: "g1",
      unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0.5,
    }],
  });
  assert.notEqual(moved, fp());
});

test("production / bulk raw change → refusal", () => {
  const moved = fp({
    production: [{
      quoteSkuId: SKU, tierId: TIER, customerShipsRaws: false,
      allocateServiceFeesToCost: true, fillingBlendingCost: 9, cmAssemblyTotal: 2,
    } as QuoteCostingInput["production"][number]],
  });
  assert.notEqual(moved, fp());
  assert.equal(verdict({ currentFingerprint: moved }).stale, true);
});

test("freight and duty/tariff changes → refusal", () => {
  const leg = {
    id: "leg-1", legGroupId: "grp-1", direction: "outbound" as const, label: null,
    origin: null, destination: null, crossesInternationalBorder: true,
    treatment: "bundled" as const, mode: null, carrier: null, incoterm: null,
    cargoReadyDate: null, vesselEtd: null, vesselEta: null, actualDeliveryDate: null,
    dutyMarkupPct: 0.1, tariffMarkupPct: 0.1, customs: {}, displayOrder: 0,
  };
  const withFreight = {
    freightLegGroups: [{ id: "grp-1", label: "G", displayOrder: 0 }],
    freightLegs: [leg],
    freightLegTiers: [{ freightLegId: "leg-1", tierId: TIER, totalFreight: 100, unitsInShipment: null }],
  };
  const baseWithFreight = fp(withFreight);
  assert.notEqual(baseWithFreight, fp(), "adding freight moves the base");

  // Freight AMOUNT.
  assert.notEqual(
    baseWithFreight,
    fp({ ...withFreight, freightLegTiers: [{ freightLegId: "leg-1", tierId: TIER, totalFreight: 200, unitsInShipment: null }] }),
  );
  // DUTY markup.
  assert.notEqual(
    baseWithFreight,
    fp({ ...withFreight, freightLegs: [{ ...leg, dutyMarkupPct: 0.2 }] }),
  );
  // TARIFF markup.
  assert.notEqual(
    baseWithFreight,
    fp({ ...withFreight, freightLegs: [{ ...leg, tariffMarkupPct: 0.2 }] }),
  );
});

test("tier QUANTITY is economic — everything amortises over it", () => {
  assert.notEqual(
    fp(),
    fp({ tiers: [{ id: TIER, label: "1000", qty: 2000, sortOrder: 0, tierPriceAdjPct: null }] }),
  );
});

// ── the exclusions, which are the sharp end ───────────────────────────────

test("CLIENT TARGET-only change → NO refusal", () => {
  // An external benchmark that does not participate in quoted-sell arithmetic.
  // Nothing about the staged price changes, so refusing would be a false stale.
  const withTarget = fp({
    cellTargets: [{ quoteSkuId: SKU, tierId: TIER, clientTargetPricePerUnit: 5 }],
  });
  assert.equal(withTarget, fp());
  assert.deepEqual(verdict({ currentFingerprint: withTarget }), { stale: false });
});

test("METADATA-only change with unchanged economics → NO refusal", () => {
  // Renaming a product, re-labelling a tier, reordering. The graph shape and
  // every number are identical, so the staged decision still stands.
  const renamed = fp({
    skus: [{
      id: SKU, canonicalQuoteLeafId: "ql-1", parentSkuId: null, qtyPerParent: null,
      skuRole: "leaf", skuLabel: "RENAMED-SKU", productName: "Totally Different Name",
      sortOrder: 7, retailBenchmark: 99,
    }],
    tiers: [{ id: TIER, label: "one thousand", qty: 1000, sortOrder: 3, tierPriceAdjPct: null }],
  });
  assert.equal(renamed, fp(), "names, labels, order and retail benchmark are not economics");
});

test("PRICING LEVERS are not in the economic fingerprint", () => {
  // They belong to the authority guard. In here they would move the
  // fingerprint on the operator's OWN staging act — the guard firing at
  // exactly the moment it must stay silent.
  assert.equal(fp(), fp({ quote: { id: "q", globalPriceAdjPct: 0.9, targetMarginPct: null } }));
  assert.equal(fp(), fp({ cellOverrides: [{ quoteSkuId: SKU, tierId: TIER, sellPriceOverride: 42 }] }));
  assert.equal(fp(), fp({ lifts: [{ quoteLeafId: "ql-1", tierId: TIER, liftPct: 0.5 }] }));
  assert.equal(
    fp(),
    fp({ tiers: [{ id: TIER, label: "1000", qty: 1000, sortOrder: 0, tierPriceAdjPct: 0.25 }] }),
  );
});

test("an unrelated quote's commit cannot move this quote's fingerprint", () => {
  // The reason `pg_snapshot_xmax` was rejected: a database-wide counter
  // advances on any commit anywhere. This is a pure function of THIS quote's
  // inputs, so nothing outside them can reach it — asserted by construction
  // rather than by narrative.
  assert.equal(fp(), fp(), "same inputs, same fingerprint, always");
  assert.equal(typeof costBaseFingerprint(input()), "string");
});

// ── pricing authority ─────────────────────────────────────────────────────

test("each lever moving is reported by name", () => {
  for (const [over, expected] of [
    [{ globalAdj: "0.2" }, "the quote-wide adjustment"],
    [{ tierAdj: [[TIER, "0.05"]] as [string, string][] }, "a tier adjustment"],
    [{ lifts: [["c1", "0.1"]] as [string, string][] }, "a surgical lift"],
    [{ overrides: [["c1", "9.99"]] as [string, string][] }, "a direct price"],
  ] as const) {
    const v = verdict({ persisted: authority(over) });
    assert.equal(v.stale, true);
    assert.equal((v as { kind: string }).kind, "pricing_authority");
    assert.deepEqual((v as { moved: string[] }).moved, [expected]);
  }
});

test("pricing authority is reported BEFORE economics when both moved", () => {
  // Both refusals are true; only one can be shown. Pricing is the more likely
  // collision on a shared quote and names what moved, which is the more
  // actionable of the two.
  const v = verdict({
    persisted: authority({ globalAdj: "0.9" }),
    currentFingerprint: fp({ packaging: [] }),
  });
  assert.equal((v as { kind: string }).kind, "pricing_authority");
});

test("the comparison is order-independent and numeric", () => {
  // Entries are sorted, and "0.10" equals 0.1 — a re-save that rewrites a
  // numeric column in a different textual form is not a pricing decision.
  assert.deepEqual(
    verdict({
      baseline: authority({ tierAdj: [["b", "0.2"], ["a", "0.10"]] }),
      persisted: authority({ tierAdj: [["a", "0.1"], ["b", "0.20"]] }),
    }),
    { stale: false },
  );
});

test("UNCHANGED state → Apply proceeds", () => {
  assert.deepEqual(verdict(), { stale: false });
});

test("a caller that sends no baseline is unguarded, not refused", () => {
  // A contract addition. Refusing every pre-existing caller would break more
  // than it protects; they are simply not covered yet.
  assert.deepEqual(
    verdict({ baseline: null, persisted: authority({ globalAdj: "0.9" }) }),
    { stale: false },
  );
  assert.deepEqual(
    verdict({ previewFingerprint: null, currentFingerprint: fp({ packaging: [] }) }),
    { stale: false },
  );
});

test("the two refusals send the operator to different surfaces", () => {
  const costs = staleMessage({ stale: true, kind: "economic_basis" });
  const pricing = staleMessage({ stale: true, kind: "pricing_authority", moved: ["a tier adjustment"] });
  assert.match(costs, /costs/i);
  assert.match(costs, /Re-check Costs/);
  assert.match(pricing, /Pricing on this quote changed/);
  assert.match(pricing, /a tier adjustment/);
  assert.notEqual(costs, pricing);
});
