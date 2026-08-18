"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { UnitTargets } from "@/lib/client-target";
import { ClientTargetCell, type TargetTier } from "./client-target";
import type { DirectProductNode } from "@/lib/assembly-tree";
import { CompletenessChip } from "./completeness-chip";
import { detachQuoteProduct } from "@/app/actions/quote-products";
import { DragGrip } from "./drag-grip";

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
  isMoving,
  onMoveStart,
  dropEdge,
  tiers,
  targets,
  pending: savingStructure,
  onRowDragOver,
  onRowDrop,
}: {
  product: DirectProductNode;
  editable: boolean;
  quoteId: string;
  editSpecsHref: string;
  /** Tier list for the Client Target drawer. */
  tiers: ReadonlyArray<TargetTier>;
  /** This unit's targets. A Direct Product IS a sellable unit, so it has some. */
  targets: UnitTargets | undefined;
  /** Drag in flight for THIS product. */
  isMoving?: boolean;
  /** Begin a structural move. Absent when the surface is read-only. */
  onMoveStart?: (e: React.DragEvent) => void;
  /** Insertion line edge, when this row is the one the product will land at. */
  dropEdge?: "before" | "after" | null;
  /** Structural move persisting. Visual only — no input is disabled (Pattern 47). */
  pending?: boolean;
  onRowDragOver?: (e: React.DragEvent) => void;
  onRowDrop?: (e: React.DragEvent) => void;
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
      <div
        className={`a1v2-asy-row a1v2-direct-row${isMoving ? " moving" : ""}${dropEdge ? ` drop-${dropEdge}` : ""}${savingStructure ? " structure-pending" : ""}`}
        onDragOver={onRowDragOver}
        onDrop={onRowDrop}
      >
        {/* B-12 · the leading slot returns, but only because there is now a
            real capability behind it. The ◆ that used to sit here was inert;
            this is the grip, and it is rendered only when a move is possible.
            The SLOT is unconditional even when the grip is not: dropping the
            cell on a read-only surface shifts every column left by one and the
            row stops sharing a register with the rows above it. */}
        {editable && onMoveStart ? (
          <DragGrip onDragStart={onMoveStart} />
        ) : (
          <span aria-hidden="true" />
        )}
        {/* B-12 REPAIR · ONE SKU cell.
            The row was rendering the SKU twice — an accent `.sku-pill` in the
            Item Group register AND the member-register `.leaf-sku` — which put
            seven children in a six-column grid. The surplus wrapped to an
            implicit second line, taking the overflow with it, and the pill's
            width opened the gap between SKU and name that made root and member
            identity blocks start at different x-coordinates.
            The member register wins: a Direct Product is a PRODUCT, and it
            should read like one. The accent pill belongs to Item Group rows. */}
        <span className="leaf-sku">{product.sku ?? "—"}</span>
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
        {/* §1 presentation closeout · the redundant UNTYPED state is gone.

            The row already carries this fact in its readiness chip — "⚠ No type
            set" — which is the slot that exists to say what a product still
            needs. Printing "untyped" in the type slot as well put one fact in two
            of the row's coloured places, and the two disagreed in register: a
            warning chip beside what looks like a stated value.

            B-10 removed the same duplication from the meta line and left this
            one, because at the time the type slot's absent-case had not been
            separated from its present-case. It has now: valid type metadata still
            renders exactly as before, and absence renders as absence.

            Absence is NOT em-dashed either. An em dash is a value meaning "none";
            the chip is already saying "not yet", and two answers to one question
            is what this removes. */}
        {product.productType ? (
          <span className="type-tag leaf-type">{product.productType.label}</span>
        ) : (
          <span aria-hidden="true" />
        )}
        {/* B-12 REPAIR · readiness and overflow share ONE trailing cell, which
            is what the member row already does. Held as two cells the Direct
            row declared six columns against the member row's five, so nothing
            after the name column could line up between the two row kinds.
            One grid cell for every action also means the confirm state adding a
            second button cannot reflow the row into a new grid line. */}
        {/* B-10 · overflow, not inline. The DA's row grammar ends every row in
            a single `…`; the inline pair arrived with §9.1 and was never
            measured against it. Handlers and semantics are unchanged — only
            where the operator reaches them. */}
        {/* A Direct Product IS the sellable unit — the leaf itself is what
            the customer buys — so it carries a client target directly. */}
        <ClientTargetCell
          unitKind="leaf"
          unitId={product.quoteLeafId}
          unitLabel={product.name}
          targets={targets}
          tiers={tiers}
          editable={editable}
        />
        <div className="direct-actions" ref={menuRef}>
          <CompletenessChip completeness={product.specCompleteness} />
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
            <div className="a1v2-context-menu" role="menu" aria-label="Line actions">
              {/* "Line actions", not "Product actions": this row component
                  renders every TOP-LEVEL row, and since Stage 2 that includes
                  Direct Services. Both are quote lines, so the noun is true of
                  both without branching. Item-group MEMBERS keep "Leaf
                  actions" — different component, and a member is not a line. */}
              <div className="header">Line actions</div>
              <a
                href={editSpecsHref}
                className="item accent"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                {/* "library", not "product", and NOT bare "Edit specs".
                    Two requirements meet here and both must hold. The label has
                    to name the AUTHORITY it edits — bare "Edit specs", read
                    from inside a quote, invites the operator to believe it is
                    quote-local, and it is not; specs are library master data.
                    It also has to be true of a Direct Service, which is not a
                    product. "product" satisfied the first requirement only
                    incidentally, by being the only kind of thing this row could
                    hold. "library" satisfies it directly, and is neutral. */}
                Edit library specs
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
