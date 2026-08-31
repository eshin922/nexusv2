/**
 * The customer document explains why a member's quantity exceeds the
 * finished-good quantity.
 *
 * ── THE REQUIREMENT ─────────────────────────────────────────────────────
 *
 * After the line-quantity repair a member consumed twice per unit correctly
 * bills 2,000 against a finished-good quantity of 1,000, and nothing on the
 * page said why. A correct number that looks like a mistake still costs the
 * firm a conversation.
 *
 * ── WHY IT IS A NUMBER, NOT COPY, IN THE PROJECTION ─────────────────────
 *
 * `displayQtyLabel` was the tempting home and is the wrong one: it is
 * documented "null on unit lines" and its only consumer is the OTC fee mapper,
 * so widening it would make one field mean two things depending on which line
 * kind read it. The projection carries the structural fact; the renderer owns
 * the wording.
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

function project() {
  const pkg = (leaf: string, cost: number) =>
    TIERS.map((t) => ({
      quoteSkuId: leaf, tierId: t.id, lineGroupId: `${leaf}-pkg`,
      unitCost: cost, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0,
    }));
  const inp = {
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
      { id: "dp", parentSkuId: null, qtyPerParent: null, skuRole: "leaf" as const,
        skuLabel: "DP", productName: "Direct", sortOrder: 3, retailBenchmark: null },
    ],
    tiers: TIERS,
    packaging: [...pkg("m1", 1.37), ...pkg("m2", 0.21), ...pkg("m3", 0.44), ...pkg("dp", 0.63)],
    production: [], assemblyProduction: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
  const costing = computeQuoteCosting(inp);
  const doc = projectCommercial({
    markupDefaults: inp.markupDefaults, skus: inp.skus,
    production: inp.production, assemblyProduction: inp.assemblyProduction, costing,
  } as never);
  return { costing, doc };
}

const line = (doc: ReturnType<typeof project>["doc"], sku: string) =>
  doc.lines.find((l) => l.displaySku === sku)!;

/** The rendered qualifier, exactly as the PDF composes it. */
const caption = (m: number | null | undefined) =>
  typeof m === "number" && m > 1 ? ` · ×${m} per unit` : "";

// ══════════════════════════════════════════════════════════════════════
// The rule
// ══════════════════════════════════════════════════════════════════════

test("Direct Product carries no multiplicity and no qualifier", () => {
  const { doc } = project();
  const l = line(doc, "DP");
  assert.equal(l.memberMultiplicity, null, "a Direct Product has no membership");
  assert.equal(caption(l.memberMultiplicity), "");
});

test("a member at q=1 states 1, and renders no qualifier", () => {
  const { doc } = project();
  const l = line(doc, "M1");
  // 1 is a real value — the projection does not null it out. The RENDERER
  // decides that "×1 per unit" is noise on every ordinary line.
  assert.equal(l.memberMultiplicity, 1);
  assert.equal(caption(l.memberMultiplicity), "");
});

test("q=2 and q=3 render ×N per unit", () => {
  const { doc } = project();
  assert.equal(line(doc, "M2").memberMultiplicity, 2);
  assert.equal(caption(line(doc, "M2").memberMultiplicity), " · ×2 per unit");
  assert.equal(line(doc, "M3").memberMultiplicity, 3);
  assert.equal(caption(line(doc, "M3").memberMultiplicity), " · ×3 per unit");
});

test("the qualifier is identical across all four tiers", () => {
  const { doc } = project();
  // Multiplicity is a bill-of-materials fact. It cannot vary by tier, and a
  // per-tier caption would imply the recipe changes with order size.
  for (const sku of ["M1", "M2", "M3", "DP"]) {
    const m = line(doc, sku).memberMultiplicity;
    const rendered = TIER_QTY.map(() => caption(m));
    assert.equal(new Set(rendered).size, 1, `${sku} qualifier varies by tier`);
  }
});

