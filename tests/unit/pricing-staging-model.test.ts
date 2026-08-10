/**
 * The staging model — H3 above all.
 *
 *     `isStaged` is a DIFFERENCE, not a property.
 *
 * Phase 3 lists that High severity and names the failure precisely: derived
 * from the working set alone it stays true forever after Apply, and *"the
 * failure is silent"* — the page keeps offering to commit changes that are
 * already committed, and nothing looks broken.
 *
 * The diff function is exported and tested directly, because it is the whole
 * of that property. Everything else in the provider — the setters, the
 * context — is plumbing around this one function being correct.
 *
 * Not tested here: that the preview runs the engine. That contract was
 * established with the preview-evaluation package and is asserted there; what
 * matters at this layer is only which set gets handed over.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cellKey,
  diffSets,
  type PricingSet,
  type StagedChange,
} from "../../src/lib/pricing-staging.ts";

const EMPTY: PricingSet = { lifts: {}, overrides: {}, tierAdj: {}, globalAdj: 0 };
const set = (over: Partial<PricingSet> = {}): PricingSet => ({ ...EMPTY, ...over });

const A = cellKey({ quoteLeafId: "leaf-a", tierId: "t1" });
const B = cellKey({ quoteLeafId: "leaf-b", tierId: "t2" });

// ─────────────────────────────────────────────────────────────────────── H3

test("identical sets stage nothing", () => {
  assert.deepEqual(diffSets(EMPTY, EMPTY), []);
  const s = set({ lifts: { [A]: 0.1 }, overrides: { [B]: 4 }, globalAdj: 0.2 });
  assert.deepEqual(diffSets(s, s), []);
});

test("after Apply, nothing is staged — the failure H3 names", () => {
  // Apply is `committed = working`. Derived from the working set alone,
  // `isStaged` would still be true here, forever, and silently.
  const working = set({ lifts: { [A]: 0.1 }, globalAdj: 0.2 });
  const committed = working;
  assert.equal(diffSets(committed, working).length, 0);
});

test("a staged lift, and a staged lift REMOVAL, are both changes", () => {
  const added = diffSets(EMPTY, set({ lifts: { [A]: 0.1 } }));
  assert.deepEqual(added, [{ kind: "lift", key: A, pct: 0.1 }]);

  // A removal is a thing to review and discard before committing. Collapsing
  // it into an absence would make it invisible in the staging bar, which is
  // the one place the operator looks to see what they are about to commit.
  const removed = diffSets(set({ lifts: { [A]: 0.1 } }), EMPTY);
  assert.deepEqual(removed, [{ kind: "lift-removed", key: A }]);
});

test("changing an existing lift stages once, not as a remove plus an add", () => {
  const d = diffSets(set({ lifts: { [A]: 0.1 } }), set({ lifts: { [A]: 0.2 } }));
  assert.deepEqual(d, [{ kind: "lift", key: A, pct: 0.2 }]);
});

test("overrides diff the same way, and independently of lifts", () => {
  const d = diffSets(
    set({ lifts: { [A]: 0.1 } }),
    set({ lifts: { [A]: 0.1 }, overrides: { [B]: 9 } }),
  );
  assert.deepEqual(d, [{ kind: "override", key: B, value: 9 }]);
});

test("the global adjustment stages with both endpoints", () => {
  // The operator needs to see what it is moving FROM. "Global adjustment 12%"
  // does not say whether that is a rise or a cut.
  const d = diffSets(set({ globalAdj: 0.1 }), set({ globalAdj: 0.12 }));
  assert.deepEqual(d, [{ kind: "adj", from: 0.1, to: 0.12 }]);
});

test("float noise on the adjustment does not stage a change nobody made", () => {
  // A percentage input round-trips through string and back. Bare `!==` would
  // report a pending change and the bar would offer to commit it.
  const d = diffSets(set({ globalAdj: 0.1 }), set({ globalAdj: 0.1 + 1e-15 }));
  assert.deepEqual(d, []);
  // But a real change of a hundredth of a percent still counts.
  assert.equal(diffSets(set({ globalAdj: 0.1 }), set({ globalAdj: 0.1001 })).length, 1);
});

test("several levers stage together, one entry each", () => {
  const committed = set({ lifts: { [A]: 0.1 }, globalAdj: 0.1 });
  const working = set({ lifts: { [B]: 0.3 }, overrides: { [A]: 5 }, globalAdj: 0.15 });
  const kinds = diffSets(committed, working)
    .map((c: StagedChange) => c.kind)
    .sort();
  assert.deepEqual(kinds, ["adj", "lift", "lift-removed", "override"]);
});

// ──────────────────────────────────────────────────── structural guarantees

const SRC = readFileSync(
  new URL(
    "../../src/components/pricing-surface/pricing-staging-context.tsx",
    import.meta.url,
  ),
  "utf8",
);
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("there is no dirty flag anywhere", () => {
  // The whole of H3. A stored boolean can get stuck; a comparison cannot.
  assert.ok(
    !/useState[^;]*dirty|setDirty|isDirty/i.test(CODE),
    "a stored staged-ness flag has appeared",
  );
  assert.ok(
    /isStaged: changes\.length > 0/.test(CODE),
    "isStaged must be read off the diff",
  );
});

test("unstage restores the committed value rather than deleting the key", () => {
  // Deleting would carry out the very removal the operator just cancelled: a
  // staged "remove this lift", unstaged, must put the lift back.
  assert.ok(/committedValue === undefined/.test(CODE));
  assert.ok(/next\[change\.key\] = committedValue/.test(CODE));
});

test("the preview runs the engine, and is null when nothing is staged", () => {
  assert.ok(
    /computeQuoteCosting\(preview, "preview"\)/.test(CODE),
    "the outcome of a staged set is stated by the engine",
  );
  assert.ok(
    /if \(changes\.length === 0\) return null;/.test(CODE),
    "a preview identical to the committed state is not a preview, and " +
      "returning one lets a consumer read preview authority unnoticed",
  );
});

test("the preview clones rather than mutating the committed input", () => {
  assert.ok(!/base\.\w+\s*=|base\.quote\.\w+\s*=/.test(CODE), "mutating the base input");
  assert.ok(/\.\.\.base,/.test(CODE) && /\.\.\.base\.quote,/.test(CODE));
});

test("staging performs no commercial arithmetic", () => {
  // It decides WHAT is staged. It never decides what staging produces.
  assert.ok(!/1\s*-\s*\w*[Cc]ost\s*\//.test(CODE), "a margin in the staging layer");
  assert.ok(!/\*\s*\(1\s*\+/.test(CODE), "a markup in the staging layer");
  assert.ok(!/floor|target/i.test(CODE.replace(/globalAdj/g, "")), "a policy threshold");
});

/**
 * This assertion used to be "no persistence, and none implied", and it was
 * right for as long as an applied adjustment had nowhere to live. Package 1
 * gives it one, so the property has to change — but only in the one way the
 * accepted contract changes it.
 *
 * What is no longer true: that staging never writes. Apply writes.
 *
 * What is still true, and is what these now assert: there is exactly ONE way
 * it writes, it is a governed server action, and the committed set does not
 * move unless that write succeeded.
 */
