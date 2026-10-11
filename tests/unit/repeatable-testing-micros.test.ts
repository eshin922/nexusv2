import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("repeatable tests are keyed by product, service leaf, and normalized label", async () => {
  const sql = await read("drizzle/0148_repeatable_associated_services.sql");
  assert.match(sql, /DROP INDEX "quote_leaves_product_service_unique_idx"/);
  assert.match(sql, /CREATE UNIQUE INDEX "quote_leaves_product_service_instance_unique_idx"/);
  assert.match(sql, /coalesce\(lower\(btrim\("service_instance_label"\)\), ''\)/);
  assert.match(sql, /"associated_product_quote_leaf_id" IS NOT NULL/);
});

test("the picker supports repeated instances with notes for every charge and associated service", async () => {
  const picker = await read("src/components/assembly-tree/add-component-charges-sheet.tsx");
  assert.match(picker, /setPicked\(\(prev\) => \[\.\.\.prev, \{ id, key, note: "" \}\]\)/);
  assert.match(picker, /setPickedServices\(\(prev\) => \[\.\.\.prev, \{ id, identity, note: "" \}\]\)/);
  assert.match(picker, /charges: picked\.map\(\(charge\) => \(\{/);
  assert.match(picker, /label: charge\.note\.trim\(\)/);
  assert.match(picker, /formData\.set\("serviceInstanceLabel", service\.note\.trim\(\)\)/);
  assert.match(picker, /existingServices\.some/);
  assert.doesNotMatch(picker, /role="checkbox"/);
  assert.doesNotMatch(picker, /existing && !repeatable/);
  const action = await read("src/app/actions/quote-products.ts");
  assert.match(action, /isProductAssociableServiceIdentity\(leafRows\[0\]\.serviceIdentity\)/);
});

test("a copied quote keeps the label with its independently priced service instance", async () => {
  const clone = await read("src/app/actions/quotes.ts");
  assert.match(clone, /serviceInstanceLabel: direct\.serviceInstanceLabel/);
  const direct = await read("src/lib/product-structure/direct-attachment.ts");
  assert.match(direct, /serviceInstanceLabel: row\.serviceInstanceLabel/);
});
