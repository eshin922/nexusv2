import type { SurfaceKey } from "./surface-routes";

// Slice RI.9 §6 step 5 — Inbox `Next move` derivation.
//
// Maps each warning `kind` value to the surface where the next
// decision happens. Consumed by Home inbox row rendering — each
// row's "Next move" button targets a surface URL derived via
// `resolveSurfaceHref(nextMoveForWarning(kind), projectId, quoteId)`.
//
// The full inbox renders with Slice 9.5 (validation engine signal
// coverage); RI.9 ships the derivation utility so the wiring is
// ready when inbox content lands.
//
// Default surface fallback: `costing` (Pricing). Most warnings
// originate from margin / override / customer-target decisions,
// all of which surface on Pricing. If a future warning kind
// targets a different surface, add the explicit mapping.

const WARNING_KIND_TO_SURFACE: Record<string, SurfaceKey> = {
  // Margin gates — resolution lives on Pricing
  margin_below_floor: "costing",
  margin_below_target: "costing",
  blended_below_floor: "costing",
  cell_override_required: "costing",

  // Override workflow — landed on Mark-Accepted
  admin_override_pending: "mark_accepted",
  admin_override_requested: "mark_accepted",

  // Cost-input shape issues — resolution on Costs
  pass_through_freight_missing_customs: "cost_build",
  markup_above_5x_default: "cost_build",
  cost_input_missing: "cost_build",

  // Customer-acceptance recorded but not finalized — Mark-Accepted
  customer_acceptance_pending_mark: "mark_accepted",

  // Setup-shape issues (SKU/tier configuration) — Setup
  no_tiers: "setup",
  no_skus: "setup",
};

export function nextMoveForWarning(kind: string): SurfaceKey {
  return WARNING_KIND_TO_SURFACE[kind] ?? "costing";
}
