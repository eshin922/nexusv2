import Link from "next/link";

// Slice RI.4 — Cost Build page header. Replaces the per-page chrome
// from the old /packaging /production /freight pages with a single
// page-level header strip per Round 6.

export function CostBuildHeader({
  project,
  quote,
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
  editable: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 border-b border-rule pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
            Cost build · {quote.scenarioLabel} v{quote.versionNumber}
          </div>
          <h1 className="mt-1 font-display text-2xl text-ink">
            {project.clientName ?? project.dealName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Link
              href={`/projects/${project.id}/quotes/${quote.id}`}
              className="hover:text-accent-ink"
            >
              ← Quote builder
            </Link>
            <span>·</span>
            <Link
              href={`/projects/${project.id}/quotes/${quote.id}/costing`}
              className="hover:text-accent-ink"
            >
              Costing sheet →
            </Link>
            <span>·</span>
            <span
              className={`rounded border px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide ${
                quote.status === "draft"
                  ? "border-warn/40 bg-warn-soft text-warn"
                  : quote.status === "sent"
                    ? "border-accent/40 bg-accent-soft text-accent-ink"
                    : "border-good/40 bg-good-soft text-good"
              }`}
            >
              {quote.status.toUpperCase()}
            </span>
          </div>
        </div>
        {children && <div className="shrink-0">{children}</div>}
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
