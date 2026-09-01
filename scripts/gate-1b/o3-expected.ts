/**
 * Order 3 · Retail Gift Set — INDEPENDENT frozen expectation.
 *
 * Written BEFORE the scenario is authored, so agreement between this and the
 * system is evidence rather than a tautology. It imports the composition-hash
 * primitive — deliberately, because the hash IS the contract under test and
 * re-implementing SHA-256 here would test my re-implementation — but every
 * INPUT to it is stated below rather than read from a quote, and every
 * economic figure is computed from the frozen constants alone.
 *
 * O3 carries TWO primary subjects. They are frozen separately because they
 * fail separately.
 *
 * ── A · turnkey_only NetSuite Group path ─────────────────────────────────
 *
 * `detail_level = turnkey_only`, so OD-004 REQUIRES grouping. This is the
 * first corpus order to exercise it: O1 and O2 were itemized, where OD-004
 * forbids it, and the seven historical grouped Sales Orders predate the
 * corpus.
 *
 * The load-bearing thing O1 could not prove is MULTIPLICITY through the ERP
 * boundary. NetSuite expands a group line as
 *
 *     member absolute qty = group-line qty x member DEFINITION qty
 *
 * and a definition quantity of 2 is therefore only visible in the readback,
 * not in anything Nexus sends. Three members carry qty/parent 2 here.
 *
 * ── B · component-owned one-time charges ─────────────────────────────────
 *
 * Frozen at (chargeInstanceId, owner) grain, not at charge-key grain. The
 * matrix exists to prove Recovery does NOT collapse by key: two `print_plates`
 * instances sit on different owners with DIFFERENT recovery treatments, so a
 * system that keyed recovery by charge type would have to give them the same
 * answer and would fail visibly.
 *
 * TWO VOCABULARIES, one intent. The `treatment` values below are the
 * `recovery_treatment` enum -- the FROZEN INSTRUCTION vocabulary, which is what
 * `quote_snapshot_recovery_instructions` carries and therefore what a reader of
 * the accepted record sees. The live ELECTION table `quote_charge_recovery`
 * uses a different enum for the same decisions:
 *
 *     instruction `unit_price`    <->  election `included`
 *     instruction `separate_line` <->  election `separate`
 *     instruction `absorbed`      <->  election `absorbed`
 *
 * Verified 2026-08-31 by electing all four through the operator surface and
 * reading both tables. A verifier comparing an election directly against the
 * strings below will report a false failure; map first.
 *
 * O1's four charges were `owner_quote_leaf_id IS NULL` with zero per-tier rows
 * — the legacy production-column path. This is the component-charge path's
 * first exercise.
 */

import {
  computeCompositionHash,
  externalIdForHash,
  type CompositionHashInput,
} from "@/lib/netsuite/composition-hash";
import { componentChargeMarkupAuthority } from "@/lib/commercial-recovery/registry";

const money = (n: number) => n.toFixed(2);

// ════════════════════════════════════════════════════════════════════════
// FROZEN INPUTS
// ════════════════════════════════════════════════════════════════════════

/** Deliberately not O2's 800/2100/5500 — a gift set is a lower-volume line. */
const TIERS = [
  { label: "Tier 1", units: 500 },
  { label: "Tier 2", units: 1200 },
  { label: "Tier 3", units: 3000 },
];

const CUSTOMER_NETSUITE_ID = "388800"; // ZZ-VALIDATION certification customer
const GROUP_SKU = "TRN-GIFTSET-DUO";
const GROUP_NAME = "TRAINING · Retail Gift Set (duo)";

/**
 * Members in FROZEN ordinal order — the order the operator attaches them and
 * the order the Sales Order must show inside the Group span.
 *
 * `qtyPerParent` is the DEFINITION quantity. Three members carry 2: a duo set
 * holds two filled bottles, so two pumps and two labels come with them. That
 * is a real gift-set structure, not a contrivance to reach multiplicity.
 *
 * `netsuiteItemId` VERIFIED against the sandbox, not assumed. The hash is over
 * those ids, so it could not be computed until the two new items existed —
 * which is why master data was created first and the hash frozen here, still
 * before the thing that depends on it (the Group) exists. An expectation
 * carrying a guessed item id would be an expectation about nothing.
 *
 * 76161 / 76162 were created with the configuration COPIED from TRN-SP-LABEL
 * (76157): subsidiary 2, taxSchedule 2 Non Taxable, income 218 / asset 211 /
 * cogs 212, InvtPart, FIFO. Verified by readback after creation. Divergent
 * item setup would make O3's readback measure my item configuration rather
 * than Nexus.
 */
