"use client";

import { useState } from "react";
import { renderAction, chipClass } from "./renderers";

// Slice RI.7 — single audit-log row component. Renders chip + summary
// + user + timestamp; click to expand the structured diff_json view.
//
// Client component so the expand toggle stays interactive without a
// round-trip. The diff render is intentionally simple: structured
// JSON with collapsible top-level keys. RI.8 polish can introduce
// per-field human-readable diff tables.

type Row = {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  summary: string | null;
  diffJson: Record<string, unknown>;
  causedByAuditId: string | null;
  userName: string | null;
  userEmail: string | null;
};

function fmtTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditLogRow({ row }: { row: Row }) {
  const [expanded, setExpanded] = useState(false);
  const rendered = renderAction(row.action, row.diffJson, row.entityLabel);

  // Prefer the renderer's computed summary over the stored
  // `summary` column — renderer reflects current diff_json shape;
  // stored summary may be stale or absent for older rows.
  const summary = rendered.summary || row.summary || row.action;

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline gap-3 text-sm">
        <span className="w-40 shrink-0 font-mono text-xs text-slate-500">
          {fmtTime(row.createdAt)}
        </span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide ${chipClass(rendered.chip.color)}`}
        >
          {rendered.chip.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-slate-900">{summary}</span>
          {row.entityLabel && (
            <span className="ml-2 italic text-slate-500">
              ({row.entityLabel})
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-slate-500">
          {row.userName ?? row.userEmail ?? "—"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-xs font-medium text-slate-700 underline hover:text-slate-900"
          aria-expanded={expanded}
        >
          {expanded ? "− collapse" : "+ diff"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 ml-44 space-y-1">
          <div className="font-mono text-[10px] text-slate-500">
            entity {row.entityType} · {row.entityId}
            {row.causedByAuditId && (
              <>
                {" · "}
                <span className="text-slate-700">
                  cascade · caused_by {row.causedByAuditId.slice(0, 8)}
                </span>
              </>
            )}
          </div>
          <pre className="overflow-auto rounded bg-slate-50 p-3 font-mono text-xs text-slate-800">
            {JSON.stringify(row.diffJson, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}
