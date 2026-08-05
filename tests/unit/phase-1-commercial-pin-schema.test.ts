import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync(
  "drizzle/0051_phase_1_commercial_settings_pins.sql",
  "utf8",
);

test("commercial pin is Quote-scoped and durably linked to one sent snapshot", () => {
  assert.match(schema, /quoteCommercialSettingsPins = pgTable/);
  assert.match(schema, /quoteSnapshotId:[\s\S]*?\.notNull\(\)[\s\S]*?\.unique\(\)/);
  assert.match(
    schema,
    /quote_commercial_settings_pins_active_idx[\s\S]*?\.on\(t\.quoteId\)[\s\S]*?superseded_at IS NULL/,
  );
  assert.match(migration, /UNIQUE\("quote_snapshot_id"\)/);
  assert.match(migration, /WHERE superseded_at IS NULL/);
});

test("tier-grained markup pin preserves canonical attachment and provenance", () => {
  for (const column of [
    '"quote_leaf_id" uuid NOT NULL',
    '"tier_id" uuid NOT NULL',
    '"category" text NOT NULL',
    '"chosen_rung" text NOT NULL',
    '"markup_pct" numeric(5, 4) NOT NULL',
    '"source_set_at" timestamp with time zone NOT NULL',
  ]) {
    assert.ok(migration.includes(column), `missing ${column}`);
  }
  assert.match(
    migration,
    /UNIQUE INDEX "quote_commercial_markup_pins_resolution_idx"[\s\S]*?"pin_id","quote_leaf_id","tier_id","category"/,
  );
  assert.match(migration, /quote_leaves"\("id"\) ON DELETE restrict/);
});
