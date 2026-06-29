// CD Commission — Customer-Facing PDF Render Layer
// Scoped data for the paged-PDF prototype.
// Vendor identity LOCKED per brief §4. Customer + SKU + tier values
// carried from the Quote-Workflow A.1-v2 customer artifact (DPS-2418).
// Every field below is customer-visible. No forbidden field (margin, markup,
// cost, supplier, duty/tariff, CBM, version, scenario, audit) appears here —
// the boundary guard (brief §1) is enforced at the data layer too.
// Annotated in docs/cd-customer-pdf-render-data-source-map.md

window.NXCPDF = (function () {

  // ─── Vendor (LOCKED — brief §4) ─────────────────────────
  const vendor = {
    name: "The DPS",
    sub: "Turnkey product development & manufacturing for beauty, health & wellness brands",
    address: "3943 Irvine Blvd, #1129 · Irvine, CA 92602",
    contact_name: "Maya Okafor",
    contact_email: "maya@dps.co",
    contact_phone: "+1 (909) 555-0142",
  };

  // ─── Customer (from HubSpot projection) ─────────────────
  const customer = {
    name: "Lumen & Co.",
    contact: "Beth Yamamoto",
    role: "VP Operations",
    email: "beth@lumenco.com",
    address: "1450 Mission St · San Francisco, CA 94103",
  };

  // ─── Quote meta (customer-facing fields only) ───────────
  const quote = {
    quote_number: "DPS-2418",          // friendly id — never version/scenario
    issued_date: "2026-05-17",
    valid_until: "2026-08-31",
    payment_terms: "50% deposit on PO · balance Net 30 from ship date",
    lead_time: "10–12 weeks from PO approval; first shipment FOB Long Beach",
    incoterms_bundled: "FOB Long Beach — container freight, duty & applicable tariffs included in unit price",
    incoterms_passthrough: "EXW Long Beach — outbound freight billed separately at cost; charges itemized",
    customer_facing_notes:
      "Pricing assumes a single port-of-origin (Ningbo). Bulk-material costs are subject to a ±2% adjustment if published indices move more than 15% before PO. Tooling is shown as a one-time charge and amortizes into unit cost from Tier 3 forward.",
  };

  // ─── Tiers (up to 4; one recommended) ───────────────────
  const tiers = [
    { id: "t1", label: "T1", full: "Tier 1", quantity: 5000  },
    { id: "t2", label: "T2", full: "Tier 2", quantity: 10000, recommended: true },
    { id: "t3", label: "T3", full: "Tier 3", quantity: 25000 },
    { id: "t4", label: "T4", full: "Tier 4", quantity: 50000 },
  ];
  const recommendedTierIdx = 1; // T2

  // ─── SKUs (customer-visible subset) ─────────────────────
  // shape: "step" | "flat" | "partial"   (drives render treatment, not a forbidden field)
  // tier_prices: [t1, t2, t3, t4] — NULL → "quote on request", never $0.00
  const skus = [
    {
      id: "s1", code: "GLW-30", name: "Hydra-Glow Vitamin C Serum",
      pack: "30 ml glass dropper, screw cap", retail_benchmark: 48,
      tier_prices: [4.45, 3.95, 3.49, 3.18], shape: "step",
    },
    {
      id: "s2", code: "GLW-50", name: "Hydra-Glow Vitamin C Serum",
      pack: "50 ml glass dropper, screw cap", retail_benchmark: 68,
      tier_prices: [6.85, 6.10, 5.42, 4.92], shape: "step",
    },
    {
      id: "s3", code: "RPL-200", name: "Replenish Body Lotion",
      pack: "200 ml HDPE pump bottle", retail_benchmark: 32,
      tier_prices: [4.65, 4.65, 4.65, 4.65], shape: "flat",
    },
    {
      id: "s4", code: "RPL-400", name: "Replenish Body Lotion",
      pack: "400 ml HDPE pump bottle", retail_benchmark: 48,
      tier_prices: [7.85, 7.20, 6.55, 5.95], shape: "step",
    },
    {
      id: "s5", code: "CAP-60", name: "Glow Capsule — Daily Inner Beauty",
      pack: "60 ct PET bottle, child-resistant cap", retail_benchmark: 38,
      tier_prices: [null, 7.55, 6.70, 6.05], shape: "partial",
    },
    {
      id: "s6", code: "SRM-15", name: "Overnight Repair Serum",
      pack: "15 ml airless pump", retail_benchmark: 72,
      tier_prices: [9.20, 8.45, 7.60, 6.95], shape: "step",
    },
  ];

  // SKU subsets per state (prototype navigation; production renders the quote's actual set)
  const skuSets = {
    pure:        ["s1", "s2", "s3", "s4"],            // 4 priced (incl. one flat)
    passThrough: ["s1", "s2", "s3", "s4"],            // same set + charges block → 2 pages
    partial:     ["s1", "s2", "s3", "s4", "s5", "s6"],// 6 SKUs, one unpriced tier → table overflows
  };

  // ─── One-time charges (state B — allocate_service_fees_to_cost = FALSE) ──
  const service_fees = [
    {
      id: "sf1", scope: "project",
      label: "Project setup & tooling",
      sub: "Per-project, one-time. Includes filling-line setup, dye-cuts, plates.",
      amount: 4800, qty_label: "1 (per project)",
    },
    {
      id: "sf2", scope: "sku", sku_id: "s2",
      label: "GLW-50 — custom mold tooling",
      sub: "One-time. Mold ownership transfers to client at PO + 50k cumulative units.",
      amount: 9600, qty_label: "1 (GLW-50 only)",
    },
  ];

  // ─── Pass-through freight lines (state B — freight_treatment = pass_through) ──
  // Customer sees a landed per-unit amount per line; per-tier amounts on request.
  const freight_lines = [
    {
      id: "fr1", label: "Inbound ocean — Ningbo → Long Beach",
      sub: "Container freight allocated per unit. Booked & billed at cost as LCL/FCL is confirmed.",
      qty_label: "Per unit · per shipment",
      tier_amounts: [0.48, 0.42, 0.36, 0.31],
    },
    {
      id: "fr2", label: "Outbound LTL — Long Beach → Lumen DC (Tracy, CA)",
      sub: "Per shipment. Estimate at current rates; actual billed at cost + 15%.",
      qty_label: "Per unit · per shipment",
      tier_amounts: [0.38, 0.31, 0.26, 0.22],
    },
  ];

  return {
    vendor, customer, quote, tiers, recommendedTierIdx,
    skus, skuSets, service_fees, freight_lines,
  };
})();
