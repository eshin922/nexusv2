// Slice RI.9 § 3.5 — Surface-routes table.
//
// Canonical map: surface key → URL pattern + forward/backward
// targets. Single source of truth for surface routing.
//
// Consumers:
//   - Resume card CTA href derivation
//   - Home inbox "Next move" jump
//   - <Breadcrumb /> segment list (when rail is shed)
//   - <YourNextMoveBanner /> forward CTA
//   - Action cluster back-direction labels
//
// Encoded as a TypeScript constant rather than a DB config table
// because the values are code-level invariants (route patterns
// match the file-system routing). If we ever expose runtime
// reconfiguration, promote to a DB table.

export type SurfaceKey =
  | "setup"
  | "cost_build"
  | "costing"
  | "customer_view"
  | "mark_accepted";

export type SurfaceRoute = {
  /** URL pattern with `:id` (project) + `:qid` (quote) tokens. */
  routePattern: string;
  /** Surface this one normally advances TO. NULL = terminal. */
  forwardTo: SurfaceKey | null;
  /** Surface this one normally returns TO (back-direction). NULL = no canonical back. */
  backwardTo: SurfaceKey | null;
  /** Display label used in breadcrumb segments + back-direction copy. */
  displayLabel: string;
};

// Slice RI.8 surface-naming canon — display labels follow the
// renamed surfaces (Costs / Pricing / Quote), keys keep the
// underscore form used by R7a designer notes for stability.
export const SURFACE_ROUTES: Record<SurfaceKey, SurfaceRoute> = {
  setup: {
    routePattern: "/projects/:id/quotes/:qid",
    forwardTo: "cost_build",
    backwardTo: null,
    displayLabel: "Setup",
  },
  cost_build: {
    // RI.8 renamed /cost-build → /costs. Route pattern uses the
    // production URL; display label too.
    routePattern: "/projects/:id/quotes/:qid/costs",
    forwardTo: "costing",
    backwardTo: null,
    displayLabel: "Costs",
  },
  costing: {
    // RI.8 renamed /costing → /pricing.
    routePattern: "/projects/:id/quotes/:qid/pricing",
    forwardTo: "customer_view",
    backwardTo: null,
    displayLabel: "Pricing",
  },
  customer_view: {
    // RI.8 renamed /customer-view → /quote.
    routePattern: "/projects/:id/quotes/:qid/quote",
    forwardTo: "mark_accepted",
    backwardTo: "costing",
    displayLabel: "Quote",
  },
  mark_accepted: {
    routePattern: "/projects/:id/quotes/:qid/mark-accepted",
    // Terminal — no canonical next move once accepted.
    forwardTo: null,
    // Override flow returns to Cost build (Costs).
    backwardTo: "cost_build",
    displayLabel: "Mark accepted",
  },
};

/**
 * Resolve a surface route pattern to a concrete URL.
 * Slice RI.9 § 3.5 — derives surface URLs from the canonical table.
 */
export function resolveSurfaceHref(
  surface: SurfaceKey,
  projectId: string,
  quoteId: string,
): string {
  const pattern = SURFACE_ROUTES[surface].routePattern;
  return pattern.replace(":id", projectId).replace(":qid", quoteId);
}

/**
 * Breadcrumb path TO a target surface — returns the upstream chain.
 * Slice RI.9 § 3.2 — Breadcrumb segments derived from this list.
 * For Quote (customer_view): [Setup, Costs, Pricing, Quote]
 */
export function breadcrumbPath(target: SurfaceKey): SurfaceKey[] {
  // Walk forwardTo chain in reverse from setup until we hit target.
  // Manual order — small (≤5 surfaces) and stable.
  const order: SurfaceKey[] = [
    "setup",
    "cost_build",
    "costing",
    "customer_view",
    "mark_accepted",
  ];
  const idx = order.indexOf(target);
  if (idx < 0) return [target];
  return order.slice(0, idx + 1);
}
