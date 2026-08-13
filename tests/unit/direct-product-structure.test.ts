// Direct Product (Add Product) structural support.
//
// THE DESIGN AUTHORITY these guard, stated once:
//
//   Add Product and Add Item Group are peer operator choices. A one-product
//   Item Group is NOT equivalent to a Direct Product — SO2704 shows the former
//   printing as a named container with a nested line and the latter as a single
//   line, so the choice reaches the customer's document. Therefore: never infer
//   Item Group from product count, never auto-wrap a Direct Product, never
//   collapse a one-product Item Group into Direct.
//
// These are unit-level structural assertions. They do NOT certify the
// end-to-end path — that requires a governed Direct fixture through
// Send → Accept → Complete against NetSuite, which is deliberately separate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildGroupingPlan } from "../../src/lib/netsuite/grouping-plan.ts";
import { buildSalesOrderPayload } from "../../src/lib/netsuite/sales-orders.ts";
import { evaluateAttachmentEligibility } from "../../src/lib/product-structure/attachment-eligibility.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

const groupedLine = (over: Record<string, unknown> = {}) => ({
  assemblyId: "asm-1",
  assemblySku: "ASY-1",
  assemblyName: "Kit",
  sku: "SKU-G",
  netsuiteItemId: "100",
  quantity: 1000,
  qtyPerParent: 1,
  rate: 2,
  unitCost: 0.5,
  ...over,
});

const directLine = (over: Record<string, unknown> = {}) => ({
  assemblyId: null,
  assemblySku: null,
  assemblyName: null,
  sku: "SKU-D",
  netsuiteItemId: "200",
  quantity: 500,
  qtyPerParent: 1,
  rate: 3,
  unitCost: 1.25,
  ...over,
});

// ---------------------------------------------------------------- 1
test("a Direct Product is never bucketed into an Item Group", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: "11323",
    tierQty: 1000,
    lines: [groupedLine(), directLine()] as never,
  });
  // One group — the assembly. The Direct Product produced none of its own.
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].assemblyId, "asm-1");
  assert.deepEqual(
    plan.groups[0].members.map((m) => m.sku),
    ["SKU-G"],
  );
});

// ---------------------------------------------------------------- 2
test("a lone Direct Product produces no group even at turnkey_only", () => {
  // The auto-wrap temptation lives exactly here: grouping is REQUIRED by the
  // detail level and there is one product to wrap. It must still not happen.
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: "11323",
    tierQty: 500,
    lines: [directLine()] as never,
  });
  assert.equal(plan.groupingRequired, true);
  assert.equal(plan.groups.length, 0);
});

// ---------------------------------------------------------------- 3
test("Direct Products are attributed, not silently omitted", () => {
  const plan = buildGroupingPlan({
    detailLevel: "itemized",
    customerNetsuiteId: "11323",
    tierQty: 500,
    lines: [groupedLine(), directLine()] as never,
  });
  // "Belongs to no group" is a recorded fact. Absence from the attribution list
  // would be indistinguishable from a dropped line.
  assert.equal(plan.lineAttribution.length, 2);
  const direct = plan.lineAttribution.find((l) => l.sku === "SKU-D");
  assert.ok(direct);
  assert.equal(direct.assemblyId, null);
  assert.equal(direct.assemblySku, null);
});

// ---------------------------------------------------------------- 4
test("a one-product Item Group still groups — no collapse into Direct", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: "11323",
    tierQty: 1000,
    lines: [groupedLine()] as never,
  });
  // The inverse error of test 2. SO2704 contains exactly this shape live.
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].members.length, 1);
});

// ---------------------------------------------------------------- 5
test("a Direct Product emits one ordinary line, no Group/EndGroup", () => {
  const body = buildSalesOrderPayload({
    netsuiteCustomerId: "11323",
    subsidiaryId: "2",
    orderStatusCode: "B",
    hubspotDealId: "D1",
    hubspotDealName: "Deal",
    lines: [
      {
        netsuiteItemId: "200",
        sku: "SKU-D",
        description: "Direct product",
        quantity: 500,
        rate: 3,
        unitCost: 1.25,
      },
    ],
  } as never);
  const items = (body.item as { items: Record<string, unknown>[] }).items;
  assert.equal(items.length, 1);
  const line = items[0];
  assert.deepEqual(line.item, { id: "200" });
  assert.equal(line.quantity, 500);
  assert.equal(line.rate, 3);
  assert.equal(line.custcol_dps_sku, "SKU-D");
  // Governed cost reaches the standard basis on the Direct path too.
  assert.deepEqual(line.costEstimateType, { id: "CUSTOM" });
  assert.equal(line.costEstimateRate, 1.25);
});

