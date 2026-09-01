import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSalesOrderPayload } from "../../src/lib/netsuite/sales-orders.ts";
import { codeOnly } from "../support/code-only.ts";

/**
 * Decision 1 — explicit CUSTOM cost basis on fee and service lines.
 *
 * Accounting's disposition, and the constraint that came with it: *"Cost must
 * not affect frozen quantity, sell rate, line amount, accepted total, or
 * REG-4."*
 *
 * ── WHY THIS IS A PERTURBATION TEST, NOT AN ASSERTION ────────────────────
 *
 * "The total did not change" proves nothing on its own if nothing could have
 * changed it. That is the shape that nearly made proof 8 vacuous in the F1/F4
 * walk, where live and frozen agreed by coincidence and a matching figure was
 * evidence for neither source.
 *
 * So cost is MOVED here — through zero, through large values, through null —
 * and every commercial figure is required to come back bit-identical. A test
 * that only ever sees one cost value cannot tell isolation from luck.
 */

const base = {
  netsuiteCustomerId: "c1",
  subsidiaryId: "s1",
  orderStatusCode: "B",
  taxCodeId: null,
  paymentTermsText: null,
  hubspotDealId: "d1",
  hubspotDealName: "Deal",
} as const;

/** One fee line at quantity 1, with the cost under test. */
function payloadWithCost(unitCost: number | null) {
  return buildSalesOrderPayload({
    ...base,
    lines: [
      {
        netsuiteItemId: "59157",
        sku: "OTC-0050",
        description: "Formulation",
        quantity: 1,
        rate: 5600,
        unitCost,
      },
      {
        netsuiteItemId: "66476",
        sku: "DPS-BOTTLE-0001",
        description: "Primary - Bottle",
        quantity: 5000,
        rate: 2.175,
        unitCost: 1.5,
      },
    ],
  } as never);
}

function lines(p: Record<string, unknown>) {
  return (p.item as { items: Array<Record<string, unknown>> }).items;
}

/** Every field that is commercial. Cost may not move any of them. */
function commercialShape(p: Record<string, unknown>) {
  return lines(p).map((l) => ({
    item: l.item,
    quantity: l.quantity,
    rate: l.rate,
    description: l.description,
    sku: l.custcol_dps_sku,
    // `amount` is deliberately included: NetSuite derives it, and the payload
    // must never start asserting one.
    amount: Object.prototype.hasOwnProperty.call(l, "amount") ? l.amount : "absent",
  }));
}

// ── the perturbation ─────────────────────────────────────────────────────

test("PERTURBATION · moving the cost basis moves no commercial figure", () => {
  const reference = commercialShape(payloadWithCost(2500));

  for (const cost of [null, 0, 0.0001, 1, 2500, 999999.9999, -1]) {
    const shape = commercialShape(payloadWithCost(cost));
    assert.deepEqual(
      shape,
      reference,
      `cost ${String(cost)} altered a commercial figure — quantity, rate, ` +
        `description, sku or amount moved`,
    );
  }
});

test("PERTURBATION · the cost fields DO move, so the test above is not vacuous", () => {
  // The companion to the check above. If cost never reached the payload at
  // all, the perturbation test would pass trivially while proving nothing.
  const a = lines(payloadWithCost(1000))[0];
  const b = lines(payloadWithCost(2500))[0];

  assert.equal(a.costEstimateRate, 1000);
  assert.equal(b.costEstimateRate, 2500);
  assert.notDeepEqual(a.costEstimateRate, b.costEstimateRate);
  assert.equal(a.custcol_dps_unit_cost, 1000);
  assert.equal(b.custcol_dps_unit_cost, 2500);
});

// ── zero vs null, the disposition Accounting settled ─────────────────────

test("an explicit ZERO cost is sent as CUSTOM 0, not suppressed", () => {
  // Accounting's call, against my initial caution. A governed zero is a
  // STATEMENT about cost; suppressing it would substitute NetSuite's
  // item-master guess for a fact Nexus holds.
  const line = lines(payloadWithCost(0))[0];
  assert.deepEqual(line.costEstimateType, { id: "CUSTOM" });
  assert.equal(line.costEstimateRate, 0);
  assert.equal(line.custcol_dps_unit_cost, 0);
});

