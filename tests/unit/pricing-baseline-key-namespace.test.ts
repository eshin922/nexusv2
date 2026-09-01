/**
 * Return to computed baseline, and the guard that refused it forever.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * Two key builders address the same cell, one character apart:
 *
 *   staging   `cellKey`      -> `<quoteLeafId>::<tierId>`
 *   apply     `applyCellId`  -> `<quoteLeafId>:<tierId>`
 *
 * `detectStale` compares the client's authority baseline against the persisted
 * one entry by entry, KEY INCLUDED. The client built its map in staging space
 * and the server built its in apply space, so the moment a quote carried a
 * single persisted lift every key differed and the guard reported "a surgical
 * lift moved since you staged" — against a baseline that had not moved.
 *
 * It refused Apply and Return to baseline alike, permanently, and survived
 * reload, because the mismatch is structural rather than stateful.
 *
 * ── WHY IT SURVIVED ─────────────────────────────────────────────────────
 *
 * Both maps are EMPTY on a quote with no lifts, and two empty arrays compare
 * equal. So the first Apply on any quote always worked; only a second act on
 * the same quote could fail. Every walk that applied once and moved on passed.
 *
 * O3 was the first quote to apply a lift and then try to remove it. Three
 * clicks, one after a fresh page load, no console error, three rows still in
 * `quote_leaf_lifts`.
 *
 * Same shape as the send-gate regression it was found next to: a control that
 * held only because nothing had reached it (Pattern 56).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cellKey, parseCellKey } from "../../src/lib/pricing-staging.ts";
import { applyCellId } from "../../src/lib/pricing-apply-plan.ts";
import {
  detectStale,
  pricingAuthorityBaseline,
} from "../../src/lib/pricing-stale-guard.ts";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");

/** O3's three lifts: one component, three tiers. */
const LEAF = "d1dbf703-d756-4117-95c3-4a83c4f6ebb7";
const TIERS = [
  ["24e71689-f7ed-4de1-9c2b-99726a331377", "0.2567"],
  ["99839187-2e40-4de6-a549-e668218c96e4", "0.0602"],
  ["601fa760-dacb-4227-a07f-28535f10b4a4", "0.0056"],
] as const;

/** What the client holds: staging keys, numeric values. */
const committedLifts: Record<string, number> = Object.fromEntries(
  TIERS.map(([tierId, pct]) => [cellKey({ quoteLeafId: LEAF, tierId }), Number(pct)]),
);

/** What the server reads back: apply keys, the raw numeric strings. */
const persistedLifts = new Map(
  TIERS.map(([tierId, pct]) => [applyCellId(LEAF, tierId), pct] as const),
);

/** The crossing, as the repaired call site performs it. */
function toApplyKeyed(source: Record<string, number>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    const { quoteLeafId, tierId } = parseCellKey(key);
    out.set(applyCellId(quoteLeafId, tierId), String(value));
  }
  return out;
}

const persisted = () =>
  pricingAuthorityBaseline({
    globalAdj: "0",
    tierAdj: new Map(),
    lifts: persistedLifts,
    overrides: new Map(),
  });

/**
 * The moved-lever list, with the union narrowed.
 *
 * `StaleVerdict` has two stale arms and only one carries `moved`, so reading it
 * off the union does not compile. Asserting the class first is also the more
 * honest test: "it refused, and for the pricing-authority reason" is the claim,
 * and a refusal for the economic-basis reason would be a different bug wearing
 * the same failure.
 */
function movedLevers(v: ReturnType<typeof detectStale>): string[] {
  assert.equal(v.stale, true, "expected a refusal");
  assert.equal(
    v.stale === true ? v.kind : null,
    "pricing_authority",
    "expected a pricing-authority refusal, not an economic-basis one",
  );
  return v.stale === true && v.kind === "pricing_authority" ? v.moved : [];
}

const verdict = (lifts: Map<string, string>) =>
  detectStale({
    baseline: pricingAuthorityBaseline({
      globalAdj: "0",
      tierAdj: new Map(),
      lifts,
      overrides: new Map(),
    }),
    persisted: persisted(),
    previewFingerprint: null,
    currentFingerprint: "same",
  });

