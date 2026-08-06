/**
 * Governed-vocabulary input contract.
 *
 * A field backed by a Postgres enum is never free text. The operator selects
 * from a governed list, the server validates the submission again, and an
 * invalid value never reaches persistence — so an enum constraint violation
 * can never surface as a full-page runtime error.
 *
 * Reference moment (2026-08-06): Freight Type rendered as `<input type="text">`
 * over `freight_destination_breaks.mode`. Typing "Ocean FCL" — the label an
 * operator would naturally use — produced `invalid input value for enum
 * freight_leg_mode` and a 500 on the Costs surface.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { freightLegMode } from "../../src/db/schema";
import {
  FREIGHT_LEG_MODES,
  enumLabel,
  enumOptions,
  isFreightLegMode,
} from "../../src/lib/enum-labels";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the shipped vocabulary matches the database enum exactly", () => {
  // enum-labels.ts is client-safe and cannot import the schema without pulling
  // Drizzle into the browser bundle, so the two lists are bound here instead.
  // Order matters: it is the order the operator sees in the selector.
  assert.deepEqual([...FREIGHT_LEG_MODES], [...freightLegMode.enumValues]);
});

test("labels are derived from the enum, not a second vocabulary", () => {
  assert.equal(enumLabel("ocean_fcl"), "Ocean FCL");
  assert.equal(enumLabel("ocean_lcl"), "Ocean LCL");
  assert.equal(enumLabel("ltl_truck"), "LTL Truck");
  assert.equal(enumLabel("exw_pickup"), "EXW Pickup");
  assert.equal(enumLabel("air_freight"), "Air Freight");
  assert.equal(enumLabel("air_express"), "Air Express");
  assert.equal(enumLabel("truckload"), "Truckload");
  assert.equal(enumLabel("drayage"), "Drayage");
  assert.equal(enumLabel("parcel"), "Parcel");
  assert.equal(enumLabel("other"), "Other");

  // Every enum value produces a non-empty label with no snake_case left over,
  // so a value added to the enum needs no code change to render correctly.
  for (const { value, label } of enumOptions(FREIGHT_LEG_MODES)) {
    assert.ok(label.length > 0, `${value} produced an empty label`);
    assert.doesNotMatch(label, /_/, `${value} leaked snake_case into the UI`);
  }
});

test("the guard admits every enum value and rejects operator-shaped strings", () => {
  for (const value of FREIGHT_LEG_MODES) assert.ok(isFreightLegMode(value));

  // The exact string that caused the crash, plus its near neighbours.
  assert.equal(isFreightLegMode("Ocean FCL"), false);
  assert.equal(isFreightLegMode("Ocean_FCL"), false);
  assert.equal(isFreightLegMode("OCEAN_FCL"), false);
  assert.equal(isFreightLegMode("ocean"), false);
  assert.equal(isFreightLegMode(""), false);
});

test("Freight Type is a governed selector, not free text", async () => {
  const drilldown = await read("src/components/costs/freight-drilldown.tsx");

  // SUPERSEDED 2026-08-06 by the tier-ordering correction. This originally
  // matched `mode:${row.tierId}` — addressing the write from the BREAK ROW.
  // Validation 2 proved the break array arrives in Postgres heap order, so
  // that addressed a different tier than the operator was looking at. The
  // control is now addressed by the COLUMN's tier. Tier-2 precedence: an
  // operator-facing correctness correction outranks the earlier contract
  // shape. See tests/unit/freight-tier-alignment.test.ts.
  const control = drilldown.match(/<select[^>]*name=\{`mode:\$\{tier\.id\}`\}[^>]*>/);
  assert.ok(control, "Freight Type must render a <select> bound to mode:<tierId>");

  // Options come from the shared vocabulary, so the control cannot drift from
  // the guard that validates what it submits.
  assert.match(drilldown, /FREIGHT_LEG_MODES\.map/);
  assert.match(drilldown, /enumLabel\(value\)/);
  // Optional field: clearing to NULL stays reachable.
  assert.match(drilldown, /<option value="">Not set<\/option>/);

  assert.doesNotMatch(
    drilldown,
    /<input[^>]*name=\{`mode:\$\{tier\.id\}`\}/,
    "Freight Type must not be free text",
  );
});

test("the server re-validates mode and never passes an unchecked value through", async () => {
  const action = await read("src/app/actions/freight-worksheet.ts");

  assert.match(action, /const modeOrNull = \(fd: FormData, key: string\)/);
  assert.match(action, /isFreightLegMode\(raw\)/);
  assert.match(action, /ActionGuardError\(\s*ERR\.VALIDATION/);

  // Both write paths — the single-item update and the per-tier break group.
  assert.match(action, /modeOrNull\(fd, "mode"\)/);
  assert.match(action, /modeOrNull\(fd, `mode:\$\{modeKey\}`\)/);

  // The unchecked casts these replaced must not come back.
  assert.doesNotMatch(action, /nullable\(fd, "mode"\)/);
  assert.doesNotMatch(action, /nullable\(fd, `mode:/);
});

test("the legacy freight-leg path shares one vocabulary with the worksheet", async () => {
  const legacy = await read("src/app/actions/freight.ts");

  assert.match(legacy, /from "@\/lib\/enum-labels"/);
  assert.match(legacy, /isFreightLegMode\(s\) \? s : null/);
  // No private copy of the list to drift out of step.
  assert.doesNotMatch(legacy, /const FREIGHT_LEG_MODES = \[/);
});
