/**
 * The Sales Order receipt renders the order that will actually be sent.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────
 *
 * The receipt built its own line set from `CustomerView`: every SKU at
 * `carriedTier.qty`. That is correct only when nothing expands. NetSuite
 * expands an Item Group member to `group quantity x member definition
 * quantity`, so O3's Bottle at 2 per set bills 2,400 against a 1,200-unit
 * order — and the receipt said 1,200 for all five lines.
 *
 * Nothing was false enough to notice. Both halves were internally consistent
 * and they described different orders, which is the shape the one-producer
 * rule exists to remove: `buildPlannedSalesOrder` is the only thing that
 * decides structure, the push sends what it returns, and the receipt renders
 * the same rows.
 *
 * ── WHY THESE ARE SOURCE ASSERTIONS ─────────────────────────────────────
 *
 * The guarantee is an ABSENCE — no second grouping implementation, no
 * arithmetic that could reconstruct a member quantity, no write from opening
 * the tab. An absence cannot be demonstrated by rendering one case; it has to
 * be asserted over the whole module. The behavioural half is
 * `planned-sales-order.test.ts`, which owns what the rows should BE.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/** Comments stripped, so an assertion cannot match prose about the code. */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .split(String.fromCharCode(13))
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const RECEIPT = "src/components/quote-umbrella/order-receipt.tsx";
const TAB = "src/components/quote-umbrella/tab-sales-order.tsx";
const PAGE = "src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx";

const receipt = code(RECEIPT);
const tab = code(TAB);
const page = code(PAGE);

// ══════════════════════════════════════════════════════════════════════
// One producer
// ══════════════════════════════════════════════════════════════════════

