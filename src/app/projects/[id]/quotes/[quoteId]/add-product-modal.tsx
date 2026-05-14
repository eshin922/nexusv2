"use client";

// Phase 1 (May 2026) — Add-product modal HubSpot-first rewrite.
// Supersedes the §6.b Step 8 local-first modal.
//
// Brief inversion: HubSpot is the source of truth. Submit always
// writes to HubSpot. No toggle. 13 fields per the HubSpot Products
// schema. SKU duplicate check on blur with two CTAs ("Pull existing"
// loads + attaches the existing record; "Use different SKU" clears
// + re-focuses).
//
// OQ2 disposition (Edward, Phase 1 prep): Leaf/Assembly dropped
// from the modal — graph position vs taxonomy are orthogonal axes.
// Modal handles taxonomy (hs_product_type); row drawer handles
// graph position (Reassign, Add child SKU).
//
// OQ3 disposition (Edward, Phase 1 prep): units_per_pack dropped
// from the modal; default to 1 on insert; exposed as inline edit
// on the SKU row in Phase 1.4 (R6 read↔edit pattern, Pattern 29).
//
// Phase 4 audit dimension banked: leaf→assembly promotion via row
// drawer probably writes hs_product_classification: bundle back to
// HubSpot for consistency. Explicit audit when that work lands.

import { useEffect, useState, useTransition } from "react";
import {
  addProductSku,
  addSkuFromHubspotProduct,
  checkProductSku,
  getCurrentHubspotOwner,
} from "@/app/actions/quotes";
import type { ProductSummary } from "@/lib/hubspot";
// Enum constants live in a client-safe module (no "server-only"
// directive) so this client component can import them without
// pulling in the HubSpot SDK Client. Same values; same names.
import {
  FSC_CLAIM_TYPE_OPTIONS,
  FSC_STATUS_OPTIONS,
  HS_PRODUCT_TYPE_OPTIONS,
  TAX_SCHEDULE_OPTIONS,
} from "@/lib/hubspot-product-options";

type Mode = "create" | "attach_existing";

type FormState = {
  name: string;
  hs_sku: string;
  description: string;
  hs_images: string;
  hs_url: string;
  hubspot_owner_id: string;
  hubspot_owner_label: string;
  price: string;
  hs_cost_of_goods_sold: string;
  markup: string;
  hs_product_type: string;
  tax_schedule: string;
  fsc_claim_type: string;
  fsc_status: string;
  fsc_supplier_verified: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  hs_sku: "",
  description: "",
  hs_images: "",
  hs_url: "",
  hubspot_owner_id: "",
  hubspot_owner_label: "",
  price: "",
  hs_cost_of_goods_sold: "",
  markup: "",
  hs_product_type: "",
  tax_schedule: "",
  fsc_claim_type: "",
  fsc_status: "",
  fsc_supplier_verified: "",
};

// Margin display per Edward smoke (May 2026): whole-number percentage.
// Formula: (price - cost) / price * 100, rounded to whole int.
// Brief originally specified `margin = price - cost` as a dollar
// amount; Edward's smoke clarified margin should read as a
// percentage (30% as 30) since that's how PMs talk margins.
function fmtMarginPct(n: number): string {
  return `${Math.round(n)}%`;
}

