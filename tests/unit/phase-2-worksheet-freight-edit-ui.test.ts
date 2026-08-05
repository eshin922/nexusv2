import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url), "utf8");

test("draft worksheet exposes business-language correction surfaces", () => {
  assert.match(source, /Edit shipment/);
  assert.match(source, /submit\(updateFreightSubcategory\)/);
  assert.match(source, /submit\(updateFreightDestination\)/);
  assert.match(source, /Edit shipment contents/);
  assert.doesNotMatch(source, /foreign key|junction|quote_leaf|subcategory id/i);
});

test("commercial corrections follow editability while selected tracking remains operational", () => {
  assert.match(source, /editable && <ShipmentEdit/);
  assert.match(source, /TrackingStrip selected=\{selected\}/);
  assert.match(source, /these dates were entered for a different endpoint/);
});
