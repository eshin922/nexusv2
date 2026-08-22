import "server-only";
import { InnerRail } from "@/components/rails/inner-rail";
import { shouldShowRail } from "@/lib/nav/surface-meta";
import type { SurfaceKey } from "@/lib/nav/surface-routes";

// Slice RI.9 step 11 audit fix (HIGH-1) — structural rail XOR.
//
// Before this slice the InnerRail was mounted in the shared
// `[quoteId]/layout.tsx`, so EVERY quote-scoped surface rendered it
// — including Customer view (`/quote`), which is rail-shed per
// R7a's load-bearing one-IA-signal rule (print-preview metaphor;
// breadcrumb replaces rail). The XOR was only encoded in
// `surface-meta.ts` config and the layout never read it — meaning
// the R7a invariant was convention, not structure.
//
// `<NavShell>` makes the rail render conditional on
// `shouldShowRail(surfaceKey)`. Rail-needing pages wrap their
// content in this component; Customer view skips it and renders
// its content directly. The shared layout becomes a thin
// passthrough.
//
// Companion fix: ties `shouldShowRail` (previously dead-code
// exported helper) to its sole caller — the helper is now the
// single source of truth for the rail decision.
//
// Trade-off accepted: each rail-needing page must pass
// `activeScenarioLabel` (cheap — already in their own quote
// fetch). Centralizing back into the layout would require
// per-pathname headers (Next 15 layouts can't see active child
// route segment without middleware), more complex than the
// per-page prop pass.

export function NavShell({
  surfaceKey,
  projectId,
  activeScenarioLabel,
  quoteId,
  children,
}: {
  surfaceKey: SurfaceKey;
  projectId: string;
  activeScenarioLabel?: string;
  quoteId: string;
  children: React.ReactNode;
}) {
  if (!shouldShowRail(surfaceKey)) {
    // Rail-shed surface (Customer view). No rail, no offset —
    // page renders edge-to-edge under the outer workspace chrome.
    return <>{children}</>;
  }
  return (
    <div className="min-h-screen">
      <InnerRail
        projectId={projectId}
        activeScenarioLabel={activeScenarioLabel}
        activeQuoteId={quoteId}
      />
      <div className="inner-rail-offset">{children}</div>
    </div>
  );
}
