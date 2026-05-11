import { desc, eq, sql, ilike, and, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { alias } from "drizzle-orm/pg-core";
import { AuditLogRow } from "./audit-log-row";

// Slice RI.7 — audit-log read view (MVP). Brief §3.12 calls for the
// full surface (filters, cascade chips, time-grouped feed, trigram
// search, CSV export, deep-link filter state). RI.7 ships the
// minimum-viable feed + action-renderer map; polish items land in
// RI.8 / UX_BACKLOG.
//
// MVP scope:
//   - Reverse-chronological feed (most recent first, capped at 200)
//   - Free-text search via `summary` ilike (trigram-indexed)
//   - Action chip per RI.7 renderer map
//   - Diff_json expand inline (default collapsed)
//   - User + timestamp + entity label
//
// Deferred to RI.8 / backlog:
//   - Entity / user / action / date-range filters
//   - Time-grouped headers ("TODAY · APR 30")
//   - Cascade chip (caused_by_audit_id surfacing)
//   - CSV export
//   - URL-state for filters
//   - Pagination / infinite scroll past 200 entries

const PAGE_LIMIT = 200;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminPage();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const auditUser = alias(users, "audit_user");

  // Build the WHERE clause once. Free-text search hits the trigram
  // indexes on summary + entity_label.
  const whereClause: SQL | undefined =
    query.length > 0
      ? or(
          ilike(auditLog.summary, `%${query}%`),
          ilike(auditLog.entityLabel, `%${query}%`),
        )
      : undefined;

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      entityLabel: auditLog.entityLabel,
      summary: auditLog.summary,
      diffJson: auditLog.diffJson,
      causedByAuditId: auditLog.causedByAuditId,
      userName: auditUser.name,
      userEmail: auditUser.email,
    })
    .from(auditLog)
    .leftJoin(auditUser, eq(auditUser.id, auditLog.userId))
    .where(whereClause ?? sql`true`)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_LIMIT);

  // Cap counter for the "showing N of M" indicator.
  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(whereClause ?? sql`true`);
  const total = totalRows[0]?.n ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Audit log</h1>
          <p className="mt-1 text-sm text-slate-600">
            Append-only history of every write through the action layer.
            Most recent first.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {total === 0
            ? "no entries"
            : total > PAGE_LIMIT
              ? `showing ${PAGE_LIMIT} of ${total.toLocaleString()}`
              : `${total.toLocaleString()} entr${total === 1 ? "y" : "ies"}`}
        </span>
      </header>

      <form
        method="GET"
        className="flex items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        <label className="flex flex-1 items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Match against summary + entity (trigram index)"
            className="flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm focus:border-slate-500 focus:bg-white focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Search
        </button>
        {query && (
          <a
            href="/admin/audit-log"
            className="text-xs text-slate-600 underline hover:text-slate-900"
          >
            Clear
          </a>
        )}
      </form>

      <section className="overflow-hidden rounded-md border border-slate-300 bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm italic text-slate-500">
            {query
              ? `No entries match "${query}". Try a different search.`
              : "No audit entries yet."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <AuditLogRow
                key={r.id}
                row={{
                  id: r.id,
                  createdAt: r.createdAt,
                  action: r.action,
                  entityType: r.entityType,
                  entityId: r.entityId,
                  entityLabel: r.entityLabel,
                  summary: r.summary,
                  diffJson: r.diffJson as Record<string, unknown>,
                  causedByAuditId: r.causedByAuditId,
                  userName: r.userName,
                  userEmail: r.userEmail,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