const MEMBERS: {
  ordinal: number;
  sku: string;
  name: string;
  qtyPerParent: number;
  netsuiteItemId: string | null;
  isNew: boolean;
}[] = [
  { ordinal: 1, sku: "TRN-PP-BOTTLE-30", name: "TRAINING · 30ml Bottle", qtyPerParent: 2, netsuiteItemId: "76155", isNew: false },
  { ordinal: 2, sku: "TRN-PP-PUMP", name: "TRAINING · Pump Closure", qtyPerParent: 2, netsuiteItemId: "76156", isNew: false },
  { ordinal: 3, sku: "TRN-SP-LABEL", name: "TRAINING · Label Set", qtyPerParent: 2, netsuiteItemId: "76157", isNew: false },
  { ordinal: 4, sku: "TRN-SP-SLEEVE", name: "TRAINING · Printed Sleeve", qtyPerParent: 1, netsuiteItemId: "76161", isNew: true },
  { ordinal: 5, sku: "TRN-SP-GIFTBOX", name: "TRAINING · Rigid Gift Box", qtyPerParent: 1, netsuiteItemId: "76162", isNew: true },
];

/**
 * Per-member packaging unit cost, per tier. Non-symmetric by construction: no
 * two equal, none a round multiple of a tier, so a swapped column or a value
 * attached to the wrong member cannot reconcile by accident.
 */
const UNIT_COST: Record<string, [number, number, number]> = {
  "TRN-PP-BOTTLE-30": [1.4820, 1.3160, 1.1740],
  "TRN-PP-PUMP": [0.6935, 0.6180, 0.5510],
  "TRN-SP-LABEL": [0.2380, 0.1960, 0.1615],
  "TRN-SP-SLEEVE": [0.8145, 0.7290, 0.6425],
  "TRN-SP-GIFTBOX": [2.9450, 2.6180, 2.3315],
};

/** Markup category per member, and therefore its rate. */
const CATEGORY: Record<string, { category: string; markup: number }> = {
  "TRN-PP-BOTTLE-30": { category: "Primary", markup: 0.45 },
  "TRN-PP-PUMP": { category: "Primary", markup: 0.45 },
  "TRN-SP-LABEL": { category: "Secondary", markup: 0.5 },
  "TRN-SP-SLEEVE": { category: "Secondary", markup: 0.5 },
  "TRN-SP-GIFTBOX": { category: "Secondary", markup: 0.5 },
};

/**
 * The charge matrix, at (instance, owner) grain.
 *
 * Instances 1 and 2 are the load-bearing pair: SAME charge type, DIFFERENT
 * owners, DIFFERENT recovery treatments. A Recovery implementation that keyed
 * by charge type would be forced to give them one answer.
 *
 * Instance 3 keeps the test from being solely about duplicate print plates,
 * and 4 adds a second markup CATEGORY so the charge-type -> category authority
 * is exercised rather than assumed constant.
 */
const CHARGES = [
  { id: "C1", owner: "TRN-SP-LABEL", type: "print_plates", treatment: "separate_line", cost: [1240, 1240, 1860] },
  { id: "C2", owner: "TRN-SP-SLEEVE", type: "print_plates", treatment: "unit_price", cost: [1685, 1685, 2530] },
  { id: "C3", owner: "TRN-PP-BOTTLE-30", type: "tooling", treatment: "separate_line", cost: [6400, 6400, 6400] },
  { id: "C4", owner: "TRN-SP-GIFTBOX", type: "samples", treatment: "unit_price", cost: [780, 1150, 1940] },
] as const;

// ════════════════════════════════════════════════════════════════════════
console.log("ORDER 3 · RETAIL GIFT SET — FROZEN EXPECTATION\n");
console.log(`  customer   ${CUSTOMER_NETSUITE_ID}`);
console.log(`  group      ${GROUP_SKU} — ${GROUP_NAME}`);
console.log(`  detail     turnkey_only  (OD-004: grouping REQUIRED)`);
console.log(`  tiers      ${TIERS.map((t) => `${t.label} ${t.units}u`).join(" · ")}`);

