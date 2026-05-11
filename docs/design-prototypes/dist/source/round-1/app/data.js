// Mock data for the Nexus quoting prototype
// Realistic beauty/wellness contract manufacturing — round-ish numbers, plausible naming

window.NX_DATA = {
  project: {
    id: "P-2418",
    client: "Lumen & Co.",
    deal: "Q3 Replenish + Glow Capsule Launch",
    pmName: "Maya Okafor",
    pmInitials: "MO",
    salesRep: "Tomás Beck",
    hubspotId: "DL-91723",
    stage: "Quote in progress",
    createdDays: 6,
    lastActivityHrs: 14,
  },
  tiers: [
    { id: "t1", label: "Tier 1", qty: 10000, margin: 41.2, status: "good" },
    { id: "t2", label: "Tier 2", qty: 25000, margin: 36.8, status: "good", active: true },
    { id: "t3", label: "Tier 3", qty: 50000, margin: 31.4, status: "warn" },
    { id: "t4", label: "Tier 4", qty: 100000, margin: 27.1, status: "bad" },
  ],
  skus: [
    {
      id: "s1",
      label: "GLW-30",
      name: "Hydra-Glow Serum",
      category: "Skincare — Serum",
      pack: "30ml glass dropper",
      retail: 48,
      completion: ["filled", "filled", "filled", "filled", "filled", "filled"],
    },
    {
      id: "s2",
      label: "GLW-50",
      name: "Hydra-Glow Serum",
      category: "Skincare — Serum",
      pack: "50ml glass dropper",
      retail: 68,
      completion: ["filled", "filled", "partial", "filled", "filled", "partial"],
      active: true,
    },
    {
      id: "s3",
      label: "RPL-200",
      name: "Replenish Body Lotion",
      category: "Body — Lotion",
      pack: "200ml HDPE pump",
      retail: 32,
      completion: ["filled", "filled", "filled", "filled", "partial", "empty"],
    },
    {
      id: "s4",
      label: "RPL-400",
      name: "Replenish Body Lotion",
      category: "Body — Lotion",
      pack: "400ml HDPE pump",
      retail: 48,
      completion: ["filled", "partial", "empty", "filled", "empty", "empty"],
    },
    {
      id: "s5",
      label: "CAP-60",
      name: "Glow Capsule",
      category: "Ingestible — Capsule",
      pack: "60ct PET bottle",
      retail: 38,
      completion: ["filled", "filled", "filled", "empty", "empty", "empty"],
    },
  ],

  // For the active SKU (s2), tier 2 — the cost stack
  costLines: {
    pkg: [
      { id: "p1", name: "Glass dropper bottle 50ml", supplier: "Verre Pacific", cost: 1.42, qty: 1, markup: 40, fresh: false },
      { id: "p2", name: "Aluminum collar + screw cap", supplier: "Verre Pacific", cost: 0.38, qty: 1, markup: 40, fresh: true },
      { id: "p3", name: "Folding carton + insert", supplier: "Stora Print", cost: 0.62, qty: 1, markup: 35, fresh: false },
      { id: "p4", name: "Shipper case (12 ct)", supplier: "Stora Print", cost: 0.18, qty: 1, markup: 25, fresh: false, note: "per unit" },
    ],
    prod: [
      { id: "pr1", name: "Filling & blending", cost: 0.84, markup: 30, fresh: false },
      { id: "pr2", name: "CM / assembly", cost: 0.52, markup: 30, fresh: false },
      { id: "pr3", name: "Setup fee (allocated)", cost: 0.21, markup: 0, fresh: false, note: "$5,250 ÷ 25k", allocated: true },
      { id: "pr4", name: "R&D recoup", cost: 0.12, markup: 0, fresh: false, allocated: true },
      { id: "pr5", name: "Bulk raws", cost: 3.40, markup: 25, fresh: true },
    ],
    frt: [
      { id: "f1", name: "Inbound ocean freight", cost: 0.46, markup: 15, fresh: false, mode: "ocean", visibility: "bundled" },
      { id: "f2", name: "Outbound LTL to DC", cost: 0.22, markup: 20, fresh: false, mode: "truck", visibility: "passthrough" },
    ],
    frtInternal: [
      { label: "CBM share", value: "0.0024 m³" },
      { label: "Duty (HS 3304.99)", value: "6.5%" },
      { label: "Tariff surcharge", value: "0.0%" },
    ],
  },

  activity: [
    { who: "TB", whoName: "Tomás", verb: "added", obj: "Aluminum collar — $0.38", when: "2h ago", role: "purch" },
    { who: "TB", whoName: "Tomás", verb: "updated bulk raws cost", obj: "$3.40", when: "2h ago", role: "purch" },
    { who: "JK", whoName: "Jin", verb: "set production fees on", obj: "GLW-50 / Tier 2", when: "Yesterday", role: "prod" },
    { who: "MO", whoName: "Maya", verb: "tuned global adjustment to", obj: "+8%", when: "2 days ago", role: "pm" },
    { who: "FW", whoName: "Freight desk", verb: "submitted ocean freight quote", obj: "$0.46/u", when: "3 days ago", role: "frt" },
  ],

  presence: [
    { id: "TB", name: "Tomás Beck", role: "Purchasing", color: "blue", here: true, viewing: "Packaging" },
    { id: "JK", name: "Jin Kanno", role: "Production", color: "rose", here: true, viewing: "Costing sheet" },
  ],

  blockers: [
    { sku: "RPL-400", tier: "Tier 3", what: "Freight not yet quoted", role: "Freight desk" },
    { sku: "CAP-60", tier: "Tier 2", what: "Bulk raws cost missing", role: "Purchasing" },
    { sku: "GLW-50", tier: "Tier 4", what: "CM/assembly fees TBD", role: "Production" },
  ],
};
