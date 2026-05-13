// Slice RI.9 step 11 audit fix (HIGH-1) — rail moved out of shared
// layout into `<NavShell>` (`src/components/nav/nav-shell.tsx`).
// The shared layout for quote-scoped surfaces is now a thin
// passthrough so Customer view can skip the rail per R7a's
// load-bearing rail XOR breadcrumb rule.
//
// Each rail-needing page wraps its content in `<NavShell>` and
// passes its own `activeScenarioLabel` (already in their existing
// quote fetch). Customer view renders bare — no rail, no offset,
// edge-to-edge under the outer workspace chrome.
//
// Why per-page rather than route-group: Next 15 layouts can't see
// the active child route segment without middleware, so
// conditional-rail-in-layout requires per-pathname headers. The
// per-page prop pass is simpler. Route groups remain available
// if a future surface joins (`(rail)/...` for the four working
// surfaces; quote stays at outer level) — re-evaluate then.

export default function QuoteLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; quoteId: string }>;
}) {
  return <>{children}</>;
}
