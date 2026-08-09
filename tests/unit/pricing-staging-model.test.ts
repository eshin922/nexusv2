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

const EMPTY: PricingSet = { lifts: {}, overrides: {}, globalAdj: 0 };
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

test("no persistence, and none implied", () => {
  // OD-012 blocks persisting an APPLIED lift. Staging is session state and is
  // not blocked by it — but nothing here may quietly reach for a server
  // either, or the boundary stops being where it is documented to be.
  assert.ok(!/fetch\(|useTransition|action/i.test(CODE), "a write path in staging");
});
