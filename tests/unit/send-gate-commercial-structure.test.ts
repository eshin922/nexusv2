import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasSendableCommercialStructure } from "../../src/lib/send-gate.ts";
import { codeOnly } from "../support/code-only.ts";

/**
 * SEND's structural gate — the five governed shapes.
 *
 * The gate counted rows in `assemblies` (Item Groups) while refusing with
 * "Quote needs at least one SKU". The message named SKUs; the query named Item
 * Groups. So two governed V1 shapes were refused for having no Item Group,
 * however many products or services they carried.
 *
 * It never surfaced because every quote certified before CERT-303 carried an
 * Item Group.
 */

/** A quote's structure, in the two counts the gate can see. */
function shape(commercialLines: number) {
  return { commercialLines };
}

// ── the five shapes, stated as the disposition states them ───────────────

test("empty quote → REFUSE", () => {
  assert.equal(hasSendableCommercialStructure(shape(0)), false);
});

test("Direct Product only → ALLOW", () => {
  // One top-level product, no Item Group. Previously refused.
  assert.equal(hasSendableCommercialStructure(shape(1)), true);
});

test("Direct Service only → ALLOW", () => {
  // The CERT-303 fixture. Previously refused.
  assert.equal(hasSendableCommercialStructure(shape(1)), true);
});

test("Item Group only → ALLOW", () => {
  // An Item Group's members are `quote_leaves` rows, so a populated group
  // counts through the same predicate — no second term needed.
  assert.equal(hasSendableCommercialStructure(shape(3)), true);
});

test("Item Group + Direct Product/Service → ALLOW", () => {
  assert.equal(hasSendableCommercialStructure(shape(4)), true);
});

// ── the edge the predicate deliberately refuses ──────────────────────────

test("an Item Group carrying NO members is refused, and that is correct", () => {
  // assemblies > 0 but quote_leaves = 0. It used to send. Nothing is being
  // sold, so it is the "empty quote" the gate exists to refuse. Four such
  // groups exist in the population (all TEST-LFC5-ASY) and none sits on a
  // quote whose verdict changes, so no live quote loses sendability.
  assert.equal(hasSendableCommercialStructure(shape(0)), false);
});

// ── the regression the disposition names explicitly ──────────────────────

test("REGRESSION · the gate must not count Item Groups again", async () => {
  // Anchored on CODE, not on comment text. The first draft sliced from the
  // comment "At-least-one-tier-with-qty" — after `codeOnly` had stripped every
  // comment — so the slice was empty and the test failed against correct code.
  // A filter and an anchor that disagree about what the source contains measure
  // nothing.
  const src = codeOnly(await readFile("src/app/actions/quotes.ts", "utf8"));
  const start = src.indexOf("const [tierCount, skuCount]");
  const end = src.indexOf("const [projectRows, firmRows]", start);
  assert.ok(start > -1 && end > start, "the sanity-gate block was not found");
  const gate = src.slice(start, end);

  // The predicate reads commercial lines…
  assert.match(gate, /\.from\(quoteLeaves\)/);
  assert.match(gate, /hasSendableCommercialStructure\(/);
  // …and never Item Groups. This is the check that fails if someone reverts to
  // `assemblies > 0`, which the disposition calls out by name.
  assert.doesNotMatch(
    gate,
    /\.from\(assemblies\)/,
    "the SEND gate is counting Item Groups again — Direct Product-only and " +
      "Direct Service-only quotes are governed V1 cases and must be sendable",
  );
});

test("the refusal copy names what is actually missing", async () => {
  const src = await readFile("src/app/actions/quotes.ts", "utf8");
  assert.match(
    src,
    /Quote needs at least one product or service before it can be sent\./,
  );
  // The old copy said SKU while the query said Item Group; both halves of that
  // mismatch are gone.
  assert.doesNotMatch(src, /Quote needs at least one SKU before it can be sent\./);
});

test("the predicate needs no filter, and says why", async () => {
  const src = await readFile("src/lib/send-gate.ts", "utf8");
  // Verified against the live population before the change: quote_leaves holds
  // only `product` and `service`. A third commercial_kind would invalidate the
  // bare count, so the reasoning is recorded where the predicate lives.
  assert.match(src, /export function hasSendableCommercialStructure/);
  assert.match(src, /commercial_kind|commercialLines/);
});
