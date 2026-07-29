import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessDeniedBanner } from "@/components/access-denied-banner";
import { DealOrganizerProjectList } from "@/components/deal-organizer/project-list";
import { getDealOrganizerProjects } from "@/lib/workspace-queries";
import { ResumeCard } from "@/components/nav/resume-card";
import {
  getNowTierWarningCount,
  getResumeContext,
} from "@/lib/nav/home-queries";
import { ensureUser } from "@/lib/auth/ensure-user";
import { getApplicationDependencies } from "@/lib/integrations/composition";

// Slice RI.2 — Home page rebuilt as the Round 4 Deal Organizer.
// Three sections (top to bottom):
//   1. "What's my move" inbox — DEFERRED placeholder (CD pushback #1:
//      ships only after Slice 9.5 signal coverage validates)
//   2. Project list with filter chips (Round 4 healthy/sparse/empty)
//   3. Top-right action bar: Import from HubSpot (modal — Slice
//      RI.deferred for the modal swap; for RI.2 it's still a link)
//      + New project
//
// Three list states per Round 4:
//   - empty: zero projects → empty-set glyph + Import-from-HubSpot CTA
//   - sparse: <5 projects → list + reduced inbox-stub
//   - healthy: 5+ projects → full list + (placeholder inbox section)

export default async function Home() {
  const { authentication } = await getApplicationDependencies();
  const identity = await authentication.identity.current();
  if (!identity) {
    redirect("/sign-in");
  }

  const name = identity.firstName ?? identity.email;

  // Slice RI.9 §6 step 4 — Resume card data. ensureUser() is the
  // same Clerk→users-table bridge used elsewhere; needed for the
  // user_surface_visits.userId FK shape.
  const dbUser = await ensureUser();
  const [resumeContext, nowTierCount, projectRows] = await Promise.all([
    getResumeContext(dbUser.id),
    getNowTierWarningCount(),
    getDealOrganizerProjects(),
  ]);
  const isEmpty = projectRows.length === 0;

  return (
    <main className="min-h-screen">
      <Suspense fallback={null}>
        <AccessDeniedBanner />
      </Suspense>

      <div className="mx-auto max-w-7xl px-8 py-8">
        {/* Header strip */}
        <div className="mb-6 flex items-end justify-between gap-4 border-b border-rule pb-4">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
              Deal organizer
            </div>
            <h1 className="mt-1 font-display text-3xl font-medium text-ink">
              Hello, {name}.
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/import"
              className="rounded border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-paper hover:bg-accent-ink"
            >
              Import from HubSpot
            </Link>
            {/* + New project: button shown but not yet wired in RI.2;
                same treatment as Import for visual rhythm. Functional
                wiring deferred (existing /import covers HubSpot path;
                the "New project" purely-Nexus flow lands later). */}
            <button
              type="button"
              disabled
              title="New project (Nexus-only) — coming soon"
              className="rounded border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-ink-3 disabled:cursor-not-allowed"
            >
              + New project
            </button>
          </div>
        </div>

        {/* Slice RI.9 §6 step 4 — Resume card + inbox stacked.
            Resume card reads the latest user_surface_visits row;
            inbox stays placeholder until Slice 9.5 validation
            engine ships signal coverage. */}
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <ResumeCard
            context={resumeContext}
            nowTierCount={nowTierCount}
          />

          {/* "What's my move" inbox — DEFERRED placeholder. Per CD
              Pushback #1: ships after Slice 9.5 signal coverage.
              Anchor id matches Resume card's "Check inbox first"
              chip target. */}
          <section
            id="whats-my-move"
            className="rounded-md border border-dashed border-rule bg-paper-2 p-4"
          >
            <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-4">
              What's my move
              {nowTierCount > 0 && (
                <span className="ml-2 text-ink-3">
                  · {nowTierCount} now-tier item{nowTierCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm italic text-ink-4">
              Inbox shipping with the validation engine.
            </p>
          </section>
        </div>

        {/* Project list */}
        {isEmpty ? (
          <EmptyState />
        ) : (
          <DealOrganizerProjectList rows={projectRows} />
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-rule bg-paper-2 px-6 py-16 text-center">
      <div className="font-display text-2xl text-ink">No deals yet</div>
      <p className="max-w-md text-sm text-ink-3">
        Import a deal from HubSpot to start building quotes, or create a
        Nexus-only project from scratch.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Link
          href="/import"
          className="rounded border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-paper hover:bg-accent-ink"
        >
          Import from HubSpot
        </Link>
      </div>
    </div>
  );
}
