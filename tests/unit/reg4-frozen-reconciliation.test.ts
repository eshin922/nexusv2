import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

import {
  checkLinkA,
  checkLinkB,
  exactRateTimesQuantity,
} from "../../src/lib/netsuite/reg4.ts";
import type { Reg4Line } from "../../src/lib/netsuite/reg4.ts";

// ═══════════════════════════════════════════════════════════════════════
// REG-4 — the emitted order sums exactly to the frozen accepted total.
//
// The interesting half is link B, because the multiplication it guards is
// performed by NETSUITE, not by us. `SalesOrderLine` sends quantity and rate
// and no amount, so "never recompute rate × qty" cannot be enforced by
// declining to multiply — it can only be enforced by checking that their
// product reproduces the frozen amount, and refusing when it does not.
// ═══════════════════════════════════════════════════════════════════════

const line = (over: Partial<Reg4Line> = {}): Reg4Line => ({
  sourceLineId: "l1",
  description: "Setup",
  quantity: 1,
  rate: "140.00",
  amount: "140.00",
  ...over,
});

// ── exact decimal arithmetic ─────────────────────────────────────────────

test("quantity × rate is exact decimal arithmetic, not float", () => {
  // 2.1750 × 5000 = 10875.00 exactly. In floats 2.175 * 5000 is 10874.999…
  const r = exactRateTimesQuantity("2.1750", 5000);
  assert.equal(r.cents, 1087500);
  assert.equal(r.exact, true);

  assert.deepEqual(exactRateTimesQuantity("1.2600", 1000), { cents: 126000, exact: true });
  assert.deepEqual(exactRateTimesQuantity("0.0001", 10000), { cents: 100, exact: true });
});

test("a rate × quantity landing on a fraction of a cent is reported, not rounded", () => {
  // 0.0001 × 5 = 0.0005 — half a cent. Rounding it here would invent money.
  const r = exactRateTimesQuantity("0.0001", 5);
  assert.equal(r.exact, false, "must be flagged rather than silently rounded");
});

// ── link A ───────────────────────────────────────────────────────────────

test("link A holds when the frozen lines sum to the frozen total", () => {
  const failures = checkLinkA(
    [
      line({ amount: "2900.00" }),
      line({ sourceLineId: "l2", amount: "4200.00" }),
      line({ sourceLineId: "l3", amount: "140.00" }),
    ],
    "7240.00",
  );
  assert.deepEqual(failures, []);
});

test("link A fails on a one-cent disagreement and names both figures", () => {
  const [f] = checkLinkA([line({ amount: "7239.99" })], "7240.00");
  assert.equal(f.kind, "link_a_mismatch");
  assert.match(f.detail, /\$7239\.99/);
  assert.match(f.detail, /\$7240\.00/);
  assert.match(f.detail, /nothing was posted/);
});

// ── link B ───────────────────────────────────────────────────────────────

test("link B holds when the emitted lines sum to the frozen total", () => {
  const failures = checkLinkB(
    [
      line({ quantity: 1000, rate: "2.9000", amount: "2900.00" }),
      line({ sourceLineId: "l2", quantity: 1, rate: "140.00", amount: "140.00" }),
    ],
    304000,
  );
  assert.deepEqual(failures, []);
});

test("link B fails when the emitted set is SHORT — the OTC-dropped shape", () => {
  // The exact failure F1/F4 exists to fix: an order missing its separately
  // billed OTC still reconciles to its own short sum, so only a comparison
  // against the FROZEN total catches it.
  const [f] = checkLinkB(
    [line({ quantity: 1000, rate: "2.9000", amount: "2900.00" })],
    304000,
  );
  assert.equal(f.kind, "link_b_mismatch");
  assert.match(f.detail, /\$290000\.00|\$2900\.00/);
  assert.match(f.detail, /nothing was posted/);
});

test("ONE CENT is a failure — REG-4 admits no tolerance", () => {
  // The sharpest form of the property, and the one a value test misses: the
  // earlier link-B case differs by $140, so introducing `Math.abs(diff) > 1`
  // passed every assertion in this file. A tolerance is precisely where a real
  // discrepancy hides, so the smallest possible gap has to refuse.
  const [f] = checkLinkB([line({ quantity: 1, rate: "0.99", amount: "0.99" })], 100);
  assert.equal(f.kind, "link_b_mismatch", "1c short must refuse");

  const [g] = checkLinkB([line({ quantity: 1, rate: "1.01", amount: "1.01" })], 100);
  assert.equal(g.kind, "link_b_mismatch", "1c over must refuse too");
});

