/**
 * Client Target — resolution, summary, and the facts a surface may state.
 *
 * The rule is `tier target ?? common target`, resolved per tier. The model this
 * replaced collapsed per-(leaf, tier) persistence to one value per SKU row —
 * "the first non-null found while iterating tiers" — and then measured every
 * cell's headroom against it, while the engine compared each cell to its own
 * true target. Two bases for one question, agreeing only while every tier
 * shared a target.
 *
 * So the tests that matter here are the ones about tiers that DIFFER, and about
 * the states the old model could not represent at all: a common target with no
 * overrides, and overrides with no common target.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clientTargetFacts,
  describeGap,
  indexClientTargets,
  resolveClientTarget,
  summariseClientTargets,
  unitKeyOf,
  type ClientTargetRow,
} from "../../src/lib/client-target.ts";

const ASY = "asy-1";
const LEAF = "leaf-1";
const T1 = "tier-1";
const T2 = "tier-2";
const T3 = "tier-3";
const T4 = "tier-4";

const row = (o: Partial<ClientTargetRow>): ClientTargetRow => ({
  assemblyId: null,
  quoteLeafId: null,
  tierId: null,
  clientTargetPricePerUnit: 5,
  ...o,
});

// ── the rule ──────────────────────────────────────────────────────────────

test("a tier with no target of its own inherits the common one", () => {
  const idx = indexClientTargets([row({ assemblyId: ASY, clientTargetPricePerUnit: 5 })]);
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T3), {
    value: 5,
    source: "common",
  });
});

test("a tier target REPLACES the common one for that tier only", () => {
  const idx = indexClientTargets([
    row({ assemblyId: ASY, clientTargetPricePerUnit: 5 }),
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 4.6 }),
  ]);
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T2), { value: 4.6, source: "tier" });
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T1), { value: 5, source: "common" });
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T4), { value: 5, source: "common" });
});

test("tiers that DIFFER each resolve to their own value", () => {
  // The case the previous model could persist but never display: it took the
  // first non-null across tiers and measured all four against it.
  const idx = indexClientTargets([
    row({ assemblyId: ASY, tierId: T1, clientTargetPricePerUnit: 6 }),
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 5 }),
    row({ assemblyId: ASY, tierId: T3, clientTargetPricePerUnit: 4 }),
  ]);
  const u = idx.get(ASY);
  assert.equal(resolveClientTarget(u, T1).value, 6);
  assert.equal(resolveClientTarget(u, T2).value, 5);
  assert.equal(resolveClientTarget(u, T3).value, 4);
});

test("no target anywhere resolves to null, not zero", () => {
  assert.deepEqual(resolveClientTarget(undefined, T1), { value: null, source: "none" });
  const idx = indexClientTargets([]);
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T1), { value: null, source: "none" });
});

test("clearing the common target leaves tier overrides standing", () => {
  // A tier target is its own decision; clearing a different one does not
  // unmake it. Tiers without one then have NO target — which is the honest
  // state, not a reason to refuse the clear.
  const idx = indexClientTargets([
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 4.6 }),
  ]);
  const u = idx.get(ASY);
  assert.deepEqual(resolveClientTarget(u, T2), { value: 4.6, source: "tier" });
  assert.deepEqual(resolveClientTarget(u, T1), { value: null, source: "none" });
});

test("an override equal to the common target is still an override", () => {
  // `source` is returned rather than inferred by comparing values. An operator
  // who deliberately pinned a tier at the same number should see it named, and
  // the next change to the common target must not silently move that tier.
  const idx = indexClientTargets([
    row({ assemblyId: ASY, clientTargetPricePerUnit: 5 }),
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 5 }),
  ]);
  assert.equal(resolveClientTarget(idx.get(ASY), T2).source, "tier");
});

test("zero is a target, and absence is not zero", () => {
  const idx = indexClientTargets([row({ assemblyId: ASY, clientTargetPricePerUnit: 0 })]);
  assert.deepEqual(resolveClientTarget(idx.get(ASY), T1), { value: 0, source: "common" });
});

// ── identity ──────────────────────────────────────────────────────────────

test("units are keyed by whichever id column is set", () => {
  const idx = indexClientTargets([
    row({ assemblyId: ASY, clientTargetPricePerUnit: 5 }),
    row({ quoteLeafId: LEAF, clientTargetPricePerUnit: 3 }),
  ]);
  assert.equal(resolveClientTarget(idx.get(ASY), T1).value, 5);
  assert.equal(resolveClientTarget(idx.get(LEAF), T1).value, 3);
});

test("an Item Group and a Direct Product do not share a target", () => {
  const idx = indexClientTargets([row({ assemblyId: ASY, clientTargetPricePerUnit: 5 })]);
  assert.equal(resolveClientTarget(idx.get(LEAF), T1).value, null);
});

test("a row identifying two units, or none, is skipped rather than guessed", () => {
  // The schema's CHECK makes both impossible, so reaching this means the row
  // came from somewhere the constraint does not govern. Guessing which half to
  // believe would attach a client's price to a product they never named.
  assert.equal(unitKeyOf(row({ assemblyId: ASY, quoteLeafId: LEAF })), null);
  assert.equal(unitKeyOf(row({})), null);
  assert.equal(indexClientTargets([row({ assemblyId: ASY, quoteLeafId: LEAF })]).size, 0);
});

// ── the row summary ───────────────────────────────────────────────────────

test("nothing set summarises to nothing", () => {
  assert.equal(summariseClientTargets(undefined, 4), null);
});

test("a common target with no overrides says all tiers", () => {
  const idx = indexClientTargets([row({ assemblyId: ASY, clientTargetPricePerUnit: 5 })]);
  assert.equal(summariseClientTargets(idx.get(ASY), 4), "all tiers");
});

test("a common target with overrides counts both", () => {
  const idx = indexClientTargets([
    row({ assemblyId: ASY, clientTargetPricePerUnit: 5 }),
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 4.6 }),
  ]);
  assert.equal(summariseClientTargets(idx.get(ASY), 4), "3 tiers · 1 override");
});

test("overrides with NO common target say how many tiers are unset", () => {
  // The disposition names this one specifically. "1 target" or "1 tier · 1
  // override" would both read as though the quote were covered.
  const idx = indexClientTargets([
    row({ assemblyId: ASY, tierId: T2, clientTargetPricePerUnit: 4.6 }),
  ]);
  assert.equal(summariseClientTargets(idx.get(ASY), 4), "1 tier targeted · 3 unset");
});

test("every tier overridden with no common target still says none are unset", () => {
  const idx = indexClientTargets(
    [T1, T2, T3, T4].map((t) => row({ assemblyId: ASY, tierId: t, clientTargetPricePerUnit: 4 })),
  );
  assert.equal(summariseClientTargets(idx.get(ASY), 4), "4 tiers targeted · 0 unset");
});

// ── the facts, and the absence of a verdict ───────────────────────────────

test("no target means no facts at all", () => {
  assert.equal(
    clientTargetFacts({ target: null, quotedSellPerUnit: 5, costPerUnit: 3 }),
    null,
  );
});

test("gap, percentage and margin-at-target are reported together", () => {
  const f = clientTargetFacts({ target: 5, quotedSellPerUnit: 5.35, costPerUnit: 3 });
  assert.ok(f);
  assert.ok(Math.abs(f.gapAbs! - 0.35) < 1e-9);
  assert.ok(Math.abs(f.gapPct! - 0.07) < 1e-9);
  // Quoting at their number: (5 - 3) / 5.
  assert.ok(Math.abs(f.marginAtTarget! - 0.4) < 1e-9);
});

test("a quote below the client target reports a negative gap", () => {
  const f = clientTargetFacts({ target: 5, quotedSellPerUnit: 4.8, costPerUnit: 3 });
  assert.ok(Math.abs(f!.gapAbs! + 0.2) < 1e-9);
});

test("an unpriced cell has a target and no gap", () => {
  // The target is known; the quote is not. Reporting a gap of zero would say
  // the two agree.
  const f = clientTargetFacts({ target: 5, quotedSellPerUnit: null, costPerUnit: 3 });
  assert.equal(f!.gapAbs, null);
  assert.equal(f!.gapPct, null);
  assert.ok(Math.abs(f!.marginAtTarget! - 0.4) < 1e-9);
});

test("a target of zero yields no percentage and no margin", () => {
  // Dividing by it gives Infinity, and -Infinity is not a margin.
  const f = clientTargetFacts({ target: 0, quotedSellPerUnit: 1, costPerUnit: 3 });
  assert.equal(f!.gapPct, null);
  assert.equal(f!.marginAtTarget, null);
  assert.equal(f!.gapAbs, 1);
});

test("the wording is factual and directional, never a verdict", () => {
  assert.equal(describeGap(0.35), "$0.35 above client target");
  assert.equal(describeGap(-0.2), "$0.20 below client target");
  assert.equal(describeGap(0), "at client target");
  assert.equal(describeGap(null), null);
  // Sub-hundredth-of-a-cent noise is the same price.
  assert.equal(describeGap(0.00001), "at client target");
  for (const g of [0.35, -0.2, 0, 0.00001]) {
    const s = describeGap(g) ?? "";
    assert.doesNotMatch(s, /competitive|uncompetitive/i, "no verdict language");
  }
});
