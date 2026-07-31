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
