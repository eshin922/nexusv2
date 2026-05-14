"use client";

import { useState, useTransition } from "react";
import { addAssemblySku } from "@/app/actions/quotes";

type EligibleParent = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
};

/**
 * Creates a Nexus-local assembly SKU — no HubSpot Product reference.
 * Used when PMs design assemblies before (or instead of) creating them
 * in HubSpot. The assembly may be top-level or a child of another
 * assembly (assembly nesting is supported).
 */
export function AddAssemblyButton({
  quoteId,
  eligibleParents,
  triggerLabel = "+ Add assembly (Nexus-local)",
  triggerVariant = "primary",
  forcedParentId = null,
}: {
  quoteId: string;
  eligibleParents: EligibleParent[];
  /** §6.b Step 1 amendment — R7b table-footer label override.
   * Setup ships this as "+ Add Product" (footer affordance).
   * Step 8 replaces with the full add-product modal (HubSpot
   * writeback toggle + Category/Pack/Units/pk fields). */
  triggerLabel?: string;
  /** §6.b Step 4 — visual register for the trigger. Use "ghost"
   * for in-drawer "+ Add child SKU" so it doesn't compete with
   * the table-footer primary "+ Add Product" affordance. */
  triggerVariant?: "primary" | "ghost";
  /** §6.b Step 4 — when set, locks the parent select to this id
   * (used for the assembly drawer's "+ Add child SKU" footer).
   * Parent-picker UI hides; qty defaults to 1. */
  forcedParentId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [skuLabel, setSkuLabel] = useState("");
  const [productName, setProductName] = useState("");
  const [parentSkuId, setParentSkuId] = useState(forcedParentId ?? "");
  const [qtyPerParent, setQtyPerParent] = useState(forcedParentId ? "1" : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSkuLabel("");
    setProductName("");
    setParentSkuId(forcedParentId ?? "");
    setQtyPerParent(forcedParentId ? "1" : "");
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("skuLabel", skuLabel);
    fd.set("productName", productName);
    const effectiveParent = forcedParentId ?? parentSkuId;
    if (effectiveParent) {
      fd.set("parentSkuId", effectiveParent);
      fd.set("qtyPerParent", qtyPerParent || "1");
    }
    startTransition(async () => {
      const result = await addAssemblySku(fd);
      if (result.ok) {
        reset();
        setOpen(false);
      } else {
        setError(result.error.message);
      }
    });
  }

  if (!open) {
    // §6.b path-B migration — canonical .add-sku.primary (R7b
    // sku-footer "+ Add product" button) per 7bsetup.jsx line 188
    // + 7bstyles.css .r7b-sku-footer .add-sku rules. Ghost variant
    // uses .add-sku alone (no primary modifier) for in-drawer use.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerVariant === "ghost" ? "add-sku" : "add-sku primary"
        }
      >
        {triggerLabel}
      </button>
    );
  }

  // Edward pre-PR fidelity check — inline form rewritten using
  // canonical .r7b-child-add-form register (token-aware). Previous
  // shape used Tailwind gray-* hardcoding (bg-gray-50, bg-gray-900,
  // border-gray-300) that failed dark-mode. Same fix shape as the
  // Reassign panel (Finding 05); .btn primary/ghost sm primitives
  // for the actions cluster.
  return (
    <div className="r7b-child-add-form">
      <div className="row two-col">
        <input
          value={skuLabel}
          onChange={(e) => setSkuLabel(e.target.value)}
          placeholder="SKU label (required)"
        />
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Product name (required)"
        />
      </div>
      {forcedParentId ? (
        // §6.b Step 4 — when forced (in-drawer "+ Add child SKU"),
        // parent is locked; only qty per parent is editable.
        <div className="row qty-only">
          <span className="qty-label">Qty per parent</span>
          <input
            type="number"
            step="0.0001"
            min={0}
            value={qtyPerParent}
            onChange={(e) => setQtyPerParent(e.target.value)}
            placeholder="1"
            style={{ width: 90, textAlign: "right", fontFamily: "var(--mono)" }}
          />
        </div>
      ) : eligibleParents.length > 0 ? (
        <div className="row parent-qty">
          <select
            value={parentSkuId}
            onChange={(e) => setParentSkuId(e.target.value)}
          >
            <option value="">No parent (top level)</option>
            {eligibleParents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.skuLabel} — {p.productName}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.0001"
            min={0}
            value={qtyPerParent}
            onChange={(e) => setQtyPerParent(e.target.value)}
            placeholder="qty per parent"
            disabled={!parentSkuId}
            style={{ textAlign: "right", fontFamily: "var(--mono)" }}
          />
        </div>
      ) : null}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="foot">
        <button
          type="button"
          className="btn primary sm"
          onClick={handleSubmit}
          disabled={pending || !skuLabel.trim() || !productName.trim()}
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
