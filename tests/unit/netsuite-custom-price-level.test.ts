import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSalesOrderPayload } from "../../src/lib/netsuite/sales-orders.ts";
import { CUSTOM_PRICE_LEVEL_ID } from "../../src/lib/netsuite/price-policy.ts";

/**
 * A Nexus-priced line is CUSTOM, never Base Price.
 *
 * Nexus supplies the accepted commercial rate; it does not select an item's
 * base price. Every line on SO2716, SO2717 and SO2718 posted as price level 1
 * "Base Price" while carrying a Nexus rate — the amounts were right and the
 * provenance the label asserted was wrong.
 *
 * Both behaviours below were measured against the sandbox before being coded:
 *
 *   CREATE  SO2720 (disposable, no deal id) — 7 × 123.45 with price -1
 *           accepted; level -1, rate 123.45, amount 864.15, tax 0
 *   PATCH   SO2715 member, control SO2714
 *           price alone REFUSED; price + rate accepted; nothing repriced
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

// ── 1 · flat lines at CREATE ─────────────────────────────────────────────

test("every flat line posts at the Custom price level", () => {
  const items = itemsOf(buildSalesOrderPayload(INPUT as never));
  assert.deepEqual(items[0].price, { id: "-1" });
});

test("the price level travels WITH the governed rate, never instead of it", () => {
  // The CREATE probe sent both together and NetSuite accepted it; a price
  // level with no rate is what lets NetSuite source one itself.
  const [line] = itemsOf(buildSalesOrderPayload(INPUT as never));
  assert.deepEqual(line.price, { id: "-1" });
  assert.equal(line.rate, 2.5, "the governed rate is still transmitted");
  assert.equal(line.quantity, 10);
});

test("Direct Product, Direct Service and OTC lines all post as Custom", () => {
  const items = itemsOf(
    buildSalesOrderPayload({
      ...INPUT,
      lines: [
        { ...LINE, sku: "PROD-1" },
        { ...LINE, sku: "SVC-TESTING-MICROS", quantity: 2000, rate: 2.24 },
        { ...LINE, sku: "OTC-SETUP", quantity: 1, rate: 700 },
      ],
    } as never),
  );
  assert.equal(items.length, 3);
  for (const l of items) {
    assert.deepEqual(l.price, { id: "-1" }, `${String(l.custcol_dps_sku)} is not Custom`);
  }
});

test("the Item Group HEADER carries NO price level", () => {
  // The header's price is ignored in favour of the members NetSuite expands
  // beneath it, so a level there would assert provenance for a number that
  // does not exist. Members get theirs on the rate PATCH instead.
  const items = itemsOf(
    buildSalesOrderPayload({
      ...INPUT,
      lines: [],
      groupLines: [{ netsuiteItemId: "grp-1", quantity: 5000 }],
      groupMemberItemIds: ["m-1"],
    } as never),
  );
  assert.equal(items.length, 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(items[0], "price"),
    false,
    "a group header acquired a price level",
  );
});

// ── 2 · the member PATCH, and the rule the refusal implies ───────────────

test("a price level without the rate is REFUSED before it reaches NetSuite", async () => {
  const { patchSalesOrderLine } = await import("../../src/lib/netsuite/client.ts");
  await assert.rejects(
    () => patchSalesOrderLine("1", 2, { priceLevelId: "-1" }),
    /priceLevelId requires rate/,
  );
  // NetSuite refuses this too — "Please enter a value for Amount" — so the
  // guard is belt-and-braces today. It exists because a future version that
  // ACCEPTED it would be free to source the rate itself.
});

test("the member PATCH sends the price level alongside the rate", async () => {
  const src = await readFile("src/lib/netsuite/rate-convergence.ts", "utf8");
  const call = src.slice(
    src.indexOf("await provider.patchLine("),
    src.indexOf("patched.push("),
  );
  assert.ok(call.length > 0, "the member PATCH call was not found");
  assert.match(call, /rate: p\.desiredRate/);
  assert.match(call, /priceLevelId: CUSTOM_PRICE_LEVEL_ID/);
});

test("the PATCH body names price literally, never spread from the argument", async () => {
  const src = await readFile("src/lib/netsuite/client.ts", "utf8");
  const fn = src
    .split("export async function patchSalesOrderLine")[1]
    .split("export async function")[0];
  assert.match(fn, /body\.price = \{ id: patch\.priceLevelId \}/);
  assert.doesNotMatch(fn, /\.\.\.patch/);
});

// ── 3 · the constant is the measured one ─────────────────────────────────

test("Custom is price level -1", () => {
  // Identified by BEHAVIOUR, not by label: `refName` on level -1 comes back
  // empty and `pricelevel` is not SuiteQL-queryable in this account (a failed
  // read, not an empty catalog). It is accepted, it persists, it is not 1.
  assert.equal(CUSTOM_PRICE_LEVEL_ID, "-1");
});

test("nothing about the price level touches quantity, rate or amount", () => {
  // The probes measured this at the provider; asserted here so a future change
  // that made the level rewrite a figure fails locally rather than in NetSuite.
  const withPrice = itemsOf(buildSalesOrderPayload(INPUT as never))[0];
  assert.equal(withPrice.quantity, LINE.quantity);
  assert.equal(withPrice.rate, LINE.rate);
  assert.equal(
    Object.prototype.hasOwnProperty.call(withPrice, "amount"),
    false,
    "amount is NetSuite-derived; emitting it would create a second authority",
  );
});
