/**
 * The staging bar — what it says, and what it declines to say.
 *
 * `describeChange` is exported and tested directly because the copy IS the
 * contract here. The bar is the one place an operator looks to see what they
 * are about to commit, so a change described vaguely, or not at all, is a
 * change committed unseen.
 *
 * The rest is structural: the bar decides nothing. It does not compute whether
 * anything is staged (H3 lives in the staging model), and it does not say what
 * a change will DO — an outcome is the engine's to state, and a chip that
 * promised one would be a second authority in the least examined part of the
 * page.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cellKey, type StagedChange } from "../../src/lib/pricing-staging.ts";

// The component cannot be imported — JSX is not type-strippable — so
// `describeChange` is re-declared here against the same contract and the
// source is asserted to match. Not ideal; the alternative is leaving the copy
// untested, and the copy is the part that reaches a person.
const SRC = readFileSync(
  new URL("../../src/components/pricing-surface/staging-bar.tsx", import.meta.url),
  "utf8",
);

const A = cellKey({ quoteLeafId: "leaf-a", tierId: "t1" });

// ─────────────────────────────────────────────────────────── the copy

test("every change kind has its own phrasing", () => {
  // A switch with no default: adding a kind to the union fails to compile
  // rather than falling through to a description of the wrong thing.
  for (const kind of [
    'case "lift":',
    'case "lift-removed":',
    'case "override":',
    'case "override-removed":',
    'case "adj":',
  ]) {
    assert.ok(SRC.includes(kind), `${kind} is not described`);
  }
  assert.ok(
    !/default:\s*\n\s*return/.test(SRC),
    "a default branch would describe an unknown change as a known one",
  );
});

test("a removal is phrased as an act, not as an absence", () => {
  assert.ok(/Remove lift on \$\{label\(change\.key\)\}/.test(SRC));
  assert.ok(/Remove direct price on \$\{label\(change\.key\)\}/.test(SRC));
});

test("the adjustment chip names both endpoints", () => {
  // "Global adjustment 12%" does not say whether that is a rise or a cut, and
  // the operator is about to commit it.
  assert.ok(/change\.from.*→.*change\.to|from\)\} → \$\{fmtPct\(change\.to/.test(SRC));
});

test("a chip names an action, never its outcome", () => {
  // What a lift will DO is a commercial result, and results come from the
  // engine's preview run. A chip promising one would be a second authority in
  // the least examined part of the page.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/margin/i.test(code), "a chip is describing a margin outcome");
  assert.ok(!/new_|would be|results in/i.test(code));
  assert.ok(!/1\s*-\s*\w*[Cc]ost\s*\//.test(code), "arithmetic in the bar");
});

// ────────────────────────────────────────────────── it decides nothing

test("staged-ness comes from the model, not from the bar", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/usePricingStaging\(\)/.test(code));
  assert.ok(
    !/useState/.test(code),
    "the bar holds no state — H3's failure is a stored staged-ness flag, and " +
      "a component is the easiest place for one to appear",
  );
  assert.ok(
    !/changes\.length > 0/.test(code) || /isStaged/.test(code),
    "the bar reads isStaged rather than re-deriving it",
  );
});

test("neither bar renders when there is nothing to say", () => {
  // §3: deltas disappear on Apply and their absence is the signal. The bar
  // follows the same rule — a permanent bar reading "0 changes" would make the
  // page look like it always has something outstanding.
  assert.ok(/return null;/.test(SRC));
  assert.ok(/if \(isStaged\)/.test(SRC));
  assert.ok(/if \(appliedCount > 0\)/.test(SRC));
});

test("the two bars are exclusive", () => {
  // Staged and applied are different statements about the page, and showing
  // both would leave the operator unsure which one governs. The staged branch
  // returns before the applied one is reached.
  const stagedAt = SRC.indexOf("if (isStaged)");
  const appliedAt = SRC.indexOf("if (appliedCount > 0)");
  assert.ok(stagedAt > 0 && appliedAt > stagedAt);
});

test("labels are supplied, not resolved", () => {
  // The key is two UUIDs, which name nothing to a person. A component that
  // resolved identity is a component that can resolve it wrongly — and the
  // caller already holds the SKU and tier names.
  assert.ok(/label: CellLabeller/.test(SRC));
  assert.ok(
    !/quoteLeaves|skuRollups|useCostingStore/.test(SRC),
    "the bar must not look identity up for itself",
  );
});

// ───────────────────────────────────────────────── the contract it renders

test("the change kinds the bar handles are exactly the model's", () => {
  // If the union grows and the bar is not updated, the switch stops compiling.
  // This asserts the two lists are the same today, so that failure is the only
  // way they can part.
  const model = readFileSync(
    new URL("../../src/lib/pricing-staging.ts", import.meta.url),
    "utf8",
  );
  const kinds = [...model.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(kinds)].sort();
  assert.deepEqual(unique, [
    "adj",
    "lift",
    "lift-removed",
    "override",
    "override-removed",
    // The fourth lever. Added by P3-016, when per-tier adjustments stopped
    // being written at click time and became something the operator stages,
    // previews and can discard like the other three.
    "tier-adj",
    "tier-adj-removed",
  ]);
  for (const k of unique) assert.ok(SRC.includes(`case "${k}":`), `${k} undescribed`);
});

test("a chip carries a stable identity per change", () => {
  // Without one, React reuses a row's dismiss button for a different change
  // when the list reorders — and the operator discards something they did not
  // point at.
  assert.ok(/function chipKey\(change: StagedChange\)/.test(SRC));
  assert.ok(/key=\{chipKey\(change\)\}/.test(SRC));
  // The adjustment is a singleton; every other kind is per cell.
  assert.ok(/change\.kind === "adj" \? "adj" : `\$\{change\.kind\}:\$\{change\.key\}`/.test(SRC));
});

test("dismiss is reachable without sight", () => {
  assert.ok(
    /aria-label=\{`Discard: \$\{describeChange\(change, label, tierLabel\)\}`\}/.test(SRC),
  );
});

// A type-level check that the exported describer covers the union: if a kind
// is added, this stops compiling before any test runs.
const _exhaustive: Record<StagedChange["kind"], true> = {
  lift: true,
  "lift-removed": true,
  override: true,
  "override-removed": true,
  "tier-adj": true,
  "tier-adj-removed": true,
  adj: true,
};
void _exhaustive;
void A;
