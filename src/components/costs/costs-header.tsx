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
// Pre-Slice-11 data-binding stub — Pattern 21 dev-scaffolding (NOT
// Pattern 39 — this isn't a workflow-ergonomics divergence from
// canon, it's an unfilled data binding that ships visible-pending).
//
// Originally: `const syncLabel = "synced just now"` hardcoded
// + active pulse-dot via .live rule. Rest-of-app sweep Step 10
// Designer audit MEDIUM-1 + Edward disposition (May 2026): synthetic
// "synced just now" is PM-facing fake-current state that risks
// PMs skipping a manual pull, trusting fake freshness. Worse than
// no indicator.
//
// Bank-as-is treatment: keep the affordance shape, swap the active
// register for a visible "not-yet-wired" register. Pulse-dot
// dimmed via .meta.pending modifier (.live rule short-circuited
// via opacity); copy reads "Sync status pending · Slice 11" so
// PMs immediately register this isn't a real freshness signal.
//
// Slice 11 scope item (banked UX_BACKLOG): wire the actual
// HubSpot refresh timestamp source + resolve the semantic
// question (live-sync vs manual-pull pattern → drives whether
// pulsing dot or static freshness indicator is right). Until
// then: visible-pending.
//
// Slice RI.7 fix preserved — non-editable banner stays as separate
// page-level row (SentStatusBanner below), not jammed into the
// header flex container.


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
  void _editable;

  return (
    <div className="r7b-head">
      <div className="lhs">
        <div className="eyebrow">
          {project.clientName ?? project.dealName}
          <span className="sep">·</span>
          {quote.scenarioLabel}
          <span className="sep">·</span>
          Rev. {quote.versionNumber} {quote.status}
        </div>
        <h1>
          Costs{" "}
          <em>
            · {quote.scenarioLabel} · Rev. {quote.versionNumber}
          </em>
        </h1>
        <p className="sub">
          Three sections — Packaging, Production, Freight — feeding one cost
          stack across {tierCount} {tierWord}. Drill in to edit; the stack
          updates live.
        </p>
        {/* THE SYNC INDICATOR IS GONE, not wired.

            It shipped as Pattern 21 visible-pending scaffolding awaiting
            "Slice 11 HubSpot data binding". Slice 11 has since shipped and the
            binding was never made, because there is nothing on this surface for
            it to bind to: Costs holds PM-entered cost inputs, which are not
            synced from HubSpot at all. The indicator was not merely unwired, it
            was measuring a thing this page does not have.

            Soak run 1 logged it as reading like development scaffolding, which
            is exactly what it was, on an operator surface. The freshness signal
            that IS real — when this project's HubSpot context was last pulled —
            already lives in the project header, where the refresh action is.

            Removed rather than relabelled: a status row that reports no status
            is not a status row, and leaving the shape in place reserves a
            promise nothing intends to keep. */}
      </div>
      {/*
        The action cluster is removed, container included.
        "View as customer" was a sideways glance to the Quote surface — the
        inner rail already links there, so it was a second route to one place.
        "Save draft" had no `onClick` at all: Costs autosaves, so it was a
        primary-weight button that did nothing, which is worse than absent —
        an operator who pressed it learned nothing and may have believed it
        was the thing that saved their work.
        The empty `.actions` div goes too, so the header does not reserve
        space for a cluster that no longer exists.
      */}
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
      Editing is disabled. Use Revise from Client Review to create the next
      draft revision.
    </div>
  );
}
