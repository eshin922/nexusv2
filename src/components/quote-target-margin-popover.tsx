"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateQuoteTargetMargin } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteId,
  selectTargetMargin,
  selectUpdateTargetMargin,
} from "@/lib/costing-store";
import { validatePercentDecimal } from "@/lib/percent-validation";

// Slice 9.2 — per-quote target-margin override (Plan B placement).
//
// Gear-icon trigger sits next to the firm-target text in the
// QuoteSummaryCard header. Popover holds a single-section form:
//
//   Target margin
//     Firm default: 35%
//     This quote:  [   ] %      ← editable; blank = inherit firm
//     Currently effective: 35% (firm default)
//                                              [ Save ] [ Cancel ]
//
// or after override is set:
//
//   Target margin
//     Firm default: 35%
//     This quote:  30 %         ← editable
//     Currently effective: 30% (this quote)
//                              [ ↺ revert to firm ] [ Save ] [ Cancel ]
//
// UX choices:
//   - No auto-save. Save/Cancel buttons make the commit explicit
//     because a target-margin change can flip verdict classification
//     across the entire quote (every tier re-bands at once). Casual
//     drag should not be the path here.
//   - "Currently effective" line makes the NULL=inherit semantic
//     legible — without it, an empty field is opaque about which
//     value is in force.
//   - "↺ revert to firm" mirrors the per-tier "↺ inherit global"
//     pattern (see TierPriceAdjInput): the only NULL-write affordance.
//   - Same value as firm allowed and STORED as override (per "keep
//     literal" decision); revert button is the path back to inherit.
//
// Single-section layout reserves room for future per-quote settings
// (e.g., valid_until_days) that could land in the same popover later.
// Don't predict scope; just don't preclude it. (Note: client target
// price is per-(SKU, tier) cell, not per-quote — lives on the new
// `quote_sku_tier_targets` table per Slice 9.4b migration 0016, NOT
// in this popover.)

const POPOVER_WIDTH_PX = 320;
const VIEWPORT_PADDING_PX = 8;
const TRIGGER_GAP_PX = 4;

function decimalToPercentDisplay(d: number): string {
  if (!Number.isFinite(d)) return "";
  return Number((d * 100).toFixed(4)).toString();
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function QuoteTargetMarginPopover({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const quoteId = useCostingStore(selectQuoteId);
  const firmSettings = useCostingStore(selectFirmSettings);
  const overrideValue = useCostingStore(selectTargetMargin);
  const updateLocal = useCostingStore(selectUpdateTargetMargin);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Draft state — lives only inside the popover. Initialized on
  // open from the store; discarded on close (Cancel, ESC, outside
  // click). Save commits to store + server.
  const [draft, setDraft] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Re-seed the draft any time the popover opens. Picks up canonical
  // store changes that landed while the popover was closed (e.g.,
  // realtime reconcile from another tab).
  useEffect(() => {
    if (!open) return;
    setDraft(
      overrideValue !== null ? decimalToPercentDisplay(overrideValue) : "",
    );
    setError(null);
    setValidationError(null);
  }, [open, overrideValue]);

  // ---- positioning (HelpTooltip pattern) ----
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    let top = triggerRect.bottom + TRIGGER_GAP_PX;
    if (top + popoverRect.height + VIEWPORT_PADDING_PX > viewport.height) {
      top = triggerRect.top - popoverRect.height - TRIGGER_GAP_PX;
    }
    let left = triggerRect.left;
    if (left + popoverRect.width + VIEWPORT_PADDING_PX > viewport.width) {
      left = viewport.width - popoverRect.width - VIEWPORT_PADDING_PX;
    }
    if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;

    setPosition({ top, left });
  }, [open]);

  // Outside click → discard draft + close (= Cancel).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ESC → discard draft + close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  function attemptSave(displayValue: string) {
    setError(null);
    setValidationError(null);

    const trimmed = displayValue.trim();
    let normalized: number | null;
    if (trimmed === "") {
      // Blank input on Save = explicit "inherit firm" (NULL).
      normalized = null;
    } else {
      const decimal = Number(trimmed) / 100;
      const r = validatePercentDecimal(decimal, "rate");
      if (!r.valid) {
        setValidationError(r.message);
        return;
      }
      normalized = r.normalized;
    }

    // Optimistic store push first → verdict bands re-band in <50ms.
    updateLocal(normalized);

    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("targetMarginPct", displayValue);

    startTransition(async () => {
      const res = await updateQuoteTargetMargin(fd);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setOpen(false);
    });
  }

  function revertToFirm() {
    // Explicit revert = NULL write. Doesn't dismiss popover; lets PM
    // confirm the effective value reverted before clicking Save.
    setDraft("");
    setValidationError(null);
  }

  // What the popover would show as effective if Save fired right now.
  // Drives the "Currently effective" preview line so PMs see the
  // forthcoming change before committing.
  const trimmedDraft = draft.trim();
  const draftDecimal =
    trimmedDraft === "" ? null : Number(trimmedDraft) / 100;
  const effectivePreview =
    draftDecimal !== null && Number.isFinite(draftDecimal)
      ? { value: draftDecimal, source: "this quote" as const }
      : { value: firmSettings.targetMarginPct, source: "firm default" as const };

  const overrideIsActive = overrideValue !== null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setOpen((o) => !o);
        }}
        disabled={disabled}
        aria-label={
          overrideIsActive
            ? "Edit per-quote target margin override"
            : "Set per-quote target margin override"
        }
        aria-expanded={open}
        title="Per-quote target margin"
        className="ml-1 inline-flex shrink-0 items-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] leading-none text-gray-700 hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        ⚙
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Per-quote target margin"
          style={{
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            width: POPOVER_WIDTH_PX,
            visibility: position ? "visible" : "hidden",
          }}
          className="z-50 rounded-md border border-gray-200 bg-white p-4 text-sm shadow-lg"
        >
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Target margin
          </div>

          <div className="mb-2 flex items-baseline justify-between text-xs text-gray-600">
            <span>Firm default</span>
            <span className="tabular-nums">
              {fmtPct(firmSettings.targetMarginPct)}
            </span>
          </div>

          <label className="mb-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-700">This quote</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={draft}
                disabled={pending}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    attemptSave(draft);
                  }
                }}
                placeholder={decimalToPercentDisplay(
                  firmSettings.targetMarginPct,
                )}
                aria-label="Per-quote target margin override"
                className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </label>

          <div className="mb-3 flex items-baseline justify-between rounded bg-gray-50 px-2 py-1 text-xs">
            <span className="text-gray-600">Currently effective</span>
            <span className="tabular-nums text-gray-900">
              {fmtPct(effectivePreview.value)}{" "}
              <span className="text-[10px] text-gray-500">
                ({effectivePreview.source})
              </span>
            </span>
          </div>

          {validationError && (
            <p className="mb-2 text-[11px] text-red-700" role="alert">
              {validationError}
            </p>
          )}
          {error && !validationError && (
            <p className="mb-2 text-[11px] text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {overrideIsActive && (
              <button
                type="button"
                onClick={revertToFirm}
                disabled={pending}
                title="Clear override and inherit firm-level target"
                className="mr-auto rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                ↺ revert to firm
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => attemptSave(draft)}
              disabled={pending}
              className="rounded border border-blue-700 bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
