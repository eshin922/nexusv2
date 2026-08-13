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

  const resolver = await readFile(
    new URL("../../src/lib/costs/packaging-row-identity.ts", import.meta.url),
    "utf8",
  );

  // COSTS-RENDER-1 moved resolution into its own module so the binding is
  // assertable without rendering. The row still renders it in the name slot.
  assert.match(source, /const \{ componentName, skuLabel \} = identity/);
  assert.match(source, /<span className="lab">\{componentName\}<\/span>/);

  // Pricing provenance must never stand in for what is being costed.
  assert.doesNotMatch(
    source,
    /const lineName = vendorName \|\| line\.supplier/,
  );
  // The resolver draws identity from the LEAF alone — it cannot reach a vendor,
  // supplier or category even by accident.
  assert.match(resolver, /sku\?\.productName/);
  assert.match(resolver, /sku\?\.skuLabel/);
  assert.doesNotMatch(resolver, /vendor|supplier|category/i);
});

test("costs expose every SKU without a switching control", async () => {
  const [page, context, packaging] = await Promise.all([
    readFile(
      new URL(
        "../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/components/costs/scenario-context-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/components/costs/packaging-drilldown.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(page, /otherSkus/);
  assert.doesNotMatch(context, /Other SKUs in this scenario|<details/);
  // Every leaf SKU still reaches Packaging; it arrives as priced structure
  // from Setup rather than through a per-SKU authoring control.
  assert.match(packaging, /leafSkus/);
  assert.match(page, /<PackagingDrilldown[\s\S]*?skus=\{skus\}/);
});

test("single-SKU context and scenario navigation remain unchanged", async () => {
  const [page, context] = await Promise.all([
    readFile(
      new URL(
        "../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/components/costs/scenario-context-strip.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(page, /<ScenarioContextStrip/);
  assert.match(context, /if \(!anchorSku\) return null/);
  assert.match(context, /\{anchorSku\.productName\}/);
  assert.match(context, /href=\{`\/projects\/\$\{projectId\}`\}/);
  assert.match(context, /Switch scenario/);
  assert.doesNotMatch(page, /skus\.length\s*[><=!]/);
});

test("packaging exposes no add-line control — Setup owns the structure", async () => {
  // Business Authority, 2026-08-06: Setup owns packaging structure and Costs
  // only prices it. Multiple cartons, labels or inserts are separate Setup
  // components, not PM-authored cost rows. This replaces the former contract
  // that required a per-SKU add-line target.
  const [drilldown, actions] = await Promise.all([
    readFile(
      new URL(
        "../../src/components/costs/packaging-drilldown.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../src/app/actions/assembly-leaf-inputs.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(drilldown, /AddLineButton|PackagingAddLineActions/);
  assert.doesNotMatch(drilldown, /Add line/);
  // The action is gone, not merely unreferenced.
  assert.doesNotMatch(actions, /export async function addAssemblyLeafInput/);
  // The empty state points at Setup instead of inviting authorship here.
  assert.match(drilldown, /No components in Setup yet/);
  assert.match(drilldown, /defined in Setup/);
});

test("packaging rows keep their explicit SKU association", async () => {
  const source = await readFile(
    new URL(
      "../../src/components/costs/packaging-drilldown.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  const resolver = await readFile(
    new URL("../../src/lib/costs/packaging-row-identity.ts", import.meta.url),
    "utf8",
  );

  // The row is still bound explicitly to its own line's identity...
  assert.match(source, /identity=\{resolvePackagingRowIdentity\(/);
  assert.match(source, /line\.quoteSkuId,/);
  assert.match(source, /\{skuLabel\}/);

  // ...and that binding uses the GOVERNED cost-input identity. Pinning the map
  // key in source is what makes a future re-key fail here rather than silently
  // degrade every row to "Unknown component", which is how COSTS-RENDER-1
  // reached production-adjacent certification unnoticed.
  assert.match(resolver, /\[\[s\.quoteLeafId, s\] as const\]/);
  assert.doesNotMatch(resolver, /\[\[s\.id, s\] as const\]/);
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
