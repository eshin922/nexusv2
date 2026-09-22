import assert from "node:assert/strict";
import test from "node:test";
import {
  packagingLineOverride,
  packagingMarkupCategory,
} from "../../src/lib/costs/packaging-markup-authority.ts";

test("Setup Product Type is the markup category authority", () => {
  assert.equal(
    packagingMarkupCategory("Labels", "primary_packaging"),
    "Labels",
  );
});

test("new HubSpot product types resolve their matching Settings defaults", () => {
  // The saved category can be stale when a catalogue product is reclassified.
  // HubSpot's raw option value is the Settings key; never fall back to the old
  // packaging rate just because the new type was added after the line was made.
  const settingsDefaults = new Map([
    ["Ingestibles", "configured ingestibles default"],
    ["Topicals", "configured topicals default"],
    ["Primary", "older packaging default"],
  ]);

  for (const [type, expectedDefault] of [
    ["Ingestibles", "configured ingestibles default"],
    ["Topicals", "configured topicals default"],
  ] as const) {
    const category = packagingMarkupCategory(type, "Primary");
    assert.equal(category, type);
    assert.equal(settingsDefaults.get(category!), expectedDefault);
  }
});

test("untyped legacy products retain their saved category", () => {
  assert.equal(
    packagingMarkupCategory(null, "Primary"),
    "Primary",
  );
  assert.equal(packagingMarkupCategory("  ", null), null);
});

test("cached category-default percentages are not line overrides", () => {
  assert.equal(packagingLineOverride(0.2, "category_default"), null);
});

test("manual overrides, including zero, remain line overrides", () => {
  assert.equal(packagingLineOverride(0.2, "manual_override"), 0.2);
  assert.equal(packagingLineOverride(0, "manual_override"), 0);
});
