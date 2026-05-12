import "server-only";
import { recordProjectVisit } from "@/app/actions/workspace";

// Slice RI.2 — project surface layout. Records the visit to the
// user's MRU list so Recent rail updates on every project nav.
//
// Slice RI.8 (F-1 fix) — InnerRail rendering moved OUT of this
// layout. Reason: the inner rail needs `activeQuoteId` to expand
// the sub-rail (Setup / Cost build / Costing sheet / Customer
// view) on quote-scoped surfaces. The project-root layout can't
// see deeper URL segments without parsing them, but the
// /quotes/[quoteId]/ layout CAN — quoteId is a route param at
// that level. So the rail rendering moved to:
//
//   - src/app/projects/[id]/page.tsx (Project Detail — renders
//     rail with activeQuoteId=null; no sub-rail expansion)
//   - src/app/projects/[id]/quotes/[quoteId]/layout.tsx (quote
//     layout — renders rail with the active quoteId from route
//     param; sub-rail expansion works as Round 4 designed)
//
// Double-rail risk avoided: this layout no longer renders a rail,
// so the deeper quote layout's rail is the only one. Same shape
// for Project Detail.

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Background: record the visit. Failures swallowed by the action.
  await recordProjectVisit(id);

  return <>{children}</>;
}
