"use client";

// Slice 9.5 — per-page summary chip + expanded panel. Per Designer
// extension memo (CR-11):
//
//   - Chip at top-right of page header. Format: [icon] N warnings ▾
//   - Highest severity wins for chip color; mixed-severity uses
//     highest-severity register (info → muted; review → warn-soft;
//     action_required → bad-soft)
//   - Hidden when zero warnings (panel hidden, not just empty)
//   - Click → dropdown panel anchored below-end (or above-end if
//     viewport-clipped). Panel: severity-grouped (action_required →
//     review → info), each item shows icon + message + meta + actions
//   - Accept-all in panel header: confirmation dialog when
//     ≥1 action_required present (per brief Q3)
//
// Filter prop allows the chip to scope to a specific surface
// (packaging-only, freight-only, etc.) via table_name match.

import { useMemo, useState, useTransition } from "react";
import { acceptWarning } from "@/app/actions/warnings";
import {
  buildAcceptedWarningKeySet,
  buildPersistedWarningIndex,
  persistedWarningKey,
  selectPersistedWarnings,
  selectWarnings,
  type PersistedQuoteWarning,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import type { WarningSpec } from "@/lib/validation";
import { WarningIcon } from "./warning-icon";

const SEVERITY_CHIP_CLASS: Record<
  "info" | "review" | "action_required",
  string
> = {
  info: "bg-slate-100 text-slate-700 border-slate-200",
  review: "bg-amber-100 text-amber-900 border-amber-300",
  action_required: "bg-red-100 text-red-800 border-red-300",
};

const SEVERITY_GROUP_LABEL: Record<
  "info" | "review" | "action_required",
  string
> = {
  info: "Info",
  review: "Review",
  action_required: "Action required",
};

export function WarningSummaryChip({
  filter,
  scope = "page",
}: {
  // Optional table_name filter — chip scopes to that surface only.
  // Omit for cross-page aggregation (used by Pricing).
  filter?: string;
  // 'page' = standard chip; 'aggregate' = stronger emphasis when
  // action_required present (per Designer memo §C, Pricing
  // gets 2px border treatment matching Round 2 BELOW_FLOOR verdict).
  scope?: "page" | "aggregate";
}) {
  const allWarnings = useCostingStore(selectWarnings);
  const persistedWarnings = useCostingStore(selectPersistedWarnings);
  const [open, setOpen] = useState(false);

  // Lookup index for attaching DB ids onto engine specs by identity
  // tuple. Re-built on every persistedWarnings change (rare; only on
  // hydrate/reconcile, not per keystroke).
  const persistedIndex = useMemo(
    () => buildPersistedWarningIndex(persistedWarnings),
    [persistedWarnings],
  );
  // Slice 9.5 — accepted tuples are suppressed from UI even when
  // engine still fires (architect option iii sticky acceptance).
  // Without this filter, PMs see "ghost" warnings they already
  // accepted because the engine fires on the underlying data state.
  const acceptedKeys = useMemo(
    () => buildAcceptedWarningKeySet(persistedWarnings),
    [persistedWarnings],
  );

  // Apply filter (when set) — narrows chip scope to the page's
  // table. Then suppress accepted-tuple ghosts.
  const warnings = (filter
    ? allWarnings.filter((w) => w.table_name === filter)
    : allWarnings
  ).filter((w) => !acceptedKeys.has(persistedWarningKey(w)));

  // Highest severity within the post-filter set (filter scopes by
  // table_name + suppresses accepted ghosts). Computed locally
  // rather than via store selector since the store's
  // selectHighestSeverity reads ALL engine warnings (no filter, no
  // acceptance suppression).
  const localHighest = recomputeHighest(warnings);

  if (warnings.length === 0) return null;
  const severity = localHighest ?? "info";

  const counts = countBySeverity(warnings);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium ${SEVERITY_CHIP_CLASS[severity]}`}
        aria-expanded={open}
      >
        <WarningIcon severity={severity} />
        <span>
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </span>
        <span className="text-[10px]">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <WarningSummaryPanel
          warnings={warnings}
          counts={counts}
          scope={scope}
          persistedIndex={persistedIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function recomputeHighest(
  ws: WarningSpec[],
): "info" | "review" | "action_required" | null {
  let highest: "info" | "review" | null = null;
  for (const w of ws) {
    if (w.severity === "action_required") return "action_required";
    if (w.severity === "review") {
      highest = "review";
    } else if (w.severity === "info" && highest === null) {
      highest = "info";
    }
  }
  return highest;
}

function countBySeverity(ws: WarningSpec[]) {
  let info = 0;
  let review = 0;
  let action_required = 0;
  for (const w of ws) {
    if (w.severity === "info") info += 1;
    else if (w.severity === "review") review += 1;
    else if (w.severity === "action_required") action_required += 1;
  }
  return { info, review, action_required };
}

function WarningSummaryPanel({
  warnings,
  counts,
  scope,
  persistedIndex,
  onClose,
}: {
  warnings: WarningSpec[];
  counts: { info: number; review: number; action_required: number };
  scope: "page" | "aggregate";
  persistedIndex: Map<string, PersistedQuoteWarning>;
  onClose: () => void;
}) {
  const [acceptAllConfirm, setAcceptAllConfirm] = useState(false);
  const [acceptAllReason, setAcceptAllReason] =
    useState<string>("vendor_moq_break");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const groups = ["action_required", "review", "info"] as const;

  const hasActionRequired = counts.action_required > 0;
  const acceptAllNeedsConfirm = hasActionRequired;

  function handleAcceptAll() {
    // Per Designer memo: single bulk reason. Iterate over warnings
    // and call acceptWarning for each. UI optimism: assume each
    // succeeds; show error if any fail.
    setError(null);
    startTransition(async () => {
      let failures = 0;
      for (const w of warnings) {
        // Look up persisted DB id by identity tuple; client-only
        // warnings (not yet persisted) skip — they'll persist on
        // next action commit.
        const persisted = persistedIndex.get(persistedWarningKey(w));
        if (!persisted) continue;
        const fd = new FormData();
        fd.set("warningId", persisted.id);
        fd.set("acceptReasonKind", acceptAllReason);
        fd.set("acceptReasonText", "");
        const r = await acceptWarning(fd);
        if (!r.ok) failures += 1;
      }
      if (failures > 0) {
        setError(`${failures} warning${failures === 1 ? "" : "s"} failed to accept.`);
      } else {
        onClose();
      }
    });
  }

  return (
    <div
      className={`absolute right-0 top-full z-50 mt-1 w-[480px] max-h-[520px] overflow-y-auto rounded-md border bg-white shadow-lg ${
        scope === "aggregate" && hasActionRequired
          ? "border-2 border-red-400"
          : "border-slate-200"
      }`}
      role="dialog"
    >
      {/* Header strip */}
      <div className="border-b border-slate-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-slate-600">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            {scope === "aggregate" && " · all pages"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAcceptAllConfirm(true)}
              disabled={pending}
              className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Dismiss panel"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* Accept-all confirmation (in-panel inline rather than modal) */}
      {acceptAllConfirm && (
        <div
          className={`border-b border-slate-200 px-3 py-2 ${
            acceptAllNeedsConfirm ? "bg-red-50" : "bg-slate-50"
          }`}
        >
          <p className="mb-2 text-[12px] text-slate-800">
            {acceptAllNeedsConfirm
              ? `Accepting will suppress ${counts.action_required} action-required warning${counts.action_required === 1 ? "" : "s"} that gate Mark-Accepted. Are you sure?`
              : `Accept ${warnings.length} warning${warnings.length === 1 ? "" : "s"}?`}
          </p>
          <div className="mb-2 flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wide text-slate-500">
              Reason:
            </label>
            <select
              value={acceptAllReason}
              onChange={(e) => setAcceptAllReason(e.target.value)}
              disabled={pending}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
            >
              <option value="vendor_moq_break">Vendor MOQ break</option>
              <option value="customer_specific_pricing">
                Customer-specific pricing
              </option>
              <option value="special_handling_fee">Special handling fee</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAcceptAll}
              disabled={pending}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {pending ? "Accepting..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setAcceptAllConfirm(false)}
              disabled={pending}
              className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Aggregate breakdown line (Pricing scope only) */}
      {scope === "aggregate" && (
        <div className="border-b border-slate-200 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-slate-500">
          {countByPage(warnings)}
        </div>
      )}

      {/* Severity-grouped list */}
      {groups.map((sev) => {
        if (counts[sev] === 0) return null;
        const items = warnings.filter((w) => w.severity === sev);
        return (
          <div key={sev} className="border-b border-slate-200 last:border-b-0">
            <div className="px-3 py-1.5">
              <span
                className={`font-mono text-[10px] uppercase tracking-[0.13em] ${
                  sev === "action_required"
                    ? "text-red-700"
                    : sev === "review"
                      ? "text-amber-700"
                      : "text-slate-500"
                }`}
              >
                {SEVERITY_GROUP_LABEL[sev]} · {counts[sev]}
              </span>
            </div>
            {items.map((w, idx) => (
              <PanelRow
                key={`${w.kind}-${w.row_id}-${w.tier_id}-${idx}`}
                warning={w}
                persistedIndex={persistedIndex}
              />
            ))}
          </div>
        );
      })}

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// Per-row warning entry in the panel. Inline-expands an Accept
// reason picker when clicked (per Designer extension memo §B —
// "Action buttons: Fix (when applicable) + Accept dropdown" on each
// panel row). For warnings with a server-side persisted id, the
// Accept commits via the action layer; client-only optimistic
// warnings (no id yet) show the button disabled until reconcile
// lands the row server-side.
function PanelRow({
  warning: w,
  persistedIndex,
}: {
  warning: WarningSpec;
  persistedIndex: Map<string, PersistedQuoteWarning>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reasonKind, setReasonKind] =
    useState<string>("vendor_moq_break");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Engine WarningSpec doesn't carry id; persisted server-side
  // warnings do. Look up by identity tuple to attach the DB id.
  const persisted = persistedIndex.get(persistedWarningKey(w));
  const persistedId = persisted?.id;

  function handleAccept() {
    if (!persistedId) return;
    setError(null);
    const fd = new FormData();
    fd.set("warningId", persistedId);
    fd.set("acceptReasonKind", reasonKind);
    fd.set("acceptReasonText", "");
    startTransition(async () => {
      const r = await acceptWarning(fd);
      if (!r.ok) setError(r.error.message);
      else setExpanded(false);
    });
  }

  return (
    <div className="px-3 py-2 hover:bg-slate-50">
      <div className="flex items-start gap-2">
        <WarningIcon severity={w.severity} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-slate-800">{w.message}</p>
          <p className="text-[10px] text-slate-500">{warningMetaLine(w)}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={!persistedId}
          title={
            persistedId
              ? "Accept this warning with reason"
              : "Saving warning... try again in a moment"
          }
          className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-white hover:border-slate-400 disabled:opacity-40"
        >
          Accept {expanded ? "▴" : "▾"}
        </button>
      </div>

      {expanded && persistedId && (
        <div className="mt-2 ml-6 space-y-1.5 border-l border-slate-200 pl-3">
          <select
            value={reasonKind}
            onChange={(e) => setReasonKind(e.target.value)}
            disabled={pending}
            className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
          >
            <option value="vendor_moq_break">Vendor MOQ break</option>
            <option value="customer_specific_pricing">
              Customer-specific pricing
            </option>
            <option value="special_handling_fee">Special handling fee</option>
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending}
              className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {pending ? "Accepting..." : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              disabled={pending}
              className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            Accepting suppresses this warning. It returns if you change the
            underlying value.
          </p>
          {error && (
            <p className="text-[11px] text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function warningMetaLine(w: WarningSpec): string {
  const parts: string[] = [];
  if (w.table_name) {
    const surface = w.table_name.replace("_inputs", "").replace("_", " ");
    parts.push(surface);
  }
  if (w.tier_id) {
    parts.push(`tier ${w.tier_id.slice(0, 6)}`);
  } else if (w.field_name && w.scope === "line") {
    parts.push("all tiers");
  }
  return parts.join(" · ") || "—";
}

function countByPage(warnings: WarningSpec[]): string {
  const byPage: Record<string, number> = {
    packaging_inputs: 0,
    production_inputs: 0,
    freight_inputs: 0,
    quote_skus: 0,
    other: 0,
  };
  for (const w of warnings) {
    if (w.table_name && w.table_name in byPage) {
      byPage[w.table_name] += 1;
    } else {
      byPage.other += 1;
    }
  }
  const labels = [
    `${byPage.packaging_inputs} packaging`,
    `${byPage.production_inputs} production`,
    `${byPage.freight_inputs} freight`,
  ];
  if (byPage.quote_skus > 0) labels.push(`${byPage.quote_skus} customs`);
  return labels.join(" · ");
}
