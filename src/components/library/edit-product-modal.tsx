"use client";

import { useEffect, useState, useTransition } from "react";

/**
 * Correct an existing Library product.
 *
 * ── PRODUCT DETAILS ARE NOT SPECIFICATIONS ────────────────────────────────
 *
 * This surface edits catalog IDENTITY -- what the thing is called, how it is
 * classified, the SKU it is known by. Specifications are a schema-driven
 * record ABOUT the thing and have their own surface. Conflating the two is
 * what produced a "Product Type" picker that governed specs while HubSpot
 * governed classification, and the two controls have been separate since.
 *
 * ── THE SCOPE OF AN EDIT IS STATED, NOT ASSUMED ───────────────────────────
 *
 * This is globally reusable master data. A change here reaches every FUTURE
 * attachment and no past one: quote snapshots and spec pins are historical
 * records of what a quote was built from, and are not rewritten. An operator
 * correcting a typo should not have to infer which of those two things they
 * are doing.
 */

export type EditProductTarget = {
  leafId: string;
  name: string;
  sku: string | null;
  url: string | null;
  unitCost: string | null;
  hubspotProductType: string | null;
  hubspotProductId: string | null;
  attachedQuoteCount: number;
};

export type ProductTypeOption = { label: string; value: string };

export type UpdateProductService = (fd: FormData) => Promise<
  | { ok: true; data: { leafId: string; syncedToHubspot: boolean } }
  | { ok: false; error: { code: string; message: string } }
>;

export function EditProductModal({
  open,
  target,
  typeOptions,
  save,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: EditProductTarget | null;
  typeOptions: ProductTypeOption[];
  save: UpdateProductService;
  onClose: () => void;
  onSaved: (leafId: string) => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [url, setUrl] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [hsType, setHsType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();

  // The SKU is ESTABLISHED if the product already had one when the form
  // opened. That is a different operation from completing a missing one, and
  // the control says so rather than accepting an edit the server will refuse.
  const established = Boolean(target?.sku && target.sku.trim() !== "");

  useEffect(() => {
    if (!open || !target) return;
    setName(target.name);
    setSku(target.sku ?? "");
    setUrl(target.url ?? "");
    setUnitCost(target.unitCost ?? "");
    setHsType(target.hubspotProductType ?? "");
    setError(null);
  }, [open, target]);

  if (!open || !target) return null;

  function submit() {
    if (!target) return;
    setError(null);
    const fd = new FormData();
    fd.set("leafId", target.leafId);
    fd.set("name", name.trim());
    fd.set("sku", established ? (target.sku ?? "") : sku.trim());
    fd.set("url", url.trim());
    fd.set("unitCost", unitCost.trim());
    fd.set("hubspotProductType", hsType);
    startSave(async () => {
      const res = await save(fd);
      if (!res.ok) {
        // Stays open, with the reason where the click happened, and the
        // control usable again. A synchronization failure is retryable.
        setError(res.error.message);
        return;
      }
      onSaved(res.data.leafId);
      onClose();
    });
  }

  return (
    <div
      className="a1v2-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-product-title"
      data-testid="edit-product-modal"
      data-leaf={target.leafId}
    >
      <div className="a1v2-modal">
        <div className="a1v2-modal-head">
          <h2 id="edit-product-title">Edit product</h2>
          <span className="sub lib-scope">
            ↗ Library master data · this change reaches future attachments.
            {target.attachedQuoteCount > 0
              ? ` ${target.attachedQuoteCount} quote${
                  target.attachedQuoteCount === 1 ? "" : "s"
                } already reference this product and are not rewritten.`
              : " No quote references it yet."}
          </span>
        </div>

        <div className="a1v2-modal-body">
          <div className="field">
            <span className="lbl req">Product name</span>
            <input
              data-testid="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="lbl">HubSpot product type</span>
            <select
              data-testid="edit-hs-type"
              aria-label="HubSpot product type"
              value={hsType}
              onChange={(e) => setHsType(e.target.value)}
            >
              <option value="">— Not classified —</option>
              {/* The INTERNAL value is submitted; the label is only shown.
                  Three of them diverge in production, so a label-keyed write
                  would resolve nothing for the largest categories. */}
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="lbl">SKU</span>
            {established ? (
              <>
                <input data-testid="edit-sku" value={target.sku ?? ""} disabled />
                <span className="hint" data-testid="edit-sku-established">
                  Established. Downstream identity may already depend on it —
                  quotes already sent, and the NetSuite item it resolves to — so
                  replacing it is a separate controlled correction rather than an
                  ordinary edit.
                </span>
              </>
            ) : (
              <>
                <input
                  data-testid="edit-sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Required before this product can be added to a quote"
                />
                <span className="hint" data-testid="edit-sku-missing">
                  This product has no SKU, which is why it cannot be added to a
                  quote. Completing it here does not create a second product.
                </span>
              </>
            )}
          </div>

          <div className="row-pair">
            <div className="field">
              <span className="lbl">Unit cost</span>
              <input
                data-testid="edit-unit-cost"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="$0.00"
              />
            </div>
            <div className="field">
              <span className="lbl">URL · supplier reference</span>
              <input
                data-testid="edit-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              data-testid="edit-product-error"
              className="a1v2-error"
              style={{
                marginTop: 12,
                padding: "8px 12px",
                border: "1px solid var(--warn, #d97706)",
                background: "var(--warn-soft, #fff4e5)",
                color: "var(--warn, #92400e)",
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {error}
            </p>
          )}
        </div>

        <div className="a1v2-modal-foot">
          <span className="left">
            Specifications are edited separately.
          </span>
          <button
            type="button"
            className="a1v2-btn ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="a1v2-btn primary"
            data-testid="edit-product-save"
            onClick={submit}
            disabled={pending || name.trim() === ""}
          >
            {pending ? "Saving…" : "Save product"}
          </button>
        </div>
      </div>
    </div>
  );
}