test("a NULL cost sends nothing and leaves NetSuite's own default intact", () => {
  const line = lines(payloadWithCost(null))[0];
  assert.equal(Object.prototype.hasOwnProperty.call(line, "costEstimateType"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(line, "costEstimateRate"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(line, "custcol_dps_unit_cost"), false);
});

test("zero and null are DIFFERENT payloads — the distinction is the disposition", () => {
  assert.notDeepEqual(lines(payloadWithCost(0))[0], lines(payloadWithCost(null))[0]);
});

// ── the emitter reads a governed source, and only a governed source ──────

test("fee-line cost comes from a governed authority, never invented", async () => {
  const src = await readFile("src/lib/netsuite/mark-complete.ts", "utf8");

  // Direct Service — the SAME math-layer field a product line already uses.
  assert.match(src, /serviceCostByLeafId/);
  assert.match(src, /perTier\.contributionCostPerUnit/);

  // OTC — the production fee column the sell price is computed from, resolved
  // through the governed destination map rather than by naming a column.
  assert.match(src, /OTC_COLUMN_DESTINATION\[c\] === line\.destination/);
  assert.match(src, /assemblyProductionInputs/);

  // The hardcoded null is gone.
  //
  // Split when the line ARRANGEMENT moved to `planned-sales-order.ts` so the
  // preview and the send path have one structural producer. The DERIVATION of
  // the cost is still mark-complete's — that is what the assertions above
  // read. Where the derived value lands on a line is now the builder's, so
  // that half is asserted against the builder. Retargeting the whole test at
  // one file would have dropped one of the two claims.
  const built = codeOnly(
    await readFile("src/lib/netsuite/planned-sales-order.ts", "utf8"),
  );
  assert.doesNotMatch(built, /unitCost: null,/);
  assert.match(built, /unitCost: input\.accountingCostFor\(frozenLine\)/);
  // And mark-complete still hands the derivation in, rather than the builder
  // acquiring a cost authority of its own.
  assert.match(codeOnly(src), /accountingCostFor,/);
});

test("the service cost index is SEPARATE from the structure index", async () => {
  const src = await readFile("src/lib/netsuite/mark-complete.ts", "utf8");
  // A service must never enter `liveByLeafId`, or it could acquire a product
  // line's quantity or rate. Cost travels in its own index for that reason.
  assert.match(src, /const serviceCostByLeafId = new Map<string, number \| null>\(\)/);
  assert.match(src, /\.filter\(\(c\) => c\.commercialKind !== "service"\)/);
});

test("cost appears ONLY as unitCost on the accounting line, never in its economics", async () => {
  // Found by falsification. Adding the cost into the accounting line's RATE
  // — `rate: lineRate + (accountingCostFor(frozenLine) ?? 0)` — left the whole
  // suite green: the perturbation test drives `buildSalesOrderPayload`
  // directly with hand-made lines, so it never sees how mark-complete builds
  // that rate, and the REG-4 grep only covers the REG-4 block.
  //
  // A guarantee about where a value may appear needs a check that reads the
  // place it must not appear in.
  // Reads the BUILDER, which is where the branch moved. The guarantee is
  // unchanged: cost may appear once, as `unitCost`, and nowhere in the
  // economics.
  const src = codeOnly(
    await readFile("src/lib/netsuite/planned-sales-order.ts", "utf8"),
  );
  const start = src.indexOf("if (!isProduct) {");
  const end = src.indexOf("continue;", start);
  assert.ok(start > -1 && end > start, "accounting-line branch not found");
  const branch = src.slice(start, end);

  // The economics are carried verbatim from the frozen line.
  assert.match(branch, /quantity: frozenLine\.quantity,/);
  assert.match(branch, /rate: lineRate,/);

  // …and the cost is consulted exactly once, for unitCost alone.
  const uses = branch.match(/accountingCostFor/g) ?? [];
  assert.equal(
    uses.length,
    1,
    `accountingCostFor appears ${uses.length} times in the accounting-line ` +
      `branch; it may be read once, for unitCost only`,
  );
  assert.match(branch, /unitCost: input\.accountingCostFor\(frozenLine\),/);
});

test("cost reaches no REG-4 input", async () => {
  const src = codeOnly(await readFile("src/lib/netsuite/mark-complete.ts", "utf8"));
  // REG-4's inputs are built from frozen rate/amount/quantity and the
  // transmitted rate. None of them may be fed a cost.
  const reg4Block = src.slice(
    src.indexOf("const reg4Groups"),
    src.indexOf("const postGroupingFailures"),
  );
  assert.ok(reg4Block.length > 0, "REG-4 construction block not found");
  assert.doesNotMatch(reg4Block, /unitCost/);
  assert.doesNotMatch(reg4Block, /accountingCostFor/);
  assert.doesNotMatch(reg4Block, /costEstimate/);
});
