/**
 * Landed logistics — the operator panel and the customer sentence.
 *
 * O2 certified that freight is economically correct and reaches NetSuite. It
 * was NOT visible: an operator at Send/Accept could not see that $24,006.01 of
 * DPS-1073's accepted economics was logistics, and the customer document said
 * nothing about freight being inside the unit prices. The only sentence in the
 * frozen O2 artifact that mentioned freight at all was an operator's free-text
 * note — which is not authority, and which a PM may simply not write.
 *
 * These tests hold the repair to the specific things that were asked for, and
 * to the one that is easy to get wrong: that the sentence is governed by the
 * economics rather than by anything a person typed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { landedLogisticsForTier } from "../../src/lib/landed-logistics.ts";

/** DPS-1073 Tier 2, the certified figures. */
const O2_TIER_2 = {
  costBreakdown: {
    freightContainer: 16609,
    dutyAndTariff: 3865,
    freightContainerMarkupSum: 19814.94,
    dutyAndTariffMarkupSum: 4191.07,
  },
};

// ── the numbers the panel must show ─────────────────────────────────────

test("O2 Tier 2 resolves to the certified landed-logistics figures", () => {
  const l = landedLogisticsForTier({ rollup: O2_TIER_2, separateFreightLineCount: 0 });
  assert.equal(l.freight.toFixed(2), "19814.94");
  assert.equal(l.dutyAndTariff.toFixed(2), "4191.07");
  assert.equal(l.total.toFixed(2), "24006.01");
  assert.equal(l.included, true);
});

test("it reads the BILLED figures, not the at-cost ones", () => {
  // The panel states the part of the customer's accepted consideration that is
  // logistics. At-cost would understate it by the markup and would not
  // reconcile against anything the customer agreed to.
  const l = landedLogisticsForTier({ rollup: O2_TIER_2, separateFreightLineCount: 0 });
  assert.notEqual(l.freight, O2_TIER_2.costBreakdown.freightContainer);
  assert.notEqual(l.dutyAndTariff, O2_TIER_2.costBreakdown.dutyAndTariff);
});

// ── when the claim may and may not be made ──────────────────────────────

test("bundled freight is included; a separate freight line is not", () => {
  assert.equal(
    landedLogisticsForTier({ rollup: O2_TIER_2, separateFreightLineCount: 0 }).included,
    true,
  );
  // The moment the document breaks freight out on its own line, saying the
  // unit prices include it becomes false. This flips without an edit here.
  assert.equal(
    landedLogisticsForTier({ rollup: O2_TIER_2, separateFreightLineCount: 1 }).included,
    false,
  );
});

test("a fixture with no freight claims nothing", () => {
  const domestic = {
    costBreakdown: {
      freightContainer: 0,
      dutyAndTariff: 0,
      freightContainerMarkupSum: 0,
      dutyAndTariffMarkupSum: 0,
    },
  };
  const l = landedLogisticsForTier({ rollup: domestic, separateFreightLineCount: 0 });
  assert.equal(l.total, 0);
  assert.equal(l.included, false, "no freight must not produce a freight claim");
});

test("a missing rollup is silence, not a claim", () => {
  const l = landedLogisticsForTier({ rollup: null, separateFreightLineCount: 0 });
  assert.equal(l.total, 0);
  assert.equal(l.included, false);
});

test("a sub-cent artifact is not treated as freight", () => {
  // `> 0` on a float would call a rounding crumb "included in unit pricing".
  const crumb = {
    costBreakdown: {
      freightContainer: 0,
      dutyAndTariff: 0,
      freightContainerMarkupSum: 0.001,
      dutyAndTariffMarkupSum: 0,
    },
  };
  assert.equal(
    landedLogisticsForTier({ rollup: crumb, separateFreightLineCount: 0 }).included,
    false,
  );
  // Half a cent rounds up and IS money.
  const cent = {
    costBreakdown: {
      freightContainer: 0,
      dutyAndTariff: 0,
      freightContainerMarkupSum: 0.005,
      dutyAndTariffMarkupSum: 0,
    },
  };
  assert.equal(
    landedLogisticsForTier({ rollup: cent, separateFreightLineCount: 0 }).included,
    true,
  );
});

// ── the copy: one source, exact words, governed gate ────────────────────

test("the sentence is defined ONCE and is exactly the approved copy", async () => {
  const doc = await readFile("src/components/pdf/customer-pdf-document.tsx", "utf8");
  const approved = "The unit prices shown include applicable freight, duty, and tariffs.";
  const literals = [...doc.matchAll(new RegExp(approved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  assert.equal(literals.length, 1, "the copy must exist exactly once, as one constant");
  assert.match(doc, /const FREIGHT_INCLUDED_SENTENCE =/);
});

test("HTML preview and PDF cannot diverge — they are one render path", async () => {
  // Asserted rather than assumed. Both go through `renderRepresentation`, so
  // there is no second renderer that could carry different words.
  const route = await readFile("src/app/api/quotes/[quoteId]/customer-pdf/route.tsx", "utf8");
  const send = await readFile("src/app/actions/quotes.ts", "utf8");
  assert.match(route, /renderRepresentation/, "preview streams the shared document");
  assert.match(send, /renderRepresentation/, "send buffers the shared document");
});

test("the sentence is gated on the governed flag, never on operator text", async () => {
  const doc = await readFile("src/components/pdf/customer-pdf-document.tsx", "utf8");
  // Rendered from the governed flag...
  assert.match(doc, /freightIncluded && ` \$\{FREIGHT_INCLUDED_SENTENCE\}`/);
  assert.match(doc, /data\.freightIncludedInUnitPrice === true/);

  // ...and the adapter feeds that flag from the governed reading only. If this
  // ever reads a note field, the document starts quoting whatever a PM typed.
  const adapter = await readFile("src/lib/customer-view-to-cpdf.ts", "utf8");
  assert.match(adapter, /freightIncludedInUnitPrice: view\.landedLogistics\?\.included === true/);
  assert.doesNotMatch(
    adapter,
    /freightIncludedInUnitPrice:[^\n]*(note|Note|customerFacing)/,
    "the flag must not be derived from operator free text",
  );
});

test("it does not say all-in — separate one-time charges can still exist", async () => {
  const doc = await readFile("src/components/pdf/customer-pdf-document.tsx", "utf8");
  const sentence = "The unit prices shown include applicable freight, duty, and tariffs.";
  assert.doesNotMatch(sentence, /all-in/i);
  // And the pre-existing all-in turnkey copy is left alone rather than reused.
  assert.match(doc, /Pricing is landed and all-in/);
});

test("the operator panel reads the governed values, and labels the treatment", async () => {
  const rail = await readFile("src/components/quote/customer-view-rail.tsx", "utf8");
  assert.match(rail, /Landed logistics/);
  assert.match(rail, /included in unit pricing/);
  assert.match(rail, /billed separately/);
  assert.match(rail, /cv-landed-total/);
  assert.match(rail, /cv-landed-freight/);
  assert.match(rail, /cv-landed-duty/);
});

test("nothing here recomputes freight", async () => {
  const src = await readFile("src/lib/landed-logistics.ts", "utf8");
  // It selects from the rollup. No markup application, no member allocation,
  // no tier arithmetic — those are certified upstream and must stay there.
  assert.doesNotMatch(src, /markupPct|memberCount|tierUnits|\* \(1 \+/);
  assert.equal(
    [...src.matchAll(/^import /gm)].length,
    0,
    "a pure selector over already-computed values needs no imports",
  );
});
