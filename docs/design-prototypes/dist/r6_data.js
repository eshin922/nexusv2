// Round 6 data — Cost Build redesign.
// Single page, three sections (Packaging, Production, Freight), summary rows
// with drawer drill-down. Multi-tier as primary axis. Cost stack horizontal at top.
//
// Schema notes:
// - Per-(SKU, tier) for everything cost-related.
// - NULL = "no cost entered at this tier" — never inherited.
// - markup_pct lives on the COMPONENT row (per-component), not per-tier.
// - freight_treatment lives on the FREIGHT LINE (per-line, not section-level).

window.NXR6 = {
  project: {
    id: "P-2418",
    client: "Lumen & Co.",
    deal_name: "Q3 Replenish + Glow Capsule Launch",
    hubspot_stage: "Closed Won — Q3",
    hubspot_synced_at: "07:42 today",
  },

  scenario: {
    id: "sc_primary",
    label: "Primary",
    version: 3,
    status: "draft",
    sku: { code: "GLW-30", name: "Glow Capsule 30ml", anchor: true, units_total: 47000 },
  },

  tiers: [
    { id: "T1", label: "Tier 1", units: 5000,  active: false },
    { id: "T2", label: "Tier 2", units: 10000, active: true  },
    { id: "T3", label: "Tier 3", units: 25000, active: false },
    { id: "T4", label: "Tier 4", units: 50000, active: false },
  ],

  // Cost stack header — per-tier rollup. Same component grammar as Round 2.
  // Each tier is the full stack: PKG / PROD / FRT / D+T (internal-only) / PASS.
  // Numbers below are per-unit dollars at that tier.
  // Multi-tier in-progress (state 2) has Tier 4 mostly empty.
  cost_stack: {
    inProgress: {
      tiers: [
        {
          id: "T1", label: "Tier 1", units: 5000,
          components: [
            { key: "pkg",  label: "PKG",  cost: 1.84, markup: 0.74 },
            { key: "prod", label: "PROD", cost: 0.92, markup: 0.28 },
            { key: "frt",  label: "FRT",  cost: 0.41, markup: 0.08 },
            { key: "dt",   label: "D+T",  cost: 0.18, markup: 0.00, internal: true },
            { key: "pass", label: "PASS", cost: 0.00, markup: 0.00 },
          ],
          subtotal: 4.45, adjustment: 0.00, sell: 4.45,
          margin_pct: 0.318, margin_state: "below_target",
        },
        {
          id: "T2", label: "Tier 2", units: 10000,
          components: [
            { key: "pkg",  label: "PKG",  cost: 1.62, markup: 0.65 },
            { key: "prod", label: "PROD", cost: 0.84, markup: 0.25 },
            { key: "frt",  label: "FRT",  cost: 0.36, markup: 0.07 },
            { key: "dt",   label: "D+T",  cost: 0.16, markup: 0.00, internal: true },
            { key: "pass", label: "PASS", cost: 0.00, markup: 0.00 },
          ],
          subtotal: 3.95, adjustment: 0.00, sell: 3.95,
          margin_pct: 0.358, margin_state: "good", active: true,
        },
        {
          id: "T3", label: "Tier 3", units: 25000,
          components: [
            { key: "pkg",  label: "PKG",  cost: 1.41, markup: 0.56 },
            { key: "prod", label: "PROD", cost: 0.78, markup: 0.23 },
            { key: "frt",  label: "FRT",  cost: 0.31, markup: 0.06 },
            { key: "dt",   label: "D+T",  cost: 0.14, markup: 0.00, internal: true },
            { key: "pass", label: "PASS", cost: 0.00, markup: 0.00 },
          ],
          subtotal: 3.49, adjustment: 0.00, sell: 3.49,
          margin_pct: 0.382, margin_state: "good",
        },
        {
          id: "T4", label: "Tier 4", units: 50000,
          components: [
            { key: "pkg",  label: "PKG",  cost: 1.28, markup: 0.51 },
            { key: "prod", label: "PROD", cost: null, markup: null },
            { key: "frt",  label: "FRT",  cost: null, markup: null },
            { key: "dt",   label: "D+T",  cost: null, markup: null, internal: true },
            { key: "pass", label: "PASS", cost: 0.00, markup: 0.00 },
          ],
          subtotal: null, adjustment: 0.00, sell: null,
          margin_pct: null, margin_state: "incomplete",
        },
      ],
    },
    empty: {
      tiers: [
        { id: "T1", label: "Tier 1", units: 5000,  margin_state: "incomplete", subtotal: null, sell: null, margin_pct: null, components: [] },
        { id: "T2", label: "Tier 2", units: 10000, margin_state: "incomplete", subtotal: null, sell: null, margin_pct: null, active: true, components: [] },
        { id: "T3", label: "Tier 3", units: 25000, margin_state: "incomplete", subtotal: null, sell: null, margin_pct: null, components: [] },
      ],
    },
    singleComplete: {
      tiers: [
        {
          id: "T1", label: "Tier 1", units: 12000,
          components: [
            { key: "pkg",  label: "PKG",  cost: 1.55, markup: 0.62 },
            { key: "prod", label: "PROD", cost: 0.81, markup: 0.24 },
            { key: "frt",  label: "FRT",  cost: 0.34, markup: 0.07 },
            { key: "dt",   label: "D+T",  cost: 0.15, markup: 0.00, internal: true },
            { key: "pass", label: "PASS", cost: 0.00, markup: 0.00 },
          ],
          subtotal: 3.78, adjustment: 0.00, sell: 3.78,
          margin_pct: 0.366, margin_state: "good", active: true,
        },
      ],
    },
  },

  // Sections — summary rows. Each row is a component or freight line.
  packaging: {
    inProgress: {
      status: "complete", owner: "Purchasing", line_count: 5, total_t2: 1.62,
      lines: [
        { id: "pl_1", name: "Glass dropper bottle 30ml",   category: "Primary Packaging",       supplier: "Verre Pacific",       markup_pct: 0.40, t1: 0.84, t2: 0.74, t3: 0.62, t4: 0.55, inventory_eligible: true,  notes: null },
        { id: "pl_2", name: "Dropper assembly + insert",   category: "Primary Packaging",       supplier: "Verre Pacific",       markup_pct: 0.40, t1: 0.42, t2: 0.38, t3: 0.32, t4: 0.28, inventory_eligible: true,  notes: "MOQ 2k. Quoted Apr 18." },
        { id: "pl_3", name: "Tamper-evident shrink band",  category: "Secondary - Labels",      supplier: "PrintWorks Co.",      markup_pct: 0.45, t1: 0.18, t2: 0.16, t3: 0.14, t4: 0.13, inventory_eligible: false, notes: null },
        { id: "pl_4", name: "Custom label",                category: "Secondary - Labels",      supplier: "PrintWorks Co.",      markup_pct: 0.45, t1: 0.22, t2: 0.20, t3: 0.18, t4: 0.17, inventory_eligible: false, notes: null },
        { id: "pl_5", name: "Outer carton + insert card",  category: "Secondary - Cards/Booklets", supplier: "PrintWorks Co.",   markup_pct: 0.45, t1: 0.18, t2: 0.14, t3: 0.15, t4: 0.15, inventory_eligible: false, notes: "Card art Apr 22." },
      ],
    },
    empty: {
      status: "empty", owner: "Purchasing", line_count: 0, total_t2: null, lines: [],
    },
    singleComplete: {
      status: "complete", owner: "Purchasing", line_count: 4, total_t2: 1.55,
      lines: [
        { id: "pl_s1", name: "Airless pump bottle 50ml",     category: "Primary Packaging",   supplier: "Verre Pacific",   markup_pct: 0.40, t1: 0.92, inventory_eligible: true, notes: null },
        { id: "pl_s2", name: "Pump head + actuator",         category: "Primary Packaging",   supplier: "Verre Pacific",   markup_pct: 0.40, t1: 0.34, inventory_eligible: true, notes: null },
        { id: "pl_s3", name: "Decoration / silk screen",     category: "Secondary - Labels",  supplier: "PrintWorks Co.",  markup_pct: 0.45, t1: 0.20, inventory_eligible: false, notes: null },
        { id: "pl_s4", name: "Outer carton",                 category: "Secondary - Cards/Booklets", supplier: "PrintWorks Co.", markup_pct: 0.45, t1: 0.09, inventory_eligible: false, notes: null },
      ],
    },
  },

  production: {
    inProgress: {
      status: "in_progress", owner: "Production", total_t2: 0.84,
      customer_ships_raws: false,
      allocate_service_fees_to_unit_cost: true,
      bulk_raw_cost_per_unit: 0.32,
      lines: [
        { id: "pr_1", name: "Filling + capping",        category: "Filling and Packout", supplier: "Marin CM",  markup_pct: 0.32, t1: 0.28, t2: 0.24, t3: 0.21, t4: null, kind: "per_unit" },
        { id: "pr_2", name: "Manual assembly + QC",     category: "Manufacturing",       supplier: "Marin CM",  markup_pct: 0.30, t1: 0.18, t2: 0.16, t3: 0.14, t4: null, kind: "per_unit" },
        { id: "pr_3", name: "Tooling + setup (NRE)",    category: "Tooling",             supplier: "Marin CM",  markup_pct: 0.15, t1: 0.06, t2: 0.04, t3: 0.02, t4: null, kind: "amortized_nre", nre_total: 1800 },
        { id: "pr_4", name: "R&D / stability prequal",  category: "R&D / Testing",       supplier: "Marin CM",  markup_pct: 0.50, t1: 0.04, t2: 0.03, t3: 0.02, t4: null, kind: "amortized_nre", nre_total: 1200 },
      ],
      actual_units_produced: null,
      yield_locked: false,
    },
    empty: {
      status: "empty", owner: "Production", total_t2: null,
      customer_ships_raws: false,
      allocate_service_fees_to_unit_cost: true,
      bulk_raw_cost_per_unit: null,
      lines: [],
      actual_units_produced: null,
      yield_locked: false,
    },
    singleComplete: {
      status: "complete", owner: "Production", total_t2: 0.81,
      customer_ships_raws: false,
      allocate_service_fees_to_unit_cost: true,
      bulk_raw_cost_per_unit: 0.30,
      lines: [
        { id: "pr_s1", name: "Filling + capping",     category: "Filling and Packout", supplier: "Marin CM", markup_pct: 0.32, t1: 0.26, kind: "per_unit" },
        { id: "pr_s2", name: "Assembly + QC",         category: "Manufacturing",       supplier: "Marin CM", markup_pct: 0.30, t1: 0.20, kind: "per_unit" },
        { id: "pr_s3", name: "Tooling + setup (NRE)", category: "Tooling",             supplier: "Marin CM", markup_pct: 0.15, t1: 0.05, kind: "amortized_nre", nre_total: 600 },
      ],
      actual_units_produced: 11200,
      yield_locked: true,
    },
  },

  freight: {
    inProgress: {
      status: "empty", owner: "Logistics", total_t2: 0.36,
      lines: [
        {
          id: "fr_1", label: "Bulk container — Verre Pacific",
          mode: "Ocean FCL", supplier: "Sino Logistics",
          treatment: "bundled",
          incoterm: "DDP",
          customs: { cbm_per_unit: 0.0042, duty_pct: 0.058, tariff_pct: 0.075 },
          tiers: [
            { id: "T1", total_freight: 1820, per_unit: 0.36 },
            { id: "T2", total_freight: 3200, per_unit: 0.32 },
            { id: "T3", total_freight: 6800, per_unit: 0.27 },
            { id: "T4", total_freight: null, per_unit: null },
          ],
        },
        {
          id: "fr_2", label: "Sample / launch shipment — Marin",
          mode: "LTL truck", supplier: "Direct",
          treatment: "pass_through",
          incoterm: "FOB",
          customs: null,
          tiers: [
            { id: "T1", total_freight: 240, per_unit: 0.05 },
            { id: "T2", total_freight: 420, per_unit: 0.04 },
            { id: "T3", total_freight: 920, per_unit: 0.04 },
            { id: "T4", total_freight: null, per_unit: null },
          ],
        },
      ],
    },
    empty: {
      status: "empty", owner: "Logistics", total_t2: null, lines: [],
    },
    singleComplete: {
      status: "complete", owner: "Logistics", total_t2: 0.34,
      lines: [
        {
          id: "fr_s1", label: "Bulk LCL — Verre + Marin",
          mode: "Ocean LCL", supplier: "Sino Logistics",
          treatment: "bundled",
          incoterm: "DDP",
          customs: { cbm_per_unit: 0.0038, duty_pct: 0.058, tariff_pct: 0.075 },
          tiers: [
            { id: "T1", total_freight: 4080, per_unit: 0.34 },
          ],
        },
      ],
    },
  },

  // Markup defaults vocabulary (FR-15 carry-forward from Round 5)
  markup_categories: [
    "Primary Packaging", "Secondary - Corrugated", "Secondary - Labels",
    "Secondary - Cards/Booklets", "Manufacturing", "Filling and Packout",
    "Co-Packing", "Raw Ingredients", "Logistics", "Passthrough",
    "One Time Charges", "R&D / Testing", "Turnkey", "Tooling",
  ],

  suppliers: [
    "Verre Pacific", "PrintWorks Co.", "Marin CM", "Sino Logistics", "Direct",
  ],
};
