// Slice RI.6 — PdfPage wrapper.
//
// This component AND ALL DESCENDANTS form the customer-view boundary
// guard: imports limited to React + sibling pdf/* components +
// @/types/quote. NO costing, no schema, no internal-only-badge,
// no audit-log, no action-layer imports.
//
// Theme-token consumption is FINE for the pdf/* subtree (canonical
// R3 register in r3-shared.css uses var(--paper-2), var(--rule),
// etc.). Earlier comment claim "literal OKLCH only" referred to
// the pre-RI.0 nexus-authored r3-quote.css; that file has since
// been renamed to r3-shared.css under Pattern 30 path-B-namespace-
// scoped adoption (rest-of-app sweep Step 4), and token consumption
// is now consistent with every other surface's body canon.
//
// The boundary's real invariant is "no costing / schema / action /
// internal-only imports" — verified by scripts/verify/
// customer-view-boundary.ts at prebuild.

import type { ReactNode } from "react";

export function PdfPage({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="pdf-page">
      <div>{children}</div>
      {footer}
    </div>
  );
}
