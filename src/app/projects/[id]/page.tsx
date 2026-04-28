import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { STAGE_LABEL_BY_ID } from "@/lib/hubspot";
import {
  archiveProject,
  refreshFromHubspot,
} from "@/app/actions/projects";
import { CategorySelect } from "./category-select";
import { ConfirmButton } from "./confirm-button";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const salesRep = alias(users, "sales_rep");
  const pm = alias(users, "pm");
  const importedBy = alias(users, "imported_by");

  const rows = await db
    .select({
      project: projects,
      salesRep: { id: salesRep.id, name: salesRep.name, email: salesRep.email },
      pm: { id: pm.id, name: pm.name, email: pm.email },
      importedBy: { id: importedBy.id, name: importedBy.name, email: importedBy.email },
    })
    .from(projects)
    .leftJoin(salesRep, eq(salesRep.id, projects.salesRepUserId))
    .leftJoin(pm, eq(pm.id, projects.pmUserId))
    .leftJoin(importedBy, eq(importedBy.id, projects.importedByUserId))
    .where(eq(projects.id, id))
    .limit(1);

  if (rows.length === 0) notFound();
  const { project, salesRep: rep, pm: pmRow, importedBy: imp } = rows[0];

  const stageLabel = project.dealStage
    ? STAGE_LABEL_BY_ID[project.dealStage] ?? project.dealStage
    : "—";

  const hubId = process.env.HUBSPOT_PROD_HUB_ID;
  const hubspotUrl = hubId
    ? `https://app.hubspot.com/contacts/${hubId}/deal/${project.hubspotDealId}`
    : null;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-2 text-sm">
        <Link href="/" className="text-gray-500 hover:text-gray-900">
          ← Home
        </Link>
        {project.status === "archived" && (
          <span className="ml-3 inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
            Archived
          </span>
        )}
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.dealName}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {project.clientName ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={refreshFromHubspot}>
            <input type="hidden" name="projectId" value={project.id} />
            <button
              type="submit"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Refresh from HubSpot
            </button>
          </form>
          {project.status === "active" && (
            <form action={archiveProject}>
              <input type="hidden" name="projectId" value={project.id} />
              <ConfirmButton
                message="Archive this project? You can still view it but it won't appear in the active list."
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Archive
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>

      <dl className="mb-8 grid grid-cols-1 gap-x-8 gap-y-4 rounded-md border border-gray-200 bg-gray-50 p-5 text-sm sm:grid-cols-2">
        <Field label="HubSpot stage">
          <span className="inline-block rounded bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
            {stageLabel}
          </span>
          <span className="ml-2 text-xs text-gray-500">
            {project.lastHubspotRefreshAt
              ? `last synced ${formatRelative(project.lastHubspotRefreshAt)}`
              : "not yet synced"}
          </span>
        </Field>
        <Field label="Project category">
          <CategorySelect projectId={project.id} value={project.projectCategory} />
        </Field>
        <Field label="Sales rep">
          {rep?.name ?? rep?.email ?? <Unassigned />}
        </Field>
        <Field label="PM">{pmRow?.name ?? pmRow?.email ?? <Unassigned />}</Field>
        <Field label="Imported">
          {project.importedAt.toLocaleDateString()}{" "}
          <span className="text-gray-500">
            by {imp?.name ?? imp?.email ?? "—"}
          </span>
        </Field>
        <Field label="HubSpot deal">
          {hubspotUrl ? (
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-blue-700 underline hover:text-blue-900"
            >
              {project.hubspotDealId} ↗
            </a>
          ) : (
            <span className="font-mono text-xs">{project.hubspotDealId}</span>
          )}
        </Field>
      </dl>

      <Placeholder
        title="Quote builder"
        body="Quote scenarios, SKUs, tiers, and the Costing Sheet land here in Slices 4–11."
      />
      <Placeholder
        title="Scenarios"
        body="Parallel scenarios within this project will appear here in Slice 14."
      />
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-0.5 text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function Unassigned() {
  return <span className="text-gray-400">Unassigned</span>;
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-4 rounded-md border border-dashed border-gray-300 bg-white p-5">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