// ══════════════════════════════════════════════════════════════════════
// The two namespaces really are different
// ══════════════════════════════════════════════════════════════════════

test("the staging key and the apply key are NOT interchangeable", () => {
  // Stated first, because everything below is a consequence of it and a future
  // reader should not have to diff two template literals to see it.
  const t = TIERS[0][0];
  assert.notEqual(cellKey({ quoteLeafId: LEAF, tierId: t }), applyCellId(LEAF, t));
  assert.equal(cellKey({ quoteLeafId: LEAF, tierId: t }), `${LEAF}::${t}`);
  assert.equal(applyCellId(LEAF, t), `${LEAF}:${t}`);
});

// ══════════════════════════════════════════════════════════════════════
// The defect, and the repair
// ══════════════════════════════════════════════════════════════════════

test("PRE-REPAIR: staging keys sent raw are refused as a moved lift", () => {
  // The control: the bug reproduced exactly. Without this the pass below is
  // equally consistent with a guard that has stopped comparing anything.
  const raw = new Map(
    Object.entries(committedLifts).map(([k, v]) => [k, String(v)] as const),
  );
  assert.deepEqual(movedLevers(verdict(raw)), ["a surgical lift"]);
});

test("REPAIRED: the crossed keys match, so baseline is not refused", () => {
  assert.deepEqual(verdict(toApplyKeyed(committedLifts)), { stale: false });
});

test("O3's exact state: three lifts present, baseline permitted", () => {
  const v = verdict(toApplyKeyed(committedLifts));
  assert.equal(v.stale, false, "three applied lifts must not refuse their own removal");
  assert.equal(persistedLifts.size, 3);
});

// ══════════════════════════════════════════════════════════════════════
// The guard still guards
// ══════════════════════════════════════════════════════════════════════

test("a lift that genuinely moved is still refused", () => {
  // The repair must not be "stop checking". A real third-party change to a
  // lift value still stops the commit.
  const moved = toApplyKeyed({ ...committedLifts });
  const first = [...moved.keys()][0];
  moved.set(first, "0.9999");
  assert.deepEqual(movedLevers(verdict(moved)), ["a surgical lift"]);
});

test("a lift added behind the operator is still refused", () => {
  const fewer = toApplyKeyed(committedLifts);
  fewer.delete([...fewer.keys()][0]);
  assert.equal(verdict(fewer).stale, true, "client believing 2 while 3 persist must refuse");
});

test("removing one lift beforehand still permits removing the rest", () => {
  // Edward's case: the operator drops one lift, then returns to baseline. The
  // client's belief and the database agree on TWO, and the remaining two are
  // removable.
  const twoTiers = TIERS.slice(1);
  const clientTwo: Record<string, number> = Object.fromEntries(
    twoTiers.map(([tierId, pct]) => [cellKey({ quoteLeafId: LEAF, tierId }), Number(pct)]),
  );
  const dbTwo = new Map(
    twoTiers.map(([tierId, pct]) => [applyCellId(LEAF, tierId), pct] as const),
  );
  const v = detectStale({
    baseline: pricingAuthorityBaseline({
      globalAdj: "0", tierAdj: new Map(), lifts: toApplyKeyed(clientTwo), overrides: new Map(),
    }),
    persisted: pricingAuthorityBaseline({
      globalAdj: "0", tierAdj: new Map(), lifts: dbTwo, overrides: new Map(),
    }),
    previewFingerprint: null,
    currentFingerprint: "same",
  });
  assert.equal(v.stale, false);
});

test("idempotent: with nothing persisted, baseline is permitted again", () => {
  // Clicking the control a second time after it worked. Both sides empty.
  const v = detectStale({
    baseline: pricingAuthorityBaseline({
      globalAdj: "0", tierAdj: new Map(), lifts: new Map(), overrides: new Map(),
    }),
    persisted: pricingAuthorityBaseline({
      globalAdj: "0", tierAdj: new Map(), lifts: new Map(), overrides: new Map(),
    }),
    previewFingerprint: null,
    currentFingerprint: "same",
  });
  assert.equal(v.stale, false);
});

