import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { projects, quotes, quoteTiers, users } from "@/db/schema";
import { STAGE_LABEL_BY_ID } from "@/lib/hubspot";
import {
  getProjectActivity,
  getProjectLineage,
  getProjectScenarioCards,
  type ScenarioCard,
} from "@/lib/workspace-queries";
import { archiveProject } from "@/app/actions/projects";
import { createQuote } from "@/app/actions/quotes";
import { InnerRail } from "@/components/rails/inner-rail";
import { NewScenarioTrigger } from "@/components/scenario-create/new-scenario-trigger";
import { EditableScenarioLabel } from "@/components/scenario-actions/editable-scenario-label";
import { ScenarioActionsMenu } from "@/components/scenario-actions/scenario-actions-menu";
import { CategorySelect } from "./category-select";

// Slice RI.8 — state-aware default surface for version-row clicks.
// Brand-new quotes (no SKUs/tiers) land on Setup instead of an
// empty Pricing. PMs adding inputs land on Costs. PMs
// with cost inputs already in place land on Pricing (current
// review surface). Edward caught the original "always Costing"
// behavior in step 0 smoke — new quotes rendered an empty Costing
// Sheet which read as broken.
function defaultQuoteSurface(
  projectId: string,
  v: { id: string; hasSetupComplete: boolean; hasCostInputs: boolean },
): string {
  const base = `/projects/${projectId}/quotes/${v.id}`;
  if (!v.hasSetupComplete) return base; // Setup (bare quote index)
  if (!v.hasCostInputs) return `${base}/costs`;
  return `${base}/pricing`;
}
import { ConfirmButton } from "./confirm-button";
import { RefreshProjectButton } from "./refresh-button";

