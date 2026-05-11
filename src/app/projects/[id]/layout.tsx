import "server-only";
import { InnerRail } from "@/components/rails/inner-rail";
import { recordProjectVisit } from "@/app/actions/workspace";

// Slice RI.2 — project surface layout. Wraps any /projects/[id]/...
// page with the inner rail (240px wide; left of main content, right
// of outer rail). Records the visit to the user's MRU list so
// Recent rail updates on every project nav.
//
// activeQuoteId prop on InnerRail: not derivable here at the
// project-root layout (would need URL parsing or per-page-passed
// context). For RI.2 the inner rail just shows the scenario list
// without "active scenario" highlight; RI.3+ can wire activeQuoteId
// via segments parsed from a deeper layout if needed.

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

  return (
    <div className="min-h-screen">
      <InnerRail projectId={id} />
      {/* Main content offset by inner rail (240px). Outer rail's
          56px padding already applied by AppShell at the root. */}
      <div className="pl-60">{children}</div>
    </div>
  );
}