export function AddProductModal({
  quoteId,
  disabled,
  forcedParentId = null,
  triggerLabel = "+ Add product",
  triggerVariant = "primary",
}: {
  quoteId: string;
  disabled?: boolean;
  /** Leaf-detach micro-slice Sub-task B — when set, the new SKU
   * is created as a child of this parent assembly with
   * `qty_per_parent = 1`. Used by DrawerChildList's "+ Add child
   * SKU" affordance to force HubSpot-first leaf creation under
   * an assembly. Replaces the prior Nexus-local AddAssemblyButton
   * for child creation. */
  forcedParentId?: string | null;
  /** Trigger button copy override — DrawerChildList uses
   * "+ Add child SKU" inside the assembly drawer. */
  triggerLabel?: string;
  /** Trigger button visual variant — "ghost" for in-drawer use
   * so it doesn't compete with the table-footer primary. */
  triggerVariant?: "primary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<Mode>("create");
  // existingMatch is set when SKU blur finds a HubSpot product with the
  // entered hs_sku. Renders the duplicate warning inline. Cleared on
  // "Use different SKU" CTA or when the user edits the SKU again.
  const [existingMatch, setExistingMatch] = useState<ProductSummary | null>(null);
  // Designer audit Finding 14 (MEDIUM) — preserve the matched HubSpot
  // productId across mode transitions so the attach-existing submit
  // path doesn't have to re-resolve via a second API call. Set on
  // handlePullExisting; cleared on Use-different-SKU + on SKU edits
  // after Pull-existing (which revert mode to "create"). Race-safe
  // against HubSpot-side product deletes between blur and submit.
  const [matchedProductId, setMatchedProductId] = useState<string | null>(null);
  const [skuChecking, setSkuChecking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Resolve current HubSpot user as Owner default once per modal open.
  // CC instructions: empty if unresolved; don't crash.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const result = await getCurrentHubspotOwner();
      if (cancelled) return;
      if (result.ok && result.data) {
        setForm((f) => ({
          ...f,
          hubspot_owner_id: result.data!.id,
          hubspot_owner_label: result.data!.name ?? result.data!.id,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm(EMPTY_FORM);
    setMode("create");
    setExistingMatch(null);
    setMatchedProductId(null);
    setError(null);
  }

  function close() {
    if (pending) return;
    reset();
    setOpen(false);
  }

  async function handleSkuBlur() {
    const sku = form.hs_sku.trim();
    if (!sku) {
      setExistingMatch(null);
      return;
    }
    setSkuChecking(true);
    const result = await checkProductSku(sku);
    setSkuChecking(false);
    if (result.ok && result.data.found && result.data.product) {
      setExistingMatch(result.data.product);
    } else {
      setExistingMatch(null);
    }
  }

  function handlePullExisting() {
    if (!existingMatch) return;
    // CC instructions §"Pull existing": loads matching record data,
    // switches mode to attach. Submit then calls
    // addSkuFromHubspotProduct with the matched productId.
    //
    // Designer audit Finding 14 — preserve the productId so submit
    // doesn't need a second checkProductSku call. Race-safe: if
    // HubSpot deletes the product between blur and submit, the
    // attach action will surface the error rather than us silently
    // matching a different product on re-resolve.
    setMatchedProductId(existingMatch.id);
    setMode("attach_existing");
    setForm((f) => ({
      ...f,
      name: existingMatch.name,
      hs_sku: existingMatch.sku ?? "",
      description: existingMatch.description ?? "",
      hs_product_type: existingMatch.productType ?? "",
      price: existingMatch.price ?? "",
    }));
    setExistingMatch(null);
  }

  function handleUseDifferentSku() {
    setExistingMatch(null);
    setMatchedProductId(null);
    setMode("create");
    update("hs_sku", "");
    const input = document.getElementById("ap-hs-sku") as HTMLInputElement | null;
    input?.focus();
  }

  function submit() {
    setError(null);

    if (mode === "attach_existing") {
      // The "Pull existing" path: the existing HubSpot product is
      // already canonical; attach to the quote without re-creating.
      //
      // Designer audit Finding 14 (MEDIUM) — productId is preserved
      // across the mode transition via matchedProductId state. No
      // second checkProductSku call needed; race-safe against
      // HubSpot-side deletes between blur and submit. If the user
      // edited the SKU after Pull-existing, mode reverts to "create"
      // (see onChange handler below), so we never get here with a
      // stale match.
      if (!matchedProductId) {
        setError(
          "Lost the product reference. Re-enter the SKU and pick from the duplicate warning.",
        );
        return;
      }
      startTransition(async () => {
        const fd = new FormData();
        fd.set("quoteId", quoteId);
        fd.set("productId", matchedProductId);
        // Designer audit Finding 13 (HIGH) — Phase 1 limitation banked:
        // OQ2 disposition hardcoded sku_role = leaf for the CREATE path
        // (a new product is always leaf at creation; children don't
        // exist yet). The ATTACH-existing path inherits the same
        // hardcoding for v1, even when the HubSpot product is classified
        // hs_product_classification: "bundle". In that case the SKU
        // lands in Nexus as leaf and PM must promote via the row
        // drawer's Type badge — sub-optimal UX (extra click) but not
        // broken. Phase 4 audit dimension (scenario/assembly model
        // reconcile): read existingMatch.classification from HubSpot,
        // pre-fill sku_role from it, and audit the auto-promote on
        // attach. For Phase 1 v1 ship: leaf is fine.
        fd.set("skuRole", "leaf");
        if (forcedParentId) {
          fd.set("parentSkuId", forcedParentId);
          fd.set("qtyPerParent", "1");
        }
        const result = await addSkuFromHubspotProduct(fd);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        reset();
        setOpen(false);
      });
      return;
    }

    // Create mode — client-side required-field validation
    // (re-validated in addProductSku for defense-in-depth).
    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }
    if (!form.price.trim()) {
      setError("Unit price is required.");
      return;
    }
    if (!form.hs_product_type) {
      setError("Product type is required.");
      return;
    }

    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("name", form.name);
    fd.set("price", form.price);
    fd.set("hs_product_type", form.hs_product_type);
    fd.set("hs_sku", form.hs_sku);
    fd.set("description", form.description);
    fd.set("hs_images", form.hs_images);
    fd.set("hs_url", form.hs_url);
    fd.set("hubspot_owner_id", form.hubspot_owner_id);
    fd.set("hs_cost_of_goods_sold", form.hs_cost_of_goods_sold);
    fd.set("markup", form.markup);
    fd.set("tax_schedule", form.tax_schedule);
    fd.set("fsc_claim_type", form.fsc_claim_type);
    fd.set("fsc_status", form.fsc_status);
    fd.set("fsc_supplier_verified", form.fsc_supplier_verified);
    if (forcedParentId) {
      fd.set("parentSkuId", forcedParentId);
      fd.set("qtyPerParent", "1");
    }
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

  // Margin as a whole-number percentage. Display only.
  // (price - cost) / price * 100. Null when price is 0 or NaN
  // (divide-by-zero guard + invalid-input guard).
  const priceNum = Number(form.price);
  const costNum = Number(form.hs_cost_of_goods_sold);
  const marginVal =
    Number.isFinite(priceNum) && priceNum > 0 && Number.isFinite(costNum)
      ? ((priceNum - costNum) / priceNum) * 100
      : null;

  if (!open) {
    return (
      <button
        type="button"
        className={
          triggerVariant === "ghost" ? "add-sku" : "add-sku primary"
        }
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {triggerLabel}
      </button>
    );
  }

  const submitCta =
    mode === "attach_existing" ? "Attach product" : "Add product";
  const headSub =
    mode === "attach_existing"
      ? "Attaches an existing HubSpot product to this scenario. Edits to fields stay on this quote only — the canonical record in HubSpot is untouched."
      : "Creates a new product in HubSpot and adds it to this scenario.";

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
        style={{ width: "min(640px, 100%)" }}
      >
        <div className="r7b-modal-head">
          <h2 id="add-product-modal-title">
            {mode === "attach_existing" ? "Attach existing product" : "Add product"}
          </h2>
          <p className="sub">{headSub}</p>
        </div>

        <div
          className="r7b-modal-body"
          style={{ maxHeight: "min(70vh, 640px)", overflowY: "auto" }}
        >
          {/* Name + Product type (required) */}
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-name">Name *</label>
              <input
                id="ap-name"
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="e.g., Hydra-Glow Vitamin C Serum"
                autoFocus
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-product-type">Product type *</label>
              <select
                id="ap-product-type"
                value={form.hs_product_type}
                onChange={(e) => update("hs_product_type", e.target.value)}
                disabled={pending}
              >
                <option value="">— Select —</option>
                {HS_PRODUCT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description (full width textarea) */}
          <div className="field">
            <label htmlFor="ap-description">Description</label>
            <textarea
              id="ap-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional"
              disabled={pending}
              rows={2}
              style={{
                resize: "vertical",
                padding: "8px 10px",
                border: "1px solid var(--rule)",
                borderRadius: 6,
                background: "var(--paper-2)",
                color: "var(--ink)",
                font: "inherit",
              }}
            />
          </div>

          {/* SKU + URL */}
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-hs-sku">
                SKU{" "}
                {skuChecking && (
                  <span
                    style={{
                      color: "var(--ink-4)",
                      textTransform: "none",
                      letterSpacing: 0,
                      fontFamily: "var(--ui)",
                      fontSize: 10,
                      marginLeft: 6,
                    }}
                  >
                    checking…
                  </span>
                )}
              </label>
              <input
                id="ap-hs-sku"
                type="text"
                value={form.hs_sku}
                onChange={(e) => {
                  update("hs_sku", e.target.value);
                  // Clear existing-match warning when user edits the SKU.
                  if (existingMatch) setExistingMatch(null);
                  // Designer audit Finding 14 — if user edits SKU after
                  // pulling existing, intent flipped to create-with-new-
                  // SKU. Revert mode + clear the matched productId so
                  // submit doesn't attach the wrong product.
                  if (mode === "attach_existing") {
                    setMatchedProductId(null);
                    setMode("create");
                  }
                }}
                onBlur={handleSkuBlur}
                placeholder="Optional"
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-hs-url">URL</label>
              <input
                id="ap-hs-url"
                type="url"
                value={form.hs_url}
                onChange={(e) => update("hs_url", e.target.value)}
                placeholder="https://"
                disabled={pending}
              />
            </div>
          </div>

          {/* SKU duplicate warning — renders inline below the row-pair
              when blur surfaces an existing product with this SKU.
              Sweep Step 1 — migrated to canonical `.warn-band`
              primitive (extracted from inline-styled block per
              Designer audit Finding 18). */}
          {existingMatch && (
            <div className="warn-band" role="alert">
              <strong>This SKU already exists in HubSpot.</strong>{" "}
              {existingMatch.name}
              {" "}
              <span style={{ color: "var(--ink-3)" }}>
                · {existingMatch.productType ?? "no product type"}
              </span>
              <div className="actions">
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={handlePullExisting}
                  disabled={pending}
                >
                  Pull existing
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleUseDifferentSku}
                  disabled={pending}
                >
                  Use different SKU
                </button>
              </div>
            </div>
          )}

          {/* Unit price (required) + Unit cost */}
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-price">Unit price *</label>
              <input
                id="ap-price"
                type="number"
                step="0.01"
                min={0}
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="0.00"
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-cogs">Unit cost</label>
              <input
                id="ap-cogs"
                type="number"
                step="0.01"
                min={0}
                value={form.hs_cost_of_goods_sold}
                onChange={(e) =>
                  update("hs_cost_of_goods_sold", e.target.value)
                }
                placeholder="0.00"
                disabled={pending}
              />
            </div>
          </div>

          {/* Margin display (calculated, read-only). Brief: "Margin is
              calculated. Display only. Do not store. Do not send to
              HubSpot. HubSpot has no `margin` property."
              Sweep Step 1 — migrated to canonical `.calc-display`
              primitive (extracted from inline-styled block per
              Designer audit Finding 17). */}
          <div className="calc-display">
            <span className="lab">Margin</span>
            <span className={`v${marginVal === null ? " empty" : ""}`}>
              {marginVal !== null ? fmtMarginPct(marginVal) : "—"}
            </span>
          </div>

          {/* Markup + Tax Schedule */}
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-markup">Markup</label>
              <input
                id="ap-markup"
                type="number"
                step="0.01"
                min={0}
                value={form.markup}
                onChange={(e) => update("markup", e.target.value)}
                placeholder="e.g., 32"
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-tax-schedule">Tax schedule</label>
              <select
                id="ap-tax-schedule"
                value={form.tax_schedule}
                onChange={(e) => update("tax_schedule", e.target.value)}
                disabled={pending}
              >
                <option value="">— Select —</option>
                {TAX_SCHEDULE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Owner (default current user) + Image URL */}
          <div className="row-pair">
            <div className="field">
              <label htmlFor="ap-owner">Owner</label>
              <input
                id="ap-owner"
                type="text"
                value={form.hubspot_owner_label}
                onChange={(e) =>
                  // PMs typing here would need owner-search; v1 just
                  // shows the default + lets them clear it.
                  setForm((f) => ({
                    ...f,
                    hubspot_owner_label: e.target.value,
                    // If user clears the label, clear the id too.
                    hubspot_owner_id: e.target.value
                      ? f.hubspot_owner_id
                      : "",
                  }))
                }
                placeholder="Default current user"
                disabled={pending}
              />
            </div>
            <div className="field">
              <label htmlFor="ap-images">Image URL</label>
              <input
                id="ap-images"
                type="url"
                value={form.hs_images}
                onChange={(e) => update("hs_images", e.target.value)}
                placeholder="https://"
                disabled={pending}
              />
            </div>
          </div>

          {/* FSC trio — 3-up grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
            }}
          >
            <div className="field">
              <label htmlFor="ap-fsc-claim">FSC claim</label>
              <select
                id="ap-fsc-claim"
                value={form.fsc_claim_type}
                onChange={(e) => update("fsc_claim_type", e.target.value)}
                disabled={pending}
              >
                <option value="">—</option>
                {FSC_CLAIM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ap-fsc-status">FSC status</label>
              <select
                id="ap-fsc-status"
                value={form.fsc_status}
                onChange={(e) => update("fsc_status", e.target.value)}
                disabled={pending}
              >
                <option value="">—</option>
                {FSC_STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ap-fsc-supplier">Supplier verified</label>
              <select
                id="ap-fsc-supplier"
                value={form.fsc_supplier_verified}
                onChange={(e) =>
                  update("fsc_supplier_verified", e.target.value)
                }
                disabled={pending}
              >
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>

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
            disabled={
              pending ||
              !form.name.trim() ||
              !form.price.trim() ||
              !form.hs_product_type
            }
          >
            {pending ? "Saving…" : submitCta}
          </button>
        </div>
      </div>
    </div>
  );
}
