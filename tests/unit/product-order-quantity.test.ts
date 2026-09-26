import assert from "node:assert/strict";
import test from "node:test";
import { parseOrderQuantity, resolveOrderQuantity, type QuantitySku } from "../../src/lib/product-structure/order-quantity.ts";

const tier = { id: "tier", qty: 25000 };
const product = (id: string, quantity?: number): QuantitySku => ({
  id, parentSkuId: null, qtyPerParent: null,
  ...(quantity === undefined ? {} : { orderQuantities: { tier: quantity } }),
});

test("five variant runs share packaging while retaining their own quantities", () => {
  const skus = new Map<string, QuantitySku>();
  for (let i = 0; i < 5; i++) {
    const id = `variant-${i}`;
    skus.set(id, product(id, 5000));
    for (const member of ["jar", "carton"]) {
      skus.set(`${id}-${member}`, { id: `${id}-${member}`, parentSkuId: id, qtyPerParent: 1 });
    }
  }
  for (const member of ["jar", "carton"]) {
    assert.equal(Array.from({ length: 5 }, (_, i) => resolveOrderQuantity(`variant-${i}-${member}`, tier, skus).quantity!).reduce((a, b) => a + b, 0), 25000);
  }
  assert.equal(resolveOrderQuantity("variant-0", tier, skus).quantity, 5000);
});

test("mixed jar usage expands once and does not encode a share of the order", () => {
  const skus = new Map<string, QuantitySku>([["mix", product("mix", 25000)]]);
  for (let i = 0; i < 5; i++) skus.set(`gummy-${i}`, { id: `gummy-${i}`, parentSkuId: "mix", qtyPerParent: 2 });
  assert.equal(resolveOrderQuantity("gummy-0", tier, skus).quantity, 50000);
  assert.equal(resolveOrderQuantity("gummy-0", tier, skus).ownerQuantity, 25000);
});

test("associated service inherits its product and alternative tiers remain independent", () => {
  const p = { ...product("p", 5000), orderQuantities: { tier: 5000, other: 12000 } };
  const skus = new Map<string, QuantitySku>([["p", p], ["filling", { ...product("filling"), associatedProductQuoteLeafId: "p" }]]);
  assert.equal(resolveOrderQuantity("filling", tier, skus).quantity, 5000);
  assert.equal(resolveOrderQuantity("filling", { id: "other", qty: 50000 }, skus).quantity, 12000);
});

test("legacy products inherit unchanged and an unspecified tier remains unspecified", () => {
  const skus = new Map([["p", product("p")]]);
  assert.deepEqual(resolveOrderQuantity("p", tier, skus), { quantity: 25000, ownerQuantity: 25000, source: "tier", ownerId: "p" });
  assert.equal(resolveOrderQuantity("p", { id: "empty", qty: null }, skus).quantity, null);
});

test("invalid authoring, missing owners and circular ownership fail explicitly", () => {
  for (const value of [0, -1, 1.2, "", "3abc", Infinity, 2147483648]) assert.throws(() => parseOrderQuantity(value));
  const skus = new Map<string, QuantitySku>([["a", { ...product("a"), parentSkuId: "b" }], ["b", { ...product("b"), parentSkuId: "a" }]]);
  assert.throws(() => resolveOrderQuantity("a", tier, skus), /Circular/);
  assert.throws(() => resolveOrderQuantity("missing", tier, skus), /missing/);
  skus.set("member", { ...product("member", 5), parentSkuId: "a" });
  assert.equal(resolveOrderQuantity("member", tier, skus).quantity, 5);
});
