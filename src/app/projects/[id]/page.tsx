import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { STAGE_LABEL_BY_ID } from "@/lib/hubspot";
import {
  getProjectActivity,
  getProjectLineage,
  getProjectScenarioCards,
  type ScenarioCard,
} from "@/lib/workspace-queries";
import { archiveProject } from "@/app/actions/projects";
import { createQuote } from "@/app/actions/quotes";
import { CategorySelect } from "./category-select";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
    <main className="p-6">
      {/* Header strip */}
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="min-w-0">
          {project.clientName && (
            <h1 className="font-display text-3xl italic text-ink">
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
                <form action={createQuote}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <button
                    type="submit"
                    className="rounded border border-rule bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-rule-2 hover:text-ink"
                  >
                    + New scenario
                  </button>
                </form>
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

  return (
    <article className={`rounded border ${cardCls} p-4`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {scenario.isRecommended && (
              <span title="Recommended" className="text-warn">
                ★
              </span>
            )}
            <h3 className="font-display text-lg text-ink">
              {scenario.scenarioLabel}
            </h3>
            <span
              className={`rounded px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide ${
                isAccepted
                  ? "bg-good-soft text-good"
                  : isDropped
                    ? "bg-paper-3 text-ink-3"
                    : "bg-accent-soft text-accent"
              }`}
            >
              {scenario.scenarioStatus}
            </span>
            {isDropped && scenario.dropReason && (
              <span className="rounded border border-rule px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-ink-3">
                {humanizeDropReason(scenario.dropReason)}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-ink-3">
            {scenario.versions.length} version
            {scenario.versions.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}/quotes/${latest.id}/costing`}
            className="rounded border border-rule bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-rule-2 hover:text-ink"
          >
            Open
          </Link>
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
              href={`/projects/${projectId}/quotes/${v.id}/costing`}
              className="flex flex-1 items-center gap-2 hover:text-accent"
            >
              <span className="font-mono text-[10px] text-ink-3">
                v{v.versionNumber}
              </span>
              <span
                className={`rounded px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide ${
                  v.status === "accepted"
                    ? "bg-good-soft text-good"
                    : v.status === "sent"
                      ? "bg-accent-soft text-accent"
                      : "bg-warn-soft text-warn"
                }`}
              >
                {v.status}
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
    <section className={`mb-4 rounded border-l-4 ${cls} p-4`}>
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

function fmtRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
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

function fmtAbsolute(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
