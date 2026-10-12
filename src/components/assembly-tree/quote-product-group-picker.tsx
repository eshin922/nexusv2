"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { moveProductsToGroup } from "@/app/actions/assemblies";

export type QuoteGroupProduct = {
  quoteLeafId: string;
  name: string;
  sku: string | null;
  groupId: string | null;
  groupName: string | null;
  associatedServiceCount: number;
};

/** Select an existing quote attachment; never create a second product line. */
export function QuoteProductGroupPicker({
  open,
  onClose,
  groupId,
  groupName,
  products,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  products: readonly QuoteGroupProduct[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const choices = products.filter((product) => product.groupId !== groupId);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setError(null);
    }
  }, [open, groupId]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  function addSelected() {
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.set("groupId", groupId);
    for (const product of choices) {
      if (selectedIds.has(product.quoteLeafId)) formData.append("quoteLeafId", product.quoteLeafId);
    }
    setError(null);
    startTransition(async () => {
      const result = await moveProductsToGroup(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  if (!mounted || !open) return null;
  return createPortal(
    <div className="od032-sheet-backdrop" role="presentation" onClick={() => { if (!pending) onClose(); }}>
      <div className="od032-sheet quote-group-picker" role="dialog" aria-modal="true" aria-label={`Add products to ${groupName}`} onClick={(event) => event.stopPropagation()}>
        <header className="od032-sheet-head">
          <div className="od032-sheet-head-row">
            <h2>Add products to {groupName}</h2>
            <button type="button" className="quote-group-picker-close" onClick={onClose} disabled={pending} aria-label="Close">×</button>
          </div>
          <p className="od032-owner">Select products from Products above. Their costs and quantities move with them.</p>
        </header>
        <div className="od032-sheet-body">
          {choices.length === 0 ? (
            <p className="quote-group-picker-empty">No other products are on this quote. Add one in Products first.</p>
          ) : (
            <ul className="quote-group-picker-list">
              {choices.map((product) => (
                <li key={product.quoteLeafId}>
                  <label className="quote-group-picker-choice">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(product.quoteLeafId)}
                      onChange={() => setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(product.quoteLeafId)) next.delete(product.quoteLeafId);
                        else next.add(product.quoteLeafId);
                        return next;
                      })}
                      disabled={pending}
                    />
                    <span>
                      <strong>{product.name}</strong>
                      <small>{product.sku ?? "No SKU"}{product.groupName ? ` · in ${product.groupName}` : " · standalone"}</small>
                      {product.associatedServiceCount > 0 ? <small>{product.associatedServiceCount} associated service{product.associatedServiceCount === 1 ? "" : "s"} stay with this product.</small> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="quote-group-picker-error" role="alert">{error}</p> : null}
          {choices.length > 0 && (
            <div className="quote-group-picker-actions">
              <span>{selectedIds.size} selected</span>
              <button type="button" className="od032-btn" onClick={addSelected} disabled={pending || selectedIds.size === 0}>
                {pending ? "Adding…" : `Add ${selectedIds.size} to group`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
