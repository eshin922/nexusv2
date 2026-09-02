/**
 * ONE structural producer for a Sales Order.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────
 *
 * The Sales Order tab built its line list from `view.skus` — the CUSTOMER
 * DOCUMENT — with every line at the tier quantity, under the words "Everything
 * below goes to NetSuite exactly as shown". The send path built something
 * else: for `turnkey_only` it emits Item Group headers and NetSuite expands
 * the members, so O3's ×2 components post at 2,400 while the operator approved
 * a screen showing 1,200.
 *
 * Two producers of one structure, disagreeing at an irreversible boundary —
 * the fourth instance of that shape this corpus has found (#537, #538, #540,
 * #541). The repair is not a preview-shaped second implementation; it is one
 * builder both paths consume.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────
 *
 * Behaviour of the builder from fixtures, and — because "one producer" is a
 * property of the TREE and not of any single call — that the send path has no
 * grouping construction of its own left.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildPlannedSalesOrder,
  type LiveStructureEntry,
} from "../../src/lib/netsuite/planned-sales-order.ts";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ASM = "asm-1";
const CUSTOMER = "388800";
const TIER_QTY = 1200;

/** O3's five members, with its real multiplicity. */
const MEMBERS = [
  { leaf: "leaf-bottle", sku: "TRN-PP-BOTTLE-30", ns: "76155", qpp: 2, rate: 1.91 },
  { leaf: "leaf-pump", sku: "TRN-PP-PUMP", ns: "76156", qpp: 2, rate: 0.9 },
  { leaf: "leaf-label", sku: "TRN-SP-LABEL", ns: "76157", qpp: 2, rate: 0.29 },
  { leaf: "leaf-sleeve", sku: "TRN-SP-SLEEVE", ns: "76161", qpp: 1, rate: 2.78 },
  { leaf: "leaf-giftbox", sku: "TRN-SP-GIFTBOX", ns: "76162", qpp: 1, rate: 5.17 },
];

function live(over: Partial<Record<string, number>> = {}) {
  const m = new Map<string, LiveStructureEntry>();
  for (const x of MEMBERS) {
    m.set(x.leaf, {
      child: { sku: x.sku, name: x.sku },
      assembly: { name: "Gift Set" },
      assemblyId: ASM,
      assemblySku: "TRN-GIFTSET-DUO",
      assemblyName: "Gift Set",
      qtyPerParent: over[x.leaf] ?? x.qpp,
      unitCost: 1,
    });
  }
  return m;
}

const frozenMembers = MEMBERS.map((x, i) => ({
  sourceLineId: `f${i}`,
  kind: "item_group_member" as const,
  description: x.sku,
  sku: x.sku,
  quoteLeafId: x.leaf,
  owningAssemblyId: ASM,
  destination: null,
  netsuiteItemId: x.ns,
  quantity: TIER_QTY,
  rate: String(x.rate),
  amount: String(x.rate * TIER_QTY),
}));

const frozenOtc = {
  sourceLineId: "otc1",
  kind: "otc" as const,
  description: "Tooling",
  sku: null,
  quoteLeafId: "leaf-bottle",
  owningAssemblyId: null,
  destination: "otc_tooling",
  netsuiteItemId: "90001",
  quantity: 1,
  rate: "7680",
  amount: "7680",
};

const build = (opts: {
  detailLevel: "itemized" | "turnkey_only";
  qppOver?: Partial<Record<string, number>>;
  members?: typeof frozenMembers;
}) =>
  buildPlannedSalesOrder({
    detailLevel: opts.detailLevel,
    customerNetsuiteId: CUSTOMER,
    tierQty: TIER_QTY,
    frozenLines: [...(opts.members ?? frozenMembers), frozenOtc] as never,
    liveByLeafId: live(opts.qppOver ?? {}),
    accountingCostFor: () => 1,
  });

// ══════════════════════════════════════════════════════════════════════
// itemized — unchanged
// ══════════════════════════════════════════════════════════════════════

