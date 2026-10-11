import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("repeatable tests are keyed by product, service leaf, and normalized label", async () => {
  const sql = await read("drizzle/0148_repeatable_testing_micros.sql");
  assert.match(sql, /DROP INDEX "quote_leaves_product_service_unique_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "quote_leaves_product_service_instance_unique_idx"/);
  assert.match(sql, /coalesce\(lower\(btrim\("service_instance_label"\)\), ''\)/);
  assert.match(sql, /"associated_product_quote_leaf_id" IS NOT NULL/);
});

test("the picker requires a distinct test name and keeps the other services single-instance", async () => {
  const picker = await read("src/components/assembly-tree/add-component-charges-sheet.tsx");
  assert.match(picker, /pickedServices\.has\("testing_micros"\)/);
  assert.match(picker, /existingTestLabels\.some/);
  assert.match(picker, /disabled=\{!available \|\| \(existing && !repeatable\)\}/);
  assert.match(picker, /formData\.set\("serviceInstanceLabel", testLabel\.trim\(\)\)/);
});

test("a copied quote keeps the label with its independently priced service instance", async () => {
  const clone = await read("src/app/actions/quotes.ts");
  assert.match(clone, /serviceInstanceLabel: direct\.serviceInstanceLabel/);
  const direct = await read("src/lib/product-structure/direct-attachment.ts");
  assert.match(direct, /serviceInstanceLabel: row\.serviceInstanceLabel/);
});
