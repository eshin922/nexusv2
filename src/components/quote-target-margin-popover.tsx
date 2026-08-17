"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateQuoteTargetMargin } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectGraph,
  selectQuoteId,
  selectTargetMargin,
  selectUpdateTargetMargin,
} from "@/lib/costing-store";
import { readEffectiveTargetMargin } from "@/lib/costing-nodes";
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
  value,
}: {
  disabled?: boolean;
  /**
   * The effective target, as a decimal, SUPPLIED BY THE CALLER.
   *
   * Deliberately not re-derived here. The grid captions itself with this same
   * number and bands every cell against it, so passing it through guarantees
   * the control states the target the grid is actually measuring — one value,
   * one source. A second read of the resolution ladder would be a second thing
   * that can be right on its own and wrong next to the grid.
   */
  value: number;
}) {
  const quoteId = useCostingStore(selectQuoteId);
  const firmSettings = useCostingStore(selectFirmSettings);
  const graph = useCostingStore(selectGraph);
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
  // The draft branch is a genuine PREVIEW of an uncommitted edit and stays
  // local. The other branch is not a preview at all — it is "what applies if
  // you clear this", which is the resolution ladder minus its top rung, and the
  // engine already publishes it. Reading `firmSettings` here was a sixth
  // private copy of that ladder, correct only for as long as the ladder has
  // exactly two rungs.
  const targetRead = readEffectiveTargetMargin(graph);
  const effectivePreview =
    draftDecimal !== null && Number.isFinite(draftDecimal)
      ? { value: draftDecimal, source: "this quote" as const }
      : {
          value: targetRead?.withoutOverride ?? null,
          source: (targetRead && !targetRead.isOverride
            ? targetRead.source.toLowerCase()
            : "firm default") as string,
        };

  const overrideIsActive = overrideValue !== null;

  return (
    <>
      {/*
        DISCOVERABILITY (2026-08-17). This was a bare ⚙ beside the word
        "target". The number read as passive status and the icon read as
        generic settings, so nothing on the surface suggested that the quote's
        Margin Target was editable at all — the authoring path was restored and
        still effectively unfindable.
        
        The label, the value and the edit affordance are now ONE target. An
        operator reading the figure is already pointing at the control that
        changes it, which is the property a separate icon cannot have however
        well it is styled.
      */}
      {disabled ? (
        // Read-only, and readable AS read-only: no button, no edit treatment,
        // no dimmed icon left behind to look like something that failed. A
        // sent quote states its Margin Target and offers nothing.
        <span className="psr-target-static">
          <span className="lab">Margin target</span>
          <span className="val">{fmtPct(value)}</span>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label={
            overrideIsActive
              ? `Edit Margin Target — currently ${fmtPct(value)}, set on this quote`
              : `Set a Margin Target for this quote — currently ${fmtPct(value)}, the firm default`
          }
          aria-expanded={open}
          className={`psr-target-control${overrideIsActive ? " overridden" : ""}`}
        >
          <span className="lab">Margin target</span>
          <span className="val">{fmtPct(value)}</span>
          <span className="edit">Edit</span>
        </button>
      )}
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
          className="psr-target-pop"
        >
          <div className="psr-target-pop-head">Target margin</div>

          <div className="psr-target-pop-row">
            <span>Firm default</span>
            <span className="num">{fmtPct(firmSettings.targetMarginPct)}</span>
          </div>

          <label className="psr-target-pop-row edit">
            <span>This quote</span>
            <div className="field">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={draft}
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
                className="psr-target-input"
              />
              <span className="unit">%</span>
            </div>
          </label>

          <div className="psr-target-pop-row effective">
            <span>Currently effective</span>
            <span className="num">
              {effectivePreview.value === null ? "—" : fmtPct(effectivePreview.value)}{" "}
              <span className="src">({effectivePreview.source})</span>
            </span>
          </div>

          {validationError && (
            <p className="psr-target-err" role="alert">
              {validationError}
            </p>
          )}
          {error && !validationError && (
            <p className="psr-target-err" role="alert">
              {error}
            </p>
          )}

          <div className="psr-target-pop-actions">
            {overrideIsActive && (
              <button
                type="button"
                onClick={revertToFirm}
                disabled={pending}
                title={
                  pending
                    ? "Saving — the revert will be available in a moment."
                    : "Clear override and inherit firm-level target"
                }
                className="psr-target-btn revert"
              >
                ↺ revert to firm
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              // Pattern 47(f): NOT gated on `pending`. Cancel initiates no
              // write, so an in-flight save must not trap the operator in a
              // dialog they have decided to leave. The save completes either
              // way; dismissing the popover does not cancel it, which is why
              // this is safe as well as correct.
              className="psr-target-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => attemptSave(draft)}
              // Its OWN action's pending — double-click protection, permitted
              // on buttons by Pattern 47(e), scoped by (f).
              disabled={pending}
              className="psr-target-btn primary"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
