/**
 * OD-026 · Direct Component quantity invariant.
 *
 *   A Direct Component IS the sellable unit. Multiplicity is inherently 1.
 *   The tier says how many are sold.
 *
 * Semantic repair, not arithmetic. Test 6 is the load-bearing one: it asserts
 * the REJECTED reading stays rejected, so a future "improvement" that makes a
 * Direct Component quantity scale packaging fails loudly instead of quietly
 * shipping SO quantities that understate what was sold.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  checkLeafQuantity,
  assertDirectComponentQuantities,
} from "../../src/lib/product-structure/direct-component-quantity.ts";
import { computeQuoteCosting } from "../../src/lib/costing.ts";
import { buildQuoteCostingInputFromNewModel } from "../../src/lib/costing-adapter.ts";

const direct = (quantity: string | number) => ({ assemblyId: null, quantity });
const member = (quantity: string | number) => ({ assemblyId: "asy-1", quantity });

// ── 1-3 · Direct Component multiplicity ───────────────────────────────────

test("1 · Direct Component quantity 1 is accepted", () => {
  const v = checkLeafQuantity(direct(1));
  assert.equal(v.ok, true);
  assert.equal(v.kind, "direct");
  assert.equal(checkLeafQuantity(direct("1")).ok, true, "numeric column arrives as a string");
});

test("2 · Direct Component quantity 2 is REFUSED", () => {
  const v = checkLeafQuantity(direct(2));
  assert.equal(v.ok, false);
  assert.match((v as any).message, /must be 1/);
  // The copy must tell the operator what to use instead, not just say no.
  assert.match((v as any).message, /tier quantity/i);
});

test("3 · Direct Component quantity 3 is REFUSED", () => {
  assert.equal(checkLeafQuantity(direct(3)).ok, false);
  assert.equal(checkLeafQuantity(direct("3")).ok, false);
});

// ── 4-5 · Finished Product members are UNAFFECTED ─────────────────────────

test("4 · Finished Product member quantity 2 remains valid", () => {
  const v = checkLeafQuantity(member(2));
  assert.equal(v.ok, true);
  assert.equal(v.kind, "member");
});

test("5 · Finished Product member quantity 3 remains valid", () => {
  assert.equal(checkLeafQuantity(member(3)).ok, true);
  // A member has a PARENT, so qtyPerParent has a referent. Carton x2 in a
  // finished product means 2 cartons consumed per finished unit — legitimate.
  assert.equal(checkLeafQuantity(member(7)).ok, true);
});

// ── 6 · THE TRIPWIRE · the rejected reading must stay rejected ────────────

test("6 · Direct Component packaging acquires NO multiplicity scaling", () => {
  const Q = "q", T = "t";
  const build = (qty: string) =>
    computeQuoteCosting(
      buildQuoteCostingInputFromNewModel({
        quote: { id: Q, globalPriceAdjPct: 0, targetMarginPct: null },
        firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
        markupDefaults: { Primary: 0 },
        tiers: [{ id: T, label: "T", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
        assemblies: [],
        quoteLeafAttachments: [{
          quoteLeafId: "ql-d", assemblyLeafId: null, assemblyId: null,
          leafId: "lib-d", quantity: qty, position: 0,
          leafName: "Direct", leafSku: "D",
        }],
        assemblyLeafInputs: [{
          quoteLeafId: "ql-d", tierId: T, lineGroupId: "lg",
          pricingVendorHubspotCompanyId: null, pricingVendorNameSnapshot: null,
          unitCost: "10", qtyPerSellableUnit: "1", category: "Primary", markupPct: null,
        }],
        assemblyProductionInputs: [], assemblyLeafOverrides: [], clientTargets: [],
        lifts: [], freightLegGroups: [], freightLegs: [], freightLegTiers: [],
        freightComponentTierCosts: [],
      } as never),
    );
  const pkg = (r: ReturnType<typeof build>) =>
    r.quoteRollup.find((t) => t.tierId === T)!.costBreakdown.packaging;

  // $10/unit x 1,000 tier units = $10,000 — for EVERY multiplicity.
  assert.equal(pkg(build("1")), 10_000);
  assert.equal(pkg(build("2")), 10_000, "quantity 2 must NOT double packaging");
  assert.equal(pkg(build("3")), 10_000, "quantity 3 must NOT triple packaging");
});

// ── 7-8 · Downstream quantity is the TIER quantity ────────────────────────

test("7 · Customer View / quoted economics use tier quantity, not tier x qty", () => {
  // The quote rollup multiplies a top-level SKU's per-unit values by TIER
  // quantity only. Asserted structurally: had a second axis been introduced,
  // test 6 would already have caught it, and this pins the reason why.
  const src = readFileSync("src/lib/costing.ts", "utf8");
  assert.match(src, /const tQty = num\(tier\.qty\);/);
  assert.match(src, /breakdown\.packaging \+= pt\.packagingCostPerUnit \* tQty;/);
  assert.doesNotMatch(
    src,
    /breakdown\.packaging \+= pt\.packagingCostPerUnit \* tQty \* [a-zA-Z]/,
    "no second quantity axis may be introduced at the quote rollup",
  );
});

test("8 · Complete refuses rather than discarding an invalid multiplicity", () => {
  // Fail-closed at the projection boundary. Authoring is NOT the only writer —
  // imports, scripts and historical rows all reach Complete, and silently
  // projecting tier quantity while dropping the multiplicity is exactly the
  // behaviour that made this state undefined.
  assert.doesNotThrow(() =>
    assertDirectComponentQuantities([direct(1), member(2), member(3)]),
  );
  assert.throws(
    () => assertDirectComponentQuantities([direct(1), direct(2)]),
    /Refusing to project rather than discard it silently/,
  );
  assert.throws(() => assertDirectComponentQuantities([direct(4)]), /OD-026/);
});
