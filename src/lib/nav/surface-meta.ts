// Slice RI.9 § 3.6 — Surface-render rules table.
//
// Per-surface metadata driving:
//   - <Eyebrow> vs <Breadcrumb> selection (XOR rule per § 3.2)
//   - Action cluster slot population (primary/secondary/back)
//   - <YourNextMoveBanner> state + CTA copy
//
// Encoded as TypeScript constant keyed by SurfaceKey. R7a load-
// bearing rule: shouldShowBreadcrumb = !shouldShowRail
// (one IA signal per surface, never both, never neither).

import type { SurfaceKey } from "./surface-routes";

export type ActionLabel = string;

export type SurfaceMeta = {
  /** Inner rail visible on this surface? Drives the XOR with breadcrumb. */
  railVisible: boolean;
  /**
   * Forward next-move banner copy. Falls back to `gatedLabel` when the
   * surface's gate is active (e.g., below-floor on Costing).
   */
  nextMove: {
    label: ActionLabel;
    /** Used when the next-move is gated (banner CTA shows resolution path). */
    gatedLabel?: ActionLabel;
  } | null; // null = terminal (no banner CTA)
  /** Primary action — right of cluster. Forward-pointing. */
  primaryAction: ActionLabel | null;
  /** Secondary actions — middle of cluster. Non-forward, non-back. */
  secondaryActions: ActionLabel[];
  /**
   * Back-direction affordance — left of vertical divider in cluster.
   * Destination-only per Pushback 3 (e.g., "← Cost build" not
   * "← Resume Cost build").
   */
  backAction: { destination: SurfaceKey; label: ActionLabel } | null;
};

/**
 * Slice RI.9 § 3.6 — canonical render rules per surface.
 *
 * Display labels follow Slice RI.8 surface naming canon (Costs /
 * Pricing / Quote) even though the keys stay underscore-form for
 * R7a continuity.
 */
export const SURFACE_META: Record<SurfaceKey, SurfaceMeta> = {
  setup: {
    railVisible: true,
    // §6.b Step 1 amendment — R7b canon strings per Edward smoke
    // (RI.9 shipped "Open costs →" / "+ New scenario"; R7b
    // specifies "Continue to Cost build →" + "+ Add SKU").
    nextMove: { label: "Continue to Cost build →" },
    primaryAction: "Save draft",
    secondaryActions: ["+ Add SKU"],
    backAction: null,
  },
  cost_build: {
    railVisible: true,
    nextMove: { label: "Review pricing →" },
    primaryAction: "Save draft",
    secondaryActions: ["View as customer", "+ New version"],
    backAction: null,
  },
  costing: {
    railVisible: true,
    nextMove: {
      label: "Preview quote PDF →",
      // Below-floor: CTA points at resolution, not forward.
      gatedLabel: "Resolve override before sending →",
    },
    primaryAction: "Mark accepted",
    // RI.9 step 10 smoke: cluster `Preview` dropped — redundant with
    // banner default CTA ("Preview quote PDF →") which targets the
    // same customer_view surface. R7a §5 placement canon: forward
    // affordances belong in the banner; cluster carries
    // workflow-state affordances only.
    secondaryActions: ["Customer accepted (manual)"],
    backAction: null,
  },
  customer_view: {
    // R7a load-bearing decision: shed inner rail on Customer view
    // (print-preview metaphor). Breadcrumb appears in its place.
    railVisible: false,
    nextMove: { label: "Send to customer →" },
    primaryAction: "Send to customer",
    secondaryActions: ["↓ Download PDF", "Edit notes"],
    backAction: null,
  },
  mark_accepted: {
    railVisible: true,
    // Terminal surface — banner reads "Terminal surface — return
    // via Home or rail." with no CTA in the muted state. Default
    // pre-acceptance state still gets a "Confirm acceptance" CTA
    // — encoded as nextMove since the banner adapts visually
    // based on `quote.status === 'accepted'`.
    nextMove: { label: "Confirm acceptance →" },
    primaryAction: "Confirm acceptance",
    secondaryActions: ["Request admin override"],
    backAction: { destination: "cost_build", label: "← Costs" },
  },
};

/**
 * Slice RI.9 § 3.2 — XOR rule encoded as a single function.
 * shouldShowBreadcrumb(surface) = !shouldShowRail(surface)
 */
export function shouldShowBreadcrumb(surface: SurfaceKey): boolean {
  return !SURFACE_META[surface].railVisible;
}

export function shouldShowRail(surface: SurfaceKey): boolean {
  return SURFACE_META[surface].railVisible;
}
