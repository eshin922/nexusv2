"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveProductMembership } from "@/app/actions/assemblies";

export type QuoteProductOption = {
  quoteLeafId: string;
  name: string;
  sku: string | null;
  assemblyId: string | null;
  groupName: string | null;
};

export function GroupProductPicker({
  open,
  onClose,
  assemblyId,
  assemblyName,
  memberCount,
  products,
}: {
  open: boolean;
  onClose: () => void;
  assemblyId: string;
  assemblyName: string;
  memberCount: number;
  products: readonly QuoteProductOption[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return products.filter((product) =>
      !term || `${product.name} ${product.sku ?? ""}`.toLocaleLowerCase().includes(term),
    );
  }, [products, search]);

  function addProduct(quoteLeafId: string) {
    const product = products.find((candidate) => candidate.quoteLeafId === quoteLeafId);
    if (!product || product.assemblyId) return;
    if (products.some((candidate) =>
      candidate.assemblyId === assemblyId &&
      candidate.sku && product.sku && candidate.sku === product.sku
    )) {
      setError(`${product.sku} is already in this item group.`);
      return;
    }
    const formData = new FormData();
    formData.set("quoteLeafId", quoteLeafId);
    formData.set("target", assemblyId);
    formData.set("position", String(memberCount));
    setPendingId(quoteLeafId);
    startTransition(async () => {
      setError(null);
      try {
        const result = await moveProductMembership(formData);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError("Could not add this product. Please try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  if (!open) return null;
  return (
    <div className="a1v2-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <div className="a1v2-modal" role="dialog" aria-modal="true" aria-labelledby={`group-product-picker-${assemblyId}`}>
        <div className="a1v2-modal-head">
          <h2 id={`group-product-picker-${assemblyId}`}>Add products to {assemblyName}</h2>
          <p className="sub">Choose from products already added to this quote. Add a new SKU in Products first.</p>
        </div>
        <div className="a1v2-modal-body">
          <div className="field">
            <span className="lbl">Find a product on this quote</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or SKU" autoFocus />
          </div>
          <div className="setup-wizard-group-product-options">
            {matches.length === 0 ? <p className="setup-wizard-empty-copy">No matching products on this quote. Add the product in Products first.</p> : null}
            {matches.map((product) => {
              const inThisGroup = product.assemblyId === assemblyId;
              const inAnotherGroup = !!product.assemblyId && !inThisGroup;
              const sameSkuInThisGroup = !product.assemblyId && !!product.sku && products.some((candidate) =>
                candidate.assemblyId === assemblyId && candidate.sku === product.sku
              );
              return (
                <div className="setup-wizard-group-product-option" key={product.quoteLeafId}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{product.sku ?? "SKU not recorded"}</span>
                  </div>
                  {inThisGroup ? <span>In this group</span> : sameSkuInThisGroup ? <span>SKU already in this group</span> : inAnotherGroup ? <span>In {product.groupName}</span> : (
                    <button type="button" className="a1v2-btn ghost sm" disabled={pending} onClick={() => addProduct(product.quoteLeafId)}>
                      {pendingId === product.quoteLeafId ? "Adding…" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {error ? <p role="alert" className="setup-wizard-group-product-error">{error}</p> : null}
        </div>
        <div className="a1v2-modal-foot">
          <span className="left">Products stay listed in Products with their group assignment.</span>
          <button type="button" className="a1v2-btn ghost" onClick={onClose} disabled={pending}>Close</button>
        </div>
      </div>
    </div>
  );
}