// ---------------------------------------------------------------- 6
test("mixing group lines and flat lines is refused, not attempted", () => {
  // Probe 7a: NetSuite expands the group AND honours explicit members,
  // returning 204 while doubling the order. Unproven for an UNRELATED flat
  // line, and an unproven argument is not a licence to send it.
  assert.throws(
    () =>
      buildSalesOrderPayload({
        netsuiteCustomerId: "11323",
        subsidiaryId: "2",
        orderStatusCode: "B",
        hubspotDealId: "D1",
        hubspotDealName: "Deal",
        lines: [
          {
            netsuiteItemId: "200",
            sku: "SKU-D",
            description: "d",
            quantity: 1,
            rate: 1,
            unitCost: null,
          },
        ],
        groupLines: [{ netsuiteItemId: "999", sku: "ASY-1-G", quantity: 1 }],
      } as never),
    /refusing to emit Item Group lines alongside explicit line items/,
  );
});

// ---------------------------------------------------------------- 7
test("markComplete refuses the mixed structure before CREATE", async () => {
  const src = await read("src/lib/netsuite/mark-complete.ts");
  // The guard must precede group emission, so nothing is written to NetSuite
  // master data before the refusal.
  const guardAt = src.indexOf(
    "groupedCount > 0 && tree.directProducts.length > 0",
  );
  const emitAt = src.indexOf("findOrCreateItemGroup(adapted)");
  assert.ok(guardAt > 0, "mixed-structure guard must exist");
  assert.ok(emitAt > 0);
  assert.ok(guardAt < emitAt, "guard must run before any Item Group is created");
});

// ---------------------------------------------------------------- 8
test("Complete requires products, not assemblies", async () => {
  const src = await read("src/lib/netsuite/mark-complete.ts");
  // The old assumption — `assemblies.length === 0` alone — made a Direct-only
  // quote unshippable while it demonstrably had products to ship.
  assert.match(
    src,
    /tree\.assemblies\.length === 0 && tree\.directProducts\.length === 0/,
  );
  assert.doesNotMatch(src, /Quote has no assemblies to push/);
});

// ---------------------------------------------------------------- 9
test("the attach writer creates no assembly", async () => {
  const src = await read("src/lib/product-structure/direct-attachment.ts");
  assert.doesNotMatch(src, /insert\(assemblies\)/);
  // No legacy junction either: writing one would make a Direct Product
  // indistinguishable from a member of a one-product group.
  assert.doesNotMatch(src, /insert\(assemblyLeaves\)/);
  assert.match(src, /assemblyId: null/);
});

// --------------------------------------------------- 10 · eligibility gate
test("SKU-less products are refused with the true reason", () => {
  for (const sku of [null, "", "   "]) {
    const verdict = evaluateAttachmentEligibility({ sku, archived: false });
    assert.equal(verdict.attachable, false);
    assert.equal(
      verdict.attachable === false ? verdict.reason : null,
      "missing_sku",
    );
    // Truthful cause, not a generic refusal — the operator must be able to act.
    assert.match(
      verdict.attachable === false ? verdict.message : "",
      /no SKU/,
    );
  }
});

test("archived is reported as archived, not as a SKU problem", () => {
  const verdict = evaluateAttachmentEligibility({ sku: "REAL", archived: true });
  assert.equal(verdict.attachable, false);
  assert.equal(
    verdict.attachable === false ? verdict.reason : null,
    "archived",
  );
});

test("a product with a SKU is attachable", () => {
  assert.deepEqual(
    evaluateAttachmentEligibility({ sku: "SKU-1", archived: false }),
    { attachable: true },
  );
});

test("both attach paths share the one gate", async () => {
  // Two independent copies of this rule would drift, and the drift would be
  // invisible: each path would look correct in isolation.
  for (const file of [
    "src/app/actions/assemblies.ts",
    "src/app/actions/quote-products.ts",
  ]) {
    assert.match(await read(file), /evaluateAttachmentEligibility/);
  }
  // The superseded inline check must be gone, not merely bypassed.
  assert.doesNotMatch(
    await read("src/app/actions/assemblies.ts"),
    /Archived leaves can't be attached/,
  );
});