test("itemized · no Group span; every product stands on its own line", () => {
  const p = build({ detailLevel: "itemized" });
  assert.equal(p.groupingRequired, false);
  assert.deepEqual(p.plan.groups, []);
  assert.deepEqual(
    p.rows.map((r) => r.role),
    ["direct", "direct", "direct", "direct", "direct", "accounting"],
  );
});

test("itemized · product quantities are the tier quantity, unexpanded", () => {
  const p = build({ detailLevel: "itemized" });
  for (const r of p.rows) {
    if (r.role === "direct") assert.equal(r.line.quantity, TIER_QTY);
  }
});

// ══════════════════════════════════════════════════════════════════════
// turnkey_only — the Group span, and the expansion
// ══════════════════════════════════════════════════════════════════════

test("turnkey_only · Group -> members -> EndGroup, in that order", () => {
  const p = build({ detailLevel: "turnkey_only" });
  assert.equal(p.groupingRequired, true);
  assert.deepEqual(
    p.rows.map((r) => r.role),
    ["group", "member", "member", "member", "member", "member", "end_group", "accounting"],
  );
});

test("turnkey_only · the Group line carries the accepted tier quantity", () => {
  const p = build({ detailLevel: "turnkey_only" });
  const g = p.rows.find((r) => r.role === "group");
  assert.equal(g?.role === "group" && g.quantity, TIER_QTY);
  assert.equal(g?.role === "group" && g.sku, "TRN-GIFTSET-DUO");
});

test("turnkey_only · ×2 members expand to tierQty × qtyPerParent", () => {
  // THE FACT THE OPERATOR APPROVES, and the one the customer-view receipt
  // could not show: NetSuite computes it from the Group definition, so it is
  // in no payload line and can only come from the plan.
  const p = build({ detailLevel: "turnkey_only" });
  const byS = new Map(
    p.rows.filter((r) => r.role === "member").map((r: any) => [r.sku, r]),
  );
  assert.equal(byS.get("TRN-PP-BOTTLE-30")!.quantity, 2400);
  assert.equal(byS.get("TRN-PP-PUMP")!.quantity, 2400);
  assert.equal(byS.get("TRN-SP-LABEL")!.quantity, 2400);
  assert.equal(byS.get("TRN-SP-SLEEVE")!.quantity, 1200);
  assert.equal(byS.get("TRN-SP-GIFTBOX")!.quantity, 1200);
  // The definition multiplier travels with it, so the expansion is legible
  // rather than an unexplained number.
  assert.equal(byS.get("TRN-PP-BOTTLE-30")!.qtyPerParent, 2);
  assert.equal(byS.get("TRN-SP-SLEEVE")!.qtyPerParent, 1);
});

test("turnkey_only · accounting lines accompany the group, never inside it", () => {
  const p = build({ detailLevel: "turnkey_only" });
  const roles = p.rows.map((r) => r.role);
  assert.ok(roles.indexOf("accounting") > roles.indexOf("end_group"));
  assert.equal(p.accountingLines.length, 1);
  assert.equal(p.accountingLines[0].quantity, 1, "an OTC is quantity 1 by construction");
});

// ══════════════════════════════════════════════════════════════════════
// The identity is deterministic, and moves only when the composition does
// ══════════════════════════════════════════════════════════════════════

test("the Group is named by its deterministic EXTERNAL id, before any provider", () => {
  const p = build({ detailLevel: "turnkey_only" });
  const g: any = p.rows.find((r) => r.role === "group");
  assert.match(g.externalId, /^nxs-grp-[0-9a-f]{64}$/);
  assert.match(g.compositionHash, /^[0-9a-f]{64}$/);
  // And no internal id is invented. That is the provider's, and it is the one
  // field a preview legitimately cannot fill.
  assert.ok(!("netsuiteInternalId" in g));
});

