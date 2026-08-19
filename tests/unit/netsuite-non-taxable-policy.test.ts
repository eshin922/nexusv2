import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSalesOrderPayload } from "../../src/lib/netsuite/sales-orders.ts";
import {
  NON_TAXABLE_TAX_CODE_ID,
  enforceNonTaxableLines,
  planTaxEnforcement,
} from "../../src/lib/netsuite/tax-policy.ts";

/**
 * Every Sales Order Nexus creates is NON-TAXABLE.
 *
 * Measured cause (2026-08-19): SO2716 came back with $1,030.50 of tax because
 * NetSuite customer 388800 carries `taxable: true` and Nexus sent no tax code
 * at all. The account is on LEGACY tax — no `taxDetails`, and no `taxItem` /
 * `isTaxable` on the SO REST schema — so per-line `taxCode` is the only lever.
 *
 * The case these tests exist for is the one that is easy to miss: Item Group
 * MEMBER lines are created by NetSuite's group EXPANSION. On SO2716 the group
 * header and EndGroup were `-8` while the member between them — the line
 * carrying the money — was `CA_CA`. No CREATE payload can reach it.
 */

const LINE = {
  netsuiteItemId: "item-1",
  sku: "SKU-1",
  description: "d",
  quantity: 10,
  rate: 2.5,
  unitCost: 1,
};

const INPUT = {
  netsuiteCustomerId: "c-1",
  subsidiaryId: "s-1",
  orderStatusCode: "B",
  paymentTermsText: null,
  hubspotDealId: "d-1",
  hubspotDealName: "deal",
  lines: [LINE],
};

const itemsOf = (p: Record<string, unknown>) =>
  (p.item as { items: Array<Record<string, unknown>> }).items;

// ── 1 · every emitted line carries the non-taxable code ──────────────────

test("every flat line is non-taxable, unconditionally", () => {
  const items = itemsOf(buildSalesOrderPayload(INPUT as never));
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].taxCode, { id: "-8" });
});

test("Direct Service and OTC lines are non-taxable, like every other line", () => {
  // The emitter is line-kind agnostic — Direct Product, Direct Service and OTC
  // all travel as flat lines. Asserted explicitly because Accounting's rule
  // enumerates them separately, and "they go through the same code path" is a
  // claim worth checking rather than assuming.
  const items = itemsOf(
    buildSalesOrderPayload({
      ...INPUT,
      lines: [
        { ...LINE, sku: "SVC-TESTING-MICROS", quantity: 2000, rate: 2.24 },
        { ...LINE, sku: "OTC-SETUP", quantity: 1, rate: 700 },
      ],
    } as never),
  );
  assert.equal(items.length, 2);
  for (const line of items) {
    assert.deepEqual(line.taxCode, { id: "-8" }, `${String(line.custcol_dps_sku)} is taxable`);
  }
});

test("the Item Group HEADER line is non-taxable and stated, not inherited", () => {
  const items = itemsOf(
    buildSalesOrderPayload({
      ...INPUT,
      lines: [],
      groupLines: [{ netsuiteItemId: "grp-1", quantity: 5000 }],
      groupMemberItemIds: ["m-1"],
    } as never),
  );
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].taxCode, { id: "-8" });
});

test("no admin setting can make a Nexus order taxable", async () => {
  // The emitter used to send a tax code only when
  // firm_settings.netsuite_default_tax_code_id was set. A governed commercial
  // rule living in an admin-mutable column is exactly the shape being removed,
  // so the input is gone rather than defaulted.
  const src = await readFile("src/lib/netsuite/sales-orders.ts", "utf8");
  assert.doesNotMatch(
    src,
    /input\.taxCodeId/,
    "the payload still reads a caller-supplied tax code",
  );
  const markComplete = await readFile("src/lib/netsuite/mark-complete.ts", "utf8");
  assert.doesNotMatch(
    markComplete,
    /taxCodeId:\s*firm\.netsuiteDefaultTaxCodeId/,
    "mark-complete still feeds the firm_settings override into the payload",
  );
});

// ── 2 · the member case — reachable only by PATCH ────────────────────────

