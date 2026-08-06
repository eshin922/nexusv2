/**
 * Tier-column alignment for the Freight worksheet.
 *
 * The invariant: the tiers collection is the authority for column order, and a
 * destination-break row is located by `tierId` — never by position.
 *
 * Reference moment (2026-08-06, Validation 2): `freight-workbook.ts` loaded
 * breaks with no ORDER BY, so they arrived in Postgres heap order. On a
 * four-tier quote the loader returned Tier 1, Tier 3, Tier 2, Tier 4 while the
 * headings read Tier 1-4. Freight Type and Item/Description iterated the array
 * positionally, so a value displayed beneath the wrong quantity break and —
 * worse — an edit made under one column wrote a different tier's row.
 *
 * Every case below feeds a DELIBERATELY SCRAMBLED break array. If any consumer
 * regresses to positional reads, these fail.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { alignBreaksToTiers } from "../../src/lib/freight-tier-cells";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const TIERS = [
  { id: "t1", label: "Tier 1" },
  { id: "t2", label: "Tier 2" },
  { id: "t3", label: "Tier 3" },
  { id: "t4", label: "Tier 4" },
];

/** The exact heap order the production loader returned during Validation 2. */
const SCRAMBLED = [
  { id: "b1", tierId: "t1", mode: "ocean_fcl", shipmentNote: "6 pallets", freightAmount: "4200.00" },
  { id: "b3", tierId: "t3", mode: "ocean_fcl", shipmentNote: "6 pallets", freightAmount: "9000.00" },
  { id: "b2", tierId: "t2", mode: null, shipmentNote: null, freightAmount: "4200.00" },
  { id: "b4", tierId: "t4", mode: "ocean_fcl", shipmentNote: "6 pallets", freightAmount: null },
];

test("columns stay in tier order regardless of break-row order", () => {
  const cells = alignBreaksToTiers(TIERS, SCRAMBLED);

  assert.deepEqual(cells.map((c) => c.tier.id), ["t1", "t2", "t3", "t4"]);
  assert.deepEqual(cells.map((c) => c.index), [0, 1, 2, 3]);

  // Reversing the input must not move a single column.
  const reversed = alignBreaksToTiers(TIERS, [...SCRAMBLED].reverse());
  assert.deepEqual(
    reversed.map((c) => [c.tier.id, c.row?.id]),
    cells.map((c) => [c.tier.id, c.row?.id]),
  );
});

test("each cell carries its own tier's row, not the row at that position", () => {
  const cells = alignBreaksToTiers(TIERS, SCRAMBLED);

  // Positionally, index 1 holds b3 (Tier 3) and index 2 holds b2 (Tier 2).
  // The defect displayed exactly that swap; alignment must undo it.
  assert.equal(cells[1].row?.id, "b2");
  assert.equal(cells[2].row?.id, "b3");

  // The values an operator reads under each heading.
  assert.deepEqual(cells.map((c) => c.row?.mode ?? null), [
    "ocean_fcl",
    null, // Tier 2 is genuinely unset — it must not borrow Tier 3's value
    "ocean_fcl",
    "ocean_fcl",
  ]);
  assert.deepEqual(cells.map((c) => c.row?.freightAmount ?? null), [
    "4200.00",
    "4200.00",
    "9000.00", // the per-tier amount stays with Tier 3
    null,
  ]);
});

test("a write is addressed by the visible tier, so it lands on that tier", () => {
  const cells = alignBreaksToTiers(TIERS, SCRAMBLED);

  // The field name the control submits, per column.
  const names = cells.map((c) => (c.row ? `mode:${c.tier.id}` : null));
  assert.deepEqual(names, ["mode:t1", "mode:t2", "mode:t3", "mode:t4"]);

  // The pre-fix bug in one assertion: naming from the ROW's position rather
  // than the COLUMN's tier sent the second column's edit to Tier 3.
  const positional = SCRAMBLED.map((row) => `mode:${row.tierId}`);
  assert.notDeepEqual(positional, names);
  assert.equal(positional[1], "mode:t3");
});

test("a tier with no break row yields null, and no control is addressable", () => {
  const cells = alignBreaksToTiers(TIERS, SCRAMBLED.filter((r) => r.tierId !== "t2"));

  assert.equal(cells.length, 4, "an unseeded tier still gets its column");
  assert.equal(cells[1].row, null);
  assert.equal(cells[1].tier.id, "t2");
  // Later columns must not shift up to fill the gap.
  assert.equal(cells[2].row?.id, "b3");
});

test("a break row for an unknown tier is dropped rather than shifting columns", () => {
  const orphan = { id: "b9", tierId: "deleted-tier", mode: "parcel", shipmentNote: null, freightAmount: "1.00" };
  const cells = alignBreaksToTiers(TIERS, [orphan, ...SCRAMBLED]);

  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map((c) => c.row?.id), ["b1", "b2", "b3", "b4"]);
});

test("empty inputs degrade without throwing", () => {
  assert.deepEqual(alignBreaksToTiers([], SCRAMBLED), []);
  assert.deepEqual(
    alignBreaksToTiers(TIERS, []).map((c) => c.row),
    [null, null, null, null],
  );
});

test("every tier-positioned Freight cell renders through the alignment helper", async () => {
  const drilldown = await read("src/components/costs/freight-drilldown.tsx");

  assert.match(drilldown, /alignBreaksToTiers/);

  // No consumer may iterate the break array positionally. This is the single
  // assertion that would have caught the original defect.
  assert.doesNotMatch(drilldown, /rows\.map\(/);

  // Amount, markup, freight type and item/description all address their write
  // by the column's tier id.
  for (const field of ["freightAmount", "freightMarkupPct", "mode", "shipmentNote"]) {
    assert.match(
      drilldown,
      new RegExp(`name=\\{\`${field}:\\$\\{tier\\.id\\}\``),
      `${field} must be addressed by the visible tier`,
    );
  }
  // The pre-fix shape, addressed from the row instead of the column.
  assert.doesNotMatch(drilldown, /name=\{`(mode|shipmentNote):\$\{row\.tierId\}`\}/);
});

test("the loader orders breaks deterministically as defence in depth", async () => {
  const workbook = await read("src/lib/freight-workbook.ts");

  assert.match(
    workbook,
    /freightDestinationBreaks[\s\S]{0,400}?orderBy\([\s\S]{0,160}?freightDestinationBreaks\.tierId/,
    "breaks must not be left in heap order",
  );
});

test("an unset freight type says so rather than rendering an empty segment", async () => {
  const drilldown = await read("src/components/costs/freight-drilldown.tsx");

  assert.match(drilldown, /const modeChip = \(mode: string\) => mode \? [\s\S]{0,80}? : "not set"/);
  assert.doesNotMatch(drilldown, /const modeChip = \(mode: string\) => mode \? [\s\S]{0,80}? : ""/);
});

test("flat-mode prose matches the implemented contract", async () => {
  const writer = await read("src/lib/freight-break-write.ts");

  // Markup follows the flat rule alongside the amount; mode and description
  // never do. The rule statement used to say "freight AMOUNT only" — it may
  // still appear quoted in the dated correction note, but not as the rule.
  assert.doesNotMatch(writer, /"One value, all breaks" governs the freight AMOUNT only/);
  assert.match(writer, /COMMERCIAL TERMS — freight amount and/);
  assert.match(writer, /markup\. It does not collapse the OPERATIONAL IDENTITY/);
  assert.match(writer, /amountKey = flat \? sourceTierId : rowTierId/);
});
