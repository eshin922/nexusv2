/**
 * OD-023 Step 1 — the draft guard, as a classification rather than a count.
 *
 * THE RULE
 *
 *   Every mutation that can change customer-visible content or commercial
 *   meaning must require `draft`.
 *
 * Not "every function in a commercial-looking module", which is the framing
 * that produced two wrong inventories in a row. `updateFreightTracking` writes
 * shipment dates in the same module as freight pricing and must stay reachable
 * after acceptance; guarding by module would have broken it at exactly the
 * point it is used.
 *
 * ── WHY THIS TEST IS SOURCE-LEVEL ────────────────────────────────────────────
 *
 * The property is "this code path cannot write while sent". Proving it by
 * calling the actions would need a live database, Clerk request scope and a
 * sent quote — none of which exists in a unit run, and the engine is not the
 * thing under test. What IS testable, and what actually broke, is whether each
 * write path REACHES a draft assertion at all.
 *
 * ── THE MEASUREMENT ERROR THIS ENCODES AGAINST ───────────────────────────────
 *
 * Draft is enforced in FOUR shapes, and every prior sweep counted a subset:
 *
 *   1. `assertDraft(quote)`                     — action-result.ts
 *   2. `requireDraft(quote)`                    — quote-guards.ts, identical
 *   3. a LOADER that calls one of those         — `quoteByIdDraft`,
 *      `quoteForAssembly`, `quoteForQuoteLeaf`, `quoteForAssemblyLeaf`,
 *      `quoteForAssemblyLeafInputLineGroup`, `quoteForLegGroup`, `quoteForLeg`,
 *      `quoteForQuoteLeaves`
 *   4. a MODULE-LOCAL loader that calls a loader — `draftSubcategory`
 *
 * Searching for shape 1 alone reported 48 unguarded paths. Adding inline
 * `status !== "draft"` still missed shapes 3 and 4, which is where nearly all
 * the real enforcement lives — and produced a freight-worksheet classification
 * that was exactly inverted: it said 11 of 12 had no guard, when 11 of 12 had
 * one and the 12th correctly did not.
 *
 * So this test enumerates the shapes explicitly and asserts per FUNCTION. It is
 * the property, checked the way the property is actually written.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Source with comments removed.
 *
 * EVERY assertion here runs on this, never on raw text. Commenting a guard out
 * leaves the words behind, so a regex over raw source reports a disabled guard
 * as present — which is not a hypothetical: the first draft of this file passed
 * unchanged while `requireDraft(quote);` sat behind a `//`, and only failed to
 * fail. A check that cannot distinguish code from a description of code is the
 * same instrument error this file was written to correct.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const read = (p: string) => stripComments(readFileSync(p, "utf8"));
const A = "src/app/actions/";

/** Loaders that assert draft internally. Verified below, not assumed. */
const DRAFT_LOADERS = [
  "quoteByIdDraft",
  "quoteForAssembly",
  "quoteForQuoteLeaf",
  "quoteForQuoteLeaves",
  "quoteForAssemblyLeaf",
  "quoteForAssemblyLeafInputLineGroup",
  "quoteForLegGroup",
  "quoteForLeg",
] as const;

/** Module-local loaders that reach a DRAFT_LOADER. */
const LOCAL_LOADERS: Record<string, readonly string[]> = {
  "freight-worksheet.ts": ["draftSubcategory"],
};

/** Slice one exported function's body out of a module. */
function bodyOf(src: string, fn: string): string {
  const start = src.indexOf(`export async function ${fn}(`);
  assert.notEqual(start, -1, `${fn} not found — the classification names a function that no longer exists`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (async )?function |\nasync function |\nfunction /);
  return next === -1 ? rest : rest.slice(0, next);
}

function reachesDraftGuard(file: string, fn: string): boolean {
  const src = read(A + file);
  const body = bodyOf(src, fn);
  const names = [...DRAFT_LOADERS, ...(LOCAL_LOADERS[file] ?? []), "assertDraft", "requireDraft"];
  return names.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));
}

// ---------------------------------------------------------------------------
// 0 · the shapes themselves. If these drift, every assertion below is vacuous.
// ---------------------------------------------------------------------------

