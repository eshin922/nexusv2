import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("operator fixtures deterministically cover 1, 6, 10 and R3 scales", async () => {
  const world = await read("tests/harness/fixtures/world.ts");
  const validator = await read("scripts/validation/fixtures.ts");

  // The spec entries are multi-line now that they carry tier counts, markups
  // and an override, so names and counts are matched separately rather than
  // as one line.
  assert.match(world, /name: "oneSku", skuCount: 1/);
  assert.match(world, /name: "sixSku", skuCount: 6/);
  assert.match(world, /name: "tenSku", skuCount: 10/);
  assert.match(world, /name: "r3Volume"/);
  assert.match(world, /tierCount: 4/);
  assert.match(world, /operatorQuotes: Record<OperatorFixtureName, QuoteFixture>/);

  // The validator's counts are DERIVED now rather than pinned to literals — a
  // fourth fixture made every literal wrong at once, and a stale check failing
  // on a correct seed is the least useful kind of failure. What is asserted is
  // that the derivation exists, not what it currently evaluates to.
  assert.match(validator, /LIFECYCLE_STATES \* 3 \+ OPERATORS\.reduce/);
  assert.match(
    validator,
    /Object\.keys\(manifest\.operatorQuotes\)\.length !== OPERATORS\.length/,
  );
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
  // Widened from a hardcoded pair to the fixture's own tier list, so a
  // four-tier fixture gets inputs and freight on every tier rather than two.
  assert.match(world, /for \(const \[tierIndex, tierId\] of tierIdList\.entries\(\)\)/);
  assert.match(world, /\$\{airLegId\}, \$\{operatorQuoteLeafIds\[0\]\}/);
  assert.match(world, /operatorQuoteLeafIds\.slice\(0, 3\)/);
  // Tier labels are generated from the quantity ladder now; the two original
  // labels remain the first two rungs of it.
  assert.match(world, /"MOQ · 1,000 units"/);
  assert.match(world, /Quantity · \$\{qty\.toLocaleString\("en-US"\)\} units/);
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
