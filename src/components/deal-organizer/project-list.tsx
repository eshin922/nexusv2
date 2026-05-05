"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DealOrganizerRow } from "@/lib/workspace-queries";
import { ProjectGlyph } from "@/components/rails/project-glyph";

// Slice RI.2 — Round 4 Deal Organizer project list. Table-style
// (subtle borders + hover tint, NOT card-per-row), columns:
//   - Glyph + Deal/Client name
//   - Stage (HubSpot stage chip)
//   - Latest quote (scenario label + version)
//   - Status chip (draft / sent / accepted)
//   - Activity timestamp (relative)
//
// Filter chips above the table: All stages, Has-active, Has-accepted.
// More filters per Round 4 (Client, PM, Sales rep, Has-lines-to-review)
// deferred until upstream data wiring (Slice 9.5 quote_warnings flag
// for has-lines-to-review).
//
// Sort: latest activity DESC (default). Sort affordance kept simple
// for v1; column-header click-to-sort is polish.

type StatusFilter = "all" | "active" | "accepted" | "draft";

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All deals" },
  { value: "draft", label: "Has draft" },
  { value: "active", label: "Active scenarios" },
  { value: "accepted", label: "Accepted" },
];

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

const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bg-warn-soft text-warn", label: "DRAFT" },
  sent: { cls: "bg-accent-soft text-accent", label: "SENT" },
  accepted: { cls: "bg-good-soft text-good", label: "ACCEPTED" },
};

export function DealOrganizerProjectList({
  rows,
}: {
  rows: DealOrganizerRow[];
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => {
      const status = r.latestQuote?.status;
      if (filter === "draft") return status === "draft";
      if (filter === "active") return status === "draft" || status === "sent";
      if (filter === "accepted") return status === "accepted";
      return true;
    });
  }, [rows, filter]);

  return (
    <div className="overflow-hidden rounded-md border border-rule">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 border-b border-rule bg-paper-2 px-3 py-2.5">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                isActive
                  ? "border-accent bg-accent text-paper"
                  : "border-rule bg-paper text-ink-3 hover:border-rule-2 hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <div className="ml-auto font-mono text-[10px] uppercase tracking-wide text-ink-4">
          {filtered.length} of {rows.length} deals
        </div>
      </div>

      {/* Project table */}
      <table className="w-full">
        <thead className="border-b border-rule bg-paper-2 text-left font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
          <tr>
            <th className="px-3 py-2 font-normal">Deal</th>
            <th className="px-3 py-2 font-normal">Stage</th>
            <th className="px-3 py-2 font-normal">Latest quote</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 text-right font-normal">Activity</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-sm italic text-ink-4"
              >
                No deals match this filter.
              </td>
            </tr>
          ) : (
            filtered.map((r) => {
              const status = r.latestQuote?.status ?? "draft";
              const chip = STATUS_CHIP[status] ?? STATUS_CHIP.draft;
              const lastActivity =
                r.latestQuote?.updatedAt ?? new Date(0);
              return (
                <tr
                  key={r.id}
                  className="border-b border-rule transition-colors last:border-b-0 hover:bg-paper-2"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/projects/${r.id}`}
                      className="flex items-center gap-2.5 hover:text-accent"
                    >
                      <ProjectGlyph
                        glyph={r.glyph}
                        projectName={r.clientName ?? r.dealName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        {r.clientName && (
                          <div className="truncate font-display text-sm italic text-ink">
                            {r.clientName}
                          </div>
                        )}
                        <div className="truncate text-xs text-ink-2">
                          {r.dealName}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-3">
                    {r.dealStage ? (
                      <span className="rounded border border-rule px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide">
                        {r.dealStage}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-2">
                    {r.latestQuote ? (
                      <>
                        <span className="font-medium text-ink">
                          {r.latestQuote.scenarioLabel}
                        </span>
                        <span className="ml-1 font-mono text-[10px] text-ink-4">
                          v{r.latestQuote.versionNumber}
                        </span>
                      </>
                    ) : (
                      <span className="italic text-ink-4">No quotes yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.latestQuote && (
                      <span
                        className={`inline-block rounded px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-3">
                    {r.latestQuote
                      ? fmtRelative(lastActivity)
                      : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
