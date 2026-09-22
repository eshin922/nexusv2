"use client";

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
  chargeCount = 0,
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
  chargeCount?: number;
}) {
  // Keep the shared cost register available to non-visual consumers without
  // reintroducing the legacy quantity/cost line into the setup card.
  const costDisplay = leafCostDisplay(product.unitCost);
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
        <span className="sr-only" aria-label="unit cost">{costDisplay}</span>
        <div className="setup-wizard-direct-charges">
          {onAddCharges ? (
            <>
              <span>One-time charges · {chargeCount ? `${chargeCount} added` : "none selected"}</span>
              <button
                type="button"
                onClick={onAddCharges}
                disabled={!editable}
                aria-label="Add one-time charges"
                title={!editable ? "This quote is no longer a draft; charges are frozen." : undefined}
              >
                {chargeCount ? "+ Add or change charges" : "+ Add one-time charge"}
              </button>
            </>
          ) : null}
          <a className="setup-wizard-inline-action" href={editSpecsHref}>
            Edit library specs
          </a>
        </div>
      </div>
    </div>
  );
}
