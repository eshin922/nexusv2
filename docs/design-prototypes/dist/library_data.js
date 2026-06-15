/* global window */
// ─────────────────────────────────────────────────────────────────────
// Library modal redesign — fixtures + states
// Clean canonical naming (no synthetic prefix). Reuses .a1v2-modal frame.
// ─────────────────────────────────────────────────────────────────────

window.LIBM = window.LIBM || {};

// Target ASYs in the current quote (the attach destination)
LIBM.quote = {
  qid: "GLW-30",
  client: "Glow Skincare Co.",
  asys: [
    { id: "ASY-01", name: "Serum carton · 30ml", leaf_count: 4 },
    { id: "ASY-02", name: "Dropper bottle assembly", leaf_count: 3 },
    { id: "ASY-03", name: "Gift set · holiday", leaf_count: 6 },
  ],
};

// Component (leaf) types — "component" is the PM-facing word; leaf is internal
LIBM.types = {
  pp:       { id: "pp",       label: "Primary packaging" },
  sp:       { id: "sp",       label: "Secondary packaging" },
  tertiary: { id: "tertiary", label: "Tertiary packaging" },
  soft:     { id: "soft",     label: "Soft goods" },
};

// readiness: "ready" | "attached" | "archived"
// source:    "nexus" | "hubspot"
LIBM.library = [
  { id: "L01", name: "Glass dropper · 30ml amber", sku: "DRP-30-AMB", type: "pp", source: "nexus",   used_asys: 12, used_scenarios: 5, readiness: "ready" },
  { id: "L02", name: "Dropper bulb · nitrile black", sku: "BLB-NIT-BK", type: "pp", source: "hubspot", used_asys: 8,  used_scenarios: 3, readiness: "ready" },
  { id: "L03", name: "Folding carton · SBS 18pt", sku: "CTN-SBS-18", type: "sp", source: "nexus",   used_asys: 22, used_scenarios: 9, readiness: "attached" },
  { id: "L04", name: "Shrink sleeve · full-body", sku: "SLV-FB-100", type: "sp", source: "hubspot", used_asys: 4,  used_scenarios: 2, readiness: "ready" },
  { id: "L05", name: "Pump · 24-410 treatment", sku: "PMP-24410-T", type: "pp", source: "nexus",   used_asys: 17, used_scenarios: 7, readiness: "ready" },
  { id: "L06", name: "Corrugated mailer · 8×6×3", sku: "MLR-863-EC", type: "tertiary", source: "hubspot", used_asys: 6, used_scenarios: 3, readiness: "ready" },
  { id: "L07", name: "Cotton drawstring pouch", sku: "PCH-CTN-DS", type: "soft", source: "nexus", used_asys: 9, used_scenarios: 4, readiness: "ready" },
  { id: "L08", name: "Pressure-sensitive label · matte", sku: "LBL-PS-MT", type: "sp", source: "nexus", used_asys: 31, used_scenarios: 12, readiness: "attached" },
  { id: "L09", name: "Tissue paper · 17gsm acid-free", sku: "TIS-17-AF", type: "tertiary", source: "hubspot", used_asys: 14, used_scenarios: 6, readiness: "ready" },
  { id: "L10", name: "Aluminum tin · 2oz screw-top", sku: "TIN-2OZ-ST", type: "pp", source: "nexus", used_asys: 5, used_scenarios: 2, readiness: "archived" },
  { id: "L11", name: "Kraft hang tag · twine", sku: "TAG-KFT-TW", type: "tertiary", source: "hubspot", used_asys: 7, used_scenarios: 3, readiness: "ready" },
  { id: "L12", name: "Glass jar · 50ml frosted", sku: "JAR-50-FR", type: "pp", source: "nexus", used_asys: 19, used_scenarios: 8, readiness: "ready" },
  { id: "L13", name: "Foam insert · die-cut EVA", sku: "FOM-EVA-DC", type: "tertiary", source: "nexus", used_asys: 3, used_scenarios: 1, readiness: "ready" },
  { id: "L14", name: "Velvet pouch · charmeuse lined", sku: "PCH-VLV-CH", type: "soft", source: "hubspot", used_asys: 2, used_scenarios: 1, readiness: "archived" },
  { id: "L15", name: "Child-resistant cap · 24mm", sku: "CAP-CR-24", type: "pp", source: "nexus", used_asys: 11, used_scenarios: 5, readiness: "ready" },
  { id: "L16", name: "Belly band · uncoated 100lb", sku: "BND-UC-100", type: "sp", source: "hubspot", used_asys: 5, used_scenarios: 2, readiness: "ready" },
];

LIBM.total_catalog = 990; // eventual size once HubSpot fully pulled

// ── States (scenario switcher) ──────────────────────────────────────
LIBM.states = {
  populated: {
    label: "① Populated · target selected",
    cluster: "Common case",
    blurb: "The everyday case. Library populated, attach target pre-selected in the persistent bar. Table-row layout for dense scanning. Row buttons say \"Attach\" (target lives in the bar, not re-prompted per row). Already-attached + archived rows carry status rail + tint.",
    selected_asy: "ASY-02",
    query: "",
    type_filter: "all",
    rows: LIBM.library,
    canCreate: true,
  },
  zero: {
    label: "② Filtered to zero",
    cluster: "Empty shapes",
    blurb: "Search returns no matches. Distinct from library-empty: the library HAS components, this query just doesn't hit. Offers \"Create new product\" as the forward path + a \"clear filters\" escape. Refresh is not the answer here, so it's de-emphasized.",
    selected_asy: "ASY-02",
    query: "biodegradable mycelium clamshell",
    type_filter: "all",
    rows: [],
    canCreate: true,
  },
  empty: {
    label: "③ Library empty · first touch",
    cluster: "Empty shapes",
    blurb: "First-touch / brand-new firm. The library has nothing yet. Two forward paths get equal weight: create the first component, or pull the HubSpot catalog. This is the one place Refresh is promoted to a primary affordance.",
    selected_asy: "ASY-01",
    query: "",
    type_filter: "all",
    rows: [],
    library_truly_empty: true,
    canCreate: true,
  },
  pulling: {
    label: "④ Refresh in progress",
    cluster: "Pull state",
    blurb: "Inline pull-progress band active in the header — does not displace the filter row or shift row alignment. Existing rows stay interactive during the pull; the band reports progress and count delta. Band sits between title and the attach bar.",
    selected_asy: "ASY-02",
    query: "",
    type_filter: "all",
    rows: LIBM.library,
    pulling: { done: 642, total: 990 },
    canCreate: true,
  },
};

LIBM.state_order = ["populated", "zero", "empty", "pulling"];
