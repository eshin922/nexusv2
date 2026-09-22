"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AutoGenerateSku, type SkuServices } from "./auto-generate-sku";

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
  /** The row version this form was populated from. */
  updatedAt: string | null;
};

export type ProductTypeOption = { label: string; value: string };

export type UpdateProductService = (fd: FormData) => Promise<
  | { ok: true; data: { leafId: string; syncedToHubspot: boolean } }
  | { ok: false; error: { code: string; message: string } }
>;

export function EditProductModal({
  open,
  target,
  quoteId = null,
  skuServices,
  typeOptions,
  save,
  recover,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: EditProductTarget | null;
  /**
   * The quote this was opened from, when there is one. Lets the customer's
   * registered brand preselect for Auto-generate. Null on surfaces with no
   * customer in context, where the operator must choose instead.
   */
  quoteId?: string | null;
  /**
   * Injected like `save` and `recover`. Absent means the Auto-generate
   * affordance does not appear at all -- which is the correct behaviour for
   * any surface that has not wired it, rather than a button that cannot work.
   */
  skuServices?: SkuServices;
  typeOptions: ProductTypeOption[];
  save: UpdateProductService;
  /**
   * Settle an edit whose remote outcome was never confirmed.
   *
   * Separate from `save` because it is a different operation: it replays the
   * RECORDED attempt rather than submitting what is on screen, and the SKU is
   * pinned. Without it the refusal names a remedy the operator has no control
   * for -- which is the shape of the original defect, one layer up.
   */
  recover?: UpdateProductService;
  onClose: () => void;
  onSaved: (leafId: string) => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [editingEstablishedSku, setEditingEstablishedSku] = useState(false);
  const [confirmedEstablishedSkuChange, setConfirmedEstablishedSkuChange] =
    useState(false);
  const [url, setUrl] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [hsType, setHsType] = useState("");
  // One creation intent, one key. Keyed to the leaf, so reopening the dialog
  // for the SAME product reuses its allocation rather than burning another
  // number -- and a save retry keeps the SKU the operator was shown.
  const attemptKey = useMemo(
    () => `edit-leaf:${target?.leafId ?? "none"}`,
    [target?.leafId],
  );
  // Held across save attempts on purpose. A failed save keeps it, so the
  // retry binds the SAME reservation rather than leaving the identifier
  // unclaimed or spending a second number.
  const [skuAllocationId, setSkuAllocationId] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  /**
   * The product is HELD, and stays held until something establishes otherwise.
   *
   * Tracked apart from `error` because an error is transient and this is not.
   * Deriving the remedy from the last error code meant a failed check erased
   * the control for checking again -- so the one path out of the state was
   * closed by using it and failing.
   */
  const [held, setHeld] = useState<"unconfirmed" | null>(null);
  const [pending, startSave] = useTransition();

  // The SKU is ESTABLISHED if the product already had one when the form
  // opened. That is a different operation from completing a missing one, and
  // the control says so rather than accepting an edit the server will refuse.
  const established = Boolean(target?.sku && target.sku.trim() !== "");

  useEffect(() => {
    if (!open || !target) return;
    setName(target.name);
    setSku(target.sku ?? "");
    setEditingEstablishedSku(false);
    setConfirmedEstablishedSkuChange(false);
    setUrl(target.url ?? "");
    setUnitCost(target.unitCost ?? "");
    setHsType(target.hubspotProductType ?? "");
    setError(null);
    setHeld(null);
  }, [open, target]);

  if (!open || !target) return null;

  function submitRecovery() {
    if (!target || !recover) return;
    setError(null);
    const fd = new FormData();
    // The id, and nothing else. The retry replays exactly what was saved --
    // sending anything from this form would make it a DIFFERENT request, and a
    // different request is the one thing that is not safe while an earlier one
    // may still be in flight.
    fd.set("leafId", target.leafId);
    startSave(async () => {
      const res = await recover(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved(res.data.leafId);
      onClose();
    });
  }

  function submit() {
    if (!target) return;
    setError(null);
    const fd = new FormData();
    fd.set("leafId", target.leafId);
    // The version the form was POPULATED from, not a fresh read: the
    // question the server has to answer is whether the row still looks
    // like what this operator was editing.
    fd.set("expectedUpdatedAt", target.updatedAt ?? "");
    fd.set("name", name.trim());
    const nextSku = sku.trim();
    const establishedSkuChanged = established && nextSku !== (target.sku ?? "");
    fd.set("sku", nextSku);
    fd.set(
      "allowEstablishedSkuChange",
      establishedSkuChanged && confirmedEstablishedSkuChange ? "true" : "false",
    );
    fd.set("url", url.trim());
    fd.set("unitCost", unitCost.trim());
    fd.set("hubspotProductType", hsType);
    // Sent only when the SKU was generated. `updateLeaf` binds it inside the
    // same transaction that writes the leaf, and a retry sends the same id.
    if (skuAllocationId) fd.set("skuAllocationId", skuAllocationId);
    startSave(async () => {
      const res = await save(fd);
      if (!res.ok) {
        // Stays open, with the reason where the click happened, and the
        // control usable again. A synchronization failure is retryable.
        setError(res.error);
        // The HELD state outlives this error. Deriving the remedy from the
        // last error code closed the only way out of the state the moment
        // using it failed.
        if (res.error.code === "UNCONFIRMED_EDIT") setHeld("unconfirmed");
        return;
      }
      onSaved(res.data.leafId);
      onClose();
    });
  }

  return (
    // `a1v2-modal-scrim` was not a class. Nothing in any stylesheet defined
    // it, so the dialog got no positioning at all: it laid out in normal flow
    // inside the Library's own modal body, which put it low and left, behind
    // the Library, and off the bottom of the viewport once the list was
    // scrolled.
    //
    // `a1v2-modal-backdrop` is the real one -- fixed, centred, dimming -- and
    // `r-a1v2-modal-stacked` raises it a z-tier so it sits ABOVE the Library
    // rather than inside it. Same pair the spec editor already uses to stack
    // on the same surface. The Library stays mounted underneath, so closing
    // returns to it with its scroll position intact.
    <div
      className="a1v2-modal-backdrop r-a1v2-modal-stacked"
      // No click-to-dismiss. The spec editor has one, and matching it here
      // would be a change to how the dialog CLOSES -- which is not what this
      // fix is. Cancel and Save are the ways out, as before.
    >
      <div
        className="a1v2-modal r-edit-product-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-product-title"
        data-testid="edit-product-modal"
        data-leaf={target.leafId}
      >
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
              // WIDTH CAPPED TO THE CONTENT.
              //
              // The control stretched to the field's full width while its longest
              // option needs ~215px. A native select's popup inherits the
              // control's width, so opening it produced a panel measured at 594px
              // in Create and 514px in Edit against 215px of text -- 64% and 58%
              // blank respectively. That empty expanse is the whole defect; the
              // popup opening upward is ordinary browser placement and is left
              // alone.
              //
              // `fit-content` rather than a fixed cap: a number would be wrong the
              // day HubSpot adds a longer option, and wrong silently, by
              // truncating it. As a MAX it still yields to a narrow field, so the
              // control stays full width where full width is all there is.
              style={{ maxWidth: "fit-content" }}
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
                {!editingEstablishedSku ? (
                  <>
                    <input data-testid="edit-sku" value={target.sku ?? ""} disabled />
                    <button
                      type="button"
                      className="a1v2-btn ghost"
                      data-testid="edit-established-sku"
                      onClick={() => setEditingEstablishedSku(true)}
                    >
                      Change established SKU…
                    </button>
                    <span className="hint" data-testid="edit-sku-established">
                      This SKU is already in use as the product&apos;s identity. A
                      correction updates the library and HubSpot for future use;
                      existing quote records are not rewritten.
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      data-testid="edit-sku"
                      value={sku}
                      onChange={(e) => {
                        setSku(e.target.value);
                        setConfirmedEstablishedSkuChange(false);
                      }}
                      aria-describedby="edit-sku-correction-warning"
                    />
                    <div
                      id="edit-sku-correction-warning"
                      className="a1v2-error"
                      data-testid="edit-sku-correction-warning"
                      style={{ marginTop: 8, padding: "8px 12px", lineHeight: 1.45 }}
                    >
                      This changes the product&apos;s library identity and syncs the
                      new SKU to HubSpot. Existing quotes are not rewritten. Check
                      any NetSuite item or integrations that depend on the old SKU
                      before continuing.
                    </div>
                    <label
                      style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}
                    >
                      <input
                        type="checkbox"
                        data-testid="confirm-established-sku-change"
                        checked={confirmedEstablishedSkuChange}
                        onChange={(e) => setConfirmedEstablishedSkuChange(e.target.checked)}
                      />
                      <span>
                        I confirmed the downstream impact and want to change this
                        established SKU.
                      </span>
                    </label>
                    <button
                      type="button"
                      className="a1v2-btn ghost"
                      data-testid="cancel-established-sku-change"
                      onClick={() => {
                        setSku(target.sku ?? "");
                        setEditingEstablishedSku(false);
                        setConfirmedEstablishedSkuChange(false);
                      }}
                    >
                      Keep current SKU
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Input and control on ONE row, so generating reads as an
                    alternative to typing rather than a step after it. The hint
                    stays beneath both, where it describes the field. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    // A refusal notice takes its own line (flexBasis 100% on the
                    // control side); without wrap it could not, and would squeeze
                    // the field instead.
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    data-testid="edit-sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="Required before this product can be added to a quote"
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  {/* Only on the no-SKU branch. The established branch above
                      never offers it -- replacing an established identifier is
                      a controlled correction, not an ordinary edit. */}
                  {skuServices && (
                  <AutoGenerateSku
                    services={skuServices}
                    quoteId={quoteId}
                    currentValue={sku}
                    established={false}
                    attemptKey={attemptKey}
                    onGenerated={(v, id) => {
                      setSku(v);
                      setSkuAllocationId(id);
                    }}
                  />
                  )}
                </div>
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
              {error.message}
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
          {held === "unconfirmed" && recover && (
            <button
              type="button"
              className="a1v2-btn"
              data-testid="edit-product-recover"
              onClick={submitRecovery}
              disabled={pending}
            >
              {pending ? "Retrying…" : "Retry the saved edit"}
            </button>
          )}
          <button
            type="button"
            className="a1v2-btn primary"
            data-testid="edit-product-save"
            onClick={submit}
            disabled={
              pending ||
              name.trim() === "" ||
              (established &&
                sku.trim() !== (target.sku ?? "") &&
                !confirmedEstablishedSkuChange) ||
              // Saving over an unconfirmed remote state is the thing being
              // prevented; the way forward is the recovery beside it.
              held !== null
            }
          >
            {pending ? "Saving…" : "Save product"}
          </button>
        </div>
      </div>
    </div>
  );
}