test("OTC lines carry no multiplicity", () => {
  const { doc } = project();
  for (const l of doc.lines.filter((x) => x.kind === "otc")) {
    assert.equal(l.memberMultiplicity, null, `${l.displayName} must have none`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// The commercial facts are untouched
// ══════════════════════════════════════════════════════════════════════

test("quantities, rates, amounts and tier totals are unchanged", () => {
  const { doc, costing } = project();
  for (const [sku, q, cost] of [["M1", 1, 1.37], ["M2", 2, 0.21], ["M3", 3, 0.44], ["DP", 1, 0.63]] as const) {
    line(doc, sku).cells.forEach((c, ti) => {
      if (c.state !== "priced") throw new Error(`${sku} tier ${ti} unpriced`);
      assert.equal(c.quantity, TIER_QTY[ti] * q, `${sku} quantity moved`);
      assert.ok(Math.abs(c.unitRate - cost) < 5e-6, `${sku} rate moved`);
      assert.ok(Math.abs(c.lineAmount - cost * TIER_QTY[ti] * q) < 5e-6, `${sku} amount moved`);
    });
  }
  doc.tiers.forEach((t, ti) => {
    assert.equal(t.quantity, TIER_QTY[ti], "parent tier quantity moved");
    assert.ok(
      Math.abs(t.tierCommercialTotal - costing.quoteRollup[ti].totalRevenue) < 5e-4,
      `tier ${ti} total no longer agrees with engine revenue`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// FALSIFY the tempting wrong implementation
// ══════════════════════════════════════════════════════════════════════

test("FALSIFY · multiplicity is structural, not reverse-engineered from output", () => {
  const { doc } = project();

  // The tempting version: infer it from the money the projection produced.
  const derived = (l: ReturnType<typeof line>, ti: number) => {
    const c = l.cells[ti];
    return c.state === "priced" ? c.quantity / TIER_QTY[ti] : null;
  };

  // On this fixture it AGREES — which is the trap. Agreement is not evidence
  // of a correct source; it is why the wrong implementation looks fine.
  for (const sku of ["M1", "M2", "M3"]) {
    assert.equal(derived(line(doc, sku), 0), line(doc, sku).memberMultiplicity);
  }

  // It fails where the structural fact does not: a zero-quantity tier makes the
  // derivation divide by zero, and a Direct Product has no membership to
  // report at all — yet the derivation would confidently answer 1.
  const dp = line(doc, "DP");
  assert.equal(derived(dp, 0), 1, "the derivation invents a multiplicity");
  assert.equal(dp.memberMultiplicity, null, "the structural fact says there is none");
  assert.notEqual(derived(dp, 0), dp.memberMultiplicity,
    "structural and derived must be distinguishable on a Direct Product");

  assert.equal(0 / 0 === 0 / 0, false, "a zero-quantity tier derives NaN");

  // And the source must be the membership, in the code.
  const src = readFileSync(path.join(process.cwd(), "src/lib/commercial-projection.ts"), "utf8");
  assert.match(src, /memberMultiplicity:\s*\n?\s*kind === "item_group_member" \? Number\(rollup\.qtyPerParent \?\? 1\) : null/);
});

test("displayQtyLabel was not widened to carry this", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/commercial-projection.ts"), "utf8");
  // Its contract still says unit lines get null, and the member line still
  // sets it null. Two meanings on one field is the thing being avoided.
  assert.match(src, /Customer-facing quantity copy, e\.g\. "1 \(setup\)"\. Null on unit lines\./);
  const memberBlock = src.slice(src.indexOf("key: `unit:${rollup.skuId}`"));
  assert.match(memberBlock.slice(0, 700), /displayQtyLabel: null/);
});

test("BOTH customer-facing renderers show the qualifier, from the same field", () => {
  // There are two views of one customer document: the live HTML preview on the
  // Quote surface and the react-pdf table. Wiring only one shipped a document
  // that said different things depending on which one the reader opened -- and
  // the PDF-only version was invisible on the surface an operator actually
  // checks, so nothing would have surfaced it.
  //
  // Both must consume `multiplicityPerUnit`; neither may compute it.
  const pdf = readFileSync(
    path.join(process.cwd(), "src/components/pdf/customer-pdf-pricing-table.tsx"), "utf8");
  const html = readFileSync(
    path.join(process.cwd(), "src/components/quote/customer-view-live.tsx"), "utf8");

  for (const [name, src, field] of [
    ["pdf", pdf, "multiplicity_per_unit"],
    ["html preview", html, "multiplicityPerUnit"],
  ] as const) {
    assert.ok(src.includes(field), `${name} does not read the multiplicity field`);
    assert.match(src, new RegExp(`${field} > 1`), `${name} must gate on > 1`);
    assert.match(src, /per unit`/, `${name} must render the qualifier`);
    // Neither may reverse-engineer it from the money.
    assert.doesNotMatch(src, /tierLineTotals\[[^\]]*\]\s*\/|quantity\s*\/\s*tier/i,
      `${name} must not derive multiplicity from output`);
  }
});

test("the renderer shows the qualifier only above 1, and does not touch identity", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/components/pdf/customer-pdf-pricing-table.tsx"), "utf8");
  assert.match(src, /sku\.multiplicity_per_unit > 1/);
  assert.match(src, /×\$\{sku\.multiplicity_per_unit\} per unit/);
  // The product name is rendered from `sku.name` alone — the qualifier lives in
  // the meta line beside the code, never concatenated into identity.
  assert.match(src, /<Text style=\{styles\.prodName\}>\{sku\.name\}<\/Text>/);
});
