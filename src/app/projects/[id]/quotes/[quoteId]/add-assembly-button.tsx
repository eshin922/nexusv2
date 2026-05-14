"use client";

import { useState, useTransition } from "react";
import { addAssemblySku } from "@/app/actions/quotes";

// Leaf-detach micro-slice (Edward 2026-05-14 simplification) —
// top-level Nexus-local assembly creation. Pairs with the
// destructive leaf → assembly convert path: PM has two ways to
// get an assembly into a quote — convert an existing leaf
// destructively, OR create an empty assembly here.
//
// Top-level only (no parent_sku_id). Once the assembly exists,
// PM adds children via the row drawer's "+ Add child SKU"
// affordance, which goes through AddProductModal (HubSpot-first)
// per Sub-task B — every child is a HubSpot-linked leaf.
//
// Differs from the pre-2026-05-14 AddAssemblyButton (deleted in
// Sub-task B): no parent picker; no qty_per_parent; no sku_role
// override. Always creates a top-level assembly. Simpler form.

export function AddAssemblyButton({
  quoteId,
  disabled = false,
}: {
  quoteId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [skuLabel, setSkuLabel] = useState("");
  const [productName, setProductName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSkuLabel("");
    setProductName("");
    setError(null);
  }

  function close() {
    if (pending) return;
    reset();
    setOpen(false);
  }

  function submit() {
    setError(null);
    if (!skuLabel.trim()) {
      setError("SKU label required.");
      return;
    }
    if (!productName.trim()) {
      setError("Product name required.");
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("skuLabel", skuLabel.trim());
    fd.set("productName", productName.trim());
    startTransition(async () => {
      const r = await addAssemblySku(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      reset();
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="add-sku"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        + Add assembly
      </button>
    );
  }

  return (
    <div className="r7b-modal-backdrop" onClick={close}>
      <div
        className="r7b-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add Nexus-local assembly"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r7b-modal-head">
          <h2>Add assembly</h2>
          <p className="sub">
            Creates an empty Nexus-local assembly (kit definition). Add
            HubSpot-linked leaf children via the row drawer&rsquo;s
            &ldquo;+ Add child SKU&rdquo; affordance after creation.
          </p>
        </div>
        <div
          className="r7b-modal-body"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div className="field">
            <label htmlFor="add-asm-sku">SKU label</label>
            <input
              id="add-asm-sku"
              type="text"
              value={skuLabel}
              onChange={(e) => setSkuLabel(e.target.value)}
              placeholder="e.g. KIT-LIP-GIFT"
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="field">
            <label htmlFor="add-asm-name">Product name</label>
            <input
              id="add-asm-name"
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Lip gift set"
              disabled={pending}
            />
          </div>
          {error && (
            <p style={{ color: "var(--bad)", fontSize: 12, margin: 0 }}>
              {error}
            </p>
          )}
          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
          >
            <button
              type="button"
              className="btn ghost sm"
              onClick={close}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary sm"
              onClick={submit}
              disabled={pending}
            >
              {pending ? "Creating…" : "Create assembly"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
