"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrganizerData, OrganizerProject } from "@/lib/organizer/load";
import type { Task } from "@/lib/organizer/tasks";

/**
 * Deal Organizer · R14 presentation.
 *
 * Renders `loadOrganizer`'s output. It computes NO task, NO ranking and NO
 * grouping — `needsYou`, `topTask` and `group` all arrive decided. The only
 * thing this file decides is which rows a filter chip and a search box let
 * through, which is presentation.
 *
 * `Your next move` is `data.needsYou[0]`, passed as `data.nextMove` and used
 * as-is. Not "the same predicates re-applied" — the same object.
 *
 * The design source's `prototype · signed in as` role switcher is REVIEW
 * CHROME and is deliberately not built: production takes the viewer from the
 * session. (Same call as the R7a/R7b state strips.)
 */

const GROUP_META = {
  needs_you: { label: "Needs you", hint: "waiting on you" },
  with_customer: { label: "With the customer", hint: "sent, awaiting a reply" },
  no_action: { label: "No action required", hint: "nothing outstanding" },
} as const;

// Group order is the reading order, not a ranking of importance.
const GROUP_ORDER = ["needs_you", "with_customer", "no_action"] as const;

/**
 * Each kind's label and its TONE, per design spec §5 — blocked 25 · missing 70 ·
 * returned 155 · informational 232.
 *
 * The tone says what KIND of attention the item wants, which the label alone
 * does not carry at scan speed: a failed push and an expiring quote are both
 * "yours" but they are not the same urgency, and rendering both in the accent
 * throws that distinction away.
 *
 * `var` is the CSS custom property the next-move card's left border reads, so
 * the page's most prominent element is coloured by its own task rather than
 * uniformly blue.
 */
const TAG: Record<Task["kind"], { text: string; tone: string; var: string }> = {
  // A failure that stopped something mid-flight.
  push_failed: { text: "push failed", tone: "r14-tag-blocked", var: "--r14-t25-fg" },
  // Came back to you with a decision on it.
  approval_rejected: { text: "declined", tone: "r14-tag-returned", var: "--r14-t155-fg" },
  // A clock is running down.
  quote_expiring: { text: "expiring", tone: "r14-tag-missing", var: "--r14-t70-fg" },
  // Nothing is wrong; it is just quiet.
  customer_silent: { text: "silent", tone: "r14-tag-info", var: "--r14-t232-fg" },
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  complete: "Locked",
};

