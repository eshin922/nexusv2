import "server-only";
import Link from "next/link";
import {
  getProjectHeader,
  getProjectScenarios,
} from "@/lib/workspace-queries";
import { ProjectGlyph } from "./project-glyph";

// Slice RI.2 — Round 4 inner rail (240px wide). Renders only when on
// a project surface. Composition (top to bottom):
//   - Back-to-all-deals link (top)
//   - Project header (client + deal + stage + synced metadata)
//   - Scenarios list (with margin pip + draft-after-send warning chips)
//   - Sub-rail expansion under active scenario (Setup / Cost build /
//     Costing sheet / Customer view links) — basic version in RI.2;
//     RI.3 adds the activity feed
//   - Mini activity feed — DEFERRED to RI.3 (needs activity log read
//     query + project-scoped filter; ships with Project Detail rebuild)

export async function InnerRail({
  projectId,
  activeQuoteId,
}: {
  projectId: string;
  activeQuoteId?: string;
}) {
  const [header, scenarios] = await Promise.all([
    getProjectHeader(projectId),
    getProjectScenarios(projectId),
  ]);

  if (!header) return null;

  // Determine the "active" scenario based on which quote is being
  // viewed (if any). Scenario surface links expand under the active one.
  const activeScenarioLabel = activeQuoteId
    ? scenarios.find((s) => s.latestQuoteId === activeQuoteId)?.scenarioLabel
    : undefined;

  // Per Round 4 + Round 4 pushback #2: dropped scenarios collapse to
  // "+N dropped" disclosure when count > 3. Active and accepted always
  // expanded.
  const activeOrAcceptedScenarios = scenarios.filter(
    (s) => s.scenarioStatus !== "dropped",
  );
  const droppedScenarios = scenarios.filter(
    (s) => s.scenarioStatus === "dropped",
  );

  return (
    <aside
      className="fixed left-14 top-0 z-20 flex h-screen w-60 flex-col overflow-y-auto px-3 py-3"
      style={{
        background: "var(--paper)",
        borderRight: "1px solid var(--rule)",
      }}
    >
      {/* Back to all deals */}
      <Link
        href="/"
        className="mb-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink"
      >
        <span aria-hidden>←</span>
        <span>All deals</span>
      </Link>

      {/* Project header */}
      <div className="mb-4 flex items-start gap-2.5 border-b border-rule pb-3">
        <ProjectGlyph
          glyph={header.glyph}
          projectName={header.clientName ?? header.dealName}
          size="md"
        />
        <div className="min-w-0 flex-1">
          {header.clientName && (
            <div className="truncate font-display text-sm italic text-ink-3">
              {header.clientName}
            </div>
          )}
          <div className="truncate text-xs text-ink-2">{header.dealName}</div>
          {header.dealStage && (
            <div className="mt-1 inline-block rounded border border-rule px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-ink-3">
              {header.dealStage}
            </div>
          )}
        </div>
      </div>

      {/* Scenarios */}
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
        Scenarios
      </div>

      {scenarios.length === 0 && (
        <div className="text-xs italic text-ink-4">No scenarios yet</div>
      )}

      <div className="flex flex-col gap-0.5">
        {activeOrAcceptedScenarios.map((s) => {
          const isActive = activeScenarioLabel === s.scenarioLabel;
          const statusColor =
            s.scenarioStatus === "accepted" ? "text-good" : "text-ink-2";
          return (
            <div key={s.scenarioLabel}>
              <Link
                href={`/projects/${projectId}/quotes/${s.latestQuoteId}/costing`}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${
                  isActive
                    ? "bg-paper-3 font-medium text-ink"
                    : `${statusColor} hover:bg-paper-3`
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {s.isRecommended && (
                    <span title="Recommended" className="text-accent">
                      ★
                    </span>
                  )}
                  <span className="truncate">{s.scenarioLabel}</span>
                  <span className="font-mono text-[10px] text-ink-4">
                    v{s.latestVersionNumber}
                  </span>
                </span>
                {s.scenarioStatus === "accepted" && (
                  <span className="rounded border border-good/40 bg-good-soft px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-good">
                    ACCEPTED
                  </span>
                )}
              </Link>

              {/* Sub-rail under active scenario: Setup / Cost build /
                  Costing sheet / Customer view links */}
              {isActive && (
                <div className="ml-4 mt-1 mb-2 flex flex-col gap-0.5 border-l border-rule pl-2">
                  {/* Slice RI.8 F-2 fix — Setup is the bare quote index
                      page (/quotes/[quoteId]), not a /setup segment. */}
                  <Link
                    href={`/projects/${projectId}/quotes/${s.latestQuoteId}`}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Setup
                  </Link>
                  {/* Slice RI.4 — Cost Build unified to single page with
                      sections-with-drill-down (Packaging / Production /
                      Bulk Raw / Freight). */}
                  <Link
                    href={`/projects/${projectId}/quotes/${s.latestQuoteId}/cost-build`}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Cost build
                  </Link>
                  <Link
                    href={`/projects/${projectId}/quotes/${s.latestQuoteId}/costing`}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Costing sheet
                  </Link>
                  {/* Slice RI.8 F-3 fix — Customer view shipped in RI.6
                      with snapshot-aware reads added in RI.7. The stale
                      "ships in Slice 10" disabled-span placeholder is
                      replaced with a real link. */}
                  <Link
                    href={`/projects/${projectId}/quotes/${s.latestQuoteId}/customer-view`}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Customer view
                  </Link>
                </div>
              )}
            </div>
          );
        })}

        {/* Dropped scenarios — render inline when count <= 3 (per
            Round 4 pushback #2 + brief §3.6 line 523); collapse to
            "+N dropped" disclosure when count > 3. The pushback's
            target was 5+ feels cluttered; 1-3 dropped don't trigger. */}
        {droppedScenarios.length > 0 && droppedScenarios.length <= 3 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {droppedScenarios.map((s) => (
              <Link
                key={s.scenarioLabel}
                href={`/projects/${projectId}/quotes/${s.latestQuoteId}/costing`}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-ink-4 line-through hover:text-ink-3"
              >
                <span className="truncate">{s.scenarioLabel}</span>
                <span className="font-mono text-[10px]">
                  v{s.latestVersionNumber}
                </span>
              </Link>
            ))}
          </div>
        )}
        {droppedScenarios.length > 3 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-4 hover:text-ink-3">
              +{droppedScenarios.length} dropped
            </summary>
            <div className="mt-1 flex flex-col gap-0.5 pl-2">
              {droppedScenarios.map((s) => (
                <Link
                  key={s.scenarioLabel}
                  href={`/projects/${projectId}/quotes/${s.latestQuoteId}/costing`}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-ink-4 line-through hover:text-ink-3"
                >
                  <span className="truncate">{s.scenarioLabel}</span>
                  <span className="font-mono text-[10px]">
                    v{s.latestVersionNumber}
                  </span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Mini activity feed — DEFERRED to RI.3 (Project Detail rebuild
          ships the activity log read query + project-scoped filter; the
          inner rail's mini feed consumes the same data with a
          last-N-entries cap). For RI.2, leave a placeholder slot. */}
      <div className="mt-4 border-t border-rule pt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
          Activity
        </div>
        <div className="mt-2 text-[11px] italic text-ink-4">
          Mini feed — RI.3
        </div>
      </div>
    </aside>
  );
}
