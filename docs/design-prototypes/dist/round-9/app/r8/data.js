// Nexus Round 8 — Quote umbrella (5-sub-tab reversible lifecycle)
// Fixtures for the Slice-12 Pattern-30 deliverable.
// Design canon: 5 strict-sequential sub-tabs; everything reversible until the
// NetSuite SO push at Tier Selection → Complete (THE LOCK).
// Field names mirror the reconciled brief + IA-spec so CC wires against real columns.
// NEW data flagged inline with  // NEW  — see docs/r8-data-source-map.md

window.NXR8 = {
  me: { name: "Maya Okafor", initials: "MO", role: "Project Manager" },

  project: {
    id: "P-2418",
    client: "Lumen & Co.",
    deal: "Q3 Replenish + Glow Capsule Launch",
    scenario: "Primary",
    hubspot_stage: "Quote Sent",
    synced: "8m",
  },

  customer: {
    name: "Lumen & Co.",
    contact: "Beth Yamamoto",
    role: "VP Operations",
    email: "beth@lumenco.com",
  },

  quote: {
    id: "q_2418",
    quote_number: "DPS-2418",   // stable across versions (customer sees "revised quote DPS-2418")
    state: "sent",              // draft | sent | accepted | complete
    sent_version: 3,
    draft_version: 4,           // draft leads sent → mismatch banner
    sent_at: "2026-07-14",
    sent_to: "beth@lumenco.com",
    valid_until: "2026-08-31",
  },

  // ─── Version chain (NEW picker; snapshots already retained) ──
  versions: [                                                        // NEW (picker UI)
    { v: 1, label: "v1", status: "superseded", created: "2026-06-02", note: "Initial 4-SKU quote",              total: 171400, sent: false },
    { v: 2, label: "v2", status: "superseded", created: "2026-06-21", note: "Added CAP-60 · freight bundled",    total: 189250, sent: false },
    { v: 3, label: "v3", status: "sent",       created: "2026-07-14", note: "Sent — customer responding to this", total: 186900, sent: true  },
    { v: 4, label: "v4", status: "draft",      created: "2026-07-24", note: "Revision in progress · 6 edits",     total: 181300, sent: false },
  ],

  // ─── Client Review feed (NEW — quote_review_events) ──────────
  review_events: [                                                   // NEW table
    { id: "ev4", type: "revision_requested", author: "Maya Okafor", at: "2026-07-24 09:12",
      note: "Beth asked for CAP-60 to come out and T2 pricing to hold. Starting a revision — v4." },
    { id: "ev3", type: "asked", author: "Maya Okafor", at: "2026-07-22 16:40",
      note: "Asked whether the 10k tier commitment can be split across two POs. No answer yet." },
    { id: "ev2", type: "responded", author: "Maya Okafor", at: "2026-07-19 11:05",
      note: "Beth: pricing 'broadly workable', wants to drop the capsule SKU and re-check freight." },
    { id: "ev1", type: "sent", author: "system", at: "2026-07-14 08:31",
      note: "Quote v3 sent to beth@lumenco.com", system: true },
  ],

  event_types: [                                                     // NEW enum (extensible)
    { id: "responded",         label: "Responded",         hint: "Customer replied" },
    { id: "asked",             label: "Asked",             hint: "You asked them something" },
    { id: "revision_requested",label: "Revision requested",hint: "They want changes" },
  ],

  // ─── Tier Selection — per-tier compliance (REUSED from Pricing) ──
  tiers: [
    { id: "t1", label: "T1", qty: 5000,  unit_price: 4.45, total: 106400, margin_pct: 31.2, status: "good",        turnkey: 111200 },
    { id: "t2", label: "T2", qty: 10000, unit_price: 3.95, total: 181300, margin_pct: 27.4, status: "good",        turnkey: 186100, recommended: true },
    { id: "t3", label: "T3", qty: 25000, unit_price: 3.49, total: 402500, margin_pct: 24.1, status: "below_target", turnkey: 407300 },
    { id: "t4", label: "T4", qty: 50000, unit_price: 3.18, total: 748000, margin_pct: 21.6, status: "below_floor",  turnkey: 752800 },
  ],
  policy: { target_pct: 30, floor_pct: 25 },

  // Customer's recorded signal → pre-fills tier selection (PM can override)
  customer_signal: { tier_id: "t2", source: "review_event ev2 · 2026-07-19", confidence: "stated" },

  // ─── Integrations ───────────────────────────────────────────
  hubspot: {
    deal: "Lumen & Co. — Q3 Replenish + Glow Capsule",
    from_stage: "Quote Sent",
    to_stage: "Closed Won",
    amount: 186100,
  },
  netsuite: {                                                        // NEW netsuite_so_id
    so_id: "SO-104882",
    status_on_push: "Pending Fulfillment",
    link: "https://netsuite.example.com/app/accounting/transactions/salesord.nl?id=104882",
    pushed_at: "2026-07-27 14:22 PST",
  },

  // ─── Sub-tab definitions (order LOCKED) ─────────────────────
  subtabs: [
    { id: "preview",  n: 1, label: "Preview Quote",  state_req: "draft",    kind: "transition" },
    { id: "send",     n: 2, label: "Send to Client", state_req: "draft",    kind: "transition" },
    { id: "review",   n: 3, label: "Client Review",  state_req: "sent",     kind: "log" },
    { id: "accepted", n: 4, label: "Mark Accepted",  state_req: "sent",     kind: "transition" },
    { id: "tier",     n: 5, label: "Tier Selection", state_req: "accepted", kind: "lock" },
  ],
};
