"use client";

// §6.b Step 8 — Add-product modal (R7b §3.7).
//
// Canonical structure per 7bsetup.jsx L354-415 + 7bstyles.css
// .r7b-modal-* / .r7b-writeback rules:
//
//   .r7b-modal-backdrop  fixed-fill scrim
//     .r7b-modal         580px paper card with rule-2 border
//       .r7b-modal-head  H2 + .sub explanatory line
//       .r7b-modal-body  field grid (.row-pair 2-col + .field)
//         .r7b-writeback consequence-sentence toggle
//       .r7b-modal-foot  paper-2 actions (Cancel + Add product)
//
// Pattern 22 dispositions per §6.b carves:
//   - `pack` (Slice 11) and `category` (Slice 9) columns don't exist
//     yet. Modal fields are OMITTED for §6.b shipping shape — adding
//     UI controls that don't persist would mislead PMs. Restored when
//     the schema columns land (single-line addition each).
//
// HubSpot writeback toggle ships per brief Q4 Option 3 fallback:
// the UI is the canonical design (default ON, consequence-sentence,
// pill toggle), but the ON path writes a `hubspot_writeback_pending:
// true` audit-log flag — the actual HubSpot products-write happens
// when that infrastructure lands. No "coming soon" copy in the
// shipping UI because the toggle's intent is honest: PM is opting
// into future writeback, not invoking it synchronously.

import { useState, useTransition } from "react";
import { addProductSku } from "@/app/actions/quotes";

export function AddProductModal({
  quoteId,
  disabled,
}: {
  quoteId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [skuRole, setSkuRole] = useState<"leaf" | "assembly">("leaf");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [writeback, setWriteback] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProductName("");
    setSkuRole("leaf");
    setUnitsPerPack("1");
    setWriteback(true);
    setError(null);
  }

  function close() {
    if (pending) return;
    reset();
    setOpen(false);
  }

  function submit() {
    if (!productName.trim()) {
      setError("Product name is required.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("productName", productName.trim());
    fd.set("skuRole", skuRole);
    fd.set("unitsPerPack", unitsPerPack || "1");
    fd.set("pushToHubspot", writeback ? "true" : "false");
    startTransition(async () => {
      const result = await addProductSku(fd);
      if (!result.ok) {
        setError(result.error.message);
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
        className="add-sku primary"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        + Add product
      </button>
    );
  }

  return (
    <div
      className="r7b-modal-backdrop"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-product-modal-title"
    >
      <div
        className="r7b-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r7b-modal-head">
          <h2 id="add-product-modal-title">Add product</h2>
          <p className="sub">
            Creates a new SKU on this scenario. If HubSpot writeback is on,
            the product also gets registered in HubSpot as the canonical
            record.
          </p>
        </div>

        <div className="r7b-modal-body">
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-product-name">Product name</label>
              <input
                id="ap-product-name"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g., Hydra-Glow Vitamin C Serum"
                autoFocus
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-sku-role">Type</label>
              <select
                id="ap-sku-role"
                value={skuRole}
                onChange={(e) =>
                  setSkuRole(e.target.value as "leaf" | "assembly")
                }
                disabled={pending}
              >
                <option value="leaf">Leaf · single-line</option>
                <option value="assembly">Assembly · with components</option>
              </select>
            </div>
          </div>

          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-units-per-pack">Units per pack</label>
              <input
                id="ap-units-per-pack"
                type="number"
                min={1}
                step={1}
                value={unitsPerPack}
                onChange={(e) => setUnitsPerPack(e.target.value)}
                disabled={pending}
              />
            </div>
            <div />
          </div>

          {/* Canonical .r7b-writeback consequence-sentence toggle. Click
              anywhere on the card flips state; .tog renders the pill
              animation via CSS pseudo-element. */}
          <button
            type="button"
            className={`r7b-writeback ${writeback ? "on" : ""}`}
            onClick={() => setWriteback((v) => !v)}
            disabled={pending}
            aria-pressed={writeback}
            style={{
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              width: "100%",
              cursor: "pointer",
            }}
          >
            <span className="tog" aria-hidden />
            <div className="body">
              <div className="lab">Push to HubSpot</div>
              <div className="desc">
                Register this product in HubSpot as the canonical record.
                Other projects can reuse it.
              </div>
              <div className="consequence">
                {writeback
                  ? "→ writes to HubSpot in background; row appears immediately"
                  : "→ Nexus-local only; never syncs back to HubSpot"}
              </div>
            </div>
          </button>

          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                color: "var(--bad)",
                fontSize: 12,
              }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="r7b-modal-foot">
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
            disabled={pending || !productName.trim()}
          >
            {pending ? "Adding…" : "Add product"}
          </button>
        </div>
      </div>
    </div>
  );
}
