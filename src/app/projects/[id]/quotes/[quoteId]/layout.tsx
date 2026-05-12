import "server-only";
import { InnerRail } from "@/components/rails/inner-rail";

// Slice RI.8 F-1 fix — quote-scoped layout. Renders InnerRail
// with activeQuoteId derived from the route param. This is the
// load-bearing fix Round 4's canonical sub-rail navigation has
// been waiting for — `/projects/[id]/layout.tsx` never had access
// to quoteId, so InnerRail received `activeQuoteId=undefined`
// and the per-scenario sub-rail (Setup / Cost build / Costing
// sheet / Customer view) never expanded for the active scenario.
//
// Layout composition (Next 15):
//   /projects/[id]/layout.tsx                — records visit only (no rail)
//   /projects/[id]/quotes/[quoteId]/layout.tsx — this file (rail + offset)
//   /projects/[id]/page.tsx                  — Project Detail; renders its
//                                              own rail (no activeQuoteId)
//
// Double-rail render avoided because the project layout no longer
// renders a rail (see comment in projects/[id]/layout.tsx).

export default async function QuoteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;

  return (
    <div className="min-h-screen">
      <InnerRail projectId={id} activeQuoteId={quoteId} />
      {/* Main content offset by inner rail (240px). Outer rail's
          56px padding already applied by AppShell at the root. */}
      <div className="pl-60">{children}</div>
    </div>
  );
}
