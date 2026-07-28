"use client";

// Slice 12 Step 4 — VersionPicker for the Preview Quote sub-tab.
// Pattern 30 port of R8 canonical `.r8-vpick` markup in
// docs/design-prototypes/dist/round-8/app/r8/umbrella.jsx:107-191
// (PreviewTab § version chooser block).
//
// R8 designer notes §2 rationale: four versions with different totals
// is a *comparison*, not a pick-from-list. Rows show what changed and
// what it costs, so the PM can tell v3-sent from v4-draft at a glance
// — the same distinction the mismatch banner depends on downstream.
// Newest first. Same quote number on all of them, stated in the
// header.
//
// Nexus-side adaptations:
//   - Each version is a separate quote row (project_id +
//     scenario_label + version_number tuple). Clicking a version =
//     Link navigation to that version's /quote?tab=preview route —
//     no local iframe swap; each version gets its own URL. Matches
//     how PMs navigate scenarios from the project detail today.
//   - Total column intentionally blank until Step 5 lands the
//     per-version snapshot infrastructure (see quote-version-chain.ts
//     header for rationale — per-version rollup requires full
//     costing bundle per version, ~8 queries each, too expensive to
//     fan out here). Row still renders a `.vtotal` slot with an
//     em-dash placeholder for layout stability.
//   - Change-note column left empty for now — the note lives in
//     `quotes.notes` today (a text field with no per-version
//     history); Step 6 (Revise-in-place) introduces the versioned
//     change-note pattern via quote_review_events.

import Link from "next/link";
import type { VersionRow } from "@/lib/quote-version-chain";

function shortDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Maps quote.status to the R8 canonical .r8-vtag CSS class + display
// text. R8 canonical only defines three classes (sent / draft /
// superseded); Nexus has 6 status values. accepted + complete get
// the sent styling (post-sent states); lost gets superseded styling.
// Display text is the raw status so PMs see the true state.
function statusToTag(status: string): { text: string; className: string } {
  switch (status) {
    case "draft":
      return { text: "draft", className: "draft" };
    case "sent":
      return { text: "sent", className: "sent" };
    case "accepted":
      return { text: "accepted", className: "sent" };
    case "complete":
      return { text: "complete", className: "sent" };
    case "superseded":
      return { text: "superseded", className: "superseded" };
    case "lost":
      return { text: "lost", className: "superseded" };
    default:
      return { text: status, className: "superseded" };
  }
}

export function VersionPicker({
  projectId,
  versions,
  quoteNumber,
}: {
  projectId: string;
  versions: VersionRow[];
  quoteNumber: string | null;
}) {
  const versionsCount = versions.length;
  const headerMeta = quoteNumber
    ? `${quoteNumber} · ${versionsCount} version${versionsCount === 1 ? "" : "s"} · same quote number`
    : `${versionsCount} version${versionsCount === 1 ? "" : "s"} · quote number assigned at send`;

  return (
    <div className="r8-card flush">
      <div className="r8-card-head">
        <p className="eyebrow" style={{ margin: 0 }}>
          Version
        </p>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: "0.04em",
          }}
        >
          {headerMeta}
        </span>
      </div>
      <div className="r8-vpick">
        {versions.map((v) => {
          const tag = statusToTag(v.status);
          const dateLabel = v.sentAt
            ? `${shortDate(v.sentAt)} · sent`
            : shortDate(v.createdAt);
          const rowContent = (
            <>
              <span className="vlab">v{v.versionNumber}</span>
              <span>
                <span className="vnote">
                  {v.isCurrent ? "current view" : "—"}
                </span>
                <span className="vmeta" style={{ display: "block" }}>
                  {dateLabel}
                </span>
              </span>
              <span>
                <span className={`r8-vtag ${tag.className}`}>{tag.text}</span>
                <span
                  className="vtotal"
                  style={{ display: "block", marginTop: 4 }}
                >
                  {/* Total column ships in Step 5+ once per-version
                      snapshot data lands. Placeholder preserves layout. */}
                  —
                </span>
              </span>
            </>
          );
          const rowClass = "r8-vrow" + (v.isCurrent ? " active" : "");
          if (v.isCurrent) {
            return (
              <button
                key={v.quoteId}
                className={rowClass}
                disabled
                aria-current="true"
              >
                {rowContent}
              </button>
            );
          }
          return (
            <Link
              key={v.quoteId}
              className={rowClass}
              href={`/projects/${projectId}/quotes/${v.quoteId}/quote?tab=preview`}
            >
              {rowContent}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
