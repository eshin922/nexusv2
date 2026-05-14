// Sweep Step 2 — Costs page chrome migration. Migrated from
// canonical `.r6-page-head` (R6 body canon's own chrome) to
// canonical `.r7b-head` (R7b chrome canon per the dual-canon
// discipline declared in `docs/rest-of-app-fidelity-sweep-brief.md`
// §0). Setup ships this structure post-§6.b; Costs adopts it now
// for chrome parity across all quote-scoped surfaces.
//
// Chrome canon (R7b):
//   .r7b-head — 1fr/auto grid + 18px padding-bottom + bottom rule
//     .lhs — flex column 6px gap min-width:0
//       .eyebrow — mono 10/0.16em uppercase ink-3 with .sep dividers
//       <h1> — display 30 italic 500 -0.012em; <em> 22 ink-3 normal
//       <p class="sub"> — 13 ink-3 max-width 64ch
//     .actions — flex 8px gap flex-shrink:0
//
// Surface-extension (Pattern 39 nexus extension):
//   .r6-page-head-sync — small below-eyebrow status strip preserving
//   the R6 pulse-dot + sync-timestamp affordance. Distinct semantic
//   from .eyebrow (identity); kept because data-freshness is a
//   Costs-specific affordance PMs read at scan speed. Lives in
//   r6-cost-build.css canonical CSS (already there as .r6-page-head
//   .meta + .live rules); we preserve the markup so the canonical
//   CSS still applies.
//
// Slice RI.7 fix preserved — non-editable banner stays as separate
// page-level row (SentStatusBanner below), not jammed into the
// header flex container.

import Link from "next/link";

export function CostsHeader({
  project,
  quote,
  tierCount,
  editable: _editable, // signature preserved for back-compat
  children,
}: {
  project: { id: string; dealName: string; clientName: string | null };
  quote: {
    id: string;
    scenarioLabel: string;
    versionNumber: number;
    status: string;
    projectId: string;
  };
  tierCount: number;
  /** @deprecated banner moved out of this component; see SentStatusBanner below */
  editable?: boolean;
  children?: React.ReactNode;
}) {
  const tierWord = tierCount === 1 ? "tier" : "tiers";
  // HubSpot sync timestamp — UX_BACKLOG entry "Pulse-dot live HubSpot
  // sync indicator" tracks wiring real timestamp + stage. v1: stub.
  const syncLabel = "synced just now";
  void _editable;

  return (
    <div className="r7b-head">
      <div className="lhs">
        <div className="eyebrow">
          {project.clientName ?? project.dealName}
          <span className="sep">·</span>
          {quote.scenarioLabel}
          <span className="sep">·</span>
          v{quote.versionNumber} {quote.status}
        </div>
        <h1>
          Costs{" "}
          <em>
            · {quote.scenarioLabel} v{quote.versionNumber}
          </em>
        </h1>
        <p className="sub">
          Three sections — Packaging, Production, Freight — feeding one cost
          stack across {tierCount} {tierWord}. Drill in to edit; the stack
          updates live.
        </p>
        {/* Pattern 39 nexus extension — pulse-dot sync indicator
            specific to Costs (data freshness PMs read at scan speed).
            Canonical .r6-page-head .meta + .live rules apply via
            r6-cost-build.css; markup preserved so CSS still binds.
            Sits below the .sub paragraph as a Costs-specific affordance,
            not a chrome canon element. */}
        <div className="meta">
          <span className="live" aria-hidden />
          <span>Synced to HubSpot · {syncLabel}</span>
        </div>
      </div>
      <div className="actions">
        {/* Slice RI.9 § 5.1 — "View as customer" canonical sideways
            glance affordance. Routes to Quote, bypassing Pricing. */}
        <Link
          href={`/projects/${quote.projectId}/quotes/${quote.id}/quote`}
          className="btn"
        >
          View as customer →
        </Link>
        {/* + New version — inert v1; wiring lands with scenario
            versioning workflow (UX_BACKLOG). */}
        <button
          type="button"
          className="btn"
          disabled
          title="+ New version — wiring lands with scenario versioning slice"
        >
          + New version
        </button>
        <button
          type="button"
          className="btn primary"
          title="Saved automatically"
        >
          Save draft
        </button>
      </div>
      {children}
    </div>
  );
}

// Slice RI.7 — page-level state notice for non-draft quotes. Renders
// as a full-width row below the header so the title + action cluster
// keep their original layout proportions.
export function SentStatusBanner({ status }: { status: string }) {
  return (
    <div
      role="alert"
      style={{
        marginBottom: 22,
        padding: 12,
        background: "var(--warn-soft)",
        border: "1px solid oklch(from var(--warn) l c h / 0.40)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--warn)",
      }}
    >
      This quote is in{" "}
      <span style={{ fontFamily: "var(--mono)" }}>{status}</span> status.
      Editing is disabled. Create a new draft version from the project page
      to make changes.
    </div>
  );
}
