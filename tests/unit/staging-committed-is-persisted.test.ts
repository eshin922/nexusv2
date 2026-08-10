/**
 * `committed` is what is in effect on the quote, not what this session applied.
 *
 * That distinction had no consequence until a quote carried a persisted
 * override. Then it had several, all silent:
 *
 *   - "Remove direct price" deleted a key that had never been in `working`, so
 *     `diffSets` saw no change: no chip, no delta, nothing.
 *   - A replacement could not be staged at all, because the value it would
 *     replace was not represented.
 *   - `appliedCount` reported fewer adjustments than the quote carried, so the
 *     APPLIED bar under-stated what was in effect.
 *
 * `globalAdj` had always been seeded from `quotes.global_price_adj_pct`. The
 * overrides simply were not, and the inconsistency is what made the gap easy
 * to miss: the bar was right about one lever and wrong about the other.
 *
 * `lifts` stays empty here on purpose. No persisted lift authority exists yet —
 * that is OD-012 — and seeding an empty set is the honest representation of
 * "nothing is persisted", not an oversight repeated.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  cellKey,
  diffSets,
  resolveCanonicalCell,
  resolveEngineCell,
  type PricingSet,
} from "../../src/lib/pricing-staging.ts";

const TIER = "tier-1";
const ENGINE = "engine-sku-AAAA";
const CANON = "canonical-leaf-AAAA";
// Distinct on purpose — a fixture where the two ids coincide cannot detect a
// seeding path that forgets to translate between them.
const SKUS = [{ id: ENGINE, canonicalQuoteLeafId: CANON }];

const PERSISTED = [{ quoteSkuId: ENGINE, tierId: TIER, sellPriceOverride: 12.5 }];

/** What the provider does at mount. */
function seed(
  persisted: ReadonlyArray<{ quoteSkuId: string; tierId: string; sellPriceOverride: number }>,
  globalAdj: number,
): PricingSet {
  const overrides: Record<string, number> = {};
  for (const o of persisted) {
    const canonical = resolveCanonicalCell(
      { quoteSkuId: o.quoteSkuId, tierId: o.tierId },
      SKUS,
    );
    if (canonical === null) continue;
    overrides[cellKey(canonical)] = o.sellPriceOverride;
  }
  return { lifts: {}, overrides, globalAdj };
}

const KEY = cellKey({ quoteLeafId: CANON, tierId: TIER });

// ── the mount state ───────────────────────────────────────────────────────

test("a quote with one persisted override initializes with one committed override", () => {
  const committed = seed(PERSISTED, 0);
  assert.equal(Object.keys(committed.overrides).length, 1);
  assert.equal(committed.overrides[KEY], 12.5);
});

test("it is keyed CANONICALLY, not by the engine id it arrived as", () => {
  const committed = seed(PERSISTED, 0);
  assert.ok(KEY.startsWith(CANON), "the staging key carries canonical identity");
  assert.equal(committed.overrides[`${ENGINE}::${TIER}`], undefined);
});

test("working === committed before any staging action", () => {
  const committed = seed(PERSISTED, 0);
  const working = seed(PERSISTED, 0);
  assert.deepEqual(working, committed);
  // The property that matters is not deep equality but that the DIFF is empty:
  // `isStaged` is `changes.length > 0`, so a non-empty diff at mount would put
  // the page in a staged state nobody asked for.
  assert.deepEqual(diffSets(committed, working), []);
});

test("appliedCount counts the persisted override", () => {
  const committed = seed(PERSISTED, 0);
  const appliedCount =
    Object.keys(committed.lifts).length +
    Object.keys(committed.overrides).length +
    (Math.abs(committed.globalAdj) > 1e-9 ? 1 : 0);
  assert.equal(appliedCount, 1);
});

test("lifts remain empty — no persisted lift authority exists yet", () => {
  assert.deepEqual(seed(PERSISTED, 0).lifts, {});
});

// ── what the seeding makes possible ───────────────────────────────────────

test("removing a persisted override now produces an override-removed change", () => {
  const committed = seed(PERSISTED, 0);
  const working: PricingSet = { ...committed, overrides: {} };
  assert.deepEqual(diffSets(committed, working), [
    { kind: "override-removed", key: KEY },
  ]);
});

test("replacing one produces a SINGLE change, not a removal plus an addition", () => {
  const committed = seed(PERSISTED, 0);
  const working: PricingSet = { ...committed, overrides: { [KEY]: 20 } };
  const changes = diffSets(committed, working);
  assert.equal(changes.length, 1, "one staged change");
  assert.deepEqual(changes[0], { kind: "override", key: KEY, value: 20 });
});

test("discarding a staged replacement restores the persisted value", () => {
  const committed = seed(PERSISTED, 0);
  // `unstage` restores the COMMITTED value rather than deleting the key —
  // deleting would carry out a removal the operator never asked for.
  const working: PricingSet = { ...committed, overrides: { [KEY]: committed.overrides[KEY] } };
  assert.deepEqual(diffSets(committed, working), []);
  assert.equal(working.overrides[KEY], 12.5);
});

// ── fail-closed on the way in ─────────────────────────────────────────────

test("a persisted override with no canonical attachment is not seeded", () => {
  const orphan = [{ quoteSkuId: "engine-unknown", tierId: TIER, sellPriceOverride: 9 }];
  assert.deepEqual(seed(orphan, 0).overrides, {});
  // It is not stageable, but it is NOT lost: the preview passes untranslatable
  // persisted rows through to the costing input unchanged, because they are
  // real and in effect. Asserted at the resolution boundary here.
  assert.equal(
    resolveCanonicalCell({ quoteSkuId: "engine-unknown", tierId: TIER }, SKUS),
    null,
  );
});

test("the two resolutions are inverses on a resolvable cell", () => {
  const canonical = resolveCanonicalCell({ quoteSkuId: ENGINE, tierId: TIER }, SKUS);
  assert.deepEqual(canonical, { quoteLeafId: CANON, tierId: TIER });
  assert.deepEqual(resolveEngineCell(canonical!, SKUS), {
    quoteSkuId: ENGINE,
    tierId: TIER,
  });
});
