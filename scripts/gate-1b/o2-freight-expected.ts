/**
 * Order 2 · Import Programme — INDEPENDENT expected freight values.
 *
 * Imports NOTHING from `src/lib/costing`. The arithmetic below is written from
 * the governed contract, not borrowed from the implementation, so agreement
 * between this and the engine is evidence rather than a tautology.
 *
 * The contract, from `computeShipmentContribution` + the shipment-break loader:
 *
 *     perUnit(amount) = amount / memberCount / tierUnits
 *     billable        = perUnit(amount) x (1 + that amount's own markup)
 *     total           = freight + duty + tariff, each per unit
 *
 * Only the SELECTED destination's breaks are read. A shipment with no recorded
 * members contributes nothing and blocks the send.
 *
 * Values are deliberately non-symmetric: no two markups equal, member counts
 * differ (3 vs 1), tier quantities are non-round, and no amount is a round
 * multiple of a tier. A swapped field, a duplicated component or a markup
 * applied to the wrong fact cannot reconcile by accident.
 */

const TIERS = [
  { label: "Tier 1", units: 800 },
  { label: "Tier 2", units: 2100 },
  { label: "Tier 3", units: 5500 },
];

type Shipment = {
  label: string;
  members: string[];
  freight: number[]; // per tier
  freightMarkup: number;
  duty?: number[];
  dutyMarkup?: number;
  tariff?: number[];
  tariffMarkup?: number;
};

const SHIPMENTS: Shipment[] = [
  {
    // International inbound · pass_through · DDP · ocean_fcl · Ningbo → Long Beach
    label: "A · Ningbo → Long Beach (international, pass-through)",
    members: ["TRN-PP-BOTTLE-30", "TRN-PP-PUMP", "TRN-SP-CARTON"],
    freight: [7412, 13905, 26318],
    freightMarkup: 0.18,
    duty: [1163, 2477, 5041],
    dutyMarkup: 0.07,
    tariff: [634, 1388, 2913],
    tariffMarkup: 0.11,
  },
  {
    // Domestic onward · bundled · FCA · ltl_truck · Long Beach → Reno
    label: "B · Long Beach → Reno (domestic, bundled)",
    members: ["TRN-SP-LABEL"],
    freight: [1286, 2704, 5192],
    freightMarkup: 0.26,
  },
];

const money = (n: number) => n.toFixed(6);

console.log("ORDER 2 · INDEPENDENT EXPECTED FREIGHT\n");
console.log("tiers: " + TIERS.map((t) => `${t.label} ${t.units}u`).join(" · "));

// Per-member, per-tier contributions.
const perLeaf = new Map<string, { cost: number; billable: number }[]>();

for (const s of SHIPMENTS) {
  console.log(`\n${s.label}`);
  console.log(`  members ${s.members.length}: ${s.members.join(", ")}`);
  console.log(
    `  markups — freight ${s.freightMarkup}` +
      (s.dutyMarkup !== undefined ? ` · duty ${s.dutyMarkup}` : "") +
      (s.tariffMarkup !== undefined ? ` · tariff ${s.tariffMarkup}` : ""),
  );
  TIERS.forEach((t, i) => {
    const div = s.members.length * t.units;
    const fC = s.freight[i] / div;
    const dC = (s.duty?.[i] ?? 0) / div;
    const tC = (s.tariff?.[i] ?? 0) / div;
    const fB = fC * (1 + s.freightMarkup);
    const dB = dC * (1 + (s.dutyMarkup ?? 0));
    const tB = tC * (1 + (s.tariffMarkup ?? 0));
    console.log(
      `  ${t.label}  entered F=${s.freight[i]} D=${s.duty?.[i] ?? 0} T=${s.tariff?.[i] ?? 0}` +
        `  ÷ ${s.members.length} members ÷ ${t.units} units`,
    );
    console.log(
      `           cost/unit  F=${money(fC)} D=${money(dC)} T=${money(tC)}  total=${money(fC + dC + tC)}`,
    );
    console.log(
      `           billable   F=${money(fB)} D=${money(dB)} T=${money(tB)}  total=${money(fB + dB + tB)}`,
    );
    for (const m of s.members) {
      const cur = perLeaf.get(m) ?? TIERS.map(() => ({ cost: 0, billable: 0 }));
      cur[i] = { cost: cur[i].cost + fC + dC + tC, billable: cur[i].billable + fB + dB + tB };
      perLeaf.set(m, cur);
    }
  });
}

console.log("\n\nEXPECTED PER-LEAF LANDED FREIGHT (what the engine must produce)");
console.log("leaf                  " + TIERS.map((t) => t.label.padStart(24)).join(""));
for (const [leaf, rows] of [...perLeaf].sort()) {
  console.log(
    leaf.padEnd(22) +
      rows.map((r) => `${money(r.cost)}/${money(r.billable)}`.padStart(24)).join(""),
  );
}

console.log("\nEXPECTED QUOTE-LEVEL FREIGHT TOTAL PER TIER (cost, then billable)");
console.log("  Each shipment's ENTERED amounts enter the quote exactly once:");
TIERS.forEach((t, i) => {
  let cost = 0;
  let bill = 0;
  for (const s of SHIPMENTS) {
    const div = s.members.length * t.units;
    const fC = s.freight[i] / div;
    const dC = (s.duty?.[i] ?? 0) / div;
    const tC = (s.tariff?.[i] ?? 0) / div;
    // x memberCount x units returns the whole entered amount — the check that
    // freight enters economics exactly once, neither dropped nor doubled.
    cost += (fC + dC + tC) * div;
    bill +=
      (fC * (1 + s.freightMarkup) +
        dC * (1 + (s.dutyMarkup ?? 0)) +
        tC * (1 + (s.tariffMarkup ?? 0))) *
      div;
  }
  const entered =
    SHIPMENTS.reduce(
      (a, s) => a + s.freight[i] + (s.duty?.[i] ?? 0) + (s.tariff?.[i] ?? 0),
      0,
    );
  console.log(
    `  ${t.label}  reconstructed cost ${cost.toFixed(2)}  vs entered ${entered.toFixed(2)}` +
      `  ${Math.abs(cost - entered) < 0.005 ? "MATCH" : "DIVERGE"}   billable ${bill.toFixed(2)}`,
  );
});

console.log(
  "\nDECOY: each subcategory carries a second, UNSELECTED destination candidate\n" +
    "with different amounts. If the engine reads the unselected one, every figure\n" +
    "above moves. That is the point of the decoy.",
);
process.exit(0);
