// Slice RI.6 — PdfPage wrapper.
//
// This component AND ALL DESCENDANTS form the customer-view boundary
// guard: imports limited to React + sibling pdf/* components +
// @/types/quote. NO costing, no schema, no internal-only-badge,
// no theme tokens (literal OKLCH only — see r3-quote.css).
//
// Boundary verified by scripts/verify/quote-boundary.ts.

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