function relative(d: Date, now: number): string {
  const days = Math.floor((now - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function OrganizerSurface({
  data,
  userName,
  now,
}: {
  data: OrganizerData;
  userName: string;
  now: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | (typeof GROUP_ORDER)[number]>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data.projects.length };
    for (const g of GROUP_ORDER) c[g] = data.projects.filter((p) => p.group === g).length;
    return c;
  }, [data.projects]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.projects.filter((p) => {
      if (filter !== "all" && p.group !== filter) return false;
      if (!q) return true;
      return (
        p.dealName.toLowerCase().includes(q) ||
        (p.clientName ?? "").toLowerCase().includes(q) ||
        (p.latestQuote?.scenarioLabel ?? "").toLowerCase().includes(q)
      );
    });
  }, [data.projects, filter, query]);

  const grouped = GROUP_ORDER.map((g) => ({
    key: g,
    ...GROUP_META[g],
    rows: visible.filter((p) => p.group === g),
  })).filter((g) => g.rows.length > 0);

  const needsYouDeals = data.projects.filter((p) => p.group === "needs_you").length;

  return (
    <main className="r14" style={{ display: "flex", flexDirection: "column" }}>
      <header className="r14-head">
        <div>
          <div className="r14-eyebrow">Deal organizer</div>
          <div className="r14-greeting">Good morning, {userName}.</div>
        </div>
        <div className="r14-spacer" />
        <Link href="/import" className="r14-btn" style={{ textDecoration: "none" }}>
          Import from HubSpot
        </Link>
      </header>

      <div className="r14-body">
        <div style={{ minWidth: 0 }}>
          {/* ── your next move · data.needsYou[0], used as-is ───────────── */}
          {data.nextMove ? (
            <button
              className="r14-next"
              onClick={() => router.push(data.nextMove!.href)}
              style={
                {
                  "--r14-next-tone": `var(${TAG[data.nextMove.kind].var})`,
                } as React.CSSProperties
              }
            >
              <div className="r14-next-head">
                <span className="r14-next-label">Your next move</span>
                <span className={`r14-tag ${TAG[data.nextMove.kind].tone}`}>
                  {TAG[data.nextMove.kind].text}
                </span>
              </div>
              <div className="r14-next-row">
                <div style={{ minWidth: 0 }}>
                  <div className="r14-next-title">{data.nextMove.reason}</div>
                  <div className="r14-next-sub">
                    {data.projects.find((p) => p.projectId === data.nextMove!.projectId)?.dealName}
                    {" · "}
                    {data.nextMove.scenarioLabel}
                  </div>
                </div>
                <div className="r14-spacer" />
                <span className="r14-next-cta">{data.nextMove.cta}</span>
              </div>
            </button>
          ) : (
            <div className="r14-next" style={{ cursor: "default" }}>
              <div className="r14-next-head">
                <span className="r14-next-label">Your next move</span>
              </div>
              <div className="r14-next-row">
                <div>
                  <div className="r14-next-title">Nothing needs you right now.</div>
                  <div className="r14-next-sub">
                    No declined approval, failed push or ageing quote is waiting on you.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── filters ─────────────────────────────────────────────────── */}
          <div className="r14-chips">
            {(["all", ...GROUP_ORDER] as const).map((k) => (
              <button
                key={k}
                className="r14-chip"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {k === "all" ? "All deals" : GROUP_META[k].label}
                <span className="r14-chip-count">{counts[k] ?? 0}</span>
              </button>
            ))}
            <input
              className="r14-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search deals, customers, quotes"
              aria-label="Search deals, customers, quotes"
            />
          </div>

          {/* ── table ───────────────────────────────────────────────────── */}
          <div className="r14-card">
            <div className="r14-grid r14-thead">
              <div>Deal</div>
              <div>Stage</div>
              <div>Latest quote</div>
              <div className="r14-num">Value</div>
              <div>Status</div>
              <div className="r14-num">Updated</div>
            </div>

            {grouped.map((g) => (
              <div key={g.key}>
                <div className={`r14-group-head r14-group-head-${g.key}`}>
                  <span className={`r14-dot r14-dot-${g.key}`} />
                  <span className="r14-group-label">{g.label}</span>
                  <span className="r14-group-count">{g.rows.length}</span>
                  <div className="r14-spacer" />
                  <span className="r14-group-hint">{g.hint}</span>
                </div>
                {g.rows.map((p) => (
                  <ProjectRow key={p.projectId} project={p} now={now} />
                ))}
              </div>
            ))}

            {grouped.length === 0 && (
              <div className="r14-empty">
                <div className="r14-empty-title">Nothing matches that.</div>
                <div className="r14-empty-sub">Clear the search or switch filters.</div>
              </div>
            )}

            <div className="r14-foot">
              <span>
                {visible.length} of {data.projects.length} deals
              </span>
              <div className="r14-spacer" />
              <span>
                {data.hiddenTestProjectCount} test {data.hiddenTestProjectCount === 1 ? "record" : "records"} hidden
              </span>
            </div>
          </div>
        </div>

        {/* ── needs-you rail ───────────────────────────────────────────── */}
        <aside className="r14-rail">
          <div className="r14-panel">
            <div className="r14-panel-head">
              <span className="r14-panel-title">Needs you</span>
              <div className="r14-spacer" />
              {/*
                Two counts, LABELLED. Breadth and workload are different
                questions; the words carry the difference so the numbers do not
                have to agree.
              */}
              <span className="r14-panel-counts">
                {needsYouDeals} {needsYouDeals === 1 ? "deal" : "deals"}
                <br />
                {data.needsYou.length} {data.needsYou.length === 1 ? "task" : "tasks"}
              </span>
            </div>

            {data.needsYou.length === 0 ? (
              <div className="r14-panel-empty">
                <div className="r14-panel-empty-title">Your queue is clear.</div>
                <div className="r14-panel-empty-sub">
                  Work appears here when something is genuinely unresolved and it is yours,
                  or when it is unassigned and you can act on it.
                </div>
              </div>
            ) : (
              data.needsYou.map((t) => {
                const deal = data.projects.find((p) => p.projectId === t.projectId);
                return (
                  <button key={t.id} className="r14-task" onClick={() => router.push(t.href)}>
                    <div className="r14-task-head">
                      <span className={`r14-tag ${TAG[t.kind].tone}`}>{TAG[t.kind].text}</span>
                      <span className="r14-task-deal">{deal?.dealName}</span>
                    </div>
                    <div className="r14-task-reason">{t.reason}</div>
                    <span className="r14-task-cta">{t.cta} →</span>
                  </button>
                );
              })
            )}

            <p className="r14-deferred">
              Pricing, cost and pending-approval work is not surfaced here yet — each
              needs current commercial state that this page cannot establish without a
              read it should not make. Open a quote to see where it stands.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ProjectRow({ project: p, now }: { project: OrganizerProject; now: number }) {
  const q = p.latestQuote;
  const href = q
    ? `/projects/${p.projectId}/quotes/${q.quoteId}/pricing`
    : `/projects/${p.projectId}`;
  const customer = p.clientName ?? "—";


  return (
    <Link href={href} className="r14-grid r14-row" style={{ textDecoration: "none" }}>
      <div className="r14-deal">
        {/*
          Identity colour from the SAME deterministic hash the outer rail uses,
          so a deal's chip in the table and its glyph in the rail are the same
          colour. Flat grey here read as a different application sitting beside
          a coloured rail.
        */}
        <span
          className="r14-avatar"
          style={{
            background: `oklch(0.55 0.12 ${p.glyph.hue})`,
            color: `oklch(0.98 0.02 ${p.glyph.hue})`,
          }}
        >
          {p.glyph.letter}
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="r14-customer">{customer}</span>
          <span className="r14-product">{p.dealName}</span>
        </span>
      </div>
      <div className="r14-cell">
        {p.dealStage ? (
          <span className="r14-stage" title={p.dealStage}>
            {p.dealStage}
          </span>
        ) : null}
      </div>
      <div className="r14-cell">
        {q ? (
          <>
            <span className="r14-quote">{q.scenarioLabel}</span>
            <span className="r14-rev">rev {q.versionNumber}</span>
          </>
        ) : (
          // Two different absences, said differently. "Every scenario was
          // dropped" is a project someone worked on and set aside; "no quote
          // yet" is one nobody has started. Collapsing them loses the only
          // signal that distinguishes them.
          <span className="r14-quote" style={{ opacity: 0.6 }}>
            {p.hasAnyQuotes ? "No active scenario" : "No quote yet"}
          </span>
        )}
      </div>
      {/*
        Deal value is BLANK unless a governed selected / recommended / accepted
        tier identifies which number the deal is worth. V1 persists no such
        pointer for a draft, so this reads em-dash rather than inventing a
        figure to fill the column.
      */}
      <div className="r14-cell r14-num r14-value r14-value-none">—</div>
      <div className="r14-cell">
        {q ? (
          <span className={`r14-status r14-status-${q.status}`}>
            {STATUS_LABEL[q.status] ?? q.status}
          </span>
        ) : null}
      </div>
      <div className="r14-cell r14-num r14-updated">
        {q ? relative(q.updatedAt, now) : "—"}
      </div>
    </Link>
  );
}
