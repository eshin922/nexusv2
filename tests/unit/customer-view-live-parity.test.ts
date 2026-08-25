import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { composeLineTotals, composeTierMoney } from "@/lib/customer-money";
import {
  lineTotal,
  serviceFeesTotal,
  tierGrand,
} from "@/components/pdf/customer-pdf-helpers";
import type { CpdfServiceFee, CpdfSku, CpdfTier } from "@/components/pdf/customer-pdf-types";

/**
 * HTML ↔ PDF PARITY, compared at the projection boundary.
 *
 * ── WHAT PARITY MEANS HERE ───────────────────────────────────────────────
 *
 * Not "the two renderers agree because they share a subroutine" — that would
 * certify a shared implementation rather than a shared source of truth. What is
 * asserted is that both renderers SELECT THE SAME ALREADY-COMPOSED FACTS from
 * one `CustomerView`, and that neither derives a figure of its own.
 *
 * So the comparison is: for a given projection, the set of monetary facts the
 * PDF's selectors return must be exactly the set the HTML renderer reads. The
 * fixtures below are the projection; there is no second input.
 *
 * ── THE VACUOUS PASS IS GUARDED ──────────────────────────────────────────
 *
 * A comparison that finds nothing on both sides passes while proving nothing.
 * That is not hypothetical here: the glyph certifier reported PASS after
 * decoding 106 runs and matching zero money values, and this estate has been
 * caught by the same shape four times. Every case below asserts a non-empty
 * comparison before asserting equality.
 */

const TIER_DEFS = [
  { id: "t1", label: "T1", full: "Tier 1", quantity: 1000 },
  { id: "t2", label: "T2", full: "Tier 2", quantity: 5000 },
  { id: "t3", label: "T3", full: "Tier 3", quantity: 10000, recommended: true },
  { id: "t4", label: "T4", full: "Tier 4", quantity: 20000 },
];
const QTYS = TIER_DEFS.map((t) => t.quantity);

const PRICES: ReadonlyArray<ReadonlyArray<number | null>> = [
  // Fractional, so a divisor error cannot hide behind round numbers.
  [14.906, 6.281024, 7.514, 3.49],
  // Unpriced at tier 2 — "on request" is a customer-visible state.
  [2.5, null, 1.25, 0.999],
];

const FEE_AMOUNTS: ReadonlyArray<ReadonlyArray<number | null>> = [
  // Null at tier 3: not billed there, which is not zero.
  [1400, 1400, null, 1400],
  [700, 700, 700, 700],
];

const lineTotalsBySku = PRICES.map((p) => composeLineTotals(p, QTYS));

const TIERS: CpdfTier[] = TIER_DEFS.map((t, ti) => ({
  ...t,
  money: composeTierMoney({
    quantity: t.quantity,
    lineTotals: lineTotalsBySku.map((lt) => lt[ti]),
    feeAmounts: FEE_AMOUNTS.map((f) => f[ti]),
  }),
}));

const SKUS = PRICES.map((p, i) => ({
  id: `s${i}`,
  code: `S${i}`,
  name: `Product ${i}`,
  pack: null,
  tier_prices: p,
  tier_line_totals: lineTotalsBySku[i],
  shape: "step↓",
})) as unknown as CpdfSku[];

const FEES: CpdfServiceFee[] = FEE_AMOUNTS.map((amts, i) => ({
  id: `f${i}`,
  scope: "sku",
  label: `Fee ${i}`,
  sub: "",
  tier_amounts: amts,
  qty_label: `1 (fee${i})`,
}));

// ═══════════════════════════════════════════════════════════════════════
// EVERY FIGURE THE PDF SELECTS EXISTS ON THE PROJECTION
// ═══════════════════════════════════════════════════════════════════════

