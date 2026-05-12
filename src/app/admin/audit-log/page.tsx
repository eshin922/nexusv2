import { desc, eq, sql, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireAdminPage } from "@/lib/admin-guard";
import { alias } from "drizzle-orm/pg-core";
import { AuditLogRow } from "./audit-log-row";
import { dayGroupLabel } from "./renderers";

// Slice RI.8 step 5 — audit-log Round 5 polish.
//
// R5 source: docs/design-prototypes/dist/source/round-5/e13554fd.js +
// r5-admin.css.
//
// What landed this step:
// - R5 page-head (eyebrow + italic "Audit log" h1 + sub)
// - Filter bar: search input live; entity/user/action/date chips
//   drawn-inert v1 (URL ?q is the only operational filter)
// - Active-filter strip when ?q is set, with "Clear filter" link
// - "{N} entries · oldest {ts}" + EXPORT CSV / COPY DEEP-LINK drawn-
//   inert in the bar above the feed
// - Day-grouped feed (Today / Yesterday / Apr 30 separators)
// - Row: ts + avatar initials + verb (who + colored-action chip +
//   entity) + summary + meta + expand-to-diff panel
// - Designer note panel below feed
//
// Deferred per R5 brief vocabulary "drawn-but-inert for not-yet-
// built":
// - Entity / user / action / date-range chip filters (drawn; no
//   wiring). Add per-chip state + URL params when the data shapes
//   for each are ready.
// - CSV export action wiring (drawn; backend missing). Trivial to
//   add once the action ships.
// - Copy deep-link (URL state already lives in ?q; chip-state URL
//   params are the prerequisite for the rest).
// - Pagination beyond 200 rows.
// - Cascade chip surfacing for cost_input cascades — pattern is
//   in the row component (caused_by_audit_id → "cascade · caused_by"
//   chip), but cost-input rollup actions haven't been auditing
//   cascade chains yet; lands in a future cost-input audit pass.

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

  const totalRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(whereClause ?? sql`true`);
  const total = totalRows[0]?.n ?? 0;

  // Group rows by relative day label
  type Group = { label: string; entries: typeof rows };
  const groups: Group[] = [];
  let currentLabel: string | null = null;
  for (const r of rows) {
    const label = dayGroupLabel(r.createdAt);
    if (label !== currentLabel) {
      groups.push({ label, entries: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].entries.push(r);
  }

  const oldestTs =
    rows.length > 0
      ? rows[rows.length - 1].createdAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <p className="eyebrow">Admin · Audit log</p>
        <h1>
          Audit <em>log</em>
        </h1>
        <p className="sub">
          Append-only forensic record of every state change in the system.
          Filter by free-text query (entity / user / action / date-range
          filters are coming). Expand any row for the structured diff.
        </p>
      </div>

      {/* Filter bar — search live; chips drawn-inert */}
      <form method="GET" className="r5-al-filters">
        <div className="r5-al-search">
          <span className="icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search summary, entity…"
            aria-label="Search audit log"
          />
        </div>
        <button
          type="submit"
          className="r5-al-filter"
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.05em" }}
        >
          SEARCH
        </button>
        <button
          type="button"
          className="r5-al-filter"
          disabled
          title="Entity filter — wiring lands next"
        >
          Entity <span className="v">any</span>
        </button>
        <button
          type="button"
          className="r5-al-filter"
          disabled
          title="User filter — wiring lands next"
        >
          User <span className="v">any</span>
        </button>
        <button
          type="button"
          className="r5-al-filter"
          disabled
          title="Action filter — wiring lands next"
        >
          Action <span className="v">any</span>
        </button>
        <button
          type="button"
          className="r5-al-filter"
          disabled
          title="Date filter — wiring lands next"
        >
          Date <span className="v">all</span>
        </button>
      </form>

      {query && (
        <div className="r5-al-active-bar">
          <span className="lbl">Filtered</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
            All entries matching{" "}
            <strong
              style={{
                fontFamily: "var(--display)",
                fontStyle: "italic",
                fontWeight: 500,
                color: "var(--ink)",
              }}
            >
              &ldquo;{query}&rdquo;
            </strong>{" "}
            — {total} entr{total === 1 ? "y" : "ies"}
          </span>
          <a className="clear" href="/admin/audit-log">
            Clear filter
          </a>
        </div>
      )}

      <div className="r5-al-bar">
        <span>
          {total === 0
            ? "no entries"
            : total > PAGE_LIMIT
              ? `showing ${PAGE_LIMIT} of ${total.toLocaleString()}`
              : `${total.toLocaleString()} entr${total === 1 ? "y" : "ies"}`}
          {oldestTs && rows.length > 0 && (
            <span style={{ color: "var(--ink-4)" }}>
              {" "}
              · oldest in view {oldestTs}
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 14 }}>
          <button
            type="button"
            className="copy-link"
            disabled
            title="CSV export — wiring lands next"
          >
            EXPORT CSV
          </button>
          <span style={{ color: "var(--ink-4)" }}>·</span>
          <button
            type="button"
            className="copy-link"
            disabled
            title="Deep-link copy — wiring lands once chip filters carry URL state"
          >
            COPY DEEP-LINK
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="r5-al-feed"
          style={{
            padding: "40px 22px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-3)",
            fontStyle: "italic",
          }}
        >
          {query
            ? `No entries match "${query}". Try a different search.`
            : "No audit entries yet."}
        </div>
      ) : (
        <div className="r5-al-feed">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="r5-al-day">{g.label}</div>
              {g.entries.map((r) => (
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
            </div>
          ))}
        </div>
      )}

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        Diffs are expandable rows, not modals — auditors scan, expansion is
        for the rare deep look. Color saturates only the action chip; the
        rest of the row is neutral so the eye lands on what matters.
        Cascades (when wired through cost-input rollups) surface as a
        single entry on the source change with a chip, not N derived rows;
        the structured facts stay queryable in the DB without drowning the
        feed.
      </div>
    </div>
  );
}
