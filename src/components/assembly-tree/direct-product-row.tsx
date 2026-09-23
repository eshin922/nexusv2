"use client";

import { useState } from "react";
import type { DirectProductNode } from "@/lib/assembly-tree";
import { leafCostDisplay } from "@/lib/leaf-cost-display";
import { CompletenessChip } from "./completeness-chip";

/** Standalone products use the same card grammar as grouped products. */
export function DirectProductRow({
  product,
  editable,
  editSpecsHref,
  isMoving,
  dropEdge,
  pending: savingStructure,
  onRowDragOver,
  onRowDrop,
  onAddCharges,
  onRemove,
  removePending = false,
  chargeCount = 0,
  associatedServiceCount = 0,
  associatedProductName,
}: {
  product: DirectProductNode;
  editable: boolean;
  editSpecsHref: string;
  isMoving?: boolean;
  dropEdge?: "before" | "after" | null;
  pending?: boolean;
  onRowDragOver?: (e: React.DragEvent) => void;
  onRowDrop?: (e: React.DragEvent) => void;
  onAddCharges?: () => void;
  onRemove?: () => void;
  removePending?: boolean;
  chargeCount?: number;
  associatedServiceCount?: number;
  associatedProductName?: string | null;
}) {
  // Keep the shared cost register available to non-visual consumers without
  // reintroducing the legacy quantity/cost line into the setup card.
  const costDisplay = leafCostDisplay(product.unitCost);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const handleRemove = () => {
    if (!onRemove || !editable || removePending) return;
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    onRemove();
  };
  return (
    <div
      className={`a1v2-asy-row a1v2-direct-row${isMoving ? " moving" : ""}${dropEdge ? ` drop-${dropEdge}` : ""}${savingStructure ? " structure-pending" : ""}`}
      onDragOver={onRowDragOver}
      onDrop={onRowDrop}
    >
      <div className="name-cell">
        <div className="name setup-wizard-product-name">
          {product.name}
          {product.productType ? (
            <span className="setup-wizard-product-chip">{product.productType.label}</span>
          ) : null}
          <CompletenessChip completeness={product.specCompleteness} />
        </div>
        <div className="setup-wizard-product-sku">{product.sku ?? "SKU not recorded"}</div>
        {associatedProductName ? <div className="setup-wizard-associated-owner">For {associatedProductName}</div> : null}
        <span className="sr-only" aria-label="unit cost">{costDisplay}</span>
        <div className="setup-wizard-direct-charges">
          {onAddCharges ? (
            <>
              <span>Associated costs · {chargeCount + associatedServiceCount ? `${chargeCount + associatedServiceCount} added` : "none selected"}</span>
              <button
                type="button"
                onClick={onAddCharges}
                disabled={!editable}
                aria-label="Add associated costs"
                title={!editable ? "This quote is no longer a draft; charges are frozen." : undefined}
              >
                {chargeCount + associatedServiceCount ? "+ Add or change associated costs" : "+ Add associated costs"}
              </button>
            </>
          ) : null}
          <a className="setup-wizard-inline-action" href={editSpecsHref}>
            Edit library specs
          </a>
          {onRemove ? (
            <button
              type="button"
              className="setup-wizard-inline-action setup-wizard-remove-action"
              onClick={handleRemove}
              disabled={!editable || removePending}
              aria-label={`Remove ${product.name} from this quote`}
              title={!editable ? "This quote is no longer a draft." : undefined}
            >
              {removePending
                ? "Removing..."
                : confirmingRemove
                  ? "Confirm remove"
                  : "Remove"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
