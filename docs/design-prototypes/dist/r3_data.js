// Nexus Round 3 — scoped data
// Customer view + Mark-Accepted flow
// Reuses Round 2 schema shapes; field names mirror SPEC.md and CLAUDE.md
// Annotated in docs/round-3-data-source-map.md

window.NXR3 = (function () {

  // ─── Vendor ─────────────────────────────────────────────
  const vendor = {
    name: "Halcyon Goods",
    sub: "Contract manufacturing & co-packing",
    address: "1845 Industry Way · Long Beach, CA 90810",
    contact: "Maya Okafor · maya@halcyongoods.co · +1 562 555 0184",
  };

  // ─── Customer ───────────────────────────────────────────
  const customer = {
    name: "Lumen & Co.",
    contact: "Priya Shah",
    role: "Director of Operations",
    address: "424 Mission St, Suite 800 · San Francisco, CA 94105",
    email: "priya@lumenandco.com",
  };

  // ─── Quote (canonical record) ───────────────────────────
  const quote = {
    id: "Q-2418-v3",
    project_id: "P-2418",
    quote_number: "HG-2418",                      // customer-facing, friendly
    version_number: 3,                            // INTERNAL — never on PDF
    scenario_label: "Base",                        // INTERNAL
    sent_date: "2026-04-28",                       // when v3 was sent
    valid_until: "2026-05-28",                     // sent_date + 30
    payment_terms: "Net 30 from invoice date",
    lead_time: "8–10 weeks from PO; first shipment ex-works LAX",
    customer_facing_notes: "Pricing assumes single port-of-origin (China main port). Bulk raws subject to ±2% adjustment if WTI crude moves more than 15% before PO. Tooling shown as one-time charge in Tier 2; amortizes into unit cost from Tier 3 forward.",
    incoterms: "FOB Long Beach (bundled freight); EXW Long Beach (pass-through freight lines)",
  };

  // ─── Tiers ──────────────────────────────────────────────
  const tiers = [
    { id: "t1", label: "Tier 1", quantity: 10000  },
    { id: "t2", label: "Tier 2", quantity: 25000  },
    { id: "t3", label: "Tier 3", quantity: 50000  },
    { id: "t4", label: "Tier 4", quantity: 100000 },
  ];

  // ─── SKUs (customer-visible subset) ─────────────────────
  // Customer sees: name, pack format, units_per_pack, retail (optional), per-tier pricing
  // Customer never sees: category, supplier, duty_pct, tariff_pct, internal IDs
  const skus = [
    {
      id: "s1", label: "GLW-30", name: "Hydra-Glow Serum",
      pack: "30 ml glass dropper", units_per_pack: 1,
      retail_benchmark: 48,
      // [t1, t2, t3, t4] — unit prices customer sees
      tier_prices: [6.80, 6.20, 5.65, 5.20],
      shape: "step↓",
    },
    {
      id: "s2", label: "GLW-50", name: "Hydra-Glow Serum",
      pack: "50 ml glass dropper", units_per_pack: 1,
      retail_benchmark: 68,
      tier_prices: [9.10, 8.30, 7.55, 6.90],
      shape: "step↓",
    },
    {
      id: "s3", label: "RPL-200", name: "Replenish Body Lotion",
      pack: "200 ml HDPE pump", units_per_pack: 1,
      retail_benchmark: 32,
      tier_prices: [4.95, 4.95, 4.95, 4.95],   // flat
      shape: "flat",
    },
    {
      id: "s4", label: "RPL-400", name: "Replenish Body Lotion",
      pack: "400 ml HDPE pump", units_per_pack: 1,
      retail_benchmark: 48,
      tier_prices: [7.85, 7.20, 6.55, 5.95],
      shape: "step↓",
    },
    {
      id: "s5", label: "CAP-60", name: "Glow Capsule",
      pack: "60 ct PET bottle", units_per_pack: 1,
      retail_benchmark: 38,
      tier_prices: [null, 6.50, 5.95, 5.40],   // partial — T1 not priced
      shape: "partial",
    },
  ];

  // ─── One-time charges (when allocate_service_fees_to_cost = FALSE) ─────────
  // Per-quote and per-SKU, separated for the customer view's clarity question.
  const service_fees = [
    {
      id: "sf1", scope: "project",
      label: "Project setup & tooling",
      sub: "Per-project, one-time. Includes filling-line setup, dye-cuts, plates.",
      amount: 5250,
      qty_label: "1 (per project)",
    },
    {
      id: "sf2", scope: "sku",  sku_id: "s2",
      label: "GLW-50 — custom mold tooling",
      sub: "One-time. Mold ownership transfers to client at PO+50k cumulative units.",
      amount: 12400,
      qty_label: "1 (GLW-50 only)",
    },
    {
      id: "sf3", scope: "sku", sku_id: "s5",
      label: "CAP-60 — formulation R&D",
      sub: "One-time. Final formula approval required before T2 production.",
      amount: 3200,
      qty_label: "1 (CAP-60 only)",
    },
  ];

  // ─── Pass-through freight lines (when freight_treatment = pass_through) ───
  // Customer sees one line per shipment — landed-with-markup, no decomposition.
  const freight_lines = [
    {
      id: "fr1", label: "Outbound LTL — Long Beach → Lumen DC (Reno, NV)",
      sub: "Per shipment. Estimate based on current rates; actual billed at cost+15%.",
      qty_label: "Per Tier shipment",
      // Per-tier pass-through unit cost (customer-visible "Freight" amount)
      tier_amounts: [0.42, 0.34, 0.28, 0.24],
    },
    {
      id: "fr2", label: "Inbound ocean — Shanghai → Long Beach",
      sub: "Container freight, allocated per unit. Customer-billed separately as container LCL/FCL booked.",
      qty_label: "Per Tier shipment",
      tier_amounts: [0.55, 0.48, 0.42, 0.38],
    },
  ];

  // ─── Costing-sheet snapshot (for Mark-Accepted surface) ───
  // Per-tier blended margin + status, plus warning summary
  const costingByScenario = {
    good: {
      blended_margin_pct: 36.4,
      target_pct: 35.0,
      floor_pct: 25.0,
      verdict: "GOOD",
      tier_summary: [
        { id: "t1", label: "Tier 1", qty: 10000,  unit_price: 7.18, total: 71800,  margin_pct: 31.2, status: "good" },
        { id: "t2", label: "Tier 2", qty: 25000,  unit_price: 6.55, total: 163750, margin_pct: 36.4, status: "good", recommended: true },
        { id: "t3", label: "Tier 3", qty: 50000,  unit_price: 5.95, total: 297500, margin_pct: 38.1, status: "good" },
        { id: "t4", label: "Tier 4", qty: 100000, unit_price: 5.42, total: 542000, margin_pct: 32.0, status: "good" },
      ],
      warnings_line: 0,
      warnings_quote: 0,
    },
    bothGates: {
      blended_margin_pct: 22.8,
      target_pct: 35.0,
      floor_pct: 25.0,
      verdict: "BELOW FLOOR",
      tier_summary: [
        { id: "t1", label: "Tier 1", qty: 10000,  unit_price: 7.18, total: 71800,  margin_pct: 31.2, status: "good" },
        { id: "t2", label: "Tier 2", qty: 25000,  unit_price: 6.10, total: 152500, margin_pct: 28.4, status: "warn" },
        { id: "t3", label: "Tier 3", qty: 50000,  unit_price: 5.20, total: 260000, margin_pct: 22.4, status: "bad", recommended: true },
        { id: "t4", label: "Tier 4", qty: 100000, unit_price: 4.65, total: 465000, margin_pct: 19.8, status: "bad" },
      ],
      warnings_line: 3,    // RPL-400 t3, RPL-400 t4, CAP-60 t4
      warnings_quote: 1,   // BLENDED_BELOW_FLOOR
      flagged_lines: [
        { sku: "RPL-400", tier: "Tier 3", margin: 22.4, rule: "MARGIN_BELOW_FLOOR" },
        { sku: "RPL-400", tier: "Tier 4", margin: 19.8, rule: "MARGIN_BELOW_FLOOR" },
        { sku: "CAP-60",  tier: "Tier 4", margin: 23.1, rule: "MARGIN_BELOW_FLOOR" },
      ],
    },
  };

  // ─── Other active scenarios on the project (for auto-drop surfacing) ──────
  const sibling_scenarios = [
    { id: "Q-2418-v3-B", label: "Reduced-tier (drop T1)", status: "active",   margin: 38.1, last_edit: "3d ago by Maya" },
    { id: "Q-2418-v3-C", label: "Pass-through freight",   status: "active",   margin: 34.2, last_edit: "5d ago by Maya" },
    { id: "Q-2418-v3-D", label: "Customer-target match",  status: "draft",    margin: null, last_edit: "draft" },
  ];

  // ─── Sent-vs-draft state ─────────────────────────────────
  const versions = {
    v3: { number: 3, status: "sent",       sent_at: "2026-04-28", snapshot_id: "snap-v3-2026-04-28" },
    v4: { number: 4, status: "draft",      created_at: "2026-04-30", base: "v3" },
  };

  return {
    vendor, customer, quote, tiers, skus,
    service_fees, freight_lines,
    costingByScenario, sibling_scenarios, versions,
  };
})();
