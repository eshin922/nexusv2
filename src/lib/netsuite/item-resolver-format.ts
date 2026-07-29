// Slice 12 Step 8c-1 — Item resolver PURE formatting helpers.
//
// Split from `./item-resolver.ts` because the resolver module depends
// on the NetSuite client + SuiteQL (which chain into node:crypto +
// drizzle + server-only). Isolating the pure text-formatting layer lets
// unit tests exercise the exact PM-facing copy without needing the
// full stack loaded.

import type { ResolveResult } from "./item-resolver-types";

export type { ResolveResult } from "./item-resolver-types";

/**
 * Format a human-readable error message for the failed-tab UI when
 * any resolution fails. Names the offending SKUs and, for each,
 * says what has to happen next. This text is what the PM reads on
 * the failed-tab after a Send attempt — must be forwardable without
 * a follow-up question (CA discipline, mirrors formatCustomerMissingError).
 */
export function formatResolutionErrors(
  results: ResolveResult[],
): string | null {
  const failures = results.filter(
    (r) => r.status === "not_found" || r.status === "ambiguous",
  );
  if (failures.length === 0) return null;
  const lines = failures.map((r) => {
    if (r.status === "not_found") {
      return `  • ${r.sku} — no matching NetSuite item. Create the item in NetSuite (Setup → Items → New Item) with SKU "${r.sku}", then retry the send.`;
    }
    // ambiguous — matches ≥2 items with the same itemid. Includes the
    // internal ids of the collisions so a NetSuite admin can go
    // straight to them without a search.
    const ids = r.matches.map((m) => m.netsuiteItemId).join(", ");
    return `  • ${r.sku} — ${r.matches.length} matching NetSuite items (internal ids: ${ids}). A NetSuite admin must reconcile itemid uniqueness (rename or inactivate the duplicates), then retry the send.`;
  });
  const skuNoun = failures.length === 1 ? "SKU" : "SKUs";
  const tail =
    failures.length === 1
      ? "did not resolve to a NetSuite item"
      : "did not resolve to NetSuite items";
  return `Cannot send — ${failures.length} ${skuNoun} ${tail}:\n${lines.join("\n")}`;
}
