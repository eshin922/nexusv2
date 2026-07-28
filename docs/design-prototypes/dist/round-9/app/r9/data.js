// Nexus Round 9 — Acceptance & Sales Order ceremony
// Revises R8 sub-tabs 4 + 5. Sub-tabs 1–3 unchanged (reused from app/r8/).
//
// CEREMONY MODEL (docs/r9-designer-notes.md):
//   One customer decision ("we accept, Tier 2") → ONE capture (sub-tab 4, HubSpot)
//   → tier CARRIED → ONE order (sub-tab 5 "Sales Order", NetSuite = the lock).
//
// R9.1 · sub-tab 5 is now a RECEIPT with three states: pending · failed · record.

window.NXR9 = (function () {
  const base = window.NXR8;

  // ── RENAMES (R9.1) ──────────────────────────────────────
  // String changes to the existing sub-tab config — no structural change.
  // "Mark Accepted" and "Tier Selection" both named buttons/actions; the new
  // labels name the ARTIFACT, which stays true across all of a tab's states.
  base.subtabs[3].label = "Acceptance";    // was "Mark Accepted"
  base.subtabs[4].label = "Sales Order";   // was "Tier Selection"

  return Object.assign({}, base, {

    // ─── The capture (sub-tab 4) ────────────────────────────
    capture: {
      source_options: [
        { id: "email",  label: "Email",  hint: "Written reply" },
        { id: "call",   label: "Call",   hint: "Verbal, you logged it" },
        { id: "portal", label: "Portal", hint: "Accepted in-app" },
      ],
      default_source: "email",
      prefill_note: "Beth (email, Jul 26): \"We're good to go on the revised pricing — let's do Tier 2, 10k units. Send the PO paperwork whenever you're ready.\"",
      prefill_from: "review_event · ev5 · 2026-07-26",
      accepted_at: "2026-07-26",
    },

    // The tier the customer named, captured at acceptance. This is an INTENT —
    // it becomes a COMMITMENT only when the SO is created (sub-tab 5).
    // Canonical: customer_accepted_tier_id (here) → accepted_tier_id (at the push).
    tier_intent: {
      tier_id: "t2",
      status: "intent",
      provenance: "customer named T2 in their acceptance (email, Jul 26)",
      captured_by: "Maya Okafor",
      captured_at: "2026-07-26 16:20",
    },

    // ─── SALES ORDER RECEIPT (sub-tab 5) ────────────────────
    // What is about to go to NetSuite. Same object drives all three states —
    // "not yet" in pending, unchanged in failed, stamped in record.
    sales_order: {
      // NetSuite account the order lands under
      netsuite_customer: {                                       // NEW
        id: "CUST-3318",
        name: "Lumen & Co.",
        matched: true,                                           // false → unconfirmed-mapping flag
        matched_on: "HubSpot company ID 8841002 · auto-matched",
      },
      terms: "50% deposit on PO · balance Net 30 from ship date",
      incoterms: "FOB Long Beach",
      ship_to: "Lumen DC · 2200 Chrisman Rd, Tracy, CA 95304",
      requested_ship: "2026-10-12",

      // Order lines at the committed tier (T2 · 10,000 units per SKU)
      lines: [
        { id: "l1", code: "GLW-30",  name: "Hydra-Glow Vitamin C Serum", pack: "30 ml glass dropper",  qty: 10000, unit: 3.95 },
        { id: "l2", code: "GLW-50",  name: "Hydra-Glow Vitamin C Serum", pack: "50 ml glass dropper",  qty: 10000, unit: 6.10 },
        { id: "l3", code: "RPL-200", name: "Replenish Body Lotion",      pack: "200 ml HDPE pump",     qty: 10000, unit: 3.48 },
        { id: "l4", code: "RPL-400", name: "Replenish Body Lotion",      pack: "400 ml HDPE pump",     qty: 10000, unit: 4.60 },
      ],
      // subtotal 181,300 + one-time 4,800 = 186,100 = t2.turnkey = hubspot.amount
      one_time: [
        { id: "o1", label: "Project setup & tooling", sub: "One-time. Filling-line setup, dye-cuts, plates.", amount: 4800 },
      ],
    },

    // Pre-push flags shown on the receipt. Empty array → clean receipt.
    so_flags: [],                                                 // NEW
    so_flags_examples: {
      below_floor:  { level: "bad",  label: "Tier below margin floor", detail: "T4 is 21.6% against a 25% floor — admin override required before the order can be sent." },
      unmatched:    { level: "warn", label: "NetSuite customer unconfirmed", detail: "No exact account match for Lumen & Co. — confirm the mapping before sending, or the order lands on a new account." },
    },

    tab_status: {
      accepted: { awaiting: "awaiting send", active: "capture", done: "recorded · reversible" },
      tier:     { awaiting: "awaiting acceptance", active: "ready to send", done: "order placed", locked: "locked" },
    },

    failures: {
      hubspot: {
        code: "403",
        title: "HubSpot push failed — acceptance not recorded",
        detail: "Integration token rejected. The quote is still sent and the customer's acceptance has not been recorded. Nothing advanced; retry once the token is refreshed.",
        state_after: "sent",
      },
      netsuite: {
        code: "502",
        title: "NetSuite rejected the order — no Sales Order created",
        detail: "SuiteTalk endpoint timed out after 30s during order creation. Nothing was written to NetSuite.",
        at: "2026-07-27 14:19 PST",
        attempts: 1,
        state_after: "accepted",
      },
    },
  });
})();
