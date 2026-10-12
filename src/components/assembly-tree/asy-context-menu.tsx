"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteAssembly } from "@/app/actions/assemblies";
import { QuoteProductGroupPicker, type QuoteGroupProduct } from "./quote-product-group-picker";

// The common Add products action is visible on the group header. Group
// options holds the less frequent, destructive group deletion action.

export function AsyContextMenu({
  assemblyId,
  assemblySku,
  groupName,
  disabled,
  quoteProducts,
}: {
  assemblyId: string;
  assemblySku: string;
  groupName: string;
  disabled: boolean;
  quoteProducts: readonly QuoteGroupProduct[];
}) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss. Listener attached only when menu is open
  // to avoid sticky document handlers.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setConfirmingDelete(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function handleDelete() {
    if (confirmingDelete) {
      const fd = new FormData();
      fd.set("assemblyId", assemblyId);
      startTransition(async () => {
        setError(null);
        const result = await deleteAssembly(fd);
        if (!result.ok) {
          setError(result.error.message);
          setConfirmingDelete(false);
          return;
        }
        setOpen(false);
        setConfirmingDelete(false);
      });
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div ref={containerRef} className="setup-wizard-group-menu" style={{ position: "relative" }}>
      <button
        type="button"
        className="setup-wizard-inline-action setup-wizard-add-to-group"
        onClick={() => { setOpen(false); setPickerOpen(true); }}
        disabled={disabled || pending}
      >
        + Add products
      </button>
      <button
        type="button"
        className="context-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for item group ${assemblySku}`}
      >
        Group options <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="a1v2-context-menu"
          role="menu"
          aria-label="Item group actions"
        >
          <div className="header">Item group actions</div>
          <button
            type="button"
            className="item bad"
            role="menuitem"
            onClick={handleDelete}
            disabled={pending}
          >
            {confirmingDelete
              ? "Confirm — remove group and its products"
              : "Remove group and its products from quote"}
          </button>
          {error ? (
            <div
              role="alert"
              style={{
                padding: "6px 10px",
                color: "var(--bad)",
                fontSize: 11,
                fontFamily: "var(--mono)",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      )}
      <QuoteProductGroupPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        groupId={assemblyId}
        groupName={groupName}
        products={quoteProducts}
      />
    </div>
  );
}