test("link B refuses a line whose quantity × rate misses its frozen amount", () => {
  // NetSuite would compute 3 × 0.3333 = 0.9999 and post 1.00; the frozen
  // amount says 1.00 too, but the product is not a whole number of cents, so
  // the agreement is luck rather than arithmetic.
  const failures = checkLinkB(
    [line({ quantity: 3, rate: "0.3333", amount: "1.00" })],
    100,
  );
  const f = failures.find((x) => x.kind === "rate_times_quantity_inexact");
  assert.ok(f, "an inexact product must be refused");
  assert.match(f.detail, /NetSuite computes amount as quantity × rate/);
});

test("link B refuses a line whose product is exact but WRONG", () => {
  // 2 × 5.00 = 10.00, but the frozen amount says 12.00. The sum could still
  // be made to balance by another line; the per-line check catches it anyway.
  const failures = checkLinkB([line({ quantity: 2, rate: "5.00", amount: "12.00" })], 1200);
  const f = failures.find((x) => x.kind === "rate_times_quantity_inexact");
  assert.ok(f);
  assert.match(f.detail, /not the frozen \$12\.00/);
});

test("a quantity-1 line is safe by construction", () => {
  // rate equals amount, so NetSuite's multiplication cannot introduce anything.
  for (const amt of ["140.00", "0.01", "123456.78", "700.00"]) {
    const failures = checkLinkB(
      [line({ quantity: 1, rate: amt, amount: amt })],
      Number(amt.replace(".", "")),
    );
    assert.deepEqual(
      failures.filter((f) => f.kind === "rate_times_quantity_inexact"),
      [],
      `${amt} should need no tolerance`,
    );
  }
});

// ── ordering, which is the actual safety property ────────────────────────

test("every refusal precedes any NetSuite call — the builder makes none", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  // Not a claim about intent. The module cannot post: it has no client, makes
  // no request, and returns lines for a caller to send. A refusal therefore
  // cannot arrive too late, because nothing has been sent.
  assert.doesNotMatch(src, /nsRequest|createRecord|createSalesOrder|suiteQL|fetch\(/);
});

test("the provisional refusal comes from readiness, before link A or emission", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  const readinessAt = src.indexOf("assessProjectionReadiness(quoteId, exec)");
  const linkAAt = src.indexOf("checkLinkA(");
  const emitAt = src.indexOf("emitAccountingLines(");
  assert.ok(readinessAt > 0 && linkAAt > 0 && emitAt > 0);
  assert.ok(readinessAt < linkAAt, "readiness runs before link A");
  assert.ok(linkAAt < emitAt, "link A runs before anything is emitted");

  const readiness = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  assert.match(readiness, /kind: "provisional_tier"/);
  assert.match(readiness, /quoted as a provisional total/);
});

