import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("operator fixtures deterministically cover 1, 6, and 10 SKU scales", async () => {
  const world = await read("tests/harness/fixtures/world.ts");
  const validator = await read("scripts/validation/fixtures.ts");

  assert.match(world, /name: "oneSku", skuCount: 1/);
  assert.match(world, /name: "sixSku", skuCount: 6/);
  assert.match(world, /name: "tenSku", skuCount: 10/);
  assert.match(world, /operatorQuotes: Record<OperatorFixtureName, QuoteFixture>/);
  assert.match(validator, /canonical_attachments: 32/);
  assert.match(validator, /Object\.keys\(manifest\.operatorQuotes\)\.length !== 3/);
});

test("scaled fixtures cover component, tier, and multi-leg freight usability", async () => {
  const world = await read("tests/harness/fixtures/world.ts");

  assert.match(world, /includeAirLeg: true/);
  assert.match(world, /'Ocean container · main shipment'/);
  assert.match(world, /'Air freight · split shipment'/);
  assert.match(world, /'Domestic transfer · ocean arrival'/);
  assert.match(world, /'Ningbo, China', 'Long Beach, CA'/);
  assert.match(world, /'Shenzhen, China', 'Los Angeles, CA'/);
  assert.match(world, /'Long Beach, CA', 'Dallas, TX'/);
  assert.match(world, /for \(const \[leafIndex, quoteLeafId\] of operatorQuoteLeafIds\.entries\(\)\)/);
  assert.match(world, /for \(const \[tierIndex, tierId\] of \[tier1, tier2\]\.entries\(\)\)/);
  assert.match(world, /\$\{airLegId\}, \$\{operatorQuoteLeafIds\[0\]\}/);
  assert.match(world, /operatorQuoteLeafIds\.slice\(0, 3\)/);
  assert.match(world, /'MOQ · 1,000 units'/);
  assert.match(world, /'Quantity · 10,000 units'/);
});

test("validation runtime remains isolated and credential-denying", async () => {
  const environment = await read(".env.validation.example");
  const runtime = await read("src/lib/config/runtime-config.ts");

  assert.match(environment, /DATABASE_URL=.*127\.0\.0\.1:55432\/nexus_validation_test/);
  assert.match(environment, /NEXUS_HUBSPOT_PROVIDER=isolated/);
  assert.match(environment, /NEXUS_NETSUITE_PROVIDER=isolated/);
  assert.match(environment, /NEXUS_ARTIFACT_PROVIDER=isolated/);
  assert.match(runtime, /isolated mode refuses external credentials/);
  assert.match(runtime, /isolated database host is not local/);
});
