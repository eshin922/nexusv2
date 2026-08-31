import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LINE_KIND_DESTINATION,
  SERVICE_IDENTITY_DESTINATION,
  bv011ItemType,
} from "../../src/lib/netsuite/bv011-destinations.ts";
import { resolvesBySku } from "../../src/lib/netsuite/line-kind-resolution.ts";
import { emitAccountingLines } from "../../src/lib/netsuite/accounting-line-emitter.ts";

// ═══════════════════════════════════════════════════════════════════════
// THE ITEM GROUP'S COMMERCIAL LINE.
//
// Two Item Group identities, and they must not be confused:
//
//   STRUCTURAL  frozen composition → composition hash → findOrCreateItemGroup
//               → a NetSuite Group that opens a span of member lines. UNPRICED:
//               the header carries a quantity and no sell value, proven against
//               SO2715/SO2716 where `rate` and `netamount` are NULL on it.
//
//   COMMERCIAL  frozen kind `item_group` → destination `item_group_production`
//               → IGP-0001. PRICED: it carries that group's own production,
//               its governed markup, and the recovery of charges elected
//               Included.
//
// DPS-1072 was refused by REG-4 because the second had nowhere to go: emitted
// lines came to $42,668.50 against a frozen accepted total of $66,556.00,
// short by exactly the $23,887.50 the Item Group owns.
// ═══════════════════════════════════════════════════════════════════════

test("the commercial line resolves by destination, never by SKU", () => {
  // `TRN-SERUM-30` is never posted as a priced line. Its SKU belongs to the
  // structural identity, which reaches NetSuite as a Group, not as a line.
  assert.equal(resolvesBySku("item_group"), false);
  assert.equal(LINE_KIND_DESTINATION.item_group, "item_group_production");
});

test("the destination is governed by KIND, the way a service is governed by identity", () => {
  // One map entry, beside the existing identity-derived authority — not a
  // special case inside the resolver. A branch in readiness would be a second
  // authority for a question this map answers.
  assert.equal(Object.keys(LINE_KIND_DESTINATION).length, 1);
  assert.equal(SERVICE_IDENTITY_DESTINATION.formulation, "otc_formulation");
  assert.equal(bv011ItemType("item_group_production"), "non_inventory");
});

test("readiness derives it from the kind rather than exempting it", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // Reached through the same `destination` resolution every other line uses,
  // so the unmapped-destination blocker applies to it unchanged.
  assert.match(src, /LINE_KIND_DESTINATION as Record<string, Bv011Destination \| undefined>/);
  // And it is NOT skipped as a product.
  assert.match(src, /if \(resolvesBySku\(line\.kind\)\) \{/);
});

test("a missing IGP mapping BLOCKS the push", async () => {
  // The line has a governed destination, so an unmapped destination is a real
  // blocker with an actionable remediation — the opposite of the unfollowable
  // "revise and re-send" it used to produce.
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  assert.match(src, /kind: "unmapped_destination"/);
  assert.match(src, /has no NetSuite item mapped\. Add it in Settings → NetSuite/);
});

// ── THE POSTED SHAPE ─────────────────────────────────────────────────────

const line = (over: Record<string, unknown> = {}) => ({
  sourceLineId: "L1",
  kind: "item_group" as const,
  owningAssemblyId: "asm",
  displayName: "TRAINING · Hydra Serum 30ml",
  destination: "item_group_production" as const,
  netsuiteItemId: "76160",
  netsuiteItemCode: "IGP-0001",
  amountCents: 2388750,
  quantity: 6000,
  unitRate: "3.9812",
  ...over,
});

test("it posts at its own quantity and rate, not as 1 × the amount", () => {
  // The failure this prevents: folded into the one-time-charge shape it would
  // post quantity 1 at $23,887.50. The amount would match and the commercial
  // statement would not — an order that reconciles while saying something the
  // customer never accepted.
  const [emitted] = emitAccountingLines([line()] as never);
  assert.equal(emitted.quantity, 6000);
  assert.equal(Number(emitted.rate), 3.98125);
  assert.equal(emitted.amountCents, 2388750);
  assert.equal(Number(emitted.rate) * emitted.quantity, 23887.5);
});

test("a one-time charge still posts as 1 × its amount", () => {
  // The other half of the branch, so widening it did not widen it too far.
  const [otc] = emitAccountingLines([
    line({ kind: "otc", amountCents: 1603000, quantity: null, unitRate: null }),
  ] as never);
  assert.equal(otc.quantity, 1);
  assert.equal(Number(otc.rate), 16030);
});

test("it refuses rather than guessing when the frozen shape is incomplete", () => {
  // Same discipline the Direct Service branch already had: a unit-priced line
  // missing its quantity or rate is an upstream invariant break, and posting a
  // quantity-1 charge instead would look like success.
  assert.throws(
    () => emitAccountingLines([line({ quantity: null })] as never),
    /missing its frozen quantity or unit rate/,
  );
});

test("the emitter branches on the SHAPE, not on one kind that has it", async () => {
  const src = await readFile("src/lib/netsuite/accounting-line-emitter.ts", "utf8");
  assert.match(src, /line\.kind === "direct_service" \|\| line\.kind === "item_group"/);
  // Named for the shape so the next kind to need it is not added as a second
  // condition on a name that stopped describing the set.
  assert.match(src, /UNIT-PRICED, not "is it a service"/);
});

test("the kind survives to the emitted order rather than being flattened", async () => {
  const src = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  assert.doesNotMatch(
    src,
    /kind: \(byId\.get\(l\.sourceLineId\)\?\.kind === "direct_service"\s*\?\s*"direct_service"\s*:\s*"otc"\)/,
    "collapsing to otc would lose the distinction the emitter just used",
  );
  assert.match(src, /\| "item_group";/);
});