test("provenance writes no commercial column", async () => {
  const src = await readFile("src/lib/netsuite/posting-provenance.ts", "utf8");
  // Pattern 52 keeps the frozen commercial columns immutable. `netsuite_item_id`
  // is not one — it records what happened to a line after the send, like
  // `pdf_url`. Asserting the negative because a stray column in that `set`
  // would be silent.
  const sets = [...src.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  assert.equal(sets.length, 1);
  assert.match(sets[0], /netsuiteItemId: line\.postedNetsuiteItemId/);
  for (const commercial of [
    "unitRate",
    "lineAmount",
    "pricingState",
    "tierCommercialTotal",
    "displayName",
    "selectedNetsuiteItemId",
  ]) {
    assert.ok(!sets[0].includes(commercial), `provenance must not write ${commercial}`);
  }
});

test("intent and actual are separate columns, so a disagreement is visible", async () => {
  const src = await readFile("src/lib/netsuite/posting-provenance.ts", "utf8");
  assert.match(src, /findProvenanceDisagreements/);
  assert.match(src, /r\.selected !== r\.posted/);
  // A null `selected` is not a disagreement — it is the normal state for every
  // destination that resolves from the firm mapping, and reporting it would
  // produce noise on every push.
  assert.match(src, /\(r\.selected \?\? ""\)\.trim\(\) !== ""/);
});

// ── every commercial line comes from the frozen matrix ───────────────────

// `codeOnly` moved to tests/support so the cutover checks share one
// definition of what counts as present in the code.

test("there is no escape hatch for a second commercial line source", async () => {
  const src = codeOnly(
    await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8"),
  );

  // `additionalLines` existed here briefly and was removed. A reconciliation is
  // only as exact as its least-controlled half, so an order taking service
  // lines from the frozen column and product lines from a caller would
  // reconcile against whichever half the check happened to cover — the shape
  // that let the OTC gap survive in the first place.
  assert.doesNotMatch(src, /additionalLines/);

  // The only inputs are a quote id, an executor, and a SKU resolver. None of
  // them can carry an amount.
  const signature = src.slice(
    src.indexOf("export async function buildFrozenSalesOrder"),
    src.indexOf("): Promise<FrozenSalesOrder>"),
  );
  assert.match(signature, /quoteId: string/);
  assert.match(signature, /exec\?: Exec; resolveSku: SkuResolver/);
  assert.doesNotMatch(signature, /amount|line|Line/);
});

test("product amounts come from the frozen row, never from live costing", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  // Quantity and amount are read off the frozen row.
  assert.match(src, /const amount = row\.amount \?\? "0";/);
  assert.match(src, /const quantity = row\.quantity \?\? 1;/);
  // The RATE is no longer read — it is derived from the frozen amount, so the
  // number NetSuite multiplies reproduces the accepted figure exactly. Reading
  // `unit_rate` is what carried the freeze's rounding error onto the order.
  assert.match(src, /derivePostedRate\(amount, quantity\)/);
  assert.doesNotMatch(src, /rate: row\.rate/, "the stored rate is read again");
  // A rate that cannot reproduce the amount blocks the push; it never posts.
  assert.match(src, /kind: "product_rate_unrepresentable"/);
  // And the module cannot reach the costing tree at all.
  assert.doesNotMatch(src, /getCostingBundle|computeQuoteCosting|skuRollups|costing-adapter/);
});

test("a product line is resolved by SKU-match, and refuses rather than guessing", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  assert.match(src, /await opts\.resolveSku\(sku\)/);
  // Ambiguity is a catalog problem. Picking a match would post the wrong item
  // silently, which is worse than a blocked push.
  assert.match(src, /kind: "product_item_unresolved"/);
  assert.match(src, /Ambiguity is a catalog problem/);
  assert.doesNotMatch(src, /matches\[0\]|\.matches\.find/);
});

