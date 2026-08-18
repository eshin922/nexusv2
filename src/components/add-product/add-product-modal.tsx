"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { createLeaf, fetchHubspotProductTypes } from "@/app/actions/leaves";
import {
  DIRECT_SERVICE_IDENTITIES,
  DIRECT_SERVICE_LABELS,
} from "@/lib/product-structure/direct-service";

// Phase A.1 v2 impl-4 — Add Product modal (scenarios ⑪-⑯).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// Create New Product — LIBRARY MASTER DATA ONLY.
//
// Creates a globally reusable library product via the governed Nexus/HubSpot
// creation path. It does NOT create quote structure. The ASY branch that used
// to live here offered an Item Group as a second kind of "product"; Item Groups
// are quote-local structure and are created from their own setup-surface entry
// point (see components/item-group/create-item-group-modal.tsx).
//
//   - identity fields (name + Nexus type + HubSpot type + sku + cost + url)
//   - Submit Continue → createLeaf → navigate to specs
//   - Submit Defer    → createLeaf → close + post-creation toast
//
// Pattern 47 invariants on form inputs: controlled values, no
// `disabled={pending}` on inputs (button-level pending only).



export function AddProductModal({
  quoteId,
  projectId,
  open,
  onClose,
  onSuccess,
  stacked = false,
  leafTypes,
}: {
  quoteId: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
  // slice-library-first-creation-flow Step 3 — optional success
  // callback for stacked-modal consumers (LibraryBrowseModal's
  // "+ Create new product" path; the canonical add-to-quote entry
  // point post-Step-6 simplification). Fires alongside `onClose`
  // only on successful create. Absent → preserves stable API for
  // any future direct consumer that doesn't need to discriminate
  // submit vs cancel.
  // `name` lets the caller CONFIRM the creation. An id alone cannot be
  // shown to an operator or searched for; the library searches by name or
  // SKU, so the name is what makes the new record locatable.
  onSuccess?: (result: { kind: "leaf"; id: string; name: string }) => void;
  // slice-library-first-creation-flow Step 4 — when mounted as a
  // sub-flow on top of another modal (LibraryBrowseModal's
  // "+ Create new product"), pass stacked={true}. Applies the
  // `r-a1v2-modal-stacked` nexus class to the backdrop (z-index:
  // 110 — above the 100 base) and registers the Escape handler
  // with capture-phase + stopImmediatePropagation so the
  // underlying modal's keydown listener doesn't also fire. See
  // r-a1v2-overrides.css for full pattern documentation.
  stacked?: boolean;
  leafTypes: LeafSpecEntryProductType[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  // LEAF form state
  const [leafName, setLeafName] = useState("");
  const [leafTypeId, setLeafTypeId] = useState<string>("");
  // HubSpot's own classification, kept separate from the Nexus type above.
  // `hsTypeValue` holds the INTERNAL option value; the label is only ever
  // rendered. The two differ on the three largest categories, so conflating
  // them would send a string HubSpot stores but never matches.
  const [hsTypeValue, setHsTypeValue] = useState<string>("");
  // BV-012 §5 — what the operator is creating. Stated, never inferred.
  const [commercialKind, setCommercialKind] = useState<"product" | "service">(
    "product",
  );
  const [serviceIdentity, setServiceIdentity] = useState<string>("");
  const [hsTypeOptions, setHsTypeOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [hsTypeError, setHsTypeError] = useState<string | null>(null);
  const [leafSku, setLeafSku] = useState("");
  const [leafUnitCost, setLeafUnitCost] = useState("");
  const [leafUrl, setLeafUrl] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset all form state on close so re-opening starts fresh.
  // Toast is preserved across modal close (auto-dismisses on its
  // own ~3s timer in the parent).
  useEffect(() => {
    if (open) return;
    setLeafName("");
    setLeafTypeId("");
    setLeafSku("");
    setLeafUnitCost("");
    setLeafUrl("");
    setHsTypeValue("");
    setError(null);
  }, [open]);

  // Load the governed HubSpot option set when the modal opens. Fetched rather
  // than hard-coded: a local copy would drift the moment an option is added in
  // HubSpot, and the drift is silent — a product classified under the new value
  // would simply stop matching anything.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchHubspotProductTypes();
      if (cancelled) return;
      if (result.ok) {
        setHsTypeOptions(result.data.options);
        setHsTypeError(null);
      } else {
        // Surfaced, not swallowed: without the vocabulary the operator cannot
        // classify, and an empty dropdown that looks like "no options exist"
        // would be a worse lie than an error.
        setHsTypeOptions([]);
        setHsTypeError(result.error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape dismiss + backdrop click.
  //
  // When stacked (slice-library-first-creation-flow Step 4), register
  // the listener with capture-phase + call stopImmediatePropagation
  // so the underlying modal's bubble-phase keydown handler doesn't
  // also fire. Document-level listeners are siblings; without
  // capture order, Escape would dismiss both modals at once.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) {
        if (stacked) {
          e.stopImmediatePropagation();
        }
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey, stacked);
    return () => document.removeEventListener("keydown", handleKey, stacked);
  }, [open, pending, onClose, stacked]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedLeafType = leafTypes.find((t) => t.id === leafTypeId) ?? null;

  function handleSubmitLeaf(option: "continue" | "defer") {
    if (!leafName.trim()) {
      setError("Leaf name is required.");
      return;
    }
    if (!leafTypeId) {
      setError("Pick a Product Type.");
      return;
    }
    const fd = new FormData();
    fd.set("name", leafName.trim());
    // Step 8 · a Nexus leaf type is no longer sent. Classification travels as
    // `hubspotProductType` only, which is the authority the Library, Setup and
    // the Spec Schema mapping all read.
    // The internal value, never the label. The server re-validates membership
    // against the governed option set, so a stale client cannot write a
    // withdrawn or invented classification.
    // A service sends its classification and NOT a HubSpot type: HubSpot is
    // not the authority for it and the action creates no HubSpot product for a
    // service at all.
    fd.set("commercialKind", commercialKind);
    if (commercialKind === "service") {
      fd.set("serviceIdentity", serviceIdentity);
    } else if (hsTypeValue) {
      fd.set("hubspotProductType", hsTypeValue);
    }
    if (leafSku) fd.set("sku", leafSku.trim());
    if (leafUnitCost) fd.set("unitCost", leafUnitCost.trim());
    if (leafUrl) fd.set("url", leafUrl.trim());

    startTransition(async () => {
      setError(null);
      const result = await createLeaf(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // Captured BEFORE onClose, which resets the form. The toast read
      // `Added "" to the library` because it interpolated a field that had
      // already been cleared -- a confirmation that named nothing, which is
      // not a confirmation.
      const created = leafName.trim();
      onSuccess?.({ kind: "leaf", id: result.data.leafId, name: created });
      onClose();
      if (option === "continue") {
        router.push(
          `/projects/${projectId}/quotes/${quoteId}/leaves/${result.data.leafId}/specs`,
        );
      } else {
        setToast(`Added "${created}" to the library · specs deferred.`);
        router.refresh();
      }
    });
  }

  // Both the toast AND the backdrop-modal render conditionally —
  // the toast persists across modal close (post-creation surface
  // confirmation per CD designer notes).
  return (
    <>
      {open ? (
        <div
          className={`a1v2-modal-backdrop${stacked ? " r-a1v2-modal-stacked" : ""}`}
          role="presentation"
          onMouseDown={(e) => {
            // Only dismiss on direct backdrop clicks; not clicks
            // that bubble from inside the modal.
            if (e.target === e.currentTarget && !pending) onClose();
          }}
        >
          <div
            ref={dialogRef}
            className="a1v2-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-product-title"
          >
            <div className="a1v2-modal-head">
              <h2 id="add-product-title">Create New Product</h2>
              {/* B-1 refinement — this creates LIBRARY MASTER DATA and nothing
                  else. It used to carry an ASY / LEAF toggle, which offered an
                  Item Group as a second kind of "product". An Item Group is
                  quote-local structure, not a product, and it now has its own
                  entry point on the setup surface. */}
              <span className="sub lib-scope">
                ↗ Creating a globally reusable library item · available across
                all scenarios
              </span>
            </div>

            <div className="a1v2-modal-body">
              <LeafFields
                name={leafName}
                onName={setLeafName}
                typeId={leafTypeId}
                onTypeId={setLeafTypeId}
                sku={leafSku}
                onSku={setLeafSku}
                unitCost={leafUnitCost}
                onUnitCost={setLeafUnitCost}
                url={leafUrl}
                onUrl={setLeafUrl}
                leafTypes={leafTypes}
                selectedType={selectedLeafType}
                hsTypeValue={hsTypeValue}
                onHsTypeValue={setHsTypeValue}
                commercialKind={commercialKind}
                onCommercialKind={setCommercialKind}
                serviceIdentity={serviceIdentity}
                onServiceIdentity={setServiceIdentity}
                hsTypeOptions={hsTypeOptions}
                hsTypeError={hsTypeError}
              />
              {error ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 12,
                    color: "var(--bad)",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                  }}
                >
                  {error}
                </div>
              ) : null}
            </div>

            <div className="a1v2-modal-foot">
              <span className="left">
                ⌥ Specs entered next step · or defer
              </span>
              <button
                type="button"
                className="a1v2-btn ghost"
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </button>
              {!leafTypeId ? (
                <button
                  type="button"
                  className="a1v2-btn primary"
                  disabled
                  aria-disabled="true"
                >
                  Pick a Product Type
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="a1v2-btn ghost sm"
                    onClick={() => handleSubmitLeaf("defer")}
                    disabled={pending}
                  >
                    {pending ? "Adding…" : "Add leaf · specs empty"}
                  </button>
                  <button
                    type="button"
                    className="a1v2-btn primary"
                    onClick={() => handleSubmitLeaf("continue")}
                    disabled={pending}
                  >
                    {pending ? "Adding…" : "Continue to specs →"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="a1v2-toast" role="status" aria-live="polite">
          <span className="glyph">✓</span>
          <div className="body">{toast}</div>
        </div>
      ) : null}
    </>
  );
}

function LeafFields(props: {
  name: string;
  onName: (v: string) => void;
  typeId: string;
  onTypeId: (v: string) => void;
  sku: string;
  onSku: (v: string) => void;
  unitCost: string;
  onUnitCost: (v: string) => void;
  url: string;
  onUrl: (v: string) => void;
  leafTypes: LeafSpecEntryProductType[];
  selectedType: LeafSpecEntryProductType | null;
  /** HubSpot's `hs_product_type` INTERNAL value — never a label. */
  hsTypeValue: string;
  onHsTypeValue: (v: string) => void;
  /** BV-012 §5 — what this entry may be sold as. */
  commercialKind: "product" | "service";
  onCommercialKind: (v: "product" | "service") => void;
  /** One of the five governed identities; required when kind is service. */
  serviceIdentity: string;
  onServiceIdentity: (v: string) => void;
  /** Governed option set, fetched from the HubSpot property definition. */
  hsTypeOptions: { label: string; value: string }[];
  hsTypeError: string | null;
}) {
  return (
    <>
      <div className="field">
        <span className="lbl req">Leaf name</span>
        <input
          type="text"
          aria-label="Leaf name"
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          placeholder="e.g., 30ml Glass Dropper Bottle · Type III soda-lime"
          autoFocus
        />
      </div>

      {/* What is being created — BV-012 §5.
          
          FIRST, because it governs what the rest of this form means: a service
          has no HubSpot classification and creates no HubSpot product, so the
          field below is not merely irrelevant for it, it is inapplicable.
          
          A choice, never an inference. §5.f forbids deriving service identity
          from HubSpot's type, from `product_types.scope`, from the legacy
          `Service / labor` type, from Production values, or from where the
          entry is later attached. */}
      <div className="field">
        <span className="lbl req">This entry is</span>
        <select
          aria-label="Commercial kind"
          value={props.commercialKind}
          onChange={(e) => {
            const next = e.target.value === "service" ? "service" : "product";
            props.onCommercialKind(next);
            // Clear the other branch's value rather than carrying it hidden —
            // a stale identity on a product would sit in state waiting to be
            // submitted if the operator switched back.
            if (next === "product") props.onServiceIdentity("");
          }}
        >
          <option value="product">A product — packaging or physical item</option>
          <option value="service">A service — sold on its own</option>
        </select>
        <span className="hint">
          {props.commercialKind === "service"
            ? "Services are sold as their own line. They are not added inside an item group — an item group owns its production costs directly."
            : "The usual case. Creates the matching HubSpot product."}
        </span>
      </div>

      {props.commercialKind === "service" && (
        <div className="field">
          <span className="lbl req">Which service</span>
          <select
            aria-label="Service identity"
            value={props.serviceIdentity}
            onChange={(e) => props.onServiceIdentity(e.target.value)}
          >
            <option value="">— Pick a service —</option>
            {DIRECT_SERVICE_IDENTITIES.map((id) => (
              <option key={id} value={id}>
                {DIRECT_SERVICE_LABELS[id]}
              </option>
            ))}
          </select>
          <span className="hint">
            Determines which production cost this service exposes later.
          </span>
        </div>
      )}

      {props.commercialKind === "product" && (
      <>
      {/* HubSpot classification — a SEPARATE field from the Nexus Product Type
          below, because they are separate vocabularies. This one travels to
          HubSpot with the product and is what the Library's type filter reads;
          the Nexus type drives spec fields and stays operator-authored.

          The option list is the governed HubSpot property definition. The
          operator reads `label`; `value` is what is submitted — they differ on
          Primary Packaging/Primary, Secondary Packaging/Secondary and
          Logistics/Third Party Logistics, so the two are never interchanged. */}
      <div className="field">
        <span className="lbl">HubSpot product type</span>
        <select
          aria-label="HubSpot product type"
          value={props.hsTypeValue}
          onChange={(e) => props.onHsTypeValue(e.target.value)}
          disabled={props.hsTypeOptions.length === 0}
        >
          <option value="">— unclassified —</option>
          {props.hsTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="hint">
          {props.hsTypeError
            ? `Could not load HubSpot product types: ${props.hsTypeError}`
            : "Sent to HubSpot with this product. Drives the Library type filter."}
        </span>
      </div>
      </>
      )}
      <div className="row-pair">
        <div className="field">
          <span className="lbl req">Leaf Product Type</span>
          <select
            aria-label="Leaf Product Type"
            value={props.typeId}
            onChange={(e) => props.onTypeId(e.target.value)}
          >
            <option value="">— Pick a type —</option>
            {props.leafTypes.map((t) => {
              const meta = t.placeholder
                ? "fields TBD"
                : `${t.fieldSchema?.fields.length ?? 0} fields`;
              return (
                <option key={t.id} value={t.id}>
                  {t.name} · {meta}
                </option>
              );
            })}
          </select>
        </div>
        <div className="field">
          <span className="lbl">SKU</span>
          <input
            type="text"
            aria-label="SKU"
            value={props.sku}
            onChange={(e) => props.onSku(e.target.value)}
            placeholder="Supplier SKU or internal ref"
          />
        </div>
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl">Unit cost</span>
          <input
            type="text"
            aria-label="Unit cost"
            inputMode="decimal"
            value={props.unitCost}
            onChange={(e) => props.onUnitCost(e.target.value)}
            placeholder="$0.00"
          />
        </div>
        <div className="field">
          <span className="lbl">URL · supplier reference</span>
          <input
            type="text"
            aria-label="URL · supplier reference"
            value={props.url}
            onChange={(e) => props.onUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>
      {props.selectedType ? (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.45,
          }}
        >
          <strong style={{ color: "var(--ink)" }}>Next step:</strong>{" "}
          {props.selectedType.placeholder ? (
            <>
              The{" "}
              <code style={{ fontFamily: "var(--mono)" }}>
                {props.selectedType.name}
              </code>{" "}
              field schema is pending Edward&apos;s input. Ship the leaf
              empty for now; populate when fields land.
            </>
          ) : (
            <>
              Continue to specs renders the{" "}
              <code style={{ fontFamily: "var(--mono)" }}>
                {props.selectedType.name}
              </code>{" "}
              field set (
              {props.selectedType.fieldSchema?.fields.length ?? 0} fields).
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
