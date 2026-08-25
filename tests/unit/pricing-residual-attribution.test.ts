import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * A residual is not a decision.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * Pricing rendered the figure below as "Pricing decision", under a band
 * reading "editable here". An operator asked where the +$9.5676 pricing
 * decision on Tier 1 had come from, and the honest answer was that no such
 * decision existed: it is quoted revenue per unit minus the component build-up
 * above it. Nobody enters it and nobody chose it.
 *
 * The graph half of this — a per-unit allocation whose only operand was a
 * synthetic terminal restating its own input — is pinned in
 * `costing-node-graph.test.ts`. This pins the surface half.
 *
 * The pairing was expensive. Tracing the residual by hand turned up $1,727.60
 * of revenue inside it that the customer document never billed. A figure
 * labelled as somebody's decision does not invite the question "what is this
 * made of?", which is the question that found the hole.
 */

test("Pricing does not call the residual a decision", async () => {
  const src = codeOnly(await read("src/components/pricing-surface/detail-zone.tsx"));
  assert.doesNotMatch(
    src,
    /<span className="n">Pricing decision<\/span>/,
    "nobody enters this figure; naming it a decision sends the operator " +
      "looking for a choice that was never made",
  );
});

test("it is named for the operation, and says it is derived", async () => {
  // Matching the engine's own node label, "Quoted price less component
  // build-up, per unit" — so the surface and the graph describe one fact in
  // one vocabulary.
  //
  // The caption carries the weight the name cannot: the row sits inside the
  // "Pricing decisions · editable here" band, directly beneath a Tier
  // adjustment that IS entered, and without it the position alone would still
  // imply somebody typed this.
  const src = codeOnly(await read("src/components/pricing-surface/detail-zone.tsx"));
  assert.match(src, /<span className="n">Quoted less base<\/span>/);
  assert.match(src, /derived, not entered/);
});
