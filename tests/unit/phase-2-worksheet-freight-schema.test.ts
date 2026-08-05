import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("worksheet freight persists subcategory destination and break authority", async () => {
  const schema = await read("src/db/schema.ts");
  assert.match(schema, /freightSubcategories = pgTable/);
  assert.match(schema, /freightDestinations = pgTable/);
  assert.match(schema, /freightDestinationBreaks = pgTable/);
  assert.match(schema, /selectedDestinationId:/);
  assert.match(schema, /freightAmount:/);
  assert.match(schema, /freightMarkupPct:/);
});

test("membership is traceability-only and same-product guarded", async () => {
  const [schema, migration] = await Promise.all([
    read("src/db/schema.ts"),
    read("drizzle/0054_phase_2_worksheet_freight_expand.sql"),
  ]);
  const start = schema.indexOf("freightSubcategoryItems = pgTable");
  const end = schema.indexOf("export const freightDestinations", start);
  const membership = schema.slice(start, end);
  assert.match(membership, /assemblyLeafId:/);
  assert.doesNotMatch(membership, /amount|markup|allocation|share|weight|cbm/i);
  assert.match(migration, /sub_assembly <> related_assembly/);
});

test("manual and future imported facts converge with per-field provenance", async () => {
  const schema = await read("src/db/schema.ts");
  assert.match(schema, /"manual",\s*"imported",\s*"corrected_after_import"/);
  assert.match(schema, /fieldProvenance: jsonb/);
  assert.match(schema, /freightCustomsChargeType[\s\S]*"duty",\s*"tariff"/);
  assert.match(schema, /freightDestinationTracking = pgTable/);
});
