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
import {
  landedLogisticsForTier,
  FREIGHT_INCLUDED_SENTENCE,
} from "../../src/lib/landed-logistics.ts";

/** The two renderers of the customer artifact, over the same CustomerView. */
const RENDERERS = [
  ["PDF", "src/components/pdf/customer-pdf-document.tsx"],
  ["live HTML", "src/components/quote/customer-view-live.tsx"],
] as const;

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

test("the approved copy is exactly these words", () => {
  assert.equal(
    FREIGHT_INCLUDED_SENTENCE,
    "The unit prices shown include applicable freight, duty, and tariffs.",
  );
});

test("the words are defined ONCE, outside both renderers", async () => {
  // CORRECTED. An earlier version asserted this against the PDF component
  // alone and separately claimed preview and PDF "are one render path",
  // evidenced by both routes calling `renderRepresentation`.
  //
  // That was route-level reasoning and it was WRONG. `customer-view-live.tsx`
  // is a SECOND renderer over the same CustomerView, reached by neither route,
  // and the assertion could not have detected it — a grep over two routes
  // cannot see a component neither route mentions. It is the #511 / #512
  // failure mode and the test would have shipped it.
  const escaped = FREIGHT_INCLUDED_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [label, path] of RENDERERS) {
    const src = await readFile(path, "utf8");
    assert.equal(
      [...src.matchAll(new RegExp(escaped, "g"))].length,
      0,
      `${label} must not carry its own copy of the sentence`,
    );
    assert.match(
      src,
      /FREIGHT_INCLUDED_SENTENCE/,
      `${label} must consume the shared constant`,
    );
    assert.match(
      src,
      /import \{[^}]*FREIGHT_INCLUDED_SENTENCE[^}]*\} from "@\/lib\/landed-logistics"/,
      `${label} must import it from the governing module`,
    );
  }
});

test("BOTH renderers consume the governed fact, and NEITHER derives it", async () => {
  for (const [label, path] of RENDERERS) {
    const src = await readFile(path, "utf8");
    // consumes the fact
    assert.match(
      src,
      /freightIncluded/,
      `${label} must gate on the governed inclusion fact`,
    );
    // ...and does not compute it. `landedLogisticsForTier` is the only place
    // inclusion is decided; a renderer calling it would be a second decision
    // point even though it would agree today.
    assert.doesNotMatch(
      src,
      /landedLogisticsForTier/,
      `${label} must not derive inclusion itself`,
    );
    assert.doesNotMatch(
      src,
      /freightContainerMarkupSum|dutyAndTariffMarkupSum/,
      `${label} must not reach the raw rollup figures`,
    );
  }
});

test("each renderer reads inclusion from the projection, by its own route in", async () => {
  // The two consume the same FACT through different shapes -- the PDF via the
  // cpdf adapter, the live renderer straight off CustomerView -- so each is
  // asserted against the shape it actually receives rather than a shared one.
  const pdf = await readFile("src/components/pdf/customer-pdf-document.tsx", "utf8");
  assert.match(pdf, /data\.freightIncludedInUnitPrice === true/);

  const live = await readFile("src/components/quote/customer-view-live.tsx", "utf8");
  assert.match(live, /view\.landedLogistics\?\.included === true/);

  // ...and the adapter that feeds the PDF gets it from the same projection
  // field the live renderer reads, so the two cannot diverge upstream either.
  const adapter = await readFile("src/lib/customer-view-to-cpdf.ts", "utf8");
  assert.match(adapter, /freightIncludedInUnitPrice: view\.landedLogistics\?\.included === true/);
});

test("bundled shows it in BOTH; no-freight shows it in NEITHER", () => {
  // The gate is one value, so proving the value proves both renderers -- each
  // is asserted above to render on exactly this flag and nothing else.
  const bundled = landedLogisticsForTier({
    rollup: O2_TIER_2,
    separateFreightLineCount: 0,
  });
  assert.equal(bundled.included, true, "O2 bundled — sentence in both");

  const noFreight = landedLogisticsForTier({
    rollup: {
      costBreakdown: {
        freightContainer: 0,
        dutyAndTariff: 0,
        freightContainerMarkupSum: 0,
        dutyAndTariffMarkupSum: 0,
      },
    },
    separateFreightLineCount: 0,
  });
  assert.equal(noFreight.included, false, "no freight — sentence in neither");
});

test("separate freight gets the non-inclusion state, not this sentence", async () => {
  const separate = landedLogisticsForTier({
    rollup: O2_TIER_2,
    separateFreightLineCount: 1,
  });
  assert.equal(separate.included, false, "a broken-out freight line is not inclusion");

  // And both renderers already carry the correct alternative for that case,
  // gated on the separate-line count rather than on this flag. The two
  // sentences are mutually exclusive by construction.
  for (const [label, path] of RENDERERS) {
    const src = await readFile(path, "utf8");
    assert.match(
      src,
      /Outbound freight is billed separately at cost/,
      `${label} must carry the non-inclusion sentence`,
    );
    assert.match(src, /hasSeparateFreight/, `${label} gates it on the separate-line count`);
  }
});

test("operator free text cannot control its presence, in either renderer", async () => {
  for (const [label, path] of RENDERERS) {
    const src = await readFile(path, "utf8");
    assert.match(
      src,
      /freightIncluded && ` \$\{FREIGHT_INCLUDED_SENTENCE\}`/,
      `${label} renders the sentence from the governed flag alone`,
    );
  }
  // The flag itself comes from the governed reading only. If the adapter ever
  // reads a note field, the document starts quoting whatever a PM typed.
  const adapter = await readFile("src/lib/customer-view-to-cpdf.ts", "utf8");
  assert.doesNotMatch(
    adapter,
    /freightIncludedInUnitPrice:[^\n]*(note|Note|customerFacing)/,
    "the flag must not be derived from operator free text",
  );
});

test("it does not say all-in — separate one-time charges can still exist", async () => {
  assert.doesNotMatch(FREIGHT_INCLUDED_SENTENCE, /all-in/i);
  // And the pre-existing all-in turnkey copy is left alone rather than reused.
  const doc = await readFile("src/components/pdf/customer-pdf-document.tsx", "utf8");
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
    "a pure selector over already-computed values needs no imports — which is " +
      "also what lets BOTH renderers consume it, including the live one that " +
      "may not import from components/pdf/",
  );
});