test("the receipt renders planned rows, and holds no line model of its own", () => {
  assert.match(receipt, /structure\.rows\.map\(/);
  assert.match(receipt, /kind: "planned";/);
  // The CustomerView-derived props are GONE, not merely unused. Leaving them
  // accepted-but-ignored is how a second source comes back: a future caller
  // passes them, nothing fails, and the receipt has two answers again.
  assert.doesNotMatch(receipt, /lines: OrderReceiptLine\[\]/);
  assert.doesNotMatch(receipt, /oneTime: OrderReceiptOneTime\[\]/);
});

test("the tab does not reconstruct structure from CustomerView", () => {
  // The specific defect: `view.skus` mapped at the tier quantity.
  assert.doesNotMatch(
    tab,
    /view\.skus[\s\S]{0,400}qty: carriedTier\.qty/,
    "the tab builds its own line set from CustomerView again",
  );
  assert.match(tab, /salesOrderPreview\.planned\.rows/);
});

test("no second grouping implementation is reachable from the render path", () => {
  // `buildGroupingPlan` is the composition primitive. A renderer that called it
  // would be a second producer of the same structure, free to disagree with the
  // one the push uses.
  for (const [name, src] of [
    ["receipt", receipt],
    ["tab", tab],
  ] as const) {
    assert.doesNotMatch(src, /buildGroupingPlan/, `${name} builds its own grouping plan`);
    assert.doesNotMatch(src, /buildPlannedSalesOrder/, `${name} runs the producer itself`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// No renderer-side expansion arithmetic
// ══════════════════════════════════════════════════════════════════════

test("neither component multiplies a tier quantity by a per-set multiplier", () => {
  // THE forbidden arithmetic. A member's absolute quantity is decided once, by
  // the producer, and rendered verbatim. Recomputing it here is how the two
  // halves drift apart while each looks right on its own.
  for (const [name, src] of [
    ["receipt", receipt],
    ["tab", tab],
  ] as const) {
    for (const shape of [
      /qtyPerParent\s*\*/,
      /\*\s*qtyPerParent/,
      /tierQty\s*\*/,
      /\*\s*tierQty/,
      /carriedTier\.qty\s*\*/,
      /\*\s*carriedTier\.qty/,
      /quantity\s*\*\s*r\.qtyPerParent/,
    ]) {
      assert.doesNotMatch(src, shape, `${name} recomputes an expanded quantity`);
    }
  }
});

test("a member's quantity and amount are rendered as given", () => {
  // Read straight off the row. `row.quantity` is already absolute and
  // `row.amount` is already extended — the producer did both.
  assert.match(receipt, /row\.quantity\.toLocaleString\(\)/);
  assert.match(receipt, /usd\(row\.amount\)/);
  // `qtyPerParent` may be DISPLAYED — stating the factor lets a reader check
  // the quantity beside it — but only as a label, never as an operand.
  assert.match(receipt, /\{row\.qtyPerParent\} per set/);
});

// ══════════════════════════════════════════════════════════════════════
// The two valid states
// ══════════════════════════════════════════════════════════════════════

test("a blocked readiness renders the governed refusal, verbatim", () => {
  // Verbatim, not paraphrased. Readiness owns what an operator is told; a
  // restatement here would be a second, drifting copy of an accounting
  // instruction — the same class of defect as a second grouping implementation.
  assert.match(tab, /reason: salesOrderPreview\.reason/);
  assert.match(receipt, /kind === "unavailable"/);
  assert.match(receipt, /structure\.reason/);
});

test("a blocked readiness renders NO line rows", () => {
  // A plausible structure beside a blocker reads as "this is what will be sent
  // once you clear it", and it would be a different order from the one that
  // eventually goes. The ternary is the guarantee: rows render only on the
  // other branch.
  const block = receipt.slice(receipt.indexOf('structure.kind === "unavailable"'));
  const untilRows = block.slice(0, block.indexOf("structure.rows.map"));
  assert.doesNotMatch(untilRows, /row\.quantity|row\.amount|\.line\./, "a line renders while blocked");
});

test("the totals derive from the same rows as the structure", () => {
  // A receipt showing one order and totalling another is the original defect in
  // a second place.
  assert.match(receipt, /const rows = structure\.kind === "planned" \? structure\.rows : \[\]/);
  assert.doesNotMatch(receipt, /lines\.reduce/);
  assert.doesNotMatch(receipt, /oneTime\.reduce/);
});

test("the confirm dialog counts and totals the planned rows too", () => {
  // It is the last thing read before an irreversible act, so it must not be
  // able to state a different order from the one going.
  assert.match(tab, /const plannedRows = structure\.kind === "planned" \? structure\.rows : \[\]/);
  assert.match(tab, /productLineCount=\{productLineCount\}/);
  assert.match(tab, /oneTimeCount=\{oneTimeCount\}/);
});

// ══════════════════════════════════════════════════════════════════════
// Opening the tab writes nothing
// ══════════════════════════════════════════════════════════════════════

test("rendering the tab cannot create a NetSuite Item Group", () => {
  // The preview loader resolves SKUs and the customer map and stops there.
  // `findOrCreateItemGroup` CREATES, and a preview that called it would make
  // opening a tab a write — an irreversible act performed by looking.
  for (const [name, src] of [
    ["receipt", receipt],
    ["tab", tab],
    ["page", page],
  ] as const) {
    assert.doesNotMatch(src, /findOrCreateItemGroup/, `${name} can create an Item Group`);
  }
  const loader = code("src/lib/netsuite/planned-sales-order-preview.ts");
  assert.doesNotMatch(loader, /findOrCreateItemGroup/, "the preview loader creates an Item Group");
});

test("the preview is resolved server-side, once, and only when one can exist", () => {
  assert.match(page, /loadSalesOrderPreview\(quote\.id\)/);
  assert.match(page, /quote\.status === "accepted" \|\| quote\.status === "complete"/);
  // The client never fetches it itself — that would be a second resolution with
  // its own timing, against a quote that may have moved.
  assert.doesNotMatch(tab, /loadSalesOrderPreview/);
});

test("the caption says what the reader is looking at", () => {
  assert.match(
    readFileSync(RECEIPT, "utf8"),
    /This is the NetSuite order structure Nexus will create\./,
  );
});