test("every line kind has exactly one resolver, and the sets are disjoint", async () => {
  const builder = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  const readiness = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");

  // Products resolve in the builder (a NetSuite round trip); services and fees
  // resolve in readiness (DB-decidable). Neither resolves the other's kinds.
  assert.match(builder, /row\.kind !== "item_group_member" && row\.kind !== "direct_product"/);
  assert.doesNotMatch(builder, /netsuiteDestinationItemMap/);
  assert.doesNotMatch(readiness, /resolveSku|resolveItem/);

  // Readiness skips products explicitly rather than by omission -- now through
  // the shared classification rather than a literal. The literal listed only
  // the two kinds that existed when it was written, and did not grow when
  // OD-028 added `item_group`; see `netsuite-line-kind-resolution` for the
  // blocker that caused and the guard that prevents a third instance.
  assert.match(readiness, /if \(resolvesBySku\(line\.kind\)\) \{/);
});

test("the emitted order is in frozen position order", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  // Products and fees resolve on different paths, so without a re-sort the
  // order would read grouped by how Nexus resolves rather than like the
  // document the customer received.
  assert.match(src, /const position = new Map\(frozen\.map\(\(r, i\) => \[r\.sourceLineId, i\]/);
  assert.match(src, /\.sort\(/);
});

// ── REG-4 over the order NetSuite actually calculates ────────────────────

import { checkPostGroupingReg4 } from "../../src/lib/netsuite/reg4-post-grouping.ts";

test("a grouped order reconciles on the EXPANDED member quantities", () => {
  // 1,000 groups, each containing 2 bottles at $2.90 → 2,000 × 2.90 = $5,800.
  // Checking the pre-group representation would have compared 1,000 × 2.90.
  const failures = checkPostGroupingReg4({
    groups: [
      {
        groupQuantity: 1000,
        members: [
          {
            sourceLineId: "m1",
            description: "Bottle",
            netsuiteItemId: "1",
            qtyPerGroup: 2,
            rate: "2.9000",
            frozenAmount: "5800.00",
          },
        ],
      },
    ],
    flatLines: [],
    frozenAcceptedTotal: "5800.00",
  });
  assert.deepEqual(failures, []);
});

test("a member priced as if the group were NOT expanded is refused", () => {
  // The failure a pre-group check cannot see: the frozen amount is for 1,000
  // units but NetSuite will expand to 2,000 and bill twice.
  const [f] = checkPostGroupingReg4({
    groups: [
      {
        groupQuantity: 1000,
        members: [
          {
            sourceLineId: "m1",
            description: "Bottle",
            netsuiteItemId: "1",
            qtyPerGroup: 2,
            rate: "2.9000",
            frozenAmount: "2900.00",
          },
        ],
      },
    ],
    flatLines: [],
    frozenAcceptedTotal: "2900.00",
  });
  assert.equal(f.kind, "rate_times_quantity_inexact");
  assert.match(f.detail, /1000 × 2 = 2000 units/);
});

test("groups, Direct Products and quantity-1 charges all reach the total", () => {
  const failures = checkPostGroupingReg4({
    groups: [
      {
        groupQuantity: 1000,
        members: [
          { sourceLineId: "m1", description: "Bottle", netsuiteItemId: "1", qtyPerGroup: 1, rate: "2.9000", frozenAmount: "2900.00" },
        ],
      },
    ],
    flatLines: [
      { sourceLineId: "d1", description: "Direct Product", netsuiteItemId: "2", quantity: 1000, rate: "1.0000", frozenAmount: "1000.00" },
      { sourceLineId: "s1", description: "Formulation", netsuiteItemId: "3", quantity: 1, rate: "4200.00", frozenAmount: "4200.00" },
      { sourceLineId: "o1", description: "Setup", netsuiteItemId: "4", quantity: 1, rate: "140.00", frozenAmount: "140.00" },
    ],
    frozenAcceptedTotal: "8240.00",
  });
  assert.deepEqual(failures, []);
});

test("a missing OTC line shows up as a total mismatch, not a silent pass", () => {
  // Drop the $140 Setup from the emitted set. Every remaining line is
  // internally correct — only the comparison against the FROZEN total catches
  // it. This is the F1/F4 defect, expressed post-grouping.
  const [f] = checkPostGroupingReg4({
    groups: [
      {
        groupQuantity: 1000,
        members: [
          { sourceLineId: "m1", description: "Bottle", netsuiteItemId: "1", qtyPerGroup: 1, rate: "2.9000", frozenAmount: "2900.00" },
        ],
      },
    ],
    flatLines: [],
    frozenAcceptedTotal: "3040.00",
  });
  assert.equal(f.kind, "link_b_mismatch");
  assert.match(f.detail, /Difference -\$140\.00/);
  assert.match(f.detail, /nothing was posted/);
});

test("ONE CENT post-grouping is a failure too", () => {
  const [f] = checkPostGroupingReg4({
    groups: [],
    flatLines: [
      { sourceLineId: "a", description: "X", netsuiteItemId: "1", quantity: 1, rate: "0.99", frozenAmount: "0.99" },
    ],
    frozenAcceptedTotal: "1.00",
  });
  assert.equal(f.kind, "link_b_mismatch");
});

test("an expansion landing on a fraction of a cent refuses rather than rounding", () => {
  // 3 groups × 1 member at 0.3333 = 0.9999. NetSuite would round to $1.00 and
  // the order would drift from the frozen record by a cent per line.
  const [f] = checkPostGroupingReg4({
    groups: [
      {
        groupQuantity: 3,
        members: [
          { sourceLineId: "m1", description: "Odd", netsuiteItemId: "1", qtyPerGroup: 1, rate: "0.3333", frozenAmount: "1.00" },
        ],
      },
    ],
    flatLines: [],
    frozenAcceptedTotal: "1.00",
  });
  assert.equal(f.kind, "rate_times_quantity_inexact");
  assert.match(f.detail, /a fraction of a cent/);
});
