"use client";

// Slice 9.5 — warning popover. Inline action panel anchored to a
// warning icon. Per Designer extension memo (CR-11): hover reveals a
// preview popover; click commits to the full action panel (sticky
// until dismissed). v1 implementation simplifies hover + click into
// a single popover that opens on click and closes on outside-click /
// Escape — hover preview is a polish item (UX_BACKLOG candidate if
// PMs ask for it).
//
// Layout per Designer memo:
//   Header strip: [icon] [SEVERITY · uppercase mono]
//   Message line: warning.message at 12.5px regular
//   Divider
//   Action row: Fix button (when applicable) + Accept dropdown
//
// Background: paper-2 (pre-RI: bg-white); border: 1px solid rule
// (pre-RI: border-slate-200); border-radius: 6px; padding: 10px 12px;
// max-width: 320px; shadow-md.

import { useEffect, useRef, useState, useTransition } from "react";
import { acceptWarning, type QuoteWarning } from "@/app/actions/warnings";
import type { WarningSpec } from "@/lib/validation";
import { WarningIcon } from "./warning-icon";

const ACCEPT_REASON_OPTIONS = [
  { value: "vendor_moq_break", label: "Vendor MOQ break" },
  { value: "customer_specific_pricing", label: "Customer-specific pricing" },
  { value: "special_handling_fee", label: "Special handling fee" },
  { value: "custom", label: "Other (custom)" },
] as const;

const SEVERITY_TEXT_COLOR: Record<WarningSpec["severity"], string> = {
  info: "text-slate-700",
  review: "text-amber-900",
  action_required: "text-red-800",
};

// Persistent warnings carry an `id` (DB row); pure engine specs
// don't. The popover supports both shapes — Accept button only
// renders when an id is available (i.e., warning has been persisted
// server-side). For client-side optimistic warnings without persisted
// rows yet, the popover shows the message + Fix affordance only;
// Accept is disabled with a "saving…" hint until reconcile lands.
type PersistedWarning = QuoteWarning;
type OptimisticWarning = WarningSpec & { id?: string };

export function WarningPopover({
  warning,
  onClose,
  onApplySuggestedFix,
}: {
  warning: PersistedWarning | OptimisticWarning;
  onClose: () => void;
  onApplySuggestedFix?: (warning: OptimisticWarning) => void;
}) {
  const [reasonKind, setReasonKind] = useState<string>("vendor_moq_break");
  const [reasonText, setReasonText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const severity = "severity" in warning ? warning.severity : "info";
  const message = "message" in warning ? warning.message : "";
  const detailJson =
    "detailJson" in warning
      ? (warning.detailJson as Record<string, unknown> | null)
      : (warning.detail_json as Record<string, unknown>);
  const persistedId =
    "id" in warning && typeof warning.id === "string" ? warning.id : undefined;
  const suggestedFix = (detailJson?.suggested_fix as
    | { kind: string; [k: string]: unknown }
    | undefined) ?? undefined;

  function handleAccept() {
    if (!persistedId) {
      setError("Warning still saving — try again in a moment.");
      return;
    }
    if (reasonKind === "custom" && reasonText.trim().length === 0) {
      setError("Custom reason requires a note.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("warningId", persistedId);
    fd.set("acceptReasonKind", reasonKind);
    fd.set("acceptReasonText", reasonKind === "custom" ? reasonText : "");
    startTransition(async () => {
      const r = await acceptWarning(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        onClose();
      }
    });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${severity} warning`}
      className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[320px] rounded-md border border-slate-200 bg-white p-3 shadow-md"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header strip — icon + severity uppercase mono */}
      <div className="mb-2 flex items-center gap-2">
        <WarningIcon severity={severity} />
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.04em] ${SEVERITY_TEXT_COLOR[severity]}`}
        >
          {severity === "action_required" ? "Action required" : severity}
        </span>
      </div>

      {/* Message */}
      <p className="text-[12.5px] text-slate-800">{message}</p>

      {/* Divider */}
      <div className="my-3 border-t border-slate-200" />

      {/* Action row */}
      <div className="flex flex-col gap-2">
        {suggestedFix && onApplySuggestedFix && "scope" in warning && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onApplySuggestedFix(warning as OptimisticWarning);
              onClose();
            }}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100 disabled:opacity-50"
          >
            {fixButtonLabel(suggestedFix)}
          </button>
        )}

        {/* Accept block */}
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-wide text-slate-500">
            Accept reason
          </label>
          <select
            value={reasonKind}
            onChange={(e) => setReasonKind(e.target.value)}
            disabled={pending || !persistedId}
            className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs disabled:bg-slate-50"
          >
            {ACCEPT_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {reasonKind === "custom" && (
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              disabled={pending || !persistedId}
              placeholder="e.g., one-off promo override approved by Nina"
              rows={2}
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] disabled:bg-slate-50"
            />
          )}
          <button
            type="button"
            disabled={pending || !persistedId}
            onClick={handleAccept}
            className="w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Accepting..." : "Accept"}
          </button>
          <p className="text-[10px] text-slate-500">
            Accepting suppresses this warning. It returns if you change the
            underlying value.
          </p>
        </div>

        {error && (
          <p className="text-[11px] text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function fixButtonLabel(fix: { kind: string; [k: string]: unknown }): string {
  switch (fix.kind) {
    case "copy_from_tier":
      return "Copy from source tier";
    case "apply_value_to_all_tiers":
      return "Apply value to all tiers";
    default:
      return "Apply suggested fix";
  }
}
