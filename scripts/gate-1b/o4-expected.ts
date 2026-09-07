/**
 * O4 · TRAINING — CONTRACT FILL · the expectation, frozen BEFORE anything exists.
 *
 * ── WHY THIS RUNS FIRST ─────────────────────────────────────────────────
 *
 * The composition hash is the contract under test. Computing it AFTER the
 * order exists would prove only that the system agrees with itself: whatever
 * NetSuite returned would be declared expected. So it is computed here, from
 * master data verified in the sandbox, before a quote, an assembly or a Group
 * exists — and the certification later asserts the ERP produced this value.
 *
 * O3's hash was frozen this way and matched exactly. That is what made it
 * evidence rather than a tautology.
 *
 * ── WHAT O4 IS FOR, AND WHAT IT DELIBERATELY IS NOT ─────────────────────
 *
 * O3 certified the grouped path and component-owned charges. O4 must not
 * re-run that as its subject. Its subject is MIXED STRUCTURE:
 *
 *   an Item Group        ... alongside
 *   a top-level Direct Product    ... alongside
 *   three Direct Services, each with a different identity and destination
 *
 * on ONE order. O1–O3 each exercised a single structural shape. Nothing yet
 * has proved the three coexist — that a Group expands while a Direct Product
 * beside it does not, and that service lines resolve by identity rather than
 * by SKU, in the same transaction.
 *
 * ── AND THE SECOND TOOLING ARM, WHICH IS NOT MANUFACTURED ───────────────
 *
 * `cutting_die -> otc_dies` has unit coverage and no order has ever posted
 * one. O4's Direct Product is TRN-SP-CARTON, a folding carton, and a folding
 * carton is die-cut: a cutting die is the tooling that component actually
 * needs. It is a rider on O4's real subject, not a scenario invented to reach
 * an untested branch — had the Direct Product been a bottle, this would have
 * waited for a carton rather than inventing one.
 *
 * ── THE RECOVERY MIX IS DELIBERATELY UNLIKE O3'S ────────────────────────
 *
 *   O3   4 charges, EVERY ONE owned by an Item Group member
 *        2 separate + 2 included; tooling = mould / collar, separate
 *
 *   O4   2 charges, one owned by a top-level DIRECT PRODUCT — a path no
 *        order has exercised — and one by a Group member
 *        1 separate + 1 included; tooling = cutting die, separate
 *
 * The distinguishing fact is not the count. It is that a charge is owned by
 * something that is not inside a Group, which changes which projection loop
 * produces it and which destination path it takes.
 *
 * READ-ONLY. It computes and prints; it creates nothing, here or in NetSuite.
 */
import { computeCompositionHash, externalIdForHash } from "@/lib/netsuite/composition-hash";
import type { CompositionHashInput } from "@/lib/netsuite/composition-hash";

// ── IDENTITIES, VERIFIED IN THE SANDBOX ────────────────────────────────
//
// Every internal id below was read back from NetSuite on 2026-09-07, not
// assumed. The hash is over these ids, so a wrong one silently produces a
// wrong-but-plausible expectation — the failure this file exists to prevent.
const CUSTOMER = "388800"; // ZZ-VALIDATION Nexus Certification Customer
const PROJECT = "TRAINING · Contract Fill";
const GROUP_BASE_SKU = "TRN-FILL-UNIT";

/** Tier quantities. Deliberately not O3's 500 / 1,200 / 3,000. */
const TIERS = [
  { label: "Tier 1", qty: 2500 },
  { label: "Tier 2", qty: 6000 },
  { label: "Tier 3", qty: 15000 },
];

/**
 * The Item Group's frozen composition.
 *
 * `qtyPerParent` 2 on the label set is the front/back pair — a real
 * multiplicity, so the group still expands rather than being five ones.
 */
const MEMBERS = [
  { sku: "TRN-PP-BOTTLE-30", netsuiteItemId: "76155", qtyPerParent: 1 },
  { sku: "TRN-PP-PUMP", netsuiteItemId: "76156", qtyPerParent: 1 },
  { sku: "TRN-SP-LABEL", netsuiteItemId: "76157", qtyPerParent: 2 },
];

/** Top-level, no parent and no service identity — the Direct Product path. */
const DIRECT_PRODUCT = { sku: "TRN-SP-CARTON", netsuiteItemId: "76158" };

/**
 * Top-level, each carrying a DIFFERENT service identity.
 *
 * A Direct Service resolves by IDENTITY, not by SKU — `SERVICE_IDENTITY_
 * DESTINATION` maps the identity to a BV-011 destination and the destination
 * map supplies the item. Three identities means three different destinations
 * resolving on one order, which is the part no prior order has shown.
 */
const SERVICES = [
  { sku: "SVC-FORMULATION", identity: "formulation", destination: "otc_formulation", item: "OTC-0050", internalId: "59157" },
  { sku: "SVC-FILLING-BLENDING", identity: "filling_blending", destination: "otc_filling", item: "BLD-FILL", internalId: "14525" },
  { sku: "SVC-PACKOUT-ASSEMBLY", identity: "packout_assembly", destination: "otc_packout", item: "OTC-0049", internalId: "76154" },
];

/**
 * The charge matrix.
 *
 * Markup follows the charge TYPE's governed category, never the owner:
 * `tooling` -> Tooling 0.20, `artwork_plate` -> Manufacturing 0.30. Recoveries
 * below are those rates applied, and are stated here so the freeze can be
 * checked against the authored quote rather than derived from it.
 */
