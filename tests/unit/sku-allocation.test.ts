import assert from "node:assert/strict";
import test from "node:test";

import { formatSku, normalizeToken } from "../../src/lib/sku/format.ts";

// ═══════════════════════════════════════════════════════════════════════
// The pure half of allocation. The database-bound half is exercised
// against the isolated Postgres by `scripts/gate-1b/sku-allocation-walk.ts`,
// because its behaviour IS the constraints -- two unique indexes and a row
// lock -- and asserting those against a mock would only prove the mock.
// ═══════════════════════════════════════════════════════════════════════

test("a token normalizes to upper case, so one identity has one spelling", () => {
  assert.equal(normalizeToken(" spj "), "SPJ");
  assert.equal(normalizeToken("Spj"), "SPJ");
});

test("the formatted SKU is the catalog's shape", () => {
  assert.equal(formatSku("SPJ", 1001), "DPS-SPJ-1001");
  assert.equal(formatSku("spj", 1001), "DPS-SPJ-1001");
});

test("numbers below four digits are padded, matching existing identifiers", () => {
  // `DPS-BOTTLE-0001` exists in the live catalog. An unpadded `DPS-X-1` would
  // be a different string for the same intent, and string identity is the
  // whole point.
  assert.equal(formatSku("X", 1), "DPS-X-0001");
  assert.equal(formatSku("X", 42), "DPS-X-0042");
});

test("numbers past four digits are not truncated", () => {
  // Padding is a minimum width, never a cap. Truncating at four would start
  // minting collisions the moment a brand passed 9999.
  assert.equal(formatSku("X", 10000), "DPS-X-10000");
});