// ── A1 · membership and multiplicity ────────────────────────────────────
console.log("\n── A1 · MEMBERSHIP (frozen ordinal order) ─────────────────");
console.log("  #  sku                  qty/parent  ns item   new?");
for (const m of MEMBERS) {
  console.log(
    `  ${m.ordinal}  ${m.sku.padEnd(20)} ${String(m.qtyPerParent).padStart(9)}  ` +
      `${(m.netsuiteItemId ?? "PENDING").padEnd(8)}  ${m.isNew ? "NEW" : "existing"}`,
  );
}
const multiplicity = MEMBERS.filter((m) => m.qtyPerParent > 1);
console.log(`\n  members with qty/parent > 1: ${multiplicity.length} (${multiplicity.map((m) => m.sku).join(", ")})`);
console.log("  This is what O1 could not prove — a definition quantity is");
console.log("  invisible in what Nexus sends and only appears on readback.");

// ── A2 · expanded absolute quantities ───────────────────────────────────
console.log("\n── A2 · EXPECTED EXPANSION (NetSuite computes these) ──────");
console.log("     member absolute qty = group-line qty x definition qty\n");
console.log("  sku                  " + TIERS.map((t) => t.label.padStart(12)).join(""));
console.log("  GROUP LINE QTY       " + TIERS.map((t) => String(t.units).padStart(12)).join(""));
for (const m of MEMBERS) {
  console.log(
    "  " + m.sku.padEnd(20) +
      TIERS.map((t) => String(t.units * m.qtyPerParent).padStart(12)).join(""),
  );
}

// ── A3 · composition hash ───────────────────────────────────────────────
console.log("\n── A3 · COMPOSITION IDENTITY ──────────────────────────────");
const pending = MEMBERS.filter((m) => m.netsuiteItemId === null);
if (pending.length > 0) {
  console.log(`  NOT YET COMPUTABLE — ${pending.length} member(s) have no NetSuite item id:`);
  for (const m of pending) console.log(`    ${m.sku}`);
  console.log("");
  console.log("  The hash is over {customerNetsuiteId, baseSku, members:[{netsuiteItemId,");
  console.log("  quantity}]}, so it cannot be stated before those items exist. Create the");
  console.log("  master data first, fill the ids in above, and re-run. Guessing an id");
  console.log("  would freeze an expectation about nothing.");
} else {
  const hashInput: CompositionHashInput = {
    customerNetsuiteId: CUSTOMER_NETSUITE_ID,
    baseSku: GROUP_SKU,
    // Sorted by netsuiteItemId ascending — the canonical order. Stated here so
    // the frozen input is the canonical one rather than relying on the
    // primitive to sort it.
    members: [...MEMBERS]
      .sort((a, b) => String(a.netsuiteItemId).localeCompare(String(b.netsuiteItemId)))
      .map((m) => ({ netsuiteItemId: String(m.netsuiteItemId), quantity: m.qtyPerParent })),
  };
  const hash = computeCompositionHash(hashInput);
  console.log("  hash input (canonical):");
  console.log("    customer  " + hashInput.customerNetsuiteId);
  console.log("    baseSku   " + hashInput.baseSku);
  for (const m of hashInput.members) {
    console.log(`    member    ${m.netsuiteItemId} x ${m.quantity}`);
  }
  console.log(`\n  composition hash  ${hash}`);
  console.log(`  externalId        ${externalIdForHash(hash)}`);
  console.log("");
  console.log("  REUSE: resolving this same composition again must return the SAME");
  console.log("  group and create no second one. Falsification — changing any ONE");
  console.log("  input must change the hash:");
  const variants: [string, CompositionHashInput][] = [
    ["different customer", { ...hashInput, customerNetsuiteId: "999999" }],
    ["different baseSku", { ...hashInput, baseSku: "TRN-GIFTSET-SOLO" }],
    ["qty/parent 2 -> 1", {
      ...hashInput,
      members: hashInput.members.map((m, i) => (i === 0 ? { ...m, quantity: 1 } : m)),
    }],
    ["member dropped", { ...hashInput, members: hashInput.members.slice(1) }],
  ];
  for (const [label, v] of variants) {
    const h = computeCompositionHash(v);
    console.log(`    ${label.padEnd(20)} ${h === hash ? "SAME — CONTROL IS USELESS" : "differs ✓"}`);
  }
  // Sort-agnostic: reordering must NOT change it.
  const reordered = { ...hashInput, members: [...hashInput.members].reverse() };
  console.log(
    `    ${"members reordered".padEnd(20)} ${
      computeCompositionHash(reordered) === hash ? "same ✓ (order-independent)" : "DIFFERS — WRONG"
    }`,
  );
}

