import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { checkStructureAgreement } from "../../src/lib/netsuite/frozen-order-assembly.ts";
import type { LiveStructureMember } from "../../src/lib/netsuite/frozen-order-assembly.ts";
import type { FrozenSalesOrderLine } from "../../src/lib/netsuite/frozen-sales-order.ts";

// ═══════════════════════════════════════════════════════════════════════
// The frozen matrix governs what was sold; live structure governs only how an
// already-frozen line is grouped. Both directions of disagreement are checked,
// because each hides a different failure — one bills for something never
// quoted, the other silently drops something that was.
// ═══════════════════════════════════════════════════════════════════════

const frozen = (over: Partial<FrozenSalesOrderLine> = {}): FrozenSalesOrderLine => ({
  sourceLineId: "f1",
  kind: "item_group_member",
  description: "Bottle",
  sku: "DPS-BOTTLE",
  quoteLeafId: "leaf-1",
  owningAssemblyId: "asm-1",
  netsuiteItemId: "500",
  quantity: 1000,
  rate: "2.9000",
  amount: "2900.00",
  ...over,
});

const live = (over: Partial<LiveStructureMember> = {}): LiveStructureMember => ({
  quoteLeafId: "leaf-1",
  sku: "DPS-BOTTLE",
  assemblyId: "asm-1",
  assemblySku: "KIT",
  assemblyName: "Kit",
  qtyPerParent: 1,
  unitCost: 1.2,
  ...over,
});

test("agreement passes when the structure matches the frozen set", () => {
  assert.deepEqual(
    checkStructureAgreement({
      frozenLines: [frozen()],
      liveMembers: [live()],
      tierQty: 1000,
    }),
    [],
  );
});

test("a live product with no frozen line REFUSES — billing for something never quoted", () => {
  const [d] = checkStructureAgreement({
    frozenLines: [frozen()],
    liveMembers: [live(), live({ quoteLeafId: "leaf-2", sku: "DPS-CAP" })],
    tierQty: 1000,
  });
  assert.equal(d.kind, "live_line_not_frozen");
  assert.match(d.detail, /added after the customer accepted/);
});

test("a frozen product missing from the structure REFUSES — silently under-billing", () => {
  const [d] = checkStructureAgreement({
    frozenLines: [frozen(), frozen({ sourceLineId: "f2", quoteLeafId: "leaf-2", description: "Cap" })],
    liveMembers: [live()],
    tierQty: 1000,
  });
  assert.equal(d.kind, "frozen_line_not_in_structure");
  assert.match(d.detail, /removed after acceptance/);
});

test("a RE-KEYED line surfaces as both a missing and an extra", () => {
  // Re-keying needs no special case: the identity that changed is absent on
  // one side and present on the other, so both directions fire.
  const out = checkStructureAgreement({
    frozenLines: [frozen({ quoteLeafId: "old-key" })],
    liveMembers: [live({ quoteLeafId: "new-key" })],
    tierQty: 1000,
  });
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((d) => d.kind).sort(),
    ["frozen_line_not_in_structure", "live_line_not_frozen"],
  );
});

test("a composition change after acceptance REFUSES", () => {
  // Frozen at 1,000 units; the group now contains two of this member, so
  // NetSuite would expand to 2,000 — a quantity the frozen amount was never
  // priced for. Caught here rather than as a REG-4 mismatch later, so the
  // operator is told the composition changed rather than that the maths failed.
  const [d] = checkStructureAgreement({
    frozenLines: [frozen({ quantity: 1000 })],
    liveMembers: [live({ qtyPerParent: 2 })],
    tierQty: 1000,
  });
  assert.equal(d.kind, "quantity_disagrees_with_structure");
  assert.match(d.detail, /1000 × 2 = 2000/);
});

test("OTC and Direct Service lines are not structural and are not compared", () => {
  // They own no leaf and belong to no grouping, so demanding live structure
  // for them would refuse every order that carries a fee.
  assert.deepEqual(
    checkStructureAgreement({
      frozenLines: [
        frozen(),
        frozen({ sourceLineId: "o1", kind: "otc", quoteLeafId: null, sku: null, description: "Setup" }),
        frozen({ sourceLineId: "s1", kind: "direct_service", quoteLeafId: null, sku: null, owningAssemblyId: null, description: "Formulation" }),
      ],
      liveMembers: [live()],
      tierQty: 1000,
    }),
    [],
  );
});

test("a Direct Product participates in the guard like any other product", () => {
  const [d] = checkStructureAgreement({
    frozenLines: [frozen({ kind: "direct_product", owningAssemblyId: null, quoteLeafId: "leaf-9" })],
    liveMembers: [],
    tierQty: 1000,
  });
  assert.equal(d.kind, "frozen_line_not_in_structure");
});

test("live structure supplies only grouping and cost basis, never an amount", async () => {
  const src = await readFile("src/lib/netsuite/frozen-order-assembly.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // LiveStructureMember may carry grouping identity, a multiplier, and
  // unitCost — nothing that could set a sell rate or a line amount.
  assert.doesNotMatch(code, /\brate\b\s*:/);
  assert.doesNotMatch(code, /\bamount\b\s*:/);
  assert.match(code, /unitCost: number \| null;/);
});
