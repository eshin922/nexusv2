import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ============================================================================
// Tier -> worksheet Freight break propagation
// ============================================================================
//
// A quote tier is a column across the whole Costs workspace, so adding one must
// extend every downstream structure. `addTier` fanned out to packaging inputs,
// production inputs and the legacy freight LEG model, but never to
// `freight_destination_breaks`. Destinations stayed pinned to the tiers that
// existed when they were created.
//
// Operator evidence (quote 2f29af72): destinations created before tiers 2 and 3
// carried ONE break row; destinations created after carried three. At a tier
// with no break row there is nothing to price, so Design Authority Row 04
// could not compute. It looked like a first-destination defect only because the
// first destinations happened to predate the tiers.

const actions = await readFile(
  new URL("../../src/app/actions/quotes.ts", import.meta.url),
  "utf8",
);
const backfill = await readFile(
  new URL("../../scripts/backfill/worksheet-freight-tier-breaks.ts", import.meta.url),
  "utf8",
);

function helperBody(): string {
  const start = actions.indexOf("async function seedWorksheetFreightBreaksForTiers");
  assert.ok(start >= 0, "propagation helper not found");
  return actions.slice(start, actions.indexOf("\nexport async function", start));
}

test("adding a tier materialises a break row for every existing destination", () => {
  const body = actions.slice(
    actions.indexOf("export async function addTier"),
    actions.indexOf("export async function updateTier"),
  );
  assert.match(
    body,
    /seedWorksheetFreightBreaksForTiers\(\s*db,\s*quoteId,\s*\[tier\.id\],?\s*\)/,
    "addTier must propagate to worksheet breaks, not only the legacy leg model",
  );
});

test("tier presets propagate identically", () => {
  const body = actions.slice(
    actions.indexOf("export async function applyTierPreset"),
    actions.indexOf("export async function", actions.indexOf("export async function applyTierPreset") + 40),
  );
  assert.match(body, /seedWorksheetFreightBreaksForTiers\(/);
  assert.match(body, /newTiers\.map\(\(t\) => t\.id\)/, "every preset tier must be covered");
});

test("first and later destinations are treated identically", () => {
  const body = helperBody();
  // The helper selects every destination on the quote. Nothing keys on
  // display_order or creation time, so the governed first-vs-later CREATION
  // behaviour is untouched while tier expansion applies uniformly.
  assert.match(body, /\.from\(freightDestinations\)/);
  assert.ok(
    !/displayOrder|display_order|created_at|createdAt/.test(body),
    "propagation must not distinguish first from later destinations",
  );
});

test("mode, markup and note inherit — amount never does", () => {
  const body = helperBody();
  assert.match(body, /mode: prior\?\.mode \?\? null/);
  assert.match(body, /freightMarkupPct: prior\?\.freightMarkupPct \?\? null/);
  assert.match(body, /shipmentNote: prior\?\.shipmentNote \?\? null/);
  // An amount is negotiated for a specific quantity break. Carrying it across
  // quantities would fabricate a price the forwarder never quoted.
  assert.ok(
    !/freightAmount:/.test(body),
    "freightAmount must never be inherited across tiers",
  );
});

test("propagation is additive and idempotent", () => {
  const body = helperBody();
  // Only (destination, tier) pairs with no existing row are inserted, so a
  // repeat cannot duplicate and an entered value cannot be overwritten.
  assert.match(body, /present\.has\(`\$\{destinationId\}:\$\{tierId\}`\)/);
  assert.ok(
    !/\.update\(freightDestinationBreaks\)|\.delete\(freightDestinationBreaks\)/.test(body),
    "propagation must never update or delete an existing break",
  );
});

test("backfill repairs stranded destinations without touching entered values", () => {
  assert.match(backfill, /not exists \(\s*select 1 from freight_destination_breaks/i);
  assert.ok(
    !/\bupdate\s+freight_destination_breaks|\bdelete\s+from\s+freight_destination_breaks/i.test(backfill),
    "backfill must be insert-only",
  );
  // Draft-only by default: a sent quote's freight was priced against the tiers
  // it had, so repairing it would rewrite commercial history.
  assert.match(backfill, /q\.status = 'draft'/);
  assert.match(backfill, /include-sent/);
  // Same inheritance rule as the action layer.
  assert.match(backfill, /prior\.mode, prior\.freight_markup_pct, prior\.shipment_note/);
});

test("flat and differs-by-break semantics are untouched", () => {
  // Row 05 was verified correct by row-level evidence: a destination with
  // sameValueAllBreaks=false held three independent values. Propagation must
  // not reach into that resolution path.
  const body = helperBody();
  assert.ok(
    !/sameValueAllBreaks|resolveBreakFieldSources/.test(body),
    "propagation must not touch flat-mode resolution",
  );
});

test("commercial math is untouched", () => {
  const body = helperBody();
  assert.ok(
    !/computeQuoteCosting|markupPct \*|\* \(1 \+/.test(body),
    "propagation seeds structure only and performs no pricing arithmetic",
  );
});
