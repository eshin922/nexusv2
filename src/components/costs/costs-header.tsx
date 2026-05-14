// §6.b path-B Costs migration commit 2/5 — canonical r6-page-head
// structure per r6_page.jsx lines 81-98 + 6styles.css .r6-page-head
// rules. Drops Eyebrow + ActionCluster primitives in favor of inline
// canonical structure (matches Setup path-B precedent).
//
// Title: "Costs" preserves Slice RI.8 surface naming canon
// ("Cost build → Costs" rename); canonical R6 prototype predates the
// rename. The scenario · vN tag renders inline as <em> per canonical
// h1 grammar; canonical CSS handles the non-italic ink-3 styling.
//
// Slice RI.7 fix preserved — non-editable banner stays as separate
// page-level row (SentStatusBanner below), not jammed into the header
// flex container.

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
    <div className="r6-page-head">
      <div>
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
        <div className="meta">
          <span className="live" aria-hidden />
          <span>Synced to HubSpot · {syncLabel}</span>
          <span>·</span>
          <span>{project.clientName ?? project.dealName}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
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
