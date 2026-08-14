"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { changeLeafProductType } from "@/app/actions/leaf-specs";

// Phase A.1 v2 impl-3 Step 9 — Type-change confirmation modal.
//
// Per CD designer notes §4.10: changing a leaf's Product Type
// discards prior spec_values since fields don't translate
// across types. PM confirms via this modal; cascade audit
// pattern (root + N derived rows linked via caused_by_audit_id)
// captures the destructive clear.
//
// Trigger: a small "Change type" button next to the type tag
// in the SpecEntry header. Inert until the leaf has an existing
// product_type (initial-assignment uses TypePicker; type-change
// uses this modal).

export function ChangeTypeModal({
  scope,
  leafId,
  currentType,
  availableTypes,
  disabled,
}: {
  scope: { quoteId: string } | { library: true };
  leafId: string;
  currentType: LeafSpecEntryProductType;
  availableTypes: LeafSpecEntryProductType[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [targetTypeId, setTargetTypeId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Filter to types OTHER than current. Hidden + placeholder remain
  // selectable per scope rules (PMs can switch to a placeholder
  // type if needed; spec_values still cleared regardless).
  const switchTargets = availableTypes.filter((t) => t.id !== currentType.id);

  // Dialog Escape + outside-click dismiss.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setTargetTypeId(null);
        setError(null);
      }
    }
    function handleClick(e: MouseEvent) {
      if (!dialogRef.current) return;
      if (dialogRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setTargetTypeId(null);
      setError(null);
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  function handleConfirm() {
    if (!targetTypeId) return;
    const fd = new FormData();
    fd.set("leafId", leafId);
      // The scope travels with every write. A form that omitted it would be
      // refused rather than defaulted.
      if ("library" in scope) fd.set("scope", "library");
      else {
        fd.set("scope", "quote");
        fd.set("quoteId", scope.quoteId);
      }
    fd.set("productTypeId", targetTypeId);
    startTransition(async () => {
      setError(null);
      const result = await changeLeafProductType(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      setTargetTypeId(null);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="a1v2-change-type-trigger"
        onClick={() => setOpen(true)}
        disabled={disabled || pending}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Change type
      </button>

      {open ? (
        <div className="a1v2-modal-backdrop" role="presentation">
          <div
            ref={dialogRef}
            className="a1v2-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`change-type-title-${leafId}`}
          >
            <div className="a1v2-modal-head">
              <h2 id={`change-type-title-${leafId}`}>
                Change Product Type
              </h2>
              <p className="sub">
                Switching from <strong>{currentType.name}</strong> discards
                all current spec values. Fields don&apos;t translate across
                types. This cannot be undone.
              </p>
            </div>
            <div className="a1v2-modal-body">
              <fieldset className="a1v2-change-type-options">
                <legend>Pick a new type</legend>
                {switchTargets.map((t) => {
                  const fieldsLabel = t.placeholder
                    ? "fields TBD"
                    : `${t.fieldSchema?.fields.length ?? 0} fields`;
                  return (
                    <label
                      key={t.id}
                      className={`a1v2-change-type-option${
                        t.placeholder ? " placeholder" : ""
                      }${targetTypeId === t.id ? " selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="target-type"
                        value={t.id}
                        checked={targetTypeId === t.id}
                        onChange={() => setTargetTypeId(t.id)}
                        disabled={pending}
                      />
                      <div>
                        <div className="lab">{t.name}</div>
                        <div className="desc">{fieldsLabel}</div>
                      </div>
                    </label>
                  );
                })}
              </fieldset>
              {error ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 12,
                    color: "var(--bad)",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                  }}
                >
                  {error}
                </div>
              ) : null}
            </div>
            <div className="a1v2-modal-foot">
              <button
                type="button"
                className="a1v2-btn ghost"
                onClick={() => {
                  setOpen(false);
                  setTargetTypeId(null);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="a1v2-btn primary"
                onClick={handleConfirm}
                disabled={!targetTypeId || pending}
              >
                {pending ? "Changing…" : "Confirm · clears spec values"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