test("planTaxEnforcement targets exactly the taxable lines", () => {
  const plan = planTaxEnforcement({
    lines: [
      { line: 0, taxCodeId: "-8" }, // group header
      { line: 1, taxCodeId: "-519" }, // MEMBER — the SO2716 case
      { line: 2, taxCodeId: "-8" }, // EndGroup
      { line: 3, taxCodeId: "-519" }, // OTC
    ],
  });
  assert.deepEqual(plan.patch, [1, 3]);
  assert.deepEqual(plan.alreadyNonTaxable, [0, 2]);
  assert.deepEqual(plan.indeterminate, []);
});

test("an UNREADABLE tax code is patched, not assumed compliant", () => {
  // A null code and a correct one are different facts. Folding them together
  // would report a taxable line as compliant, so the unknown is acted on.
  const plan = planTaxEnforcement({ lines: [{ line: 0, taxCodeId: null }] });
  assert.deepEqual(plan.patch, [0]);
  assert.deepEqual(plan.indeterminate, [0]);
  assert.deepEqual(plan.alreadyNonTaxable, []);
});

test("enforcement patches the member and verifies against a RE-READ", async () => {
  const state = new Map([
    [0, "-8"],
    [1, "-519"],
    [2, "-8"],
  ]);
  const patched: Array<[number, string]> = [];
  let reads = 0;

  const result = await enforceNonTaxableLines({
    readLines: async () => {
      reads++;
      return [...state].map(([line, taxCodeId]) => ({ line, taxCodeId }));
    },
    patchLine: async (line, taxCodeId) => {
      patched.push([line, taxCodeId]);
      state.set(line, taxCodeId);
    },
  });

  assert.deepEqual(patched, [[1, "-8"]]);
  assert.deepEqual(result.residual, [], "order still carries a taxable line");
  assert.equal(reads, 2, "compliance was not verified by a second read");
});

test("a PATCH NetSuite accepts but overrides is still caught", async () => {
  // The failure this guards is silent: the call succeeds, nothing throws, and
  // the customer's tax configuration re-derives the code anyway. Reporting
  // success from "no call threw" would pass. Only provider state settles it.
  const result = await enforceNonTaxableLines({
    readLines: async () => [{ line: 1, taxCodeId: "-519" }],
    patchLine: async () => {
      /* accepted, and silently ineffective */
    },
  });
  assert.deepEqual(result.residual, [1]);
});

test("a failing PATCH is reported rather than swallowed", async () => {
  const result = await enforceNonTaxableLines({
    readLines: async () => [{ line: 4, taxCodeId: "-519" }],
    patchLine: async () => {
      throw new Error("INSUFFICIENT_PERMISSION");
    },
  });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /INSUFFICIENT_PERMISSION/);
  assert.deepEqual(result.residual, [4]);
});

test("enforcement is a GATE in mark-complete, not best-effort like cost", async () => {
  const src = await readFile("src/lib/netsuite/mark-complete.ts", "utf8");
  const block = src.slice(
    src.indexOf("Governed tax policy"),
    src.indexOf("Governed cost"),
  );
  assert.ok(block.length > 0, "the tax enforcement block was not found");
  assert.match(block, /enforceNonTaxableLines\(/);
  assert.match(block, /residual\.length > 0/);
  assert.match(block, /throw new Error\(/, "a non-compliant order must not complete");
  // Cost projection is deliberately wrapped so a reporting basis cannot refuse
  // a commercially correct order. Tax must NOT inherit that treatment.
  assert.doesNotMatch(
    block,
    /catch\s*\(/,
    "tax enforcement swallows its own failure — it is a governed rule, not a reporting basis",
  );
});

// ── 3 · tax moves no commercial number ───────────────────────────────────

test("adding the tax code moves no commercial figure", () => {
  // SO2716 measured this directly: subtotal $17,175.00 equalled the frozen
  // commercial total exactly, with $1,030.50 of tax on top. Tax sits outside
  // the frozen statement, so REG-4 cannot move — asserted rather than trusted.
  const items = itemsOf(buildSalesOrderPayload(INPUT as never));
  const line = items[0];
  assert.equal(line.quantity, 10);
  assert.equal(line.rate, 2.5);
  assert.equal(
    Object.prototype.hasOwnProperty.call(line, "amount"),
    false,
    "amount is NetSuite-derived; emitting it would create a second authority",
  );
});

test("the non-taxable code is the one NetSuite itself uses", () => {
  // `-8` is evidenced, not guessed: NetSuite applied it to the Item Group
  // header and EndGroup lines of SO2716 unprompted.
  assert.equal(NON_TAXABLE_TAX_CODE_ID, "-8");
});