test("parity · the PDF's selectors return exactly the projection's facts", () => {
  let compared = 0;

  for (let ti = 0; ti < TIERS.length; ti++) {
    const m = TIERS[ti].money;

    // Extended line amounts.
    for (let si = 0; si < SKUS.length; si++) {
      assert.equal(
        lineTotal(SKUS[si], TIERS, ti),
        lineTotalsBySku[si][ti],
        `sku ${si} tier ${ti}: the PDF must read the projection's line total`,
      );
      compared++;
    }

    // Fee totals.
    assert.equal(serviceFeesTotal(FEES, ti, TIERS), m.feesTotal);
    compared++;

    // Both shapes, because `foldFees` selects and must not construct.
    const itemized = tierGrand(SKUS, TIERS, ti, false, FEES);
    assert.equal(itemized.total, m.goodsTotal);
    assert.equal(itemized.perUnit, m.perUnitGoods);
    assert.equal(itemized.hasUnpriced, m.hasUnpricedLine);

    const folded = tierGrand(SKUS, TIERS, ti, true, FEES);
    assert.equal(folded.total, m.turnkeyTotal);
    assert.equal(folded.perUnit, m.perUnitTurnkey);
    compared += 5;
  }

  // The vacuous-pass guard. A comparison that compared nothing is a failure,
  // not a pass.
  assert.ok(compared >= 4 * (2 + 1 + 5), `expected a full comparison, made ${compared}`);
});

// ═══════════════════════════════════════════════════════════════════════
// THE HTML RENDERER READS THE SAME FIELDS, AND DERIVES NOTHING
// ═══════════════════════════════════════════════════════════════════════

test("parity · the HTML renderer reads the projection and nothing else", async () => {
  const src = await readFile(
    new URL("../../src/components/quote/customer-view-live.tsx", import.meta.url),
    "utf8",
  );
  // Comments stripped: this file explains the boundary by naming what it
  // forbids, and a prose mention is not a use.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("^[ \t]*//.*$", "gm"), "");

  // Every monetary figure comes from a projection field.
  for (const field of [
    "tierLineTotals",
    "money.goodsTotal",
    "money.turnkeyTotal",
    "money.perUnitGoods",
    "money.perUnitTurnkey",
    "money.hasUnpricedLine",
    "tierAmounts",
  ]) {
    const bare = field.includes(".") ? field.split(".")[1] : field;
    assert.ok(
      code.includes(bare),
      `the renderer must read ${field} rather than derive it`,
    );
  }

  // No PDF adapter dependency — the whole point of building from CustomerView.
  assert.ok(!code.includes("customer-view-to-cpdf"), "no adapter dependency");
  assert.ok(!/from "@\/components\/pdf/.test(code), "no PDF tree dependency");

  // No invented fallback for a missing figure. `?? 0` on a price or total would
  // print a governed zero the firm never quoted (OD-005).
  assert.doesNotMatch(
    code,
    /(price|total|amount|perUnit)\w*\s*\?\?\s*0\b/i,
    "a null figure must render as absence, never as zero",
  );
});

test("both documents describe an unpriced cell in the same words", async () => {
  // Parity finding 4, found on a production draft carrying three unpriced
  // cells. The PDF said "quote on request"; the live renderer said "on
  // request". The same customer-facing state, described two ways -- a content
  // difference, not a styling one, and exactly what this gate exists to catch.
  //
  // Asserted on the exact phrases. A looser /request/ would match "Per-tier
  // amounts available on request" in the charges block and pass while the cell
  // label diverged -- the same too-broad-pattern mistake that produced a false
  // green on T&Cs.
  const live = await readFile(
    new URL("../../src/components/quote/customer-view-live.tsx", import.meta.url),
    "utf8",
  );
  const table = await readFile(
    new URL("../../src/components/pdf/customer-pdf-pricing-table.tsx", import.meta.url),
    "utf8",
  );
  const grand = await readFile(
    new URL("../../src/components/pdf/customer-pdf-grand-total-row.tsx", import.meta.url),
    "utf8",
  );

  // A cell with no price.
  assert.match(table, />quote on request</, "the PDF's cell wording");
  assert.match(live, />quote on request</, "the live renderer must match it");

  // A tier with nothing priced at all.
  assert.match(live, />total on request</);
  assert.ok(grand.includes("total on request"), "the PDF uses the same phrase");

  // Neither may render a governed zero for an unpriced state (OD-005).
  // The renderer must contain no literal money zero at all: every amount it
  // shows comes from the projection, and an unpriced one is rendered as
  // words rather than as a price the firm never quoted.
  assert.ok(
    !live.includes("$0.00"),
    "the live renderer must not carry a literal $0.00",
  );
});
