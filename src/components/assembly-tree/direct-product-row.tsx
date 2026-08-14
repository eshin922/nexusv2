"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape dismiss, matching the member row's overflow so the
  // two behave identically now that they share the grammar.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setConfirming(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setConfirming(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // B-8 — the cross-quote usage cell is GONE from this surface. Under B-3
  // isolation it changes no quote-side decision: this quote owns its
  // specification, so where else the product is used cannot affect what the
  // operator does here. Reuse and history belong to the Library/master context.
  //
  // The loader still computes globalRefCount; it is left in place for that
  // Library context rather than torn out of the query on the way past.
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
        {/* No leading slot. The ◆ was inert — no children to expand, and no
            drag handle by design — and it existed only because the row had
            borrowed a register that HAS a leading slot. A meaningless glyph is
            not improved by replacing it with meaningless whitespace, so the
            column goes with it and identity reclaims the width. */}
        <span className="sku-pill">{product.sku ?? "—"}</span>
        <div className="name-cell">
          <div className="name">{product.name}</div>
          <div className="meta">
            <span>
              qty {qtyDisplay} · {costDisplay}
            </span>
            {/* B-10 · the untyped case is already carried by the
                NO TYPE SET readiness chip on this row. Saying it twice put the
                same fact in both of the row's coloured slots. Valid type
                metadata still renders. */}
          </div>
        </div>
        {/* B-10 · the generic "Product" label carried no operator value — the
            tree already says what this is. The slot now holds the QUOTE-OWNED
            Product Type in the same quiet register member rows use, so Direct
            and member products read as one register. Absent type stays absent:
            the Library's HubSpot classification is a different taxonomy and is
            not substituted here. */}
        <span
          className={`type-tag leaf-type${product.productType ? "" : " untyped"}`}
        >
          {product.productType?.label ?? "untyped"}
        </span>
        <CompletenessChip completeness={product.specCompleteness} />
        {/* One grid cell for every action, so the confirm state adding a
            second button cannot reflow the row into a new grid line. */}
        {/* B-10 · overflow, not inline. The DA's row grammar ends every row in
            a single `…`; the inline pair arrived with §9.1 and was never
            measured against it. Handlers and semantics are unchanged — only
            where the operator reaches them. */}
        <div className="direct-actions" ref={menuRef}>
          <button
            type="button"
            className="context-trigger"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${product.name} actions`}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="a1v2-context-menu" role="menu" aria-label="Product actions">
              <div className="header">Product actions</div>
              <a
                href={editSpecsHref}
                className="item accent"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                Edit product specs
              </a>
              {editable ? (
                <>
                  <div className="sep" />
                  <button
                    type="button"
                    className="item bad"
                    role="menuitem"
                    onClick={handleRemove}
                    disabled={pending}
                  >
                    {confirming ? "Confirm — remove from quote" : "Remove"}
                  </button>
                </>
              ) : null}
            </div>
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
