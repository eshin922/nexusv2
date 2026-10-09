"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { moveProductMembership } from "@/app/actions/assemblies";

export type QuoteGroupProduct = {
  quoteLeafId: string;
  name: string;
  sku: string | null;
  groupId: string | null;
  groupName: string | null;
};

/** Select an existing quote attachment; never create a second product line. */
export function QuoteProductGroupPicker({
  open,
  onClose,
  groupId,
  groupName,
  position,
  products,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  position: number;
  products: readonly QuoteGroupProduct[];
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choices = products.filter((product) => product.groupId !== groupId);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onClose]);

  function select(product: QuoteGroupProduct) {
    const formData = new FormData();
    formData.set("quoteLeafId", product.quoteLeafId);
    formData.set("target", groupId);
    formData.set("position", String(position));
    setError(null);
    startTransition(async () => {
      const result = await moveProductMembership(formData);
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
          <p className="od032-owner">Choose a product from Products above. Its costs and quantity move with it.</p>
        </header>
        <div className="od032-sheet-body">
          {choices.length === 0 ? (
            <p className="quote-group-picker-empty">No other products are on this quote. Add one in Products first.</p>
          ) : (
            <ul className="quote-group-picker-list">
              {choices.map((product) => (
                <li key={product.quoteLeafId}>
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.sku ?? "No SKU"}{product.groupName ? ` · in ${product.groupName}` : " · standalone"}</small>
                  </span>
                  <button type="button" className="od032-btn" onClick={() => select(product)} disabled={pending}>Add to group</button>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="quote-group-picker-error" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
