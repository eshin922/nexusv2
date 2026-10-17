import assert from "node:assert/strict";
import test from "node:test";
import { placeSetupServices } from "../../src/lib/product-structure/setup-service-placement.ts";

test("Setup shows product-associated services with their SKU and keeps standalone or orphaned services visible", () => {
  const products = [{ quoteLeafId: "sku-a" }, { quoteLeafId: "sku-b" }];
  const services = [
    { id: "standalone", associatedProductQuoteLeafId: null },
    { id: "a-1", associatedProductQuoteLeafId: "sku-a" },
    { id: "b-1", associatedProductQuoteLeafId: "sku-b" },
    { id: "a-2", associatedProductQuoteLeafId: "sku-a" },
    { id: "orphan", associatedProductQuoteLeafId: "missing" },
  ];

  const placement = placeSetupServices(products, services);
  assert.deepEqual(placement.associatedByProduct.get("sku-a")?.map((service) => service.id), ["a-1", "a-2"]);
  assert.deepEqual(placement.associatedByProduct.get("sku-b")?.map((service) => service.id), ["b-1"]);
  assert.deepEqual(placement.standalone.map((service) => service.id), ["standalone", "orphan"]);
  assert.equal(services.length, 5, "display placement must not mutate service line records");
});
