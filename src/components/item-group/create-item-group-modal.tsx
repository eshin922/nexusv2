"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAssembly } from "@/app/actions/assemblies";

// B-1 repair — Create Item Group is its own capability.
//
// WHY THIS IS NOT PART OF THE CREATE-NEW-PRODUCT MODAL. The two answer
// different operator questions and write to different places:
//
//   Create New Product  → library master data. A new record in the Nexus /
//                         HubSpot product library, reusable across scenarios.
//   Create Item Group   → quote-local structure. A container that exists only
//                         inside this quote and adds NOTHING to the library.
//
// They shared a modal with an ASY / LEAF toggle, which presented an Item Group
// as one of two kinds of "product". It is not a product. The toggle also made
// the grouped path reachable only by discovering it inside a product-creation
// screen, which is how B-1's dead end survived acceptance.
//
// The writer is unchanged: `createAssembly`, exactly as before. This moves the
// entry point and the vocabulary, not the semantics.

/** Step 7 · a category, not a product type. Item Groups never had one. */
type ItemGroupCategoryOption = { id: string; name: string };

export function CreateItemGroupModal({
  quoteId,
  open,
  onClose,
  itemGroupCategories,
  onSuccess,
}: {
  quoteId: string;
  open: boolean;
  onClose: () => void;
  itemGroupCategories: ItemGroupCategoryOption[];
  /** Fires only on a successful create, alongside `onClose`. */
  onSuccess?: (result: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [markupPct, setMarkupPct] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset on close so re-opening starts fresh.
  useEffect(() => {
    if (open) return;
    setName("");
    setCategoryId("");
    setSku("");
    setDescription("");
    setUnitPrice("");
    setUnitCost("");
    setMarkupPct("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, pending, onClose]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSubmit() {
    if (!name.trim()) {
      setError("Item group name is required.");
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("name", name.trim());
    if (categoryId) fd.set("itemGroupCategoryId", categoryId);
    if (sku) fd.set("sku", sku.trim());
    if (description) fd.set("description", description.trim());
    if (unitPrice) fd.set("unitPrice", unitPrice.trim());
    if (unitCost) fd.set("unitCost", unitCost.trim());
    if (markupPct) fd.set("markupPct", markupPct.trim());

    startTransition(async () => {
      setError(null);
      // The existing governed writer — not a second implementation.
      const result = await createAssembly(fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onSuccess?.({ id: result.data.assemblyId, name: name.trim() });
      onClose();
      setToast(`Created item group "${name.trim()}".`);
      router.refresh();
    });
  }

  return (
    <>
      {open ? (
        <div
          className="a1v2-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) onClose();
          }}
        >
          <div
            ref={dialogRef}
            className="a1v2-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-item-group-title"
          >
            <div className="a1v2-modal-head">
              <h2 id="create-item-group-title">Create Item Group</h2>
              {/* Says plainly what this does and does not do. The operator's
                  other creation action writes library master data; this one
                  does not, and the difference is not inferable from the form. */}
              <p className="sub">
                Groups several products that are sold together, inside this
                quote only. Nothing is added to the product library. Products
                are added to the group afterwards.
              </p>
            </div>

            <div className="a1v2-modal-body">
              <div className="field">
                <span className="lbl req">Item group name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Hydra-Glow Gift Set"
                  autoFocus
                />
              </div>
              <div className="row-pair">
                <div className="field">
                  <span className="lbl">Item group category</span>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">— Pick a category —</option>
                    {itemGroupCategories.map((t) => (
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
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="auto-generated if blank"
                  />
                </div>
              </div>
              <div className="field">
                <span className="lbl">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line descriptor for the quote"
                  style={{
                    minHeight: 50,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <div className="row-triple">
                <div className="field">
                  <span className="lbl">Unit price</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    placeholder="$0.00"
                  />
                </div>
                <div className="field">
                  <span className="lbl">Unit cost</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    placeholder="$0.00"
                  />
                </div>
                <div className="field">
                  <span className="lbl">Markup %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={markupPct}
                    onChange={(e) => setMarkupPct(e.target.value)}
                    placeholder="30"
                  />
                </div>
              </div>

              {error ? (
                <div
                  role="alert"
                  style={{
                    marginTop: 10,
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
                ⌥ Products are added to the group after it exists
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
                onClick={handleSubmit}
                disabled={pending}
              >
                {pending ? "Creating…" : "Create item group"}
              </button>
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
