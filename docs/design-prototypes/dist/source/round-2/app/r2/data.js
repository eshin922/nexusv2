// Nexus Round 2 — schema-faithful mock data
// Field names mirror the actual schema (CLAUDE.md, SPEC.md, post-Slice-9.1)
// Every field here is annotated in docs/data-source-map.md

window.NXR2 = (function () {

  // ─── firm_settings (versioned) ──────────────────────────
  const firm_settings = {
    target_margin_pct: 35.0,
    floor_margin_pct: 25.0,
    effective_from: "2025-08-01",
  };

  // ─── markup_defaults (PK by category text) ──────────────
  // Subset shown — only what's used in this quote
  const markup_defaults = {
    "Primary":                  { markup_pct: 40 },
    "Secondary":                { markup_pct: 35 },
    "Secondary - Corrugated":   { markup_pct: 25 },
    "Secondary - Labels":       { markup_pct: 35 },
    "Filling and Packout":      { markup_pct: 30 },
    "Co-Packing":               { markup_pct: 30 },
    "One Time Charges":         { markup_pct:  0 },
    "R&D / Testing":            { markup_pct:  0 },
    "Raw Ingredients":          { markup_pct: 25 },
    "Logistics":                { markup_pct: 15 },
    "Passthrough":              { markup_pct:  0 },
  };

  // ─── projects ───────────────────────────────────────────
  const project = {
    id: "P-2418",
    client: "Lumen & Co.",
    pm_user_id: "u_maya",
  };

  // ─── quotes ─────────────────────────────────────────────
  const quote = {
    id: "Q-2418-v3",
    project_id: "P-2418",
    version_number: 3,
    scenario_label: "Base",
    scenario_status: "active",
    global_price_adj_pct: 8.0,
    target_margin_pct: null,           // 9.2 — null means use firm_settings.target_margin_pct
    created_at: "2025-10-19",
  };

  // ─── quote_tiers ────────────────────────────────────────
  // 9.1 schema: tier_price_adj_pct, client_target_price_per_unit added
  const tiers = [
    { id: "t1", quote_id: "Q-2418-v3", label: "Tier 1", quantity: 10000,  tier_price_adj_pct: null, client_target_price_per_unit: null  },
    { id: "t2", quote_id: "Q-2418-v3", label: "Tier 2", quantity: 25000,  tier_price_adj_pct: null, client_target_price_per_unit: 6.80  },
    { id: "t3", quote_id: "Q-2418-v3", label: "Tier 3", quantity: 50000,  tier_price_adj_pct: null, client_target_price_per_unit: 6.20  },
    { id: "t4", quote_id: "Q-2418-v3", label: "Tier 4", quantity: 100000, tier_price_adj_pct: null, client_target_price_per_unit: 5.40  },
  ];

  // ─── quote_skus ────────────────────────────────────────
  // CLAUDE.md: duty_pct + tariff_pct live HERE, NEVER customer-facing
  const skus = [
    { id: "s1", quote_id: "Q-2418-v3", sku_role: "leaf", parent_sku_id: null,
      label: "GLW-30", name: "Hydra-Glow Serum", pack: "30ml glass dropper", retail: 48,
      duty_pct: 6.5, tariff_pct: 0.0 },
    { id: "s2", quote_id: "Q-2418-v3", sku_role: "leaf", parent_sku_id: null,
      label: "GLW-50", name: "Hydra-Glow Serum", pack: "50ml glass dropper", retail: 68,
      duty_pct: 6.5, tariff_pct: 0.0 },
    { id: "s3", quote_id: "Q-2418-v3", sku_role: "leaf", parent_sku_id: null,
      label: "RPL-200", name: "Replenish Body Lotion", pack: "200ml HDPE pump", retail: 32,
      duty_pct: 4.2, tariff_pct: 0.0 },
    { id: "s4", quote_id: "Q-2418-v3", sku_role: "leaf", parent_sku_id: null,
      label: "RPL-400", name: "Replenish Body Lotion", pack: "400ml HDPE pump", retail: 48,
      duty_pct: 4.2, tariff_pct: 0.0 },
    { id: "s5", quote_id: "Q-2418-v3", sku_role: "leaf", parent_sku_id: null,
      label: "CAP-60", name: "Glow Capsule", pack: "60ct PET bottle", retail: 38,
      duty_pct: 0.0, tariff_pct: 7.5 },
  ];

  // ─── packaging_inputs (keyed by quote_sku_id, tier_id) ──
  // Each row has its own markup_pct + markup_pct_source
  // For brevity we store inputs for active SKU (s2) + a sampling for others
  // Build via factory below
  function pkg(quote_sku_id, tier_id, name, category, supplier, unit_cost, markup_override = null, fresh = false) {
    const def = markup_defaults[category]?.markup_pct ?? 0;
    const markup_pct = markup_override ?? def;
    return {
      id: `pkg-${quote_sku_id}-${tier_id}-${name.slice(0,3)}`,
      quote_sku_id, tier_id,
      component_name: name,
      category, supplier,
      unit_cost,                                    // null = empty
      markup_pct,
      markup_pct_source: markup_override == null ? "category_default" : "override",
      fresh,
    };
  }
  function prod(quote_sku_id, tier_id, name, category, unit_cost, markup_override = null, allocated_from = null, fresh = false) {
    const def = markup_defaults[category]?.markup_pct ?? 0;
    return {
      id: `prod-${quote_sku_id}-${tier_id}-${name.slice(0,3)}`,
      quote_sku_id, tier_id,
      fee_name: name, category,
      unit_cost,
      markup_pct: markup_override ?? def,
      markup_pct_source: markup_override == null ? "category_default" : "override",
      allocated_from, // e.g. "$5,250 setup ÷ 25k"
      fresh,
    };
  }
  function frt(quote_sku_id, tier_id, line_name, category, unit_cost, freight_treatment, sku_total_cbm, units_in_shipment, markup_override = null, fresh = false) {
    return {
      id: `frt-${quote_sku_id}-${tier_id}-${line_name.slice(0,3)}`,
      quote_sku_id, tier_id,
      line_name, category,
      unit_cost,
      markup_pct: markup_override ?? markup_defaults[category]?.markup_pct ?? 15,
      markup_pct_source: markup_override == null ? "category_default" : "override",
      freight_treatment,    // 'bundled' or 'pass_through'
      sku_total_cbm,        // INTERNAL only
      units_in_shipment,    // null → use tier qty fallback
      fresh,
    };
  }

  // Active SKU s2, all 4 tiers — full data
  const s2t2_pkg = [
    pkg("s2", "t2", "Glass dropper bottle 50ml", "Primary", "Verre Pacific", 1.42),
    pkg("s2", "t2", "Aluminum collar + screw cap", "Primary", "Verre Pacific", 0.38, null, true),
    pkg("s2", "t2", "Folding carton + insert", "Secondary", "Stora Print", 0.62),
    pkg("s2", "t2", "Shipper case (12 ct, per-unit allocation)", "Secondary - Corrugated", "Stora Print", 0.18),
    pkg("s2", "t2", "Front + back label", "Secondary - Labels", "Stora Print", 0.11),
  ];
  const s2t2_prod = [
    prod("s2", "t2", "Filling & blending", "Filling and Packout", 0.84),
    prod("s2", "t2", "CM / assembly", "Co-Packing", 0.52),
    prod("s2", "t2", "Setup fee (allocated)", "One Time Charges", 0.21, null, "$5,250 ÷ 25k units"),
    prod("s2", "t2", "R&D recoup (allocated)", "R&D / Testing", 0.12, null, "$3,000 ÷ 25k units"),
    prod("s2", "t2", "Bulk raws (formula)", "Raw Ingredients", 3.40, null, null, true),
  ];
  const s2t2_frt = [
    frt("s2", "t2", "Inbound ocean freight (China → LAX)", "Logistics", 0.46, "bundled",     0.0024, null),
    frt("s2", "t2", "Outbound LTL to customer DC", "Passthrough",      0.22, "pass_through", null,    null),
  ];

  // s2 tiers t1, t3, t4 — partial / mostly-empty for state demonstration
  const s2t1_pkg = s2t2_pkg.map(r => ({ ...r, id: r.id.replace("-t2-","-t1-"), tier_id: "t1", unit_cost: r.unit_cost * 1.06 })); // smaller tier = higher unit cost
  const s2t1_prod = s2t2_prod.map(r => ({ ...r, id: r.id.replace("-t2-","-t1-"), tier_id: "t1", unit_cost: r.unit_cost * 1.10 }));
  const s2t1_frt = s2t2_frt.map(r => ({ ...r, id: r.id.replace("-t2-","-t1-"), tier_id: "t1", unit_cost: r.unit_cost * 1.05 }));

  const s2t3_pkg = s2t2_pkg.map(r => ({ ...r, id: r.id.replace("-t2-","-t3-"), tier_id: "t3", unit_cost: r.unit_cost * 0.92 }));
  const s2t3_prod = s2t2_prod.map(r => ({ ...r, id: r.id.replace("-t2-","-t3-"), tier_id: "t3", unit_cost: r.unit_cost * 0.95 }));
  const s2t3_frt = [
    frt("s2", "t3", "Inbound ocean freight (China → LAX)", "Logistics", 0.42, "bundled", 0.0024, null),
    frt("s2", "t3", "Outbound LTL to customer DC", "Passthrough", null, "pass_through", null, null), // EMPTY
  ];

  const s2t4_pkg = s2t2_pkg.map(r => ({ ...r, id: r.id.replace("-t2-","-t4-"), tier_id: "t4", unit_cost: r.unit_cost * 0.86 }));
  const s2t4_prod = [
    prod("s2", "t4", "Filling & blending", "Filling and Packout", 0.78),
    prod("s2", "t4", "CM / assembly", "Co-Packing", null), // EMPTY
    prod("s2", "t4", "Setup fee (allocated)", "One Time Charges", 0.05, null, "$5,250 ÷ 100k"),
    prod("s2", "t4", "R&D recoup (allocated)", "R&D / Testing", 0.03, null, "$3,000 ÷ 100k"),
    prod("s2", "t4", "Bulk raws (formula)", "Raw Ingredients", 3.30),
  ];
  const s2t4_frt = [
    frt("s2", "t4", "Inbound ocean freight (China → LAX)", "Logistics", null, "bundled", 0.0024, null), // EMPTY
    frt("s2", "t4", "Outbound LTL to customer DC", "Passthrough", null, "pass_through", null, null),    // EMPTY
  ];

  // Aggregate
  const packaging_inputs = [...s2t1_pkg, ...s2t2_pkg, ...s2t3_pkg, ...s2t4_pkg];
  const production_inputs = [...s2t1_prod, ...s2t2_prod, ...s2t3_prod, ...s2t4_prod];
  const freight_inputs   = [...s2t1_frt, ...s2t2_frt, ...s2t3_frt, ...s2t4_frt];

  // ─── Helpers (mirroring src/lib/costing.ts behavior) ────
  function lineCost(row) {
    if (row.unit_cost == null) return null;
    return row.unit_cost * (1 + (row.markup_pct ?? 0) / 100);
  }

  function tierMath(skuId, tierId, opts = {}) {
    const pkgRows  = packaging_inputs.filter(r => r.quote_sku_id === skuId && r.tier_id === tierId);
    const prodRows = production_inputs.filter(r => r.quote_sku_id === skuId && r.tier_id === tierId);
    const frtRows  = freight_inputs.filter(r => r.quote_sku_id === skuId && r.tier_id === tierId);
    const sku = skus.find(s => s.id === skuId);
    const tier = tiers.find(t => t.id === tierId);

    const pkgCost  = pkgRows.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost, 0);
    const prodCost = prodRows.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost, 0);
    // Freight contribution depends on treatment + duty/tariff
    const bundledFrtRows = frtRows.filter(r => r.freight_treatment === "bundled" && r.unit_cost != null);
    const passThroughFrtRows = frtRows.filter(r => r.freight_treatment === "pass_through" && r.unit_cost != null);
    const containerFrt = bundledFrtRows.reduce((a, r) => a + r.unit_cost, 0);
    const passThroughFrt = passThroughFrtRows.reduce((a, r) => a + r.unit_cost, 0);

    // landed_with_markup = (container_freight + duty + tariff) × (1 + freight_markup)
    const dutyAmt = containerFrt * (sku.duty_pct / 100);
    const tariffAmt = containerFrt * (sku.tariff_pct / 100);
    const frtMarkup = bundledFrtRows[0]?.markup_pct ?? 15;
    const landedFrt = (containerFrt + dutyAmt + tariffAmt) * (1 + frtMarkup / 100);

    const pkgWithMarkup  = pkgRows.filter(r => r.unit_cost != null).reduce((a, r) => a + lineCost(r), 0);
    const prodWithMarkup = prodRows.filter(r => r.unit_cost != null).reduce((a, r) => a + lineCost(r), 0);
    const passThroughWithMarkup = passThroughFrtRows.reduce((a, r) => a + lineCost(r), 0);

    const contributionCost = pkgCost + prodCost + containerFrt + dutyAmt + tariffAmt + passThroughFrt;

    // Required Sell = sum(component_cost × (1 + markup)) × (1 + global_price_adj_pct)
    const gpa = opts.gpa ?? quote.global_price_adj_pct;
    const tierAdj = opts.tierAdj ?? tier.tier_price_adj_pct;
    const effectiveAdj = tierAdj != null ? tierAdj : gpa;

    const beforeAdj = pkgWithMarkup + prodWithMarkup + landedFrt + passThroughWithMarkup;
    const requiredSell = beforeAdj * (1 + effectiveAdj / 100);
    const margin = requiredSell > 0 ? ((requiredSell - contributionCost) / requiredSell) * 100 : 0;

    return {
      pkgCost, prodCost, containerFrt, dutyAmt, tariffAmt, passThroughFrt,
      landedFrt, contributionCost, beforeAdj, requiredSell, margin,
      effectiveAdj, gpa, tierAdj,
      counts: {
        pkg: { filled: pkgRows.filter(r => r.unit_cost != null).length, total: pkgRows.length },
        prod: { filled: prodRows.filter(r => r.unit_cost != null).length, total: prodRows.length },
        frt: { filled: frtRows.filter(r => r.unit_cost != null).length, total: frtRows.length },
      },
    };
  }

  // ─── Users ──────────────────────────────────────────────
  const users = {
    u_maya:  { id: "u_maya",  initials: "MO", name: "Maya Okafor",  role: "PM" },
    u_tomas: { id: "u_tomas", initials: "TB", name: "Tomás Beck",   role: "Purchasing" },
    u_jin:   { id: "u_jin",   initials: "JK", name: "Jin Kanno",    role: "Production" },
    u_freight:{id: "u_freight",initials:"FW", name: "Freight desk", role: "Logistics" },
    u_admin: { id: "u_admin", initials: "AD", name: "Avery Diaz",   role: "Admin" },
  };

  // ─── quote_warnings (Slice 9.5 — wishful for live, but schema is committed) ──
  // Pre-9.5: empty array. Post-9.5: derived rows.
  const quote_warnings_post95 = [
    { id: "w1", quote_sku_id: "s4", tier_id: "t3", severity: "high",   rule_code: "MARGIN_BELOW_FLOOR",     message: "RPL-400 / Tier 3 margin 22.4% — below 25% floor", related_field: "margin_pct" },
    { id: "w2", quote_sku_id: "s4", tier_id: "t4", severity: "high",   rule_code: "MARGIN_BELOW_FLOOR",     message: "RPL-400 / Tier 4 margin 19.8% — below 25% floor", related_field: "margin_pct" },
    { id: "w3", quote_sku_id: "s5", tier_id: "t4", severity: "high",   rule_code: "MARGIN_BELOW_FLOOR",     message: "CAP-60 / Tier 4 margin 23.1% — below 25% floor",  related_field: "margin_pct" },
    { id: "w4", quote_sku_id: "s2", tier_id: "t4", severity: "medium", rule_code: "ANOMALY_HIGH_FRT_RATIO", message: "GLW-50 / Tier 4 freight is 18% of contribution cost (typical: 8-12%)", related_field: "frt_ratio" },
  ];

  return {
    firm_settings, markup_defaults,
    project, quote, tiers, skus, users,
    packaging_inputs, production_inputs, freight_inputs,
    quote_warnings_post95,
    tierMath, lineCost,
  };
})();
