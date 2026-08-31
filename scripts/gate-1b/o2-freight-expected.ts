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
 *
 * ── `treatment` GOVERNS NOTHING IN THIS ARITHMETIC ──────────────────────
 *
 * Traced before authoring, because the expectation below treats both shipments
 * identically and that had to be true rather than assumed:
 *
 *   landed cost              NO. `computeShipmentContribution` never reads
 *                            `treatment`; it reads units, memberCount, the
 *                            three amounts and the three markups. Nothing else.
 *   billable freight         NO. Same function, same inputs.
 *   unit-price contribution  NO. The worksheet loop accumulates the
 *                            contribution without consulting it.
 *   separate-line recovery   NO. Freight is not a `quote_charge_instance`; it
 *                            has no recovery election and no BV-011 destination.
 *   customer presentation    NOT IN V1. `customer-view-resolver.ts:646` emits
 *                            `freightLines: []` UNCONDITIONALLY -- no freight
 *                            line reaches the customer under either treatment.
 *   NetSuite representation  NO. Freight never becomes a Sales Order line; it
 *                            reaches the ERP only inside unit cost.
 *
 * `treatment` therefore survives as a stored FACT with no live consumer. It is
 * carried on the shipment break and on the leg breakdown, and it is displayed
 * on Costs ("bundled · amortised across units"), and that is all it does.
 *
 * ── AND IT IS NOT OPERATOR-SELECTABLE IN V1 ─────────────────────────────
 *
 * `freight-drilldown.tsx:610` emits it as a HIDDEN input echoing the
 * shipment's own persisted value, under OD-001: "choice removed; the
 * shipment's OWN persisted value is echoed back so an edit cannot rewrite it."
 * `createFreightSubcategory` defaults every new shipment to `bundled`.
 *
 * So the corpus requirement "one pass-through treatment and one bundled
 * treatment" CANNOT be authored through the operator workflow. Both O2
 * shipments will be `bundled`, and the expectation below is unaffected either
 * way because the arithmetic does not read the field.
 *
 * The downstream grain where it would govern -- whether a customer ever sees a
 * freight line -- is suppressed UNCONDITIONALLY today, and the suppression
 * cites a conditional reason:
 *
 *     // BV-009: freight remains in commercial costing. WHEN BUNDLED into unit
 *     // price it has no separate customer-facing line...
 *     const freightLines: [] = [];   // <- reads no treatment
 *
 * The stated justification has a condition; the code has none. So a
 * `pass_through` shipment is suppressed by the same literal that suppresses a
 * bundled one, and the admin surface still tells operators the opposite:
 * "Renders on customer view only when freight_treatment = pass_through"
 * (`customer-facing-defaults-form.tsx:209`).
 *
 * BV-009 is the document OD-001 records as HAVING NEVER EXISTED. Recorded as
 * an observation against that open decision -- not repaired here, and not a
 * gap in this expectation, which is about the freight arithmetic.
 */

const TIERS = [
  { label: "Tier 1", units: 800 },
  { label: "Tier 2", units: 2100 },
  { label: "Tier 3", units: 5500 },
];

type Shipment = {
  label: string;
  members: string[];
  /** The destination whose breaks the engine must read. */
  selectedDestination: string;
  freight: number[]; // per tier, on the SELECTED destination
  freightMarkup: number;
  duty?: number[];
  dutyMarkup?: number;
  tariff?: number[];
  tariffMarkup?: number;
  /**
   * A second candidate that exists on the shipment and is NOT selected.
   *
   * Frozen here, before staging, so the decoy cannot be chosen to agree with
   * whatever the UI happened to produce. Its amounts differ from the selected
   * candidate's on every tier, so:
   *
   *   - expected economics use the SELECTED candidate only;
   *   - substituting the decoy changes every expected figure;
   *   - changing the SELECTION -- not merely editing an unused row -- is what
   *     moves the governed freight.
   *
   * The third property is the one worth stating: editing a candidate nobody
   * selected must move nothing, and selecting it must move everything.
   */
  decoyDestination: string;
  decoyFreight: number[];
};

const SHIPMENTS: Shipment[] = [
  {
    // International inbound · pass_through · DDP · ocean_fcl · Ningbo → Long Beach
    label: "A · Ningbo → Long Beach (international, DDP, ocean_fcl)",
    members: ["TRN-PP-BOTTLE-30", "TRN-PP-PUMP", "TRN-SP-CARTON"],
    selectedDestination: "Long Beach, CA",
    decoyDestination: "Oakland, CA",
    // Same shipment, different port. Every tier differs from the selected
    // candidate, and by a different proportion, so a decoy substitution cannot
    // be mistaken for a rounding difference.
    decoyFreight: [8967, 15230, 24104],
    freight: [7412, 13905, 26318],
    freightMarkup: 0.18,
    duty: [1163, 2477, 5041],
    dutyMarkup: 0.07,
    tariff: [634, 1388, 2913],
    tariffMarkup: 0.11,
  },
  {
    // Domestic onward · bundled · FCA · ltl_truck · Long Beach → Reno
    label: "B · Long Beach → Reno (domestic, FCA, ltl_truck)",
    members: ["TRN-SP-LABEL"],
    selectedDestination: "Reno, NV",
    decoyDestination: "Sparks, NV",
    decoyFreight: [1601, 2318, 6045],
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

console.log("\n\nFROZEN DESTINATION CANDIDATES");
for (const s of SHIPMENTS) {
  console.log(`  ${s.label}`);
  console.log(`    SELECTED   ${s.selectedDestination.padEnd(16)} ${s.freight.join(" / ")}`);
  console.log(`    decoy      ${s.decoyDestination.padEnd(16)} ${s.decoyFreight.join(" / ")}`);
}

console.log("\nWHAT THE DECOY PROVES — expected freight cost per tier, both ways");
TIERS.forEach((t, i) => {
  const sel = SHIPMENTS.reduce((a, s) => a + s.freight[i], 0);
  const dec = SHIPMENTS.reduce((a, s) => a + s.decoyFreight[i], 0);
  const moved = Math.abs(sel - dec) > 0.005;
  console.log(
    `  ${t.label}  selected ${sel.toFixed(2)}  ·  if decoy were read ${dec.toFixed(2)}` +
      `  ·  ${moved ? `MOVES by ${(dec - sel).toFixed(2)}` : "NO MOVEMENT — decoy is useless"}`,
  );
});
console.log(
  "\n  Editing an unselected candidate must move NOTHING.\n" +
    "  Changing the SELECTION must move the freight to the figures above.\n" +
    "  Both are checked against the live quote after authoring.",
);
process.exit(0);