test("staging writes through exactly one governed action", () => {
  assert.ok(
    /import \{ applyPricingAdjustments \} from "@\/app\/actions\/pricing-lifts"/.test(CODE),
    "the one sanctioned write path is absent",
  );
  // Nothing may reach for a server any other way, or the boundary stops being
  // where it is documented to be.
  assert.ok(!/fetch\(|XMLHttpRequest|axios/.test(CODE), "an ad-hoc write path");
  const callSites = CODE.match(/applyPricingAdjustments\(/g) ?? [];
  assert.equal(
    callSites.length,
    1,
    "Apply and Return to baseline share one commit; a second call site is a second path",
  );
});

test("committed moves only after the write succeeded", () => {
  // The ordering IS the property. Moving `committed` first clears the chips and
  // leaves an APPLIED bar describing adjustments the quote does not carry —
  // the precise failure the bar exists to prevent.
  const guard = CODE.indexOf("if (!result.ok)");
  const move = CODE.indexOf("setCommitted(next)");
  assert.ok(guard > -1, "no failure branch on the write result");
  assert.ok(move > -1, "committed is never advanced");
  assert.ok(guard < move, "committed advances before the result is checked");
});

test("pending state is scoped to the act that owns it", () => {
  // Pattern 47(f). One shared transition would let an in-flight Apply disable
  // Return to baseline, a workflow the operator has every right to reach.
  const transitions = CODE.match(/useTransition\(\)/g) ?? [];
  assert.equal(transitions.length, 2, "Apply and baseline must own their own");
});