test("changing qty/parent changes BOTH the expansion and the Group identity", () => {
  // One builder, so a definition change cannot move the preview without moving
  // the send plan — that divergence is the whole defect.
  const a = build({ detailLevel: "turnkey_only" });
  const b = build({ detailLevel: "turnkey_only", qppOver: { "leaf-sleeve": 3 } });

  const qty = (p: typeof a, sku: string) =>
    (p.rows.find((r: any) => r.role === "member" && r.sku === sku) as any).quantity;
  assert.equal(qty(a, "TRN-SP-SLEEVE"), 1200);
  assert.equal(qty(b, "TRN-SP-SLEEVE"), 3600);

  const ext = (p: typeof a) => (p.rows.find((r) => r.role === "group") as any).externalId;
  assert.notEqual(ext(a), ext(b), "a different composition is a different Group");
});

test("changing the frozen composition changes the external identity", () => {
  const full = build({ detailLevel: "turnkey_only" });
  const fewer = build({ detailLevel: "turnkey_only", members: frozenMembers.slice(1) });
  const ext = (p: typeof full) => (p.rows.find((r) => r.role === "group") as any).externalId;
  assert.notEqual(ext(full), ext(fewer));
});

test("the same composition is stable across tier quantity", () => {
  // The hash describes the reusable composition, not this order. A 1,200-unit
  // tier and a 3,000-unit tier of one product mix must resolve to ONE group.
  const a = build({ detailLevel: "turnkey_only" });
  const b = buildPlannedSalesOrder({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty: 3000,
    frozenLines: [...frozenMembers, frozenOtc] as never,
    liveByLeafId: live(),
    accountingCostFor: () => 1,
  });
  const ext = (p: typeof a) => (p.rows.find((r) => r.role === "group") as any).externalId;
  assert.equal(ext(a), ext(b));
});

// ══════════════════════════════════════════════════════════════════════
// The builder is pure, and it is the ONLY producer
// ══════════════════════════════════════════════════════════════════════

test("the builder performs no provider call of any kind", () => {
  // A preview must not create master data because someone opened a tab.
  const src = code("src/lib/netsuite/planned-sales-order.ts");
  for (const forbidden of [
    /findOrCreateItemGroup/,
    /createRecord/,
    /nsRequest/,
    /suiteQL/,
    /getRecord/,
    /from "@\/db"/,
    /drizzle-orm/,
  ]) {
    assert.doesNotMatch(src, forbidden, "the structural builder must not reach a provider or a database");
  }
});

test("the send path constructs no grouping plan of its own", () => {
  // ONE producer is a property of the tree. The send path must consume the
  // builder's plan rather than calling `buildGroupingPlan` a second time — two
  // calls are two answers to "what is this order's structure".
  const mc = code("src/lib/netsuite/mark-complete.ts");
  assert.match(mc, /buildPlannedSalesOrder\(/, "the send path builds through the shared builder");
  assert.match(mc, /const groupingPlan = planned\.plan/, "and takes the plan from it");
  assert.doesNotMatch(
    mc,
    /buildGroupingPlan\(\{/,
    "a second grouping-plan construction reintroduces the divergence",
  );
});

test("exactly one module calls buildGroupingPlan", () => {
  const callers = [
    "src/lib/netsuite/planned-sales-order.ts",
    "src/lib/netsuite/mark-complete.ts",
  ].filter((f) => /buildGroupingPlan\s*\(\s*\{/.test(code(f)));
  assert.deepEqual(
    callers,
    ["src/lib/netsuite/planned-sales-order.ts"],
    "the structural producer is the only constructor of a grouping plan",
  );
});

test("provider resolution stays downstream, and stays narrow", () => {
  // `findOrCreateItemGroup` keeps its place in the irreversible path; its job
  // is planned identity -> internal id, and nothing else.
  const mc = code("src/lib/netsuite/mark-complete.ts");
  assert.match(mc, /findOrCreateItemGroup\(/);
  const built = code("src/lib/netsuite/planned-sales-order.ts");
  assert.doesNotMatch(built, /findOrCreateItemGroup/);
});
