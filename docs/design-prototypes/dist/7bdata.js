// Round 7b — Setup redesign fixtures.
// Representative DPS data: 5 SKUs (one assembly with 3 nested components,
// one assembly with 2, three leaves), 3 tiers, long product names that
// stress column widths.

window.NXR7B = {
  me: { name: "Maya Okafor", initials: "MO" },

  project: {
    id: "P-2418",
    client: "Lumen & Co.",
    deal_name: "Q3 Replenish + Glow Capsule Launch",
    hubspot_stage: "Quote in progress",
    hubspot_synced_at: "8m ago",
  },

  scenario: {
    id: "sc_primary",
    label: "Primary",
    version: 4,
    status: "draft_after_send",  // v3 sent, v4 in progress
  },

  // SKU rows — `sku_role` is the schema control (leaf | assembly);
  // CD picks Type as badge+glyph + click-to-toggle visualization.
  // `quote_skus.notes` lives in the drawer (NOT inline).
  skus: [
    {
      id: "sku_glw30",
      label: "GLW-30",
      product: "Hydra-Glow Vitamin C Serum",
      pack: "30ml glass dropper bottle, screw cap",
      sku_role: "assembly",
      category: "Skincare — Serum",
      retail_benchmark: 48.00,
      units_per_pack: 1,
      hubspot_product_id: "p_91823",
      notes: "Customer requested matte black dropper finish; sourcing TBD.",
      components: [
        { id: "c_glw30_1", product: "Glass dropper bottle 30ml — matte black", supplier: "Verre Pacific",  unit_cost: 0.84, qty: 1, markup: 0.40, category: "Primary Packaging" },
        { id: "c_glw30_2", product: "Dropper assembly + insert",                 supplier: "Verre Pacific",  unit_cost: 0.42, qty: 1, markup: 0.40, category: "Primary Packaging" },
        { id: "c_glw30_3", product: "Custom front + back label",                  supplier: "PrintWorks Co.", unit_cost: 0.22, qty: 1, markup: 0.45, category: "Secondary - Labels" },
      ],
    },
    {
      id: "sku_glw50",
      label: "GLW-50",
      product: "Hydra-Glow Vitamin C Serum",
      pack: "50ml glass dropper bottle, screw cap",
      sku_role: "assembly",
      category: "Skincare — Serum",
      retail_benchmark: 68.00,
      units_per_pack: 1,
      hubspot_product_id: "p_91824",
      notes: null,
      components: [
        { id: "c_glw50_1", product: "Glass dropper bottle 50ml — matte black", supplier: "Verre Pacific", unit_cost: 1.42, qty: 1, markup: 0.40, category: "Primary Packaging" },
        { id: "c_glw50_2", product: "Dropper assembly + insert",                 supplier: "Verre Pacific", unit_cost: 0.42, qty: 1, markup: 0.40, category: "Primary Packaging" },
      ],
    },
    {
      id: "sku_rpl200",
      label: "RPL-200",
      product: "Replenish Body Lotion",
      pack: "200ml HDPE pump bottle",
      sku_role: "leaf",
      category: "Body — Lotion",
      retail_benchmark: 32.00,
      units_per_pack: 1,
      hubspot_product_id: "p_91901",
      notes: "Inventory-eligible — 1,200 units on hand from Q2 reorder.",
      components: [],
    },
    {
      id: "sku_rpl400",
      label: "RPL-400",
      product: "Replenish Body Lotion",
      pack: "400ml HDPE pump bottle",
      sku_role: "leaf",
      category: "Body — Lotion",
      retail_benchmark: 48.00,
      units_per_pack: 1,
      hubspot_product_id: "p_91902",
      notes: null,
      components: [],
    },
    {
      id: "sku_cap60",
      label: "CAP-60",
      product: "Glow Capsule — Daily Inner Beauty",
      pack: "60ct PET bottle, child-resistant cap",
      sku_role: "leaf",
      category: "Ingestible — Capsule",
      retail_benchmark: 38.00,
      units_per_pack: 1,
      hubspot_product_id: "p_91950",
      notes: "Formulation TBD per R&D; pricing placeholder.",
      components: [],
    },
  ],

  // Tier table — coupled register with SKU table.
  // R5 / firm settings still owns target_margin_pct + floor_margin_pct;
  // tiers carry per-tier price_adj_pct (downward only, applied on Costing sheet).
  tiers: [
    { id: "t1", label: "Tier 1", qty: 5000,  price_adj_pct: 0.00, status: "active" },
    { id: "t2", label: "Tier 2", qty: 10000, price_adj_pct: 0.00, status: "active", recommended: true },
    { id: "t3", label: "Tier 3", qty: 25000, price_adj_pct: -0.05, status: "active" },
  ],

  // Tier presets — RI.4 commitment, surfaced in empty-state CTA
  tier_presets: [
    { id: "pst_3step",   label: "3-tier step",  desc: "5k · 10k · 25k",            tiers: 3 },
    { id: "pst_4step",   label: "4-tier step",  desc: "5k · 10k · 25k · 50k",      tiers: 4 },
    { id: "pst_first",   label: "First-PO",     desc: "10k single tier",            tiers: 1 },
    { id: "pst_volume",  label: "Volume break", desc: "10k · 50k · 100k",          tiers: 3 },
  ],

  // Notes — three audiences per R7b ask
  notes: {
    internal: "Customer prefers matte black on all primary packaging — verified verbally with Lumen procurement Apr 24. Glow Capsule formulation still pending R&D; flag to @nina before send.",
    customer_facing: "All pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown. Glow Capsule (CAP-60) pricing pending formulation finalization — quote available on request once raw-ingredient sourcing is locked.\n\nValid through August 31, 2026. PO required for production lock-in.",
  },

  // Add-new-product modal state (Q4 Option 1: Nexus-local fast path)
  add_product_modal: {
    open: false,
    name: "",
    category: "Skincare — Serum",
    pack: "",
    units_per_pack: 1,
    sku_role: "leaf",
    writeback_hubspot: true,  // toggle, default ON (writeback is the canonical path)
  },

  // Possible categories for SKU + add-new-product (mirrors R5 markup_categories
  // but at the SKU-level taxonomy rather than per-line-item)
  sku_categories: [
    "Skincare — Serum", "Skincare — Moisturizer", "Skincare — Cleanser",
    "Body — Lotion", "Body — Wash", "Hair — Shampoo", "Hair — Conditioner",
    "Ingestible — Capsule", "Ingestible — Powder", "Cosmetics", "Other",
  ],
};
