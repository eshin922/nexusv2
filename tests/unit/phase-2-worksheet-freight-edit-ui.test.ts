import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url), "utf8");

test("draft worksheet exposes business-language correction surfaces", () => {
  assert.match(source, /Edit shipment/);
  // SUPERSEDED 2026-08-05 by Pattern 47(f). These asserted the unkeyed
  // `submit(action)` shape, which required one shared pending flag across the
  // surface — an in-flight write then disabled unrelated controls. Every
  // submit now declares the action instance that owns it. The enduring
  // intent, that these correction surfaces exist and are reachable, is
  // preserved; only the call shape changed.
  assert.match(source, /submit\(updateFreightSubcategory, `editShipment:/);
  assert.match(source, /submit\(updateFreightDestination, `editDestination:/);
  assert.match(source, /Edit shipment contents/);
  assert.doesNotMatch(source, /foreign key|junction|quote_leaf|subcategory id/i);
});

test("commercial corrections follow editability while selected tracking remains operational", () => {
  assert.match(source, /editable && <ShipmentEdit/);
  assert.match(source, /TrackingStrip selected=\{selected\}/);
  assert.match(source, /these dates were entered for a different endpoint/);
});