// ── A4 · expected Sales Order structure ─────────────────────────────────
console.log("\n── A4 · EXPECTED SO STRUCTURE (per accepted tier) ─────────");
console.log("  Group header      TRN-GIFTSET-DUO   qty = tier qty, NO sell value");
for (const m of MEMBERS) {
  console.log(`    member ${m.ordinal}        ${m.sku.padEnd(20)} own rate, qty = tier x ${m.qtyPerParent}`);
}
console.log("  EndGroup          rolls up members; carries no independent economics");
console.log("  IGP line          group-owned production economics, per #523");
console.log("\n  Arithmetic alone is NOT sufficient here. Flat members summing to the");
console.log("  same total would reconcile and misrepresent the accepted structure.");

// ── B · charge matrix ───────────────────────────────────────────────────
console.log("\n── B · COMPONENT-OWNED CHARGES (instance x owner grain) ───");
console.log("  id  owner                type          category       mk    treatment");
for (const c of CHARGES) {
  const auth = componentChargeMarkupAuthority(c.type);
  const cat = auth.kind === "governed" ? auth.category : "UNCLASSIFIED";
  const mk = cat === "Tooling" ? 0.2 : cat === "Manufacturing" ? 0.3 : NaN;
  console.log(
    `  ${c.id}  ${c.owner.padEnd(20)} ${c.type.padEnd(13)} ${cat.padEnd(14)} ` +
      `${mk.toFixed(2)}  ${c.treatment}`,
  );
}

console.log("\n  cost and expected recovery revenue, per tier:");
console.log("  id  " + TIERS.map((t) => `${t.label} cost/revenue`.padStart(24)).join(""));
const recoveryByTier = [0, 0, 0];
const separateByTier = [0, 0, 0];
const unitPriceByTier = [0, 0, 0];
for (const c of CHARGES) {
  const auth = componentChargeMarkupAuthority(c.type);
  const cat = auth.kind === "governed" ? auth.category : null;
  const mk = cat === "Tooling" ? 0.2 : cat === "Manufacturing" ? 0.3 : 0;
  const cells = TIERS.map((_, i) => {
    const cost = c.cost[i];
    const revenue = cost * (1 + mk);
    recoveryByTier[i] += revenue;
    if (c.treatment === "separate_line") separateByTier[i] += revenue;
    else unitPriceByTier[i] += revenue;
    return `${money(cost)}/${money(revenue)}`.padStart(24);
  });
  console.log(`  ${c.id}  ` + cells.join(""));
}
console.log("  " + "-".repeat(76));
console.log("  ALL " + TIERS.map((_, i) => money(recoveryByTier[i]).padStart(24)).join(""));
console.log("  SEP " + TIERS.map((_, i) => money(separateByTier[i]).padStart(24)).join(""));
console.log("  UP  " + TIERS.map((_, i) => money(unitPriceByTier[i]).padStart(24)).join(""));

// ── B2 · the collapse falsification ─────────────────────────────────────
console.log("\n── B2 · RECOVERY MUST NOT COLLAPSE BY CHARGE KEY ─────────");
const byKey = new Map<string, typeof CHARGES[number][]>();
for (const c of CHARGES) byKey.set(c.type, [...(byKey.get(c.type) ?? []), c]);
for (const [key, instances] of byKey) {
  if (instances.length < 2) continue;
  const treatments = new Set(instances.map((i) => i.treatment));
  console.log(
    `  "${key}" has ${instances.length} instances on ${new Set(instances.map((i) => i.owner)).size} owners, ` +
      `${treatments.size} distinct treatment(s)`,
  );
  for (const i of instances) console.log(`    ${i.id}  ${i.owner.padEnd(20)} ${i.treatment}`);
  console.log(
    treatments.size > 1
      ? "    → a key-collapsing implementation CANNOT satisfy both. This is the control."
      : "    → SAME treatment: this pair proves nothing. Fix the matrix.",
  );
}

console.log("\n── MASTER DATA REQUIRED ───────────────────────────────────");
console.log("  Reused unchanged: TRN-PP-BOTTLE-30, TRN-PP-PUMP, TRN-SP-LABEL");
console.log("  New, and only because a gift set genuinely has them:");
console.log("    TRN-SP-SLEEVE    printed outer sleeve — the second print-plate owner");
console.log("    TRN-SP-GIFTBOX   rigid gift box — distinct from a folding unit carton");
console.log("");
console.log("  NOT created: a second bottle/pump/label under an O3 name, and no");
console.log("  tertiary master carton — a shipper's identity belongs to O5's spec");
console.log("  subject and adding it here would serve no O3 objective.");
console.log("  TRN-SP-CARTON is not a member: a duo gift box replaces the unit carton.");

console.log("");
process.exit(0);
