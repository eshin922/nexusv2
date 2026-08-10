/**
 * P3-016 — a recommendation stages. It does not write.
 *
 * The defect this pins was not a wiring fault. Both recommendation CTAs were
 * fully wired to actions that wrote `quote_tiers.tier_price_adj_pct` at click
 * time, with their own audit rows, outside the staging model the surface
 * otherwise runs on. The runtime observation is in
 * `docs/validation/P3-016-surgical-staging-bypass.md`: one click moved the
 * database and produced no chip, no preview and no Discard, so a committed
 * pricing change read to the operator as a button that did nothing.
 *
 * It is asserted at source level because the alternative is a rendered click,
 * and a rendered click can only reach ONE of the two paths at a time — the
 * classifier offers surgical or global, never both. A guard that can only ever
 * check half a contract is the guard that let this ship.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SHELL = await readFile(
  new URL("../../src/components/pricing-surface/pricing-surface-shell.tsx", import.meta.url),
  "utf8",
);

/** The recommendation handler, isolated from the bulk-lift handlers below it. */
const onApply = SHELL.slice(
  SHELL.indexOf('function onApply(kind: "apply_surgical" | "apply_global")'),
  SHELL.indexOf("function onActivate("),
);

test("the recommendation handler is bounded and non-empty", () => {
  // Every assertion below is a slice of this. An indexOf that missed would
  // make them all pass against an empty string.
  assert.ok(onApply.length > 200, "onApply was not located in the shell");
});

test("BOTH recommendation kinds stage; neither writes", () => {
  // The whole of P3-016. Two visually equivalent recommendations must not
  // carry different persistence semantics — that outcome is worse than either
  // behaviour chosen consistently, because nothing on screen distinguishes
  // them.
  const stages = [...onApply.matchAll(/stageTierAdj\(/g)];
  assert.ok(stages.length >= 2, "both kinds must reach the staging model");

  for (const writer of ["applySurgicalAdj", "applyGlobalAdj", "applyPricingAdjustments"]) {
    assert.doesNotMatch(
      onApply,
      new RegExp(writer),
      `the recommendation handler must not call ${writer} — persistence is the page-level Apply's`,
    );
  }
});

test("the click-time surgical writer is gone, not merely unused", () => {
  // Left in place it is one import away from being re-wired, and its only
  // caller was the CTA this repair moved.
  assert.doesNotMatch(SHELL, /applySurgicalAdj/);
});

test("bulk lift keeps its own committed-write contract", () => {
  // `applyGlobalAdj` survives, and the caller audit is the reason: the
  // bulk-lift workflow is separately governed — read-only preview (PB-004),
  // an apply carrying `expectedPreview` so a stale commit is refused, and a
  // receipt-based exact Undo. VAL-208 walks all three. The boundary P3-016
  // draws is the CALLER, not the action.
  assert.match(SHELL, /applyGlobalAdj/);
  const bulk = SHELL.slice(SHELL.indexOf("async function onApplyGlobalPreview"));
  assert.match(bulk, /expectedPreview/);
  assert.match(bulk, /applyGlobalAdj\(fd\)/);
});

test("no arithmetic is invented for a recommendation", () => {
  // A recommendation is a solver output. Composing it onto what a tier already
  // carries uses the surface's one composition rule, which the bulk-lift
  // preview uses too — a second formula here would be a second pricing
  // authority in the least examined part of the page.
  assert.match(onApply, /composePricingAdjustment\(/);
  const code = onApply.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /1\s*\+|\*\s*\(|Math\./, "arithmetic in the recommendation handler");
});

test("a rendered CTA with no suggestion fails loudly", () => {
  // It used to fall through two guarded branches to a silent return: the
  // operator pressed a recommended action and nothing happened, anywhere,
  // with no account of why.
  const code = onApply.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /if \(!sugg\.surgical\)[\s\S]{0,200}setApplyError/);
  assert.match(code, /if \(!sugg\.global\)[\s\S]{0,200}setApplyError/);
  // And the message reaches a person rather than a console.
  assert.match(SHELL, /\{applyError\}/);
});

test("the CTA copy says staging, not an immediate write", async () => {
  // The observed sublabel was "re-renders quote in place", which described the
  // mechanism being removed. Copy that promises a write on a control that
  // stages is the same defect stated in words.
  const classifier = await readFile(
    new URL("../../src/lib/pricing-classifier.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(classifier, /re-renders quote in place/);
  assert.match(classifier, /Stages a per-tier adjustment/);
});

test("a surgical CTA names the tier it lifts, not every tier below floor", async () => {
  // The runtime observation caught this alongside the bypass: the label read
  // "lift T1, T2, T3, T4 above floor" while the action moved one tier, and the
  // blocked count went 4 → 3. A surgical lift is surgical, and the CTA an
  // operator is about to press has to say which tier it moves.
  const classifier = await readFile(
    new URL("../../src/lib/pricing-classifier.ts", import.meta.url),
    "utf8",
  );
  const surgicalLabels = [...classifier.matchAll(/label: `Apply Surgical · lift \$\{([^}]+)\}/g)].map(
    (m) => m[1],
  );
  assert.ok(surgicalLabels.length >= 2, "both surgical CTAs must be labelled");
  for (const expr of surgicalLabels) {
    assert.match(
      expr,
      /sugg\.surgical\.tier_id/,
      `a surgical CTA is labelled from ${expr}, not from the tier the suggestion targets`,
    );
  }
});
