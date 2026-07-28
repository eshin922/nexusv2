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
 * Format a human-readable error message for the blocking-tab UI when
 * any resolution fails. Names the offending SKUs and their statuses;
 * this text goes to the PM verbatim.
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
      return `  • ${r.sku}: no matching NetSuite item found`;
    }
    return `  • ${r.sku}: ${r.matches.length} matching NetSuite items (ambiguous — administrator must reconcile itemid uniqueness)`;
  });
  return `Cannot resolve ${failures.length} NetSuite item${failures.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}
