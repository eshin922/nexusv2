"use client";

import { useState } from "react";
import {
  compactRelativeTime,
  initialsFor,
  r5ActionClass,
  renderAction,
} from "./renderers";

// Slice RI.8 step 5 — R5 audit-log row.
//
// R5 row shape (per docs/design-prototypes/dist/source/round-5/e13554fd.js):
//   grid: ts (88px) | avatar (28px) | body (1fr) | expand (auto)
//   body: verb line (who + colored-action chip + entity)
//         summary line
//         meta line (full ts · entity_type · N fields changed · cascade chip)
//   on expand: r5-al-diff panel grid-spans cols 3-4 below body
//
// Click anywhere on the row toggles expand (R5: "Diffs ARE expandable
// rows, not modals"). Entity-label hyperlinks would land on the entity
// page in a new tab in production — placeholder for now (logged in
// designer note: "Entity hyperlinks land on that entity's page (in
// another tab)" is a v1.5 commitment, not blocking).

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

function fmtFullTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Render a primitive value for from/to display. Numbers with pct-shape
// keys render as percent (matches R5 fmtVal).
function fmtVal(v: unknown, key: string): string {
  if (v === null || v === undefined) return "null";
  const isPct = /(_pct|margin)$/i.test(key);
  if (isPct && typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return `${(n * 100).toFixed(1)}%`;
  }
  if (isPct && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
  if (typeof v === "string" && v.length > 60) return v.slice(0, 58) + "…";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Walk a diff_json shape and extract per-field {from, to} pairs.
// Handles the canonical { from: {...}, to: {...} } shape we use across
// firm_settings, markup_defaults, user_phone_updated, etc.
function extractFieldDiffs(
  diffJson: Record<string, unknown>,
): Array<{ key: string; from: unknown; to: unknown }> {
  const from = (diffJson.from ?? null) as Record<string, unknown> | null;
  const to = (diffJson.to ?? null) as Record<string, unknown> | null;
  if (from && to) {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    return Array.from(keys).map((k) => ({
      key: k,
      from: from[k],
      to: to[k],
    }));
  }
  if (to && !from) {
    // Create-only audit shape (e.g. first-time set)
    return Object.entries(to).map(([k, v]) => ({ key: k, from: null, to: v }));
  }
  // Fallback: surface the shape at the top level so auditors can see
  // it. Better than rendering nothing.
  return Object.entries(diffJson).map(([k, v]) => ({
    key: k,
    from: null,
    to: v,
  }));
}

export function AuditLogRow({ row }: { row: Row }) {
  const [expanded, setExpanded] = useState(false);
  const rendered = renderAction(row.action, row.diffJson, row.entityLabel);
  const summary = rendered.summary || row.summary || row.action;
  const initials = initialsFor(row.userName, row.userEmail);
  const actionClass = r5ActionClass(rendered.chip.color);
  const fieldDiffs = expanded ? extractFieldDiffs(row.diffJson) : [];

  return (
    <div
      className={`r5-al-row ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      aria-expanded={expanded}
    >
      <div className="ts">{compactRelativeTime(row.createdAt)}</div>
      <div className="avatar" title={row.userName ?? row.userEmail ?? ""}>
        {initials}
      </div>
      <div className="body">
        <div className="verb">
          <span className="who">{row.userName ?? row.userEmail ?? "—"}</span>
          <span className={`action ${actionClass}`}>
            {rendered.chip.label.toLowerCase()}
          </span>
          {row.entityLabel && (
            <span className="entity">{row.entityLabel}</span>
          )}
        </div>
        <div className="summary">{summary}</div>
        <div className="meta">
          <span>{fmtFullTime(row.createdAt)}</span>
          <span>·</span>
          <span>{row.entityType}</span>
          {fieldDiffs.length > 0 && (
            <>
              <span>·</span>
              <span>
                {fieldDiffs.length} field
                {fieldDiffs.length === 1 ? "" : "s"} changed
              </span>
            </>
          )}
          {row.causedByAuditId && (
            <span className="cascade-chip">
              cascade · caused_by {row.causedByAuditId.slice(0, 8)}
            </span>
          )}
        </div>

        {expanded && (
          <div className="r5-al-diff" onClick={(e) => e.stopPropagation()}>
            {row.causedByAuditId && (
              <div className="cascade-summary">
                <div>
                  <strong>Cascade</strong> — derived from upstream change{" "}
                  <strong>{row.causedByAuditId.slice(0, 8)}</strong>
                </div>
              </div>
            )}
            {fieldDiffs.length === 0 ? (
              <div className="field">
                <div className="key">— no field diffs —</div>
                <div className="val">
                  <code style={{ color: "var(--ink-3)" }}>
                    {row.action}
                  </code>
                </div>
              </div>
            ) : (
              fieldDiffs.map((f) => (
                <div className="field" key={f.key}>
                  <div className="key">{f.key}</div>
                  <div className="val">
                    {f.from === null || f.from === undefined ? (
                      <span className="to">{fmtVal(f.to, f.key)}</span>
                    ) : f.to === null || f.to === undefined ? (
                      <>
                        <span className="from">{fmtVal(f.from, f.key)}</span>
                        <span className="arrow">→</span>
                        <span style={{ color: "var(--ink-4)" }}>
                          (cleared)
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="from">{fmtVal(f.from, f.key)}</span>
                        <span className="arrow">→</span>
                        <span className="to">{fmtVal(f.to, f.key)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            <div
              className="field"
              style={{
                marginTop: 4,
                color: "var(--ink-4)",
                borderTop: "1px solid var(--rule)",
                paddingTop: 8,
              }}
            >
              <div className="key">entity</div>
              <div className="val" style={{ color: "var(--ink-3)" }}>
                {row.entityType} · {row.entityId}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="expand">
        {expanded ? "− COLLAPSE" : "+ DIFF"}
      </div>
    </div>
  );
}