test("0 · assertDraft and requireDraft are the SAME invariant, under two names", () => {
  // The duplication is not cosmetic — it is the direct cause of the undercount,
  // because a sweep naturally greps for one name. Recorded so that collapsing
  // them later is a known, deliberate act rather than a surprise.
  const ar = read("src/lib/action-result.ts");
  const qg = read("src/lib/quote-guards.ts");
  assert.match(ar, /export function assertDraft\(quote: \{ status: string \}\): void \{\s*if \(quote\.status !== "draft"\)/);
  assert.match(qg, /export function requireDraft\(quote: Quote\): void \{\s*if \(quote\.status !== "draft"\)/);
});

test("0 · every named loader really does assert draft", () => {
  // The load-bearing precondition of this whole file. A loader that stopped
  // calling `requireDraft` would silently un-guard every caller, and each
  // caller would still look guarded to the check above.
  const qg = read("src/lib/quote-guards.ts");
  for (const loader of DRAFT_LOADERS) {
    const start = qg.indexOf(`export async function ${loader}(`);
    assert.notEqual(start, -1, `${loader} no longer exists`);
    const rest = qg.slice(start + 1);
    const next = rest.search(/\nexport (async )?function /);
    const body = next === -1 ? rest : rest.slice(0, next);
    assert.match(
      body,
      /requireDraft\(quote\)/,
      `${loader} no longer asserts draft — every caller relying on it is now unguarded`,
    );
  }
});

test("0 · the module-local loader reaches a draft loader", () => {
  const src = read(A + "freight-worksheet.ts");
  const start = src.indexOf("async function draftSubcategory(");
  assert.notEqual(start, -1);
  const body = src.slice(start, src.indexOf("export async function updateFreightSubcategory("));
  assert.match(body, /quoteByIdDraft\(/);
});

// ---------------------------------------------------------------------------
// 1 · IN — every commercial writer reaches a draft guard.
// ---------------------------------------------------------------------------

const PROTECTED: Array<[string, string, string]> = [
  // file, function, why it is customer-visible or commercial
  ["leaf-specs.ts", "updateLeafSpec", "spec values render in the PDF addendum"],

  ["assembly-leaf-inputs.ts", "updateAssemblyLeafInputLineMeta", "packaging line metadata feeds cost"],
  ["assembly-leaf-inputs.ts", "updateAssemblyLeafInputCell", "packaging unit cost"],

  ["assembly-production-inputs.ts", "upsertAssemblyProductionInputs", "production service fees"],
  ["assembly-production-inputs.ts", "updateAssemblyProductionPolicy", "production policy changes cost allocation"],

  ["costing.ts", "updateQuoteGlobalPriceAdj", "quote-level price adjustment"],
  ["costing.ts", "updateTierPriceAdj", "per-tier price adjustment"],
  ["costing.ts", "updateQuoteTargetMargin", "margin policy for this quote"],
  ["costing.ts", "applySuggestedGlobalAdj", "applies a price adjustment"],
  ["costing.ts", "updateAssemblyLeafOverride", "per-cell quoted sell price"],
  ["costing.ts", "updateAssemblyLeafTarget", "per-cell client target"],
  ["costing.ts", "applyClientTargetSolveTierAdj", "writes a tier adjustment"],

  ["pricing-lifts.ts", "applyPricingAdjustments", "persists surgical lifts and prices"],
  ["pricing-apply.ts", "applyGlobalAdj", "applies a global price adjustment"],
  ["pricing-apply.ts", "undoGlobalAdj", "reverts a global price adjustment"],

  ["bulk-raw.ts", "setRawsMode", "raws mode drives the RAW cost row"],

  ["freight.ts", "addLegGroup", "freight journey structure"],
  ["freight.ts", "updateLegGroupMetadata", "freight journey metadata"],
  ["freight.ts", "deleteLegGroup", "removes freight cost"],
  ["freight.ts", "addLeg", "adds a freight leg"],
  ["freight.ts", "updateLegMetadata", "leg metadata affects customs eligibility"],
  ["freight.ts", "updateLegMarkup", "freight markup is commercial"],
  ["freight.ts", "updateLegCustoms", "duty and tariff enter landed cost"],
  ["freight.ts", "updateLegTierCell", "per-tier freight rate"],
  ["freight.ts", "updateFreightComponentTierCost", "per-component freight cost"],
  ["freight.ts", "updateQuoteFreightMarkup", "quote-level freight markup"],
  ["freight.ts", "moveLeg", "leg order changes journey composition"],
  ["freight.ts", "deleteLeg", "removes freight cost"],
  ["freight.ts", "updateCustomerArrangesMeta", "changes who bears freight"],

  ["freight-worksheet.ts", "createFreightSubcategory", "a shipment carries freight cost"],
  ["freight-worksheet.ts", "updateFreightSubcategory", "shipment membership and treatment"],
  ["freight-worksheet.ts", "updateFreightDestination", "destination pricing"],
  ["freight-worksheet.ts", "addFreightDestination", "adds a priceable destination"],
  ["freight-worksheet.ts", "selectFreightDestination", "selects which destination prices"],
  ["freight-worksheet.ts", "updateFreightDestinationBreak", "per-tier freight amount"],
  ["freight-worksheet.ts", "updateFreightDestinationBreakGroup", "per-tier freight amounts"],
  ["freight-worksheet.ts", "deleteFreightDestination", "removes freight cost"],
  ["freight-worksheet.ts", "deleteFreightSubcategory", "removes a shipment"],
  ["freight-worksheet.ts", "updateFreightCustomsEntry", "duty and tariff enter landed cost"],
  ["freight-worksheet.ts", "updateFreightCustomsBreak", "per-tier duty and tariff"],
];

for (const [file, fn, why] of PROTECTED) {
  test(`IN · ${file} · ${fn} — ${why}`, () => {
    assert.ok(
      reachesDraftGuard(file, fn),
      `${fn} can write customer-visible or commercial state without requiring draft`,
    );
  });
}

test("the protected set covers every commercial writer the classification named", () => {
  // A count, deliberately, and ONLY as a tripwire on the list above — not as
  // the measurement. If a writer is added to one of these modules the list does
  // not grow by itself, and this is what says so.
  assert.equal(PROTECTED.length, 40);
});

// ---------------------------------------------------------------------------
// 2 · OUT — and the one that must STAY out.
// ---------------------------------------------------------------------------

test("OUT · updateFreightTracking must NOT be draft-gated", () => {
  // The trap. Shipment tracking is entered after Send and often after
  // acceptance, so a draft gate would make the feature unreachable exactly when
  // it is used. It lives in the freight module beside freight PRICING, which is
  // the concrete reason the rule is semantic and not per-module.
  //
  // Asserted as a REFUSAL TO GUARD, so a future mechanical sweep that "fixes"
  // the module fails here instead of shipping a dead feature.
  assert.equal(
    reachesDraftGuard("freight-worksheet.ts", "updateFreightTracking"),
    false,
    "updateFreightTracking is operational, not commercial — gating it breaks post-acceptance tracking",
  );

  const body = bodyOf(read(A + "freight-worksheet.ts"), "updateFreightTracking");
  // It stays out because of WHAT IT WRITES, and that is what is asserted.
  assert.match(body, /freightDestinationTracking/);
  assert.match(body, /operational: true/);
  assert.doesNotMatch(
    body,
    /freightDestinationBreaks|freightCustomsBreaks|freightSubcategories\)\.set/,
    "if this ever writes pricing, its exemption is void",
  );
});

test("OUT · assertNotFrozen is not used as a stand-in for the draft rule", () => {
  // `assertNotFrozen` PASSES on `sent`, so it cannot express sent-version
  // immutability. It was doing nothing in `deleteFreightSubcategory` — which
  // also calls `quoteByIdDraft`, strictly stronger — while advertising the
  // wrong rule, and that mis-advertisement is what an earlier sweep read.
  //
  // Matched as a CALL, not as the bare word: the removal is explained in a
  // comment that necessarily names it, and a check that cannot tell an
  // explanation from the thing it explains reports the wrong answer. Same error
  // shape as the sweeps this file exists to correct.
  assert.doesNotMatch(
    read(A + "freight-worksheet.ts"),
    /assertNotFrozen\s*\(/,
    "a draft-only writer must not also claim the weaker not-frozen rule",
  );
});

// ---------------------------------------------------------------------------
// 3 · the guard is reached BEFORE the write, not merely present.
// ---------------------------------------------------------------------------

test("the draft guard precedes the first write in each normalized path", () => {
  // Presence is not ordering. A guard after an INSERT refuses nothing, and both
  // paths normalized in this slice read rows first, so the ordering is a real
  // question rather than a formality.
  const src = read(A + "freight.ts");
  for (const fn of ["updateLegTierCell", "updateFreightComponentTierCost"]) {
    const body = bodyOf(src, fn);
    const guard = body.search(/assertDraft\(/);
    const write = body.search(/db\s*\n?\s*\.(insert|update|delete)\(|\.onConflictDoUpdate\(/);
    assert.notEqual(guard, -1, `${fn} lost its guard`);
    assert.ok(write === -1 || guard < write, `${fn} writes before it asserts draft`);
  }
});

test("the quote-scoped spec guard precedes the spec write", () => {
  const body = bodyOf(read(A + "leaf-specs.ts"), "updateLeafSpec");
  const guard = body.search(/quoteByIdDraft\(scope\.quoteId\)/);
  const write = body.search(/\.insert\(leafSpecs\)|\.update\(leafSpecs\)/);
  assert.notEqual(guard, -1);
  assert.notEqual(write, -1);
  assert.ok(guard < write, "updateLeafSpec writes before it asserts draft");
});

test("library-scope spec edits stay ungated", () => {
  // Master data owns no quote's version, so there is no quote whose draft-ness
  // could be asserted. Gating it would make the Product Library uneditable
  // whenever any quote happened to be sent — a broader freeze than OD-023 asks
  // for, and one that would look like compliance.
  const body = bodyOf(read(A + "leaf-specs.ts"), "updateLeafSpec");
  assert.match(
    body,
    /if \("quoteId" in scope\) await quoteByIdDraft\(scope\.quoteId\)/,
    "the guard must be conditional on quote scope",
  );
});