const CHARGES = [
  {
    id: "C1",
    owner: DIRECT_PRODUCT.sku,
    ownerPath: "direct product (top-level, no Group)",
    chargeKey: "tooling",
    classification: "cutting_die",
    destination: "otc_dies",
    treatment: "separate",
    markupCategory: "Tooling",
    markup: 0.2,
    cost: [4200, 4200, 4200],
  },
  {
    id: "C2",
    owner: "TRN-SP-LABEL",
    ownerPath: "Item Group member",
    chargeKey: "artwork_plate",
    classification: null,
    destination: "otc_artwork",
    treatment: "included",
    markupCategory: "Manufacturing",
    markup: 0.3,
    cost: [1900, 1900, 2850],
  },
];

// ══════════════════════════════════════════════════════════════════════
console.log("O4 · TRAINING — CONTRACT FILL · FROZEN EXPECTATION");
console.log("");
console.log(`  project        ${PROJECT}`);
console.log(`  customer       ${CUSTOMER} · ZZ-VALIDATION Nexus Certification Customer`);
console.log(`  tiers          ${TIERS.map((t) => `${t.label} ${t.qty.toLocaleString()}`).join(" · ")}`);
console.log("");

console.log("── STRUCTURE ─────────────────────────────────────────────");
console.log(`  Item Group      ${GROUP_BASE_SKU}`);
for (const m of MEMBERS) {
  console.log(`    member        ${m.sku.padEnd(20)} ns=${m.netsuiteItemId}  qty/parent ${m.qtyPerParent}`);
}
console.log(`  Direct Product  ${DIRECT_PRODUCT.sku.padEnd(20)} ns=${DIRECT_PRODUCT.netsuiteItemId}`);
for (const s of SERVICES) {
  console.log(
    `  Direct Service  ${s.sku.padEnd(20)} ${s.identity.padEnd(17)} -> ${s.destination.padEnd(16)} ${s.item} / ${s.internalId}`,
  );
}
console.log("");

console.log("── EXPANDED MEMBER QUANTITIES, PER TIER ──────────────────");
console.log("  (NetSuite expands a member to group qty x qty/parent)");
for (const t of TIERS) {
  const parts = MEMBERS.map((m) => `${m.sku} ${(t.qty * m.qtyPerParent).toLocaleString()}`);
  console.log(`  ${t.label} · group ${t.qty.toLocaleString().padStart(6)}  ->  ${parts.join(" · ")}`);
}
console.log("");
console.log("  The Direct Product does NOT expand: it posts at the tier quantity,");
console.log("  which is the distinction O4 exists to prove holds on one order.");
console.log("");

console.log("── CHARGES ───────────────────────────────────────────────");
for (const c of CHARGES) {
  const rec = c.cost.map((n) => (n * (1 + c.markup)).toFixed(2));
  console.log(`  ${c.id} · ${c.chargeKey}${c.classification ? ` / ${c.classification}` : ""}`);
  console.log(`       owner        ${c.owner} — ${c.ownerPath}`);
  console.log(`       treatment    ${c.treatment}`);
  console.log(`       destination  ${c.destination}`);
  console.log(`       markup       ${c.markupCategory} ${c.markup}`);
  console.log(`       cost         ${c.cost.map((n) => n.toFixed(2)).join(" / ")}`);
  console.log(`       recovery     ${rec.join(" / ")}`);
  console.log(
    `       ERP          ${c.treatment === "separate" ? `one accounting line at ${c.destination}` : "NO separate line — carried in unit price"}`,
  );
}
console.log("");

// ── the composition hash, computed before the Group exists ─────────────
console.log("── COMPOSITION IDENTITY ──────────────────────────────────");
const hashInput: CompositionHashInput = {
  customerNetsuiteId: CUSTOMER,
  baseSku: GROUP_BASE_SKU,
  members: MEMBERS.map((m) => ({
    netsuiteItemId: m.netsuiteItemId,
    quantity: m.qtyPerParent,
  })),
};
const hash = computeCompositionHash(hashInput);
console.log(`  input          ${JSON.stringify(hashInput)}`);
console.log(`  hash           ${hash}`);
console.log(`  externalId     ${externalIdForHash(hash)}`);
console.log("");
console.log("  Over the DEFINITION quantity, never the tier-expanded one — so the");
console.log("  same composition resolves to one Group across every tier.");
console.log("");

// ── falsification: the hash must move when the composition does ────────
console.log("── FALSIFICATION · each input must change the hash ───────");
const variants: Array<[string, CompositionHashInput]> = [
  ["different customer", { ...hashInput, customerNetsuiteId: "999999" }],
  ["different base sku", { ...hashInput, baseSku: "TRN-FILL-UNIT-X" }],
  [
    "one member's qty/parent",
    { ...hashInput, members: hashInput.members.map((m, i) => (i === 2 ? { ...m, quantity: 3 } : m)) },
  ],
  ["a member removed", { ...hashInput, members: hashInput.members.slice(0, 2) }],
  [
    "a member swapped",
    { ...hashInput, members: [...hashInput.members.slice(0, 2), { netsuiteItemId: "76158", quantity: 2 }] },
  ],
];
for (const [what, v] of variants) {
  const h = computeCompositionHash(v);
  console.log(`  ${h === hash ? "FAIL" : "ok  "} ${what.padEnd(24)} ${h.slice(0, 16)}...`);
}
console.log("");
console.log("  And O3's composition must NOT collide with O4's:");
const o3 = computeCompositionHash({
  customerNetsuiteId: CUSTOMER,
  baseSku: "TRN-GIFTSET-DUO",
  members: [
    { netsuiteItemId: "76155", quantity: 2 },
    { netsuiteItemId: "76156", quantity: 2 },
    { netsuiteItemId: "76157", quantity: 2 },
    { netsuiteItemId: "76161", quantity: 1 },
    { netsuiteItemId: "76162", quantity: 1 },
  ],
});
console.log(`  ${o3 === hash ? "FAIL" : "ok  "} O3 hash differs        ${o3.slice(0, 16)}...`);
