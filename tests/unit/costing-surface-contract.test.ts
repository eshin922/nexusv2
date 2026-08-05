import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packaging rows use LEAF identity rather than pricing provenance", async () => {
  const source = await readFile(
    new URL(
      "../../src/components/costs/packaging-drilldown.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /const componentName = productName \|\| skuLabel \|\| "Unknown component"/,
  );
  assert.match(source, /<span className="lab">\{componentName\}<\/span>/);
  assert.doesNotMatch(
    source,
    /const lineName = vendorName \|\| line\.supplier/,
  );
});

test("cost scenario context derives other SKUs from LEAFs only", async () => {
  const source = await readFile(
    new URL(
      "../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("otherSkus={(() =>");
  const end = source.indexOf("tierCount=", start);
  const projection = source.slice(start, end);

  assert.match(
    projection,
    /const leaves = skus\.filter\(\(s\) => s\.skuRole === "leaf"\)/,
  );
  assert.match(projection, /return leaves\s+\.filter/);
  assert.doesNotMatch(projection, /return skus\s+\.filter/);
});

test("packaging exposes a governed add-line target for every leaf SKU", async () => {
  const [drilldown, button] = await Promise.all([
    readFile(
      new URL(
        "../../src/components/costs/packaging-drilldown.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/app/projects/[id]/quotes/[quoteId]/packaging/add-line-button.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(drilldown, /leafSkus\.map\(\(sku\) => \(/);
  assert.match(drilldown, /quoteSkuId=\{sku\.id\}/);
  assert.match(drilldown, /`Add line · \$\{sku\.skuLabel\}`/);
  assert.doesNotMatch(drilldown, /quoteSkuId=\{leafSkus\[0\]\.id\}/);
  assert.match(button, /fd\.set\("quoteSkuId", quoteSkuId\)/);
});

test("packaging rows keep their explicit SKU association", async () => {
  const source = await readFile(
    new URL(
      "../../src/components/costs/packaging-drilldown.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /sku=\{skuMap\.get\(line\.quoteSkuId\)\}/);
  assert.match(source, /const skuLabel = sku\?\.skuLabel \?\? ""/);
  assert.match(source, /\{skuLabel\}/);
});

test("Bulk Raw operator surface is absent while compatibility plumbing remains", async () => {
  const [page, schema, costing, component] = await Promise.all([
    readFile(
      new URL(
        "../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../src/db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/costing.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../src/components/costs/bulk-raw-drilldown.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(page, /<BulkRawDrilldown/);
  assert.doesNotMatch(page, /id="bulk_raw"/);
  assert.doesNotMatch(page, /\.from\(bulkRawCategories\)/);
  assert.doesNotMatch(page, /\.from\(bulkRawIngredients\)/);
  assert.match(schema, /export const bulkRawSectionMeta = pgTable/);
  assert.match(schema, /export const bulkRawCategories = pgTable/);
  assert.match(schema, /export const bulkRawIngredients = pgTable/);
  assert.match(costing, /bulkRawCost/);
  assert.match(component, /export function BulkRawDrilldown/);
});
