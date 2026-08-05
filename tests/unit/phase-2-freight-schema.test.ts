import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("component freight persists only actual cost at canonical leg-leaf-tier grain", async () => {
  const schema = await read("src/db/schema.ts");
  assert.match(schema, /freightLegComponentTierCosts = pgTable/);
  assert.match(schema, /freightLegId:[\s\S]*quoteLeafId:[\s\S]*tierId:/);
  assert.match(schema, /actualFreightCost: numeric/);
  assert.match(schema, /freight_leg_component_tier_costs_identity_idx/);
  const table = schema.slice(
    schema.indexOf("freightLegComponentTierCosts"),
    schema.indexOf("quoteSnapshotFreightInputs"),
  );
  assert.doesNotMatch(table, /freightMarkupPct:|billableFreight:/);
});

test("freight snapshots use extensible input naming and pin Quote markup", async () => {
  const schema = await read("src/db/schema.ts");
  assert.match(schema, /quoteSnapshotFreightInputs = pgTable/);
  assert.match(schema, /"quote_snapshot_freight_inputs"/);
  assert.doesNotMatch(schema, /quote_snapshot_freight_component_costs/);
  assert.match(schema, /quoteCommercialSettingsPins[\s\S]*freightMarkupPct:/);
});

test("migration blocks divergent authority and mixed legacy-component costs", async () => {
  const migration = await read("drizzle/0053_phase_2_component_freight_expand.sql");
  assert.match(migration, /count\(DISTINCT fl\.freight_markup_pct\) > 1/);
  assert.match(migration, /divergent leg markups exist within a Quote/);
  assert.match(migration, /component freight identity must resolve exactly one Quote/);
  assert.match(migration, /legacy and component freight cannot coexist/);
});

// The "authority cutover removes the leg-level freight markup column"
// assertion lives in PR-G with migration 0056. PR-D deliberately stops at
// 0053 and RETAINS the column, so asserting its removal here would fail by
// design. Moved, not deleted — see docs/release/PR-D-CONSTRUCTION-BRIEF.md.