// ══════════════════════════════════════════════════════════════════════
// Overrides crossed the same boundary
// ══════════════════════════════════════════════════════════════════════

test("direct prices had the identical defect and are crossed too", () => {
  // `overrides` is built by the same call site from the same staging space, so
  // it carried the same bug — invisible for the same reason, and fixed by the
  // same crossing. Asserted separately because a repair that fixed only the
  // lift half would pass every test above.
  const t = TIERS[0][0];
  const clientOverrides = { [cellKey({ quoteLeafId: LEAF, tierId: t })]: 4.25 };
  const dbOverrides = new Map([[applyCellId(LEAF, t), "4.2500"]]);
  const mk = (lifts: Map<string, string>, overrides: Map<string, string>) =>
    pricingAuthorityBaseline({ globalAdj: "0", tierAdj: new Map(), lifts, overrides });

  const raw = new Map(
    Object.entries(clientOverrides).map(([k, v]) => [k, String(v)] as const),
  );
  const before = detectStale({
    baseline: mk(new Map(), raw),
    persisted: mk(new Map(), dbOverrides),
    previewFingerprint: null,
    currentFingerprint: "same",
  });
  assert.deepEqual(movedLevers(before), ["a direct price"]);

  const after = detectStale({
    baseline: mk(new Map(), toApplyKeyed(clientOverrides)),
    persisted: mk(new Map(), dbOverrides),
    previewFingerprint: null,
    currentFingerprint: "same",
  });
  assert.equal(after.stale, false, "4.25 and 4.2500 are the same number");
});

// ══════════════════════════════════════════════════════════════════════
// Scope, and the call site
// ══════════════════════════════════════════════════════════════════════

test("the call site crosses through the one helper, not by hand", () => {
  const src = read("src/components/pricing-surface/pricing-staging-context.tsx");
  assert.match(src, /lifts: toApplyKeyed\(committed\.lifts\)/);
  assert.match(src, /overrides: toApplyKeyed\(committed\.overrides\)/);
  // Through `parseCellKey`, never a hand-split — the halves got misnamed that
  // way once already.
  assert.match(src, /function toApplyKeyed[\s\S]{0,320}parseCellKey\(key\)/);
  assert.doesNotMatch(src, /committed\.lifts\)\.map\(\(\[k, v\]\) => \[k, String\(v\)\]\)/);
});

test("tier adjustments and the quote-wide adjustment do NOT cross", () => {
  // They key on the bare tier id and on nothing respectively. Crossing them
  // would corrupt keys that were already correct — the opposite defect.
  const src = read("src/components/pricing-surface/pricing-staging-context.tsx");
  assert.match(
    src,
    /tierAdj: new Map\(\s*Object\.entries\(committed\.tierAdj\)\.map\(\(\[k, v\]\) => \[k, String\(v\)\]\),\s*\)/,
  );
  assert.doesNotMatch(src, /tierAdj: toApplyKeyed/);
});

test("the baseline still clears only the four pricing levers", () => {
  // Scope is unchanged by this repair. The baseline set names lifts, direct
  // prices, tier adjustments and the quote-wide adjustment — and nothing about
  // costs, recovery elections, component charges or the target margin, none of
  // which this surface has ever been able to write.
  const src = read("src/components/pricing-surface/pricing-staging-context.tsx");
  assert.match(
    src,
    /const baseline: PricingSet = useMemo\(\s*\(\) => \(\{ lifts: \{\}, overrides: \{\}, tierAdj: \{\}, globalAdj: 0 \}\)/,
  );
  for (const forbidden of [
    /targetMarginPct/,
    /chargeRecovery/,
    /componentCharge/,
    /costAmount/,
  ]) {
    assert.doesNotMatch(src, forbidden, "the staging layer must not reach a governed non-pricing decision");
  }
});
