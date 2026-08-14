"use client";

import { useEffect, useState } from "react";
import { fetchLibraryDefaultSpecs } from "@/app/actions/leaf-specs";
import { SpecEntrySurface } from "@/components/spec-entry/spec-entry-surface";
import type { LeafSpecEntryData } from "@/lib/leaf-spec-loader";

// B-3 · Step 3 — Library default specs, edited as a SUB-FLOW over the Library.
//
// WHY A STACKED MODAL AND NOT A ROUTE. The Library is a modal, so navigating
// away destroys browse state — search, type filter, scroll — and no back link
// recovers it. The operator would pay for one spec edit with their whole place
// in a 1,000-row catalogue. Stacking is the convention AddProductModal already
// established for "+ Create new product" from this same surface, so this is an
// existing Nexus pattern rather than a new one.
//
// The browse modal stays mounted underneath and is never unmounted, which is
// what makes "returns to the exact Library position" true by construction
// rather than by restoring state after the fact.
//
// B-3 AUTHORITY IS UNCHANGED HERE. This edits `quote_id IS NULL` — the template
// for FUTURE attachments. No existing quote is touched, whatever its state.

export function LibrarySpecModal({
  leafId,
  open,
  onClose,
}: {
  leafId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<LeafSpecEntryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !leafId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await fetchLibraryDefaultSpecs(leafId);
      if (cancelled) return;
      if (!result.ok) setError(result.error.message);
      else setData(result.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, leafId]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Capture-phase + stop-immediate so the Library's own Escape handler does
      // not also fire and close both layers at once.
      e.stopImmediatePropagation();
      onClose();
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="a1v2-modal-backdrop r-a1v2-modal-stacked"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="a1v2-modal r-lib-spec-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-spec-title"
      >
        <div className="a1v2-modal-head">
          <h2 id="library-spec-title">Edit specs</h2>
        </div>
        <div className="a1v2-modal-body">
          {loading ? (
            <p className="sub">Loading…</p>
          ) : error ? (
            <div role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>
              {error}
            </div>
          ) : data ? (
            // The surface states the scope itself — "Default specifications ·
            // Used as the starting point for future quotes. Existing quotes are
            // not changed." Repeating it in the modal head would say it twice.
            <SpecEntrySurface
              scope={{ library: true }}
              data={data}
              readOnly={false}
            />
          ) : (
            <p className="sub">This product has no library record.</p>
          )}
        </div>
        <div className="a1v2-modal-foot">
          <span className="left">
            ⌥ Changes apply to future quote attachments only
          </span>
          <button type="button" className="a1v2-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
