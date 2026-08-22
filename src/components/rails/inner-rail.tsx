import "server-only";
import Link from "next/link";
import {
  getProjectActivity,
  getProjectHeader,
  getProjectScenarios,
} from "@/lib/workspace-queries";
import { ProjectGlyph } from "./project-glyph";
import { InnerRailCollapse } from "./inner-rail-collapse";

// Slice RI.8 F-12 fix — mini activity feed cap. Project Detail page
// (the full feed) uses limit=30; rail uses a smaller cap because the
// rail is glanceable navigation, not the canonical reading surface.
const RAIL_ACTIVITY_LIMIT = 6;

function compactTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffH < 24) return `${diffH}h`;
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function shortenAction(action: string): string {
  // Map action keys to glanceable verbs for the rail's tight space.
  // Verbose audit-log renderer summaries live on the full activity
  // surface; rail compresses.
  const map: Record<string, string> = {
    quote_sent: "sent",
    customer_acceptance_recorded: "customer ✓",
    customer_acceptance_cleared: "cleared ✓",
    user_phone_updated: "phone edit",
    firm_settings_updated: "firm policy",
    global_price_adj_updated: "price adj",
    cell_override_updated: "override",
    scenario_dropped: "dropped",
    created: "created",
    create: "created",
    updated: "updated",
    update: "updated",
    deleted: "deleted",
    delete: "deleted",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

// Slice RI.2 — Round 4 inner rail (240px wide). Renders only when on
// a project surface. Composition (top to bottom):
//   - Back-to-all-deals link (top)
//   - Project header (client + deal + stage + synced metadata)
//   - Scenarios list (with margin pip + draft-after-send warning chips)
//   - Sub-rail expansion under active scenario (Setup / Costs /
//     Pricing / Quote links) — basic version in RI.2;
//     RI.3 adds the activity feed
//   - Mini activity feed — DEFERRED to RI.3 (needs activity log read
//     query + project-scoped filter; ships with Project Detail rebuild)

export async function InnerRail({
  projectId,
  activeScenarioLabel,
  activeQuoteId,
}: {
  projectId: string;
  /** The scenario_label of the quote being viewed, if any. Drives
   * the active-scenario highlight + sub-rail expansion under that
   * scenario row. Resolved at the layout level via quoteId →
   * scenario_label lookup; works for any version of a scenario,
   * not just the latest. */
  activeScenarioLabel?: string;
  /** The exact quote ID PM is currently viewing. Sub-rail link
   * hrefs use THIS (not s.latestQuoteId) so navigating across
   * sub-rail surfaces keeps PMs in their current version's pages.
   * Issue 3 fix — sub-rail was always jumping to latestQuoteId,
   * surprising PMs inspecting older sent versions by routing them
   * to the current draft. */
  activeQuoteId?: string;
}) {
  const [header, scenarios, activity] = await Promise.all([
    getProjectHeader(projectId),
    getProjectScenarios(projectId),
    getProjectActivity(projectId, RAIL_ACTIVITY_LIMIT),
  ]);

  if (!header) return null;

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
      id="inner-rail"
      // `w-60` is kept as the expanded width and `inner-rail` overrides it from
      // a CSS variable, so the expanded geometry is literally today's geometry
      // rather than a re-derivation of it.
      className="inner-rail fixed left-14 top-0 z-20 flex h-screen w-60 flex-col overflow-y-auto px-3 py-3"
      style={{
        background: "var(--paper)",
        borderRight: "1px solid var(--rule)",
      }}
    >
      <InnerRailCollapse />

      {/*
        Everything below is hidden when collapsed — display:none, not opacity or
        width, so no content keeps occupying the reclaimed strip and nothing
        stays reachable by keyboard behind a panel the operator has closed.
        Route state is untouched: this is presentation only, and the links are
        re-rendered by the server on the next navigation exactly as before.
      */}
      <div className="inner-rail-body">
      {/* Back to all deals */}
      <Link
        href="/"
        className="mb-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink"
      >
        <span aria-hidden>←</span>
        <span>All deals</span>
      </Link>

      {/* Project header — Slice RI.8 step 9 / F-10 close.
          Wrapped in Link so PMs on Costs / Pricing / Quote /
          Mark-Accepted can navigate UP to Project Detail directly.
          Was a back-nav gap pre-RI.8 (R6 deliberately strips
          in-page breadcrumb on Cost Build); F-1's sub-rail fix
          handles cross-quote nav but not up-to-project. This
          closes the residual. */}
      <Link
        href={`/projects/${projectId}`}
        className="mb-4 flex items-start gap-2.5 border-b border-rule pb-3 hover:bg-paper-3 -mx-1 px-1 py-1 rounded transition-colors"
        title="Project detail"
      >
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
          {header.dealStageLabel && (
            <div className="mt-1 inline-block rounded border border-rule px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-ink-3">
              {header.dealStageLabel}
            </div>
          )}
        </div>
      </Link>

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
                href={`/projects/${projectId}/quotes/${s.latestQuoteId}/pricing`}
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
                  {/* Slice RI.8 Issue 2 fix — version chip dropped.
                      The "v5" caption read as "rail locked to v5"
                      when PMs viewing older versions saw it. Active
                      highlight + sub-rail expansion already convey
                      scope; version chip was redundant + misleading.
                      Per-version row enumeration isn't intended
                      per brief §3.6. */}
                </span>
                {s.scenarioStatus === "accepted" && (
                  <span className="rounded border border-good/40 bg-good-soft px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-good">
                    ACCEPTED
                  </span>
                )}
              </Link>

              {/* Sub-rail under active scenario: Setup / Costs /
                  Pricing / Quote links.

                  Slice RI.8 Issue 3 fix — hrefs use activeQuoteId
                  (the version PM is actually viewing) instead of
                  s.latestQuoteId. PMs inspecting older sent
                  versions now navigate within that version, not
                  jumping unexpectedly to the latest draft.
                  Fallback to latestQuoteId if activeQuoteId isn't
                  set (shouldn't happen when isActive is true, but
                  defensive). */}
              {isActive && (() => {
                const targetQuoteId = activeQuoteId ?? s.latestQuoteId;
                return (
                  <div className="ml-4 mt-1 mb-2 flex flex-col gap-0.5 border-l border-rule pl-2">
                    {/* Slice RI.8 F-2 fix — Setup is the bare quote
                        index page, not a /setup segment. */}
                    <Link
                      href={`/projects/${projectId}/quotes/${targetQuoteId}`}
                      className="text-[11px] text-ink-3 hover:text-ink"
                    >
                      Setup
                    </Link>
                    {/* Slice RI.4 — Costs unified to single page
                        with sections-with-drill-down (Packaging /
                        Production / Bulk Raw / Freight). */}
                    <Link
                      href={`/projects/${projectId}/quotes/${targetQuoteId}/costs`}
                      className="text-[11px] text-ink-3 hover:text-ink"
                    >
                      Costs
                    </Link>
                    <Link
                      href={`/projects/${projectId}/quotes/${targetQuoteId}/pricing`}
                      className="text-[11px] text-ink-3 hover:text-ink"
                    >
                      Pricing
                    </Link>
                    {/* Slice RI.8 F-3 fix — Quote shipped in
                        RI.6 with snapshot-aware reads added in RI.7.
                        The stale "ships in Slice 10" disabled-span
                        placeholder is replaced with a real link. */}
                    <Link
                      href={`/projects/${projectId}/quotes/${targetQuoteId}/quote`}
                      className="text-[11px] text-ink-3 hover:text-ink"
                    >
                      Quote
                    </Link>
                  </div>
                );
              })()}
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
                href={`/projects/${projectId}/quotes/${s.latestQuoteId}/pricing`}
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
                  href={`/projects/${projectId}/quotes/${s.latestQuoteId}/pricing`}
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

      {/* Mini activity feed — Slice RI.8 F-12 fix. Wired via existing
          getProjectActivity with a smaller limit. Glanceable verbs +
          compact time; full activity surface still lives on the
          Project Detail page (limit=30, fuller renderers). */}
      <div className="mt-4 border-t border-rule pt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
          Activity
        </div>
        {activity.length === 0 ? (
          <div className="mt-2 text-[11px] italic text-ink-4">
            No activity yet
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {activity.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline gap-1.5 text-[11px] leading-snug"
                title={a.summary ?? a.action}
              >
                <span className="font-mono text-[9.5px] text-ink-4 shrink-0 w-7">
                  {compactTime(a.createdAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-3">
                  <span className="text-ink-2">
                    {a.userName ?? "—"}
                  </span>{" "}
                  <span className="text-ink-4">
                    {shortenAction(a.action)}
                  </span>
                  {a.entityLabel && (
                    <span className="text-ink-3"> · {a.entityLabel}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {activity.length === RAIL_ACTIVITY_LIMIT && (
          <Link
            href={`/projects/${projectId}`}
            className="mt-2 inline-block font-mono text-[9.5px] uppercase tracking-[0.06em] text-accent-ink hover:text-ink"
          >
            All activity →
          </Link>
        )}
      </div>
      </div>
    </aside>
  );
}