// Slice RI.3 — Project Detail rebuild per Round 4 design. Three
// composition pieces:
//   1. Header strip (italic client h1 + deal name + meta + actions)
//   2. Next-action card (room organizer; three states per Round 4:
//      override-pending / just-created / accepted-closed-won; default
//      "active multi-scenario" state shows nothing)
//   3. Scenario cards (one per scenario_label; version chains;
//      drop_reason badges; recommended star) + Lineage panel (when
//      cross-project copies present) + Activity rail (right panel)

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    /**
     * Scenario actions menu → Copy scenario navigates here with
     * `?copy_from=<quoteId>`. NewScenarioTrigger auto-opens the
     * canonical modal in copy-scenario mode with the source
     * pre-selected. Trigger clears the param on modal close.
     */
    copy_from?: string;
  }>;
}) {
  const { id } = await params;
  const { copy_from: copyFromQuoteId } = await searchParams;

  const salesRep = alias(users, "sales_rep");
  const pm = alias(users, "pm");
  const importedBy = alias(users, "imported_by");

  const projectRows = await db
    .select({
      project: projects,
      salesRep: { id: salesRep.id, name: salesRep.name, email: salesRep.email },
      pm: { id: pm.id, name: pm.name, email: pm.email },
      importedBy: {
        id: importedBy.id,
        name: importedBy.name,
        email: importedBy.email,
      },
    })
    .from(projects)
    .leftJoin(salesRep, eq(salesRep.id, projects.salesRepUserId))
    .leftJoin(pm, eq(pm.id, projects.pmUserId))
    .leftJoin(importedBy, eq(importedBy.id, projects.importedByUserId))
    .where(eq(projects.id, id))
    .limit(1);

  if (projectRows.length === 0) notFound();
  const { project, salesRep: rep, pm: pmRow, importedBy: imp } = projectRows[0];

  const [scenarios, activity, lineage] = await Promise.all([
    getProjectScenarioCards(project.id),
    getProjectActivity(project.id, 30),
    getProjectLineage(project.id),
  ]);

  // canonical-scenario-create-flow Step 6 — modal props loader.
  // Pulls the data the New Scenario modal needs:
  //   - existing scenario labels (to compute next-available "Alt N")
  //   - recommended scenario name (Currently recommended: "{name}")
  //   - current active scenario (default attach target for the
  //     drop choice + source for the customer-target-tier dropdown
  //     per CA Q3 disposition)
  //   - tier labels of the current active scenario
  //
  // "Current active" = recommended scenario if exists; else the
  // most-recent active scenario. Edge cases (no active scenarios
  // at all) surface as nulls — modal disables the drop option in
  // that case.
  const allProjectQuotes = await db
    .select({
      id: quotes.id,
      scenarioLabel: quotes.scenarioLabel,
      scenarioStatus: quotes.scenarioStatus,
      isRecommended: quotes.isRecommended,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(eq(quotes.projectId, project.id))
    .orderBy(asc(quotes.createdAt));

  const existingScenarioLabels = Array.from(
    new Set(allProjectQuotes.map((q) => q.scenarioLabel)),
  );
  let nextAltN = 1;
  while (existingScenarioLabels.includes(`Alt ${nextAltN}`)) nextAltN++;
  const nextAltLabel = `Alt ${nextAltN}`;

  const recommendedQuote = allProjectQuotes.find(
    (q) => q.isRecommended && q.scenarioStatus === "active",
  );
  const recommendedScenarioName = recommendedQuote?.scenarioLabel ?? null;

  // currentActive = recommended scenario, else most-recent active
  const currentActiveQuote =
    recommendedQuote ??
    [...allProjectQuotes]
      .reverse()
      .find((q) => q.scenarioStatus === "active") ??
    null;

  let currentScenarioTierLabels: string[] = [];
  if (currentActiveQuote) {
    const tierRows = await db
      .select({ label: quoteTiers.label })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, currentActiveQuote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));
    currentScenarioTierLabels = tierRows.map((r) => r.label);
  }

  const stageLabel = project.dealStage
    ? STAGE_LABEL_BY_ID[project.dealStage] ?? project.dealStage
    : null;

  const hubId = process.env.HUBSPOT_PROD_HUB_ID;
  const hubspotUrl = hubId
    ? `https://app.hubspot.com/contacts/${hubId}/deal/${project.hubspotDealId}`
    : null;

  // Determine project state for next-action card (per Round 4):
  //   - just-created: no quotes yet
  //   - accepted-closed-won: at least one quote with status='accepted'
  //     AND no active scenarios remaining
  //   - default (active multi-scenario): no card, scenario cards lead
  const acceptedScenario = scenarios.find((s) =>
    s.versions.some((v) => v.status === "accepted"),
  );
  const hasAnyQuote = scenarios.length > 0;
  const isJustCreated = !hasAnyQuote;
  const isAcceptedClosed = !!acceptedScenario && scenarios.every(
    (s) => s.scenarioStatus !== "active",
  );

  return (
    /* Slice RI.8 F-1 fix — InnerRail moved out of project layout to
       avoid double-render under the new quote layout. Project Detail
       renders its own rail with no activeQuoteId (no sub-rail). */
    <div className="min-h-screen">
      <InnerRail projectId={project.id} />
      <main className="pl-64 p-6">
      {/* Header strip */}
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="min-w-0">
          {project.clientName && (
            <h1 className="font-display text-3xl italic text-ink-3">
              {project.clientName}
            </h1>
          )}
          <div className="mt-1 text-sm text-ink-2">{project.dealName}</div>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-3">
            {stageLabel && (
              <span className="rounded border border-rule px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide">
                {stageLabel}
              </span>
            )}
            {pmRow && (
              <span>
                PM: <span className="text-ink-2">{pmRow.name ?? pmRow.email}</span>
              </span>
            )}
            {rep && (
              <span>
                Sales: <span className="text-ink-2">{rep.name ?? rep.email}</span>
              </span>
            )}
            {project.lastHubspotRefreshAt && (
              <span>synced {fmtRelative(project.lastHubspotRefreshAt)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshProjectButton projectId={project.id} />
          {hubspotUrl && (
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-rule px-3 py-1.5 text-xs text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              ↗ View deal in HubSpot
            </a>
          )}
          {project.status === "active" && (
            <form action={archiveProject}>
              <input type="hidden" name="projectId" value={project.id} />
              <ConfirmButton
                message="Archive this project?"
                className="rounded border border-bad bg-bad-soft px-3 py-1.5 text-xs text-bad hover:opacity-80"
              >
                Archive
              </ConfirmButton>
            </form>
          )}
          {project.status === "archived" && (
            <span className="rounded bg-paper-3 px-2 py-0.5 text-xs font-medium text-ink-3">
              Archived
            </span>
          )}
        </div>
      </div>

      {/* Two-column main: scenarios on left, activity rail on right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          {/* Next-action card — three states per Round 4 */}
          {isJustCreated && (
            <NextActionCard
              tone="neutral"
              title="New project"
              body="Enter your SKU shapes to begin."
            >
              <form action={createQuote}>
                <input type="hidden" name="projectId" value={project.id} />
                <button
                  type="submit"
                  className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:bg-accent-ink"
                >
                  Open Setup →
                </button>
              </form>
            </NextActionCard>
          )}
          {isAcceptedClosed && acceptedScenario && (
            <NextActionCard
              tone="good"
              title={`${project.clientName ?? project.dealName} accepted ${acceptedScenario.scenarioLabel}`}
              body={`v${acceptedScenario.versions.find((v) => v.status === "accepted")?.versionNumber} accepted ${
                acceptedScenario.versions.find((v) => v.status === "accepted")
                  ?.acceptedAt
                  ? fmtAbsolute(
                      acceptedScenario.versions.find((v) => v.status === "accepted")!
                        .acceptedAt!,
                    )
                  : ""
              }${
                scenarios.length > 1
                  ? `. ${scenarios.length - 1} sibling scenarios auto-dropped.`
                  : ""
              }`}
            >
              {/* View snapshot + Final PDF actions ship in Slice 11/12 */}
              <span className="text-xs italic text-ink-4">
                Snapshot + PDF actions in Slice 11/12
              </span>
            </NextActionCard>
          )}

          {/* Scenario cards */}
          <section className="mb-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
                Scenarios
              </h2>
              {project.status === "active" && (
                /* canonical-scenario-create-flow Step 6 — form-action
                   replaced with the canonical modal trigger. PMs
                   capture intent + target tier + attachment + drop
                   choice + recommended pin at scenario birth. */
                <NewScenarioTrigger
                  projectId={project.id}
                  projectName={project.dealName ?? project.clientName ?? "Project"}
                  nextAltLabel={nextAltLabel}
                  recommendedScenarioName={recommendedScenarioName}
                  currentActiveScenarioId={currentActiveQuote?.id ?? null}
                  currentActiveScenarioName={
                    currentActiveQuote?.scenarioLabel ?? null
                  }
                  currentScenarioTierLabels={currentScenarioTierLabels}
                  initialSourceQuoteId={copyFromQuoteId ?? null}
                />
              )}
            </div>
            {scenarios.length === 0 ? (
              <div className="rounded border border-dashed border-rule bg-paper-2 p-4 text-sm italic text-ink-4">
                No scenarios yet — create one to start building cost data.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {scenarios.map((s) => (
                  <ScenarioCardView
                    key={s.scenarioLabel}
                    scenario={s}
                    projectId={project.id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Lineage panel — only when cross-project copies present */}
          {lineage.length > 0 && (
            <section className="mb-4 rounded border border-rule bg-paper-2 p-4">
              <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
                Lineage
              </h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {lineage.map((l) => (
                  <li key={l.scenarioLabel} className="text-ink-2">
                    <span className="font-medium text-ink">{l.scenarioLabel}</span>{" "}
                    forked from{" "}
                    <Link
                      href={`/projects/${l.fromProjectId}`}
                      className="text-accent-ink hover:text-accent"
                    >
                      {l.fromProjectClientName ?? l.fromProjectDealName} ·{" "}
                      {l.fromQuoteScenarioLabel} v{l.fromQuoteVersionNumber}
                    </Link>{" "}
                    <span className="text-ink-4">{fmtRelative(l.forkedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Project metadata (preserve from prior version; consolidated) */}
          <details className="mt-4 rounded border border-rule">
            <summary className="cursor-pointer bg-paper-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3 hover:text-ink">
              Project metadata
            </summary>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Field label="Project category">
                <CategorySelect
                  projectId={project.id}
                  value={project.projectCategory}
                />
              </Field>
              <Field label="Imported">
                {project.importedAt.toLocaleDateString()}{" "}
                <span className="text-ink-4">
                  by {imp?.name ?? imp?.email ?? "—"}
                </span>
              </Field>
              <Field label="HubSpot deal ID">
                <span className="font-mono text-xs text-ink-2">
                  {project.hubspotDealId}
                </span>
              </Field>
            </dl>
          </details>
        </div>

        {/* Activity rail */}
        <aside className="rounded border border-rule bg-paper-2 p-4">
          <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
            Activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-xs italic text-ink-4">No activity yet</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {activity.map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="text-ink-2">
                    <span className="font-medium text-ink">
                      {a.userName ?? "system"}
                    </span>{" "}
                    <span className="text-ink-3">{humanizeAction(a.action)}</span>
                  </div>
                  {a.entityLabel && (
                    <div className="mt-0.5 italic text-ink-3">
                      {a.entityLabel}
                    </div>
                  )}
                  {a.summary && (
                    <div className="mt-0.5 text-ink-3">{a.summary}</div>
                  )}
                  <div className="mt-0.5 font-mono text-[10px] text-ink-4">
                    {fmtRelative(a.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      </main>
    </div>
  );
}

function ScenarioCardView({
  scenario,
  projectId,
}: {
  scenario: ScenarioCard;
  projectId: string;
}) {
  const latest = scenario.versions[0];
  const isDropped = scenario.scenarioStatus === "dropped";
  const isAccepted = scenario.scenarioStatus === "accepted";
  const cardCls = isAccepted
    ? "border-good bg-good-soft/30"
    : isDropped
      ? "border-rule bg-paper-2 opacity-70"
      : "border-rule bg-paper";

  const isActive = scenario.scenarioStatus === "active";

  return (
    <article className={`rounded border ${cardCls} p-4`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2">
            {scenario.isRecommended && (
              <span title="Recommended" className="text-accent">
                ★
              </span>
            )}
            {/* Post-Step-6 follow-up (2026-07-15) — click-to-edit
                label. Non-active scenarios stay static (no rename
                for dropped/accepted). */}
            {isActive ? (
              <EditableScenarioLabel
                projectId={projectId}
                scenarioLabel={scenario.scenarioLabel}
                className="font-display text-lg text-ink"
              />
            ) : (
              <h3 className="font-display text-lg text-ink">
                {scenario.scenarioLabel}
              </h3>
            )}
            <span
              className={`rounded border px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide ${
                isAccepted
                  ? "border-good/40 bg-good-soft text-good"
                  : isDropped
                    ? "border-rule bg-paper-3 text-ink-3"
                    : "border-accent/40 bg-accent-soft text-accent-ink"
              }`}
            >
              {scenario.scenarioStatus.toUpperCase()}
            </span>
            {isDropped && scenario.dropReason && (
              <span className="rounded border border-rule px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-ink-3">
                {humanizeDropReason(scenario.dropReason)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
            <span>
              {scenario.versions.length} version
              {scenario.versions.length === 1 ? "" : "s"}
            </span>
            {/* canonical-scenario-create-flow Step 7 — 📎 N attachment
                count chip. Renders only when count > 0; clicking
                navigates to the Setup surface where the attachment
                list lives (Setup header affordance handles the list
                + add/remove). */}
            {scenario.attachmentCount > 0 && (
              <Link
                href={`/projects/${projectId}/quotes/${latest.id}/setup`}
                title={`${scenario.attachmentCount} attachment${scenario.attachmentCount === 1 ? "" : "s"} — view on Setup`}
                className="rounded border border-rule px-1.5 py-0 font-mono text-[10px] text-ink-3 hover:border-rule-2 hover:text-ink"
              >
                📎 {scenario.attachmentCount}
              </Link>
            )}
          </div>
          {/* canonical-scenario-create-flow Step 7 — intent note
              surfaced as truncated text + full-text tooltip on
              hover. Skipped when empty. */}
          {scenario.intentNote && (
            <p
              title={scenario.intentNote}
              className="mt-1 text-xs italic text-ink-3"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 480,
              }}
            >
              {scenario.intentNote}
            </p>
          )}
        </div>
        {/* canonical-scenario-create-flow polish (May 2026) —
            collapsed the RI.8 F-9 dual-affordance (Build · v{N} +
            Open Costing · v{N}) into a single state-aware Open button.
            "Build" label drifted vs the RI.8 surface canon ("Cost
            build → Costs"); "Open Costing" drifted vs the same rename
            ("Costing sheet → Pricing"). Dual buttons were also
            state-blind — clicking Open Costing on a bare quote
            landed PMs on an empty Pricing surface, reintroducing
            the same speed-pass trap defaultQuoteSurface fixes for
            version-row clicks (see helper comment at top of file).
            Single button reuses that helper for canonical-flow
            routing while preserving the version-explicit label
            Edward wanted in RI.8. */}
        <div className="flex items-center gap-2">
          <Link
            href={defaultQuoteSurface(projectId, latest)}
            className="rounded border border-rule bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-rule-2 hover:bg-paper-2"
          >
            Open · v{latest.versionNumber}
          </Link>
          {/* Post-Step-6 follow-up (2026-07-15) — scenario actions
              menu (Copy / Drop). Renders only for active scenarios;
              Drop item inside the menu additionally gates on
              status === 'draft'. */}
          {isActive && (
            <ScenarioActionsMenu
              projectId={projectId}
              scenarioLabel={scenario.scenarioLabel}
              latestQuoteId={latest.id}
              latestQuoteStatus={latest.status}
            />
          )}
        </div>
      </header>
      {/* Version chain */}
      <ul className="flex flex-col divide-y divide-rule text-xs">
        {scenario.versions.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <Link
              href={defaultQuoteSurface(projectId, v)}
              className="flex flex-1 items-center gap-2 hover:text-accent"
            >
              <span className="font-mono text-[10px] text-ink-3">
                v{v.versionNumber}
              </span>
              {/* Slice RI.7 — customer-facing quote_number, assigned at
                  sendQuote. Renders adjacent to version number for
                  sent+ quotes; drafts show no chip (no number yet). */}
              {v.quoteNumber && (
                <span className="font-mono text-[10px] text-ink-2">
                  {v.quoteNumber}
                </span>
              )}
              <span
                className={`rounded border px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide ${
                  v.status === "accepted"
                    ? "border-good/40 bg-good-soft text-good"
                    : v.status === "sent"
                      ? "border-accent/40 bg-accent-soft text-accent-ink"
                      : "border-warn/40 bg-warn-soft text-warn"
                }`}
              >
                {v.status.toUpperCase()}
              </span>
            </Link>
            <span className="font-mono text-[10px] text-ink-4">
              {fmtRelative(v.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function NextActionCard({
  tone,
  title,
  body,
  children,
}: {
  tone: "neutral" | "good";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const cls =
    tone === "good"
      ? "border-good bg-good-soft/40"
      : "border-accent bg-accent-soft";
  return (
    <section className={`mb-4 rounded border ${cls} p-4`}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
        Next action
      </div>
      <div className="mt-1 font-display text-xl text-ink">{title}</div>
      <p className="mt-1 text-sm text-ink-2">{body}</p>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-4">
        {label}
      </dt>
      <dd className="text-sm text-ink-2">{children}</dd>
    </div>
  );
}

// RSC boundary defense: timestamps serialize as ISO strings when
// crossing server → client component boundary. Even though this file
// is a server component, defensive coercion keeps the formatters
// safe if any portion gets carved into a client subtree later.
function fmtRelative(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const ms = Date.now() - t;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function fmtAbsolute(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function humanizeAction(action: string): string {
  // Strip namespacing + format. e.g. "global_price_adj_updated" →
  // "updated global price adj". Keeps the audit-log copy readable
  // without per-action mapping (which ships in the audit-log read
  // view in RI.7).
  return action.replace(/_/g, " ");
}

function humanizeDropReason(reason: string): string {
  const labels: Record<string, string> = {
    superseded_by_copy: "Superseded by copy",
    draft_at_accept: "Draft at accept",
    accept_sibling: "Sibling accepted",
    manual: "Manually dropped",
    other: "Other",
  };
  return labels[reason] ?? reason;
}
