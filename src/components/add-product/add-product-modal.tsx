"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { createAssembly } from "@/app/actions/assemblies";
import { createLeaf } from "@/app/actions/leaves";

// Phase A.1 v2 impl-4 — Add Product modal (scenarios ⑪-⑯).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// AddProductModal (lines 445-508) + AsyModalFields (510-567) +
// LeafModalFields (569-627).
//
// Behavior shape:
//   - mode toggle (ASY / LEAF segmented control)
//   - ASY mode: commercial fields (name + type + sku + description +
//     unit price + unit cost + markup% + owner). Tax schedule field
//     DROPPED per Pattern 22 §0.5 finding (no tax_schedules table).
//   - LEAF mode: identity fields (name + type + sku + cost + owner +
//     url) + "Next step" preview card + Continue/Defer submit choice
//   - Submit ASY → createAssembly → close
//   - Submit LEAF Continue → createLeaf → navigate to
//     /projects/.../leaves/<newLeafId>/specs (Q-Type6 disposition)
//   - Submit LEAF Defer → createLeaf → close + post-creation toast
//
// Pattern 47 invariants on form inputs: controlled values, no
// `disabled={pending}` on inputs (button-level pending only).

type Mode = "asy" | "leaf";

type AssemblyTypeOption = { id: string; name: string };

