// Slice RI.4 — Cost Build page header per R6 actual source
// (`docs/design-prototypes/dist/source/round-6/index.html` lines
// 2346-2365 + cost-build-page.jsx lines 81-98).
//
// R6 anchors page identity on FUNCTION ("Cost build · Primary v3"
// italic display 30px) with the scenario as a desaturated em-tag.
// Project/client identity stays in rail/inbox surfaces, NOT on the
// cost-build header. Designer Pattern 1 audit Path A.
//
// Meta strip = sync state + HubSpot stage (TWO items, mono caption).
// NOT a navigation row. Per Designer audit S-16: stripping the
// breadcrumb links + status pill that drifted in earlier.
// Right-cluster: View as customer + Save draft buttons.

export function CostBuildHeader({
  project,
  quote,
  tierCount,
  editable,
  children,
}: {
  project: { id: string; dealName: string; clientName: string | null };
  quote: {
    id: string;
    scenarioLabel: string;
    versionNumber: number;
    status: string;
  };
  tierCount: number;
  editable: boolean;
  children?: React.ReactNode;
}) {
  // Sub copy matches R6 verbatim (cost-build-page.jsx:84-86). R6
  // hardcodes "Three sections" because Bulk Raw is the conditional
  // peer per R6.1 addendum — primary IA is three sections feeding
  // the cost stack; Bulk Raw is the raws-mode-declaration zone.
  const tierWord = tierCount === 1 ? "tier" : "tiers";

  // HubSpot sync timestamp — UX_BACKLOG entry "Pulse-dot live HubSpot
  // sync indicator" tracks wiring real timestamp + stage. v1: stub.
  const syncLabel = "synced just now";

  return (
    <header className="r6-page-head mb-[22px] flex items-end justify-between gap-6">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 font-display text-[30px] font-medium italic leading-tight tracking-[-0.012em] text-ink">
          Cost build{" "}
          <em className="not-italic font-normal text-ink-3">
            · {quote.scenarioLabel} v{quote.versionNumber}
          </em>
        </h1>

        {/* Sub copy — R6 verbatim (cost-build-page.jsx:84-86) */}
        <p
          className="m-0 mt-1 text-[13px] text-ink-3"
          style={{ maxWidth: "64ch" }}
        >
          Three sections — Packaging, Production, Freight — feeding one cost
          stack across {tierCount} {tierWord}. Drill in to edit; the stack
          updates live.
        </p>

        {/* Meta strip: pulse + sync state + HubSpot stage. Two-item
            mono caption per R6 (NOT nav row). */}
        <div className="mt-2 flex items-center gap-3.5 font-mono text-[10.5px] tracking-[0.04em] text-ink-4">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: "var(--good)",
              boxShadow: "0 0 0 3px var(--good-soft)",
            }}
          />
          <span>Synced to HubSpot · {syncLabel}</span>
          <span>·</span>
          <span>{project.clientName ?? project.dealName}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* View as customer — default .btn variant per R6
            (index.html:517-528). Sentence case, Instrument Sans 13px,
            paper bg + rule-2 border + 6px radius + 7px×12px padding. */}
        <button
          type="button"
          title="Customer preview ships in Slice 11"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-rule-2 bg-paper text-[13px] font-medium text-ink transition-all hover:bg-paper-2 hover:border-ink-4"
          style={{ padding: "7px 12px" }}
        >
          View as customer →
        </button>
        {/* Save draft — .btn.primary per R6 (index.html:531-535).
            Ink bg + paper text. Nexus auto-saves; this is reinforcement. */}
        <button
          type="button"
          title="Saved automatically"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border text-[13px] font-medium transition-all"
          style={{
            padding: "7px 12px",
            background: "var(--ink)",
            color: "var(--paper)",
            borderColor: "var(--ink)",
          }}
        >
          Save draft
        </button>
        {children}
      </div>

      {!editable && (
        <div
          role="alert"
          className="mt-3 rounded border border-warn/40 bg-warn-soft p-3 text-xs text-warn"
        >
          This quote is in <span className="font-mono">{quote.status}</span>{" "}
          status. Editing is disabled. Create a new draft version from the
          project page to make changes.
        </div>
      )}
    </header>
  );
}
