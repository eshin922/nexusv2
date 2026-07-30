// Round 6.1 — Bulk Raw section + raws-mode + dual yield reconcile.
// Fixtures live separately from data.js so the original Round 6 file stays
// intact and reviewable; page.jsx merges them at runtime.
//
// Schema additions:
// - raws_mode: enum {dps_sources, cm_sources, customer_supplies}
//   Drives whether Bulk Raw contributes to the cost stack at all.
// - section.deposit: {pct, paid_pct, outstanding} per (section, scenario)
//   Slice 12 / writeback stub — section-row rollup only.
// - bulk_raw: parallel section to packaging/production/freight.
//   Lines are CATEGORIES; each category has ingredient sub-lines.
//   Lines have native_unit (kg | L | mL) + native_cost (per native_unit) +
//   usage_per_filled_unit (qty of native_unit consumed per filled bottle).
//   Per-unit cost = native_cost × usage_per_filled_unit.
//   markup_pct lives on the category (not ingredient).
// - production reconcile splits:
//   Production yield: actual_units_produced vs. tier units
//   Formula yield: mass_consumed_vs_ordered (procurement waste) AND
//                  mass_consumed_vs_theoretical (fill efficiency)

window.NXR6_1 = {

  raws_mode_options: [
    {
      key: "dps_sources",
      label: "DPS sources raws",
      desc: "We buy the raws and bill the customer. Bulk Raw section is active and rolls into the cost stack.",
      consequence: "RAW row visible in cost stack",
    },
    {
      key: "cm_sources",
      label: "CM sources raws",
      desc: "The contract manufacturer sources raws and bills us through their service line. We don't track raw costs separately.",
      consequence: "Bulk Raw inactive — costs roll into PROD",
    },
    {
      key: "customer_supplies",
      label: "Customer supplies raws",
      desc: "Customer provides raws to the CM. Zero raw cost in our quote.",
      consequence: "Bulk Raw inactive — no cost contribution",
    },
  ],

  // Per-state default mode
  raws_mode_default: {
    empty: "dps_sources",
    inProgress: "dps_sources",
    singleComplete: "dps_sources",
  },

  // Section-rollup deposit data (Slice 12 stub).
  // Per (state, section): pct charged at PO, paid_pct against that, outstanding $.
  // Outstanding is a $ figure shown on the section header.
  // For PKG and PROD existing in NXR6.packaging/production fixtures, the deposits
  // here apply only when state is "inProgress" or "singleComplete".
  deposits: {
    inProgress: {
      packaging:  { pct: 0.50, paid_pct: 0.50, outstanding_total: 0,    invoiced: true,  invoice_id: "INV-2418-PKG-01" },
      production: { pct: 0.30, paid_pct: 0.00, outstanding_total: 4860, invoiced: false, invoice_id: null },
      bulk_raw:   { pct: 0.50, paid_pct: 0.00, outstanding_total: 5240, invoiced: false, invoice_id: null },
    },
    singleComplete: {
      packaging:  { pct: 0.50, paid_pct: 1.00, outstanding_total: 0,    invoiced: true,  invoice_id: "INV-2418-PKG-01" },
      production: { pct: 0.30, paid_pct: 1.00, outstanding_total: 0,    invoiced: true,  invoice_id: "INV-2418-PROD-01" },
      bulk_raw:   { pct: 0.50, paid_pct: 1.00, outstanding_total: 0,    invoiced: true,  invoice_id: "INV-2418-RAW-01" },
    },
    empty: {
      packaging:  null, production: null, bulk_raw: null,
    },
  },

  // Bulk Raw fixtures, parallel to packaging/production/freight.
  // Each "line" is a CATEGORY of raws. Categories have ingredient sub-lines.
  // Category cost = sum of ingredient (native_cost × usage_per_filled_unit).
  // Per-tier unit cost = category cost (raws cost doesn't tier on volume the
  // same way packaging/production does — bulk discounts come from supplier
  // breaks, modeled as different unit_cost values per tier on the ingredient).
  bulk_raw: {
    inProgress: {
      status: "in_progress",
      owner: "Purchasing",
      total_t2: 0.32,
      categories: [
        {
          id: "rc_1", name: "Oil base",
          markup_pct: 0.25,
          ingredients: [
            { id: "rc_1_i1", name: "Jojoba oil (refined)",     native_unit: "kg", native_cost: 18.40, usage_per_filled_unit: 0.012, hts_code: "1515.90.80" },
            { id: "rc_1_i2", name: "Squalane (olive-derived)", native_unit: "kg", native_cost: 42.00, usage_per_filled_unit: 0.008, hts_code: "2901.10.50" },
          ],
        },
        {
          id: "rc_2", name: "Active complex",
          markup_pct: 0.40,
          ingredients: [
            { id: "rc_2_i1", name: "Niacinamide (PC)",           native_unit: "kg", native_cost: 32.00, usage_per_filled_unit: 0.0015 },
            { id: "rc_2_i2", name: "Bakuchiol 1.0%",             native_unit: "kg", native_cost: 380.00, usage_per_filled_unit: 0.0010 },
            { id: "rc_2_i3", name: "Hyaluronic acid (LMW)",      native_unit: "kg", native_cost: 220.00, usage_per_filled_unit: 0.0008 },
          ],
        },
        {
          id: "rc_3", name: "Fragrance",
          markup_pct: 0.30,
          ingredients: [
            { id: "rc_3_i1", name: "Custom fragrance LMN-04", native_unit: "kg", native_cost: 145.00, usage_per_filled_unit: 0.0009, supplier: "Symrise" },
          ],
        },
        {
          id: "rc_4", name: "Preservative system",
          markup_pct: 0.30,
          ingredients: [
            { id: "rc_4_i1", name: "Phenoxyethanol",     native_unit: "kg", native_cost: 14.00, usage_per_filled_unit: 0.0024 },
            { id: "rc_4_i2", name: "Ethylhexylglycerin", native_unit: "kg", native_cost: 36.00, usage_per_filled_unit: 0.0006 },
          ],
        },
      ],
    },
    empty: {
      status: "empty", owner: "Purchasing", total_t2: null, categories: [],
    },
    singleComplete: {
      status: "complete", owner: "Purchasing", total_t2: 0.30,
      categories: [
        {
          id: "rc_s1", name: "Oil base",
          markup_pct: 0.25,
          ingredients: [
            { id: "rc_s1_i1", name: "Jojoba oil (refined)",     native_unit: "kg", native_cost: 18.40, usage_per_filled_unit: 0.011 },
            { id: "rc_s1_i2", name: "Squalane (olive-derived)", native_unit: "kg", native_cost: 42.00, usage_per_filled_unit: 0.007 },
          ],
        },
        {
          id: "rc_s2", name: "Active + preservative",
          markup_pct: 0.35,
          ingredients: [
            { id: "rc_s2_i1", name: "Niacinamide (PC)",  native_unit: "kg", native_cost: 32.00, usage_per_filled_unit: 0.0014 },
            { id: "rc_s2_i2", name: "Phenoxyethanol",    native_unit: "kg", native_cost: 14.00, usage_per_filled_unit: 0.0024 },
          ],
        },
      ],
    },
  },

  // Formula yield reconcile data — only meaningful in singleComplete state.
  formula_yield: {
    inProgress: {
      mass_ordered_kg: null,
      mass_consumed_kg: null,
      mass_theoretical_kg: null,
      yield_locked: false,
    },
    singleComplete: {
      // Customer ordered 12,000 units. Theoretical formula mass for 12,000 fills
      // at 0.0245 kg/unit = 294 kg. We ordered 320 kg (10% safety stock).
      // Actually consumed 308 kg (some over-fill). Produced 11,200 units
      // (production yield loss).
      mass_ordered_kg: 320,
      mass_consumed_kg: 308,
      mass_theoretical_kg: 274.4, // 11200 × 0.0245
      yield_locked: true,
    },
    empty: {
      mass_ordered_kg: null, mass_consumed_kg: null, mass_theoretical_kg: null, yield_locked: false,
    },
  },
};