export function AddProductModal({
  quoteId,
  projectId,
  open,
  onClose,
  onSuccess,
  assemblyTypes,
  leafTypes,
}: {
  quoteId: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
  // slice-library-first-creation-flow Step 3 — optional success
  // callback for stacked-modal consumers (LibraryBrowseModal's
  // "+ Create new product" path). Fires alongside `onClose` only
  // on successful create. Absent → preserves prior behavior
  // (existing AddProductTrigger mount doesn't need to discriminate
  // submit vs cancel).
  onSuccess?: (result: { kind: "asy" | "leaf"; id: string }) => void;
  assemblyTypes: AssemblyTypeOption[];
  leafTypes: LeafSpecEntryProductType[];
}) {
  const [mode, setMode] = useState<Mode>("asy");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();

  // ASY form state
  const [asyName, setAsyName] = useState("");
  const [asyTypeId, setAsyTypeId] = useState<string>("");
  const [asySku, setAsySku] = useState("");
  const [asyDescription, setAsyDescription] = useState("");
  const [asyUnitPrice, setAsyUnitPrice] = useState("");
  const [asyUnitCost, setAsyUnitCost] = useState("");
  const [asyMarkupPct, setAsyMarkupPct] = useState("");

  // LEAF form state
  const [leafName, setLeafName] = useState("");
  const [leafTypeId, setLeafTypeId] = useState<string>("");
  const [leafSku, setLeafSku] = useState("");
  const [leafUnitCost, setLeafUnitCost] = useState("");
  const [leafUrl, setLeafUrl] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset all form state on close so re-opening starts fresh.
  // Toast is preserved across modal close (auto-dismisses on its
  // own ~3s timer in the parent).
  useEffect(() => {
    if (open) return;
    setMode("asy");
    setAsyName("");
    setAsyTypeId("");
    setAsySku("");
    setAsyDescription("");
    setAsyUnitPrice("");
    setAsyUnitCost("");
    setAsyMarkupPct("");
    setLeafName("");
    setLeafTypeId("");
    setLeafSku("");
    setLeafUnitCost("");
    setLeafUrl("");
    setError(null);
  }, [open]);

  // Escape dismiss + backdrop click.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, pending, onClose]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedLeafType = leafTypes.find((t) => t.id === leafTypeId) ?? null;

  function handleSubmitAsy() {
    if (!asyName.trim()) {
      setError("Product name is required.");
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("name", asyName.trim());
    if (asyTypeId) fd.set("productTypeId", asyTypeId);
    if (asySku) fd.set("sku", asySku.trim());
    if (asyDescription) fd.set("description", asyDescription.trim());
    if (asyUnitPrice) fd.set("unitPrice", asyUnitPrice.trim());
    if (asyUnitCost) fd.set("unitCost", asyUnitCost.trim());
    if (asyMarkupPct) fd.set("markupPct", asyMarkupPct.trim());

    startTransition(async () => {
      setError(null);
      const result = await createAssembly(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onSuccess?.({ kind: "asy", id: result.data.assemblyId });
      onClose();
      setToast(`Added "${asyName.trim()}" to this quote.`);
      router.refresh();
    });
  }

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
    fd.set("productTypeId", leafTypeId);
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
      onSuccess?.({ kind: "leaf", id: result.data.leafId });
      onClose();
      if (option === "continue") {
        router.push(
          `/projects/${projectId}/quotes/${quoteId}/leaves/${result.data.leafId}/specs`,
        );
      } else {
        setToast(
          `Added "${leafName.trim()}" to the library · specs deferred.`,
        );
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
          className="a1v2-modal-backdrop"
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
              <h2 id="add-product-title">
                {mode === "asy" ? "Add product · ASY" : "Add product · LEAF"}
              </h2>
              {mode === "leaf" ? (
                <span className="sub lib-scope">
                  ↗ Creating a globally reusable library item · available
                  across all scenarios
                </span>
              ) : (
                <p className="sub">
                  Creates a new product/SKU in this scenario. Leaves get
                  attached separately.
                </p>
              )}
              <div className="a1v2-mode-toggle">
                <button
                  type="button"
                  className={mode === "asy" ? "active" : ""}
                  onClick={() => setMode("asy")}
                  disabled={pending}
                >
                  <span className="lab">ASY</span>
                  <span className="desc">Quotable product · commercial fields</span>
                </button>
                <button
                  type="button"
                  className={mode === "leaf" ? "active" : ""}
                  onClick={() => setMode("leaf")}
                  disabled={pending}
                >
                  <span className="lab">LEAF</span>
                  <span className="desc">Reusable component · type + specs</span>
                </button>
              </div>
            </div>

            <div className="a1v2-modal-body">
              {mode === "asy" ? (
                <AsyFields
                  name={asyName}
                  onName={setAsyName}
                  typeId={asyTypeId}
                  onTypeId={setAsyTypeId}
                  sku={asySku}
                  onSku={setAsySku}
                  description={asyDescription}
                  onDescription={setAsyDescription}
                  unitPrice={asyUnitPrice}
                  onUnitPrice={setAsyUnitPrice}
                  unitCost={asyUnitCost}
                  onUnitCost={setAsyUnitCost}
                  markupPct={asyMarkupPct}
                  onMarkupPct={setAsyMarkupPct}
                  assemblyTypes={assemblyTypes}
                />
              ) : (
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
                />
              )}
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
                {mode === "leaf"
                  ? "⌥ Specs entered next step · or defer"
                  : "⌥ Leaves added separately via the tree"}
              </span>
              <button
                type="button"
                className="a1v2-btn ghost"
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </button>
              {mode === "asy" ? (
                <button
                  type="button"
                  className="a1v2-btn primary"
                  onClick={handleSubmitAsy}
                  disabled={pending}
                >
                  {pending ? "Adding…" : "Add product"}
                </button>
              ) : !leafTypeId ? (
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

function AsyFields(props: {
  name: string;
  onName: (v: string) => void;
  typeId: string;
  onTypeId: (v: string) => void;
  sku: string;
  onSku: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  unitPrice: string;
  onUnitPrice: (v: string) => void;
  unitCost: string;
  onUnitCost: (v: string) => void;
  markupPct: string;
  onMarkupPct: (v: string) => void;
  assemblyTypes: AssemblyTypeOption[];
}) {
  return (
    <>
      <div className="field">
        <span className="lbl req">Product name</span>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          placeholder="e.g., Hydra-Glow Vitamin C Serum 30ml"
          autoFocus
        />
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl">ASY Product Type</span>
          <select
            value={props.typeId}
            onChange={(e) => props.onTypeId(e.target.value)}
          >
            <option value="">— Pick a type —</option>
            {props.assemblyTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lbl">SKU</span>
          <input
            type="text"
            value={props.sku}
            onChange={(e) => props.onSku(e.target.value)}
            placeholder="auto-generated if blank"
          />
        </div>
      </div>
      <div className="field">
        <span className="lbl">Description</span>
        <textarea
          value={props.description}
          onChange={(e) => props.onDescription(e.target.value)}
          placeholder="One-line product descriptor for the quote"
          style={{ minHeight: 50, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
      <div className="row-triple">
        <div className="field">
          <span className="lbl">Unit price</span>
          <input
            type="text"
            inputMode="decimal"
            value={props.unitPrice}
            onChange={(e) => props.onUnitPrice(e.target.value)}
            placeholder="$0.00"
          />
        </div>
        <div className="field">
          <span className="lbl">Unit cost</span>
          <input
            type="text"
            inputMode="decimal"
            value={props.unitCost}
            onChange={(e) => props.onUnitCost(e.target.value)}
            placeholder="$0.00"
          />
        </div>
        <div className="field">
          <span className="lbl">Markup %</span>
          <input
            type="text"
            inputMode="decimal"
            value={props.markupPct}
            onChange={(e) => props.onMarkupPct(e.target.value)}
            placeholder="30"
          />
        </div>
      </div>
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
}) {
  return (
    <>
      <div className="field">
        <span className="lbl req">Leaf name</span>
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          placeholder="e.g., 30ml Glass Dropper Bottle · Type III soda-lime"
          autoFocus
        />
      </div>
      <div className="row-pair">
        <div className="field">
          <span className="lbl req">Leaf Product Type</span>
          <select
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
