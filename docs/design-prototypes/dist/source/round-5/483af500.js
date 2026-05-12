// Round 4 data — workspace-level (deal organizer + project detail + copy ops)
// All values reflect the field-bucket schema from SPEC FR-12 and the validation
// engine signals from Slice 9.5 / quote_warnings. NULL means "not entered" not zero.

window.NXR4 = {
  me: {
    user_id: "u_maya",
    name: "Maya Okafor",
    initials: "MO",
    role: "pm",                  // pm | admin
    last_login_at: "2026-04-30T08:14:00Z",
  },

  // Recents drive the outer rail. Most-recent first. Pinned has its own list.
  recents: [
    { project_id: "P-2418", deal_name: "Q3 Replenish + Glow Capsule",  client: "Lumen & Co.",   accent: "blue",   pinned: true,  last_visit: "12m" },
    { project_id: "P-2401", deal_name: "Reorder · 4-SKU spring set",    client: "Beija Flor",    accent: "amber",  pinned: true,  last_visit: "2h"  },
    { project_id: "P-2419", deal_name: "Skin barrier line · pilot",     client: "Acre",          accent: "violet", pinned: false, last_visit: "yest" },
    { project_id: "P-2412", deal_name: "Autumn essentials reorder",     client: "Maren",         accent: "teal",   pinned: false, last_visit: "2d" },
  ],

  pinned: ["P-2418", "P-2401"],

  // Cross-project signals aggregated from quote_warnings + gate state +
  // sent-vs-current state. This is the "what's my move across all projects"
  // surface — see Designer notes for scope discipline.
  cross_project_signals: [
    { kind: "override_pending",   project_id: "P-2418", project: "Lumen & Co.",  detail: "v3 admin override DM'd to @nina · 2h, no reply", urgency: "now",    age: "2h" },
    { kind: "customer_silent",    project_id: "P-2401", project: "Beija Flor",   detail: "v4 sent Apr 28 · customer hasn't replied",       urgency: "today",  age: "3d" },
    { kind: "supplier_quote",     project_id: "P-2419", project: "Acre",         detail: "Awaiting Verre Pacific quote on 2 SKUs",         urgency: "today",  age: "1d" },
    { kind: "supplier_quote",     project_id: "P-2424", project: "Holst & Lo",   detail: "Awaiting Stora Print on shipper case",            urgency: "this_week", age: "2d" },
    { kind: "stage_drift",        project_id: "P-2412", project: "Maren",        detail: "HubSpot stage moved to Closed-Lost · refresh?",   urgency: "review", age: "4h" },
  ],

  // Project list — the deal organizer. Mix of stages + states for the healthy view.
  projects: [
    {
      id: "P-2418", deal_name: "Q3 Replenish + Glow Capsule Launch", client: "Lumen & Co.",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Negotiation",
      project_status: "active",
      scenarios_active: 2, scenarios_total: 3,
      latest_quote: { v: 3, status: "sent", amount: 163750, blended_margin: 22.8, tier: "T2", margin_state: "below_floor" },
      lines_requiring_review: 3,
      last_activity: "12m",
      next_action: { kind: "override_pending", text: "Admin override pending @nina · 2h" },
    },
    {
      id: "P-2401", deal_name: "Reorder · 4-SKU spring set", client: "Beija Flor",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Decision",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 1,
      latest_quote: { v: 4, status: "sent", amount: 84200, blended_margin: 34.1, tier: "T2", margin_state: "good" },
      lines_requiring_review: 0,
      last_activity: "3d",
      next_action: { kind: "customer_silent", text: "Sent Apr 28 · follow up" },
    },
    {
      id: "P-2419", deal_name: "Skin barrier line · pilot", client: "Acre",
      sales_rep: "Priya Mehta", pm: "Maya Okafor", hubspot_stage: "Quote in progress",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 1,
      latest_quote: { v: 2, status: "draft", amount: null, blended_margin: null, tier: null, margin_state: "incomplete" },
      lines_requiring_review: 7,
      last_activity: "yest",
      next_action: { kind: "supplier_quote", text: "Verre Pacific · 2 SKUs awaiting" },
    },
    {
      id: "P-2412", deal_name: "Autumn essentials reorder", client: "Maren",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Closed-Lost",
      project_status: "active",
      scenarios_active: 0, scenarios_total: 2,
      latest_quote: { v: 2, status: "sent", amount: 42100, blended_margin: 30.4, tier: "T1", margin_state: "good" },
      lines_requiring_review: 0,
      last_activity: "4h",
      next_action: { kind: "stage_drift", text: "HubSpot moved to Closed-Lost · refresh?" },
    },
    {
      id: "P-2424", deal_name: "Holiday capsule · 6 SKUs", client: "Holst & Lo",
      sales_rep: "Priya Mehta", pm: "Maya Okafor", hubspot_stage: "Quote in progress",
      project_status: "active",
      scenarios_active: 2, scenarios_total: 2,
      latest_quote: { v: 1, status: "draft", amount: null, blended_margin: null, tier: null, margin_state: "incomplete" },
      lines_requiring_review: 4,
      last_activity: "2d",
      next_action: { kind: "supplier_quote", text: "Stora Print · shipper case" },
    },
    {
      id: "P-2422", deal_name: "Hand cream · 100ml", client: "Veld",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Negotiation",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 2,
      latest_quote: { v: 5, status: "sent", amount: 28400, blended_margin: 28.2, tier: "T2", margin_state: "below_target" },
      lines_requiring_review: 0,
      last_activity: "5h",
      next_action: null,
    },
    {
      id: "P-2415", deal_name: "Body care relaunch", client: "Sonder", 
      sales_rep: "Priya Mehta", pm: "Maya Okafor", hubspot_stage: "Decision",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 3,
      latest_quote: { v: 3, status: "sent", amount: 112900, blended_margin: 31.7, tier: "T3", margin_state: "good" },
      lines_requiring_review: 0,
      last_activity: "1d",
      next_action: null,
    },
    {
      id: "P-2390", deal_name: "Refill pouches · trial",   client: "Coast Wellness",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Closed-Won",
      project_status: "accepted",
      scenarios_active: 0, scenarios_total: 2,
      latest_quote: { v: 4, status: "accepted", amount: 56800, blended_margin: 33.5, tier: "T2", margin_state: "good" },
      lines_requiring_review: 0,
      last_activity: "2d",
      next_action: null,
    },
    {
      id: "P-2426", deal_name: "Dry shampoo · 200ml", client: "Halsa",
      sales_rep: "Priya Mehta", pm: "Maya Okafor", hubspot_stage: "Quote in progress",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 1,
      latest_quote: { v: 1, status: "draft", amount: null, blended_margin: null, tier: null, margin_state: "incomplete" },
      lines_requiring_review: 12,
      last_activity: "6h",
      next_action: { kind: "fresh_setup", text: "New project · enter SKU shapes" },
    },
    {
      id: "P-2407", deal_name: "Q4 essentials reorder", client: "Marin",
      sales_rep: "Tomás Beck", pm: "Maya Okafor", hubspot_stage: "Negotiation",
      project_status: "active",
      scenarios_active: 1, scenarios_total: 1,
      latest_quote: { v: 2, status: "sent", amount: 71400, blended_margin: 35.2, tier: "T2", margin_state: "good" },
      lines_requiring_review: 0,
      last_activity: "3d",
      next_action: null,
    },
  ],

  // Project detail (active, multi-scenario state) — Lumen & Co. P-2418.
  // Three scenarios; one sent + override pending, one active draft, one dropped.
  project_detail: {
    id: "P-2418",
    deal_name: "Q3 Replenish + Glow Capsule Launch",
    client: "Lumen & Co.",
    sales_rep: "Tomás Beck",
    pm: "Maya Okafor",
    hubspot_stage: "Negotiation",
    hubspot_stage_cached_at: "2026-04-30T07:55:00Z",
    hubspot_synced_at: "8m",
    project_status: "active",
    created_at: "2026-04-22",
    next_action: {
      kind: "override_pending",
      headline: "Admin override is your move",
      detail: "Primary scenario v3 sent at 22.8% blended (below floor). DM to @nina sent 2h ago.",
      cta: "Resume primary scenario",
      target_scenario: "sc_primary",
    },
    scenarios: [
      {
        id: "sc_primary",
        label: "Primary",
        status: "active",
        recommended: true,
        versions: [
          {
            v: 3, status: "sent",
            sent_at: "2026-04-30T05:42:00Z", sent_at_label: "2h ago",
            blended_margin: 22.8, margin_state: "below_floor",
            tier: "T2", amount: 163750,
            note: "Below-floor send · admin override DM sent",
          },
          {
            v: 2, status: "superseded",
            sent_at: "2026-04-29T14:00:00Z", sent_at_label: "yesterday",
            blended_margin: 24.1, margin_state: "below_floor",
            tier: "T2", amount: 167200,
            note: "Customer asked for revised tier-3 pricing",
          },
          {
            v: 1, status: "superseded",
            sent_at: "2026-04-26T11:00:00Z", sent_at_label: "Apr 26",
            blended_margin: 25.6, margin_state: "below_target",
            tier: "T2", amount: 171000,
            note: "Initial send",
          },
        ],
        draft_after_send: { v: 4, edits: 6, blended_margin: 23.9, last_edited: "12m" },
      },
      {
        id: "sc_aggressive",
        label: "Aggressive — drop CAP-60",
        status: "active",
        versions: [
          {
            v: 1, status: "draft",
            sent_at: null, sent_at_label: null,
            blended_margin: 28.4, margin_state: "below_target",
            tier: "T2", amount: 142100,
            note: "Forked from Primary v2 · removed CAP-60",
          },
        ],
      },
      {
        id: "sc_freight",
        label: "Pass-through freight",
        status: "dropped",
        drop_reason: "explored",
        dropped_at: "2026-04-28",
        versions: [
          {
            v: 2, status: "superseded",
            sent_at: null, sent_at_label: null,
            blended_margin: 31.2, margin_state: "good",
            tier: "T2", amount: 158900,
            note: "Customer prefers freight bundled",
          },
        ],
      },
    ],
    presence: [
      { id: "WC", name: "Wei Chen",       viewing: "Cost build · freight",  section: "freight" },
    ],
    activity: [
      { ts: "2h",   text: "v3 sent at 22.8% blended margin",  who: "MO" },
      { ts: "2h",   text: "Admin override requested · DM @nina",  who: "MO" },
      { ts: "12m",  text: "Wei opened Cost build · freight",   who: "WC" },
      { ts: "5h",   text: "Aggressive scenario forked from Primary v2", who: "MO" },
    ],
  },

  // Copy Scenario — within-project source list (small)
  copy_within_sources: [
    { id: "q_p_v3", scenario: "Primary",                    v: 3, status: "sent",        margin: 22.8, tier_count: 4, sku_count: 5, when: "2h" },
    { id: "q_p_v2", scenario: "Primary",                    v: 2, status: "superseded",  margin: 24.1, tier_count: 4, sku_count: 5, when: "yest" },
    { id: "q_a_v1", scenario: "Aggressive — drop CAP-60",   v: 1, status: "draft",       margin: 28.4, tier_count: 4, sku_count: 4, when: "5h" },
    { id: "q_f_v2", scenario: "Pass-through freight (dropped)", v: 2, status: "superseded", margin: 31.2, tier_count: 4, sku_count: 5, when: "Apr 28" },
  ],

  // Copy Quote to Project — cross-project source list (large; preview slice)
  copy_cross_projects: [
    { id: "P-2401", deal_name: "Reorder · 4-SKU spring set",  client: "Beija Flor",  scenarios: 1, latest: { v: 4, when: "3d ago" } },
    { id: "P-2390", deal_name: "Refill pouches · trial",      client: "Coast Wellness", scenarios: 2, latest: { v: 4, when: "2d ago" }, accepted: true },
    { id: "P-2334", deal_name: "Q1 hydration set",            client: "Lumen & Co.", scenarios: 1, latest: { v: 5, when: "Mar 22" }, accepted: true },
    { id: "P-2287", deal_name: "Body care relaunch · phase 1",client: "Sonder",     scenarios: 2, latest: { v: 3, when: "Feb 10" }, accepted: true },
  ],

  // Field-bucket spec (mirrors SPEC FR-12)
  field_buckets: {
    cloneable: [
      { field: "SKUs (label, name, category, units_per_pack)", count: 5 },
      { field: "Packaging inputs (per-SKU, per-tier)",          count: 24 },
      { field: "Production inputs",                              count: 18 },
      { field: "Freight inputs (policy fields only)",            count: 6 },
      { field: "Global price adjustment %",                       count: 1 },
      { field: "Retail benchmark (per SKU)",                      count: 5 },
    ],
    inherited: [
      { field: "project_id",       value: "P-2418" },
      { field: "hubspot_deal_id",  value: "DL-91723" },
      { field: "deal_name",        value: "Q3 Replenish + Glow Capsule" },
      { field: "client_name",      value: "Lumen & Co." },
      { field: "sales_rep",        value: "Tomás Beck" },
      { field: "pm",               value: "Maya Okafor" },
    ],
    reset: [
      { field: "Quote id, version_number, status",        to: "→ draft v1" },
      { field: "Sent / accepted timestamps",               to: "→ null" },
      { field: "Customer-facing notes, internal notes",    to: "→ empty" },
      { field: "valid_until",                              to: "→ null" },
      { field: "Freight shipment-specific fields (CBM, route, ETA)", to: "→ null" },
      { field: "actual_units_produced",                    to: "→ null" },
      { field: "scenario_label, scenario_status",          to: "→ Primary, active" },
      { field: "Tier qty values",                          to: "→ null (PM enters)" },
    ],
  },
};
