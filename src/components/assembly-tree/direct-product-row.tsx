"use client";

import { useState, useTransition } from "react";
import type { DirectProductNode } from "@/lib/assembly-tree";
import { CompletenessChip } from "./completeness-chip";
import { detachQuoteProduct } from "@/app/actions/quote-products";

// A Direct Product — a product attached straight to the quote, with no Item
// Group. Renders as a FIRST-CLASS quote row, peer to an Item Group row, because
// that is what it is commercially: the choice between the two reaches the
// customer's Sales Order document.
//
// It deliberately does NOT reuse the grouped LeafRow. That row is indented
// under a parent, keyed by the legacy junction id, and carries group-membership
// affordances — rendering a Direct Product through it would present it as
// something contained by an Item Group, which is the exact confusion this
// structure exists to avoid.
//
// Operator identity only: product name and SKU. No quote_leaf_id, no
// assembly_leaf_id, no composition hash — those are internal and mean nothing
// to the person reading the quote.

export function DirectProductRow({
  product,
  editable,
  quoteId,
  editSpecsHref,
}: {
  product: DirectProductNode;
  editable: boolean;
  quoteId: string;
  editSpecsHref: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const otherRefs = Math.max(0, product.globalRefCount - 1);
  // Neutral wording, deliberately. This is NOT a blast-radius count: whether a
  // spec edit reaches another quote depends on that quote's own pin state, which
  // this number does not model. It says where the product is used and stops
  // there. B-3 item 4.
  const refsCopy =
    otherRefs > 0
      ? `Used in ${otherRefs} other quote${otherRefs === 1 ? "" : "s"}`
      : "this scenario only";
  const qtyNum = Number(product.quantity);
  const qtyDisplay = qtyNum < 1 ? qtyNum.toFixed(4) : String(qtyNum);
  const costDisplay = product.unitCost
    ? `$${Number(product.unitCost).toFixed(2)} cost`
    : "— cost";

  function handleRemove() {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("quoteLeafId", product.quoteLeafId);
    startTransition(async () => {
      setError(null);
      const result = await detachQuoteProduct(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setConfirming(false);
    });
  }

  return (
    <>
      <div className="a1v2-asy-row a1v2-direct-row">
        {/* No drag handle: ordering among Direct Products is not an operator
            concern yet, and a handle that reorders nothing would lie. */}
        <span className="twirl" aria-hidden="true">
          ◆
        </span>
        <span className="sku-pill">{product.sku ?? "—"}</span>
        <div className="name-cell">
          <div className="name">{product.name}</div>
          <div className="meta">
            <span>
              qty {qtyDisplay} · {costDisplay}
            </span>
            <span className="sep">·</span>
            <span className="type-tag">
              {product.productType?.name ?? "untyped"}
            </span>
          </div>
        </div>
        <span className="leaf-count">Product</span>
        <CompletenessChip completeness={product.specCompleteness} />
        {/* One grid cell for every action, so the confirm state adding a
            second button cannot reflow the row into a new grid line. */}
        <div className="direct-actions">
          <span className="leaf-refs">{refsCopy}</span>
          <a className="a1v2-btn ghost sm" href={editSpecsHref}>
            Edit product specs
          </a>
          {editable ? (
            confirming ? (
              <>
                <button
                  type="button"
                  className="a1v2-btn ghost sm"
                  onClick={handleRemove}
                  // Pattern 47(f): this button owns the action it initiates,
                  // and nothing else on the row is gated by it.
                  disabled={pending}
                  title={pending ? "Removing…" : "Confirm removal"}
                >
                  {pending ? "Removing…" : "Confirm"}
                </button>
                <button
                  type="button"
                  className="a1v2-btn ghost sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="a1v2-btn ghost sm"
                onClick={() => setConfirming(true)}
                title="Remove this product from the quote"
              >
                Remove
              </button>
            )
          ) : null}
        </div>
      </div>
      {error ? (
        <div
          role="alert"
          style={{
            padding: "6px 16px",
            color: "var(--bad)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      ) : null}
    </>
  );
}
