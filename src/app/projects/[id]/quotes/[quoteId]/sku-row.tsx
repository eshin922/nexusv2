"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  assignSkuToParent,
  convertSkuRole,
  deleteSku,
  moveSku,
  refreshSkuFromHubspot,
  unassignSkuFromParent,
  updateQtyPerParent,
  updateSku,
} from "@/app/actions/quotes";
import { eligibleRoleTargets } from "@/lib/sku-tree";

type Sku = {
  id: string;
  hubspotProductId: string | null;
  skuLabel: string;
  productName: string;
  unitsPerPack: number;
  retailBenchmark: string | null;
  notes: string | null;
  lastHubspotRefreshAt: Date | null;
  skuRole: "leaf" | "assembly";
  parentSkuId: string | null;
  qtyPerParent: string | null;
};

type EligibleParent = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
};

const DEBOUNCE_MS = 500;

// §6.b Step 2 — R7b Type badge canon (brief §3.1 + designer notes
// Decision 1). Glyph + label, click toggles sku_role. Assemblies
// render `▤ ASY` accent-tinted; leaves render `○ LEAF` paper-3
// tinted. Always visible at row scale — not buried in a drawer
// or behind a hover affordance. Preserve-hidden semantics for
// assembly → leaf toggle (with children) handled by the action
// layer (convertSkuRole + sku-tree validation).
const ROLE_GLYPH: Record<Sku["skuRole"], string> = {
  leaf: "○",
  assembly: "▤",
};

const ROLE_SHORT_LABEL: Record<Sku["skuRole"], string> = {
  leaf: "LEAF",
  assembly: "ASY",
};

type ChildRow = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
  qtyPerParent: string | null;
  childCount: number;
};

export function SkuRow({
  sku,
  depth,
  hasChildren,
  childCount,
  childSkus = [],
  eligibleParents,
  hubspotPortalId,
  disabled = false,
  isDrawerOpen = false,
  onDrawerToggle,
  projectId,
  quoteId,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  sku: Sku;
  depth: number;
  hasChildren: boolean;
  /** §6.b Step 1 — children count for the Components column. */
  childCount: number;
  /** §6.b Step 4 — direct children for the assembly drawer's
   * child-SKU navigation list. Empty / unused for leaf rows. */
  childSkus?: ChildRow[];
  eligibleParents: EligibleParent[];
  hubspotPortalId: string | null;
  disabled?: boolean;
  /** §6.b Step 3 — drawer expansion state (one-at-a-time via SkuRowList). */
  isDrawerOpen?: boolean;
  onDrawerToggle?: () => void;
  /** §6.b Step 4 — needed for the drawer's "↗ Cost build" link
   * per child SKU. */
  projectId?: string;
  quoteId?: string;
  /** §6.b Step 9 — HTML5 drag-and-drop wiring driven by SkuRowList.
   * `isDragging` flags the row that's currently being dragged so the
   * source row dims via inline opacity; drop handler lives on the
   * list container (single onDragEnd). */
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  // §6.b Step 1 — units_per_pack and notes inputs removed from row.
  // Notes returns in Step 4 (per-SKU drawer textarea).
  // Phase 1.4 (OQ3 disposition) — units_per_pack inline-edit affordance
  // restored as a Pattern 29 read↔edit cell inside the .pack sub-text
  // of the product cell. Dropped from the Add-product modal; lives
  // here as a line-item attribute (how the product is sold in THIS
  // quote, not catalog metadata).
  const [retailBenchmark, setRetailBenchmark] = useState(sku.retailBenchmark ?? "");
  const [unitsPerPack, setUnitsPerPack] = useState(String(sku.unitsPerPack));

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  // Slice RI.8 — overflow menu state for action cluster compression
  // (Designer audit Q2 approved). Houses the four conditional
  // affordances (assembly reassign / detach / HubSpot refresh /
  // HubSpot product link) behind a `⋯` button. Click + ESC +
  // outside-click closes. Full keyboard arrow nav is polish,
  // deferred per Designer's drop-and-defer fallback.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ retailBenchmark, unitsPerPack });
  stateRef.current = { retailBenchmark, unitsPerPack };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Slice RI.8 — overflow menu close-on-outside-click + ESC.
  useEffect(() => {
    if (!overflowOpen) return;
    function onClick(e: MouseEvent) {
      if (
        overflowRef.current &&
        !overflowRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  type Overrides = Partial<{
    retailBenchmark: string;
    unitsPerPack: string;
  }>;

  // §6.b Step 1 — updateSku takes the full input shape; pre-existing
  // notes pass through unchanged (read from props.sku snapshot) so
  // the action layer doesn't null them out on a partial save.
  // Phase 1.4 — unitsPerPack now comes from local state (was
  // sku.unitsPerPack snapshot; switched so the inline-edit cell
  // can persist its own draft value).
  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("unitsPerPack", s.unitsPerPack);
    fd.set("retailBenchmark", s.retailBenchmark);
    fd.set("notes", sku.notes ?? "");
    startTransition(async () => {
      const result = await updateSku(fd);
      if (!result.ok) setSaveError(result.error.message);
      else setSaveError(null);
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  function handleDelete() {
    const msg =
      sku.skuRole !== "leaf"
        ? `Remove "${sku.productName}" from this quote? This will CASCADE-DELETE its full subtree (children, grandchildren, and all their packaging cells). Cannot be undone.`
        : `Remove "${sku.productName}" from this quote?`;
    if (!confirm(msg)) return;
    const fd = new FormData();
    fd.set("skuId", sku.id);
    startTransition(async () => {
      const r = await deleteSku(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleMove(direction: "up" | "down") {
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("direction", direction);
    startTransition(async () => {
      const r = await moveSku(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleRefresh() {
    const fd = new FormData();
    fd.set("skuId", sku.id);
    startTransition(async () => {
      const r = await refreshSkuFromHubspot(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleConvertRole(newRole: Sku["skuRole"]) {
    if (newRole === sku.skuRole) return;
    setSaveError(null);
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("newRole", newRole);
    startTransition(async () => {
      const r = await convertSkuRole(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleDetach() {
    if (!confirm("Detach from parent? The SKU becomes top-level.")) return;
    setSaveError(null);
    const fd = new FormData();
    fd.set("skuId", sku.id);
    startTransition(async () => {
      const r = await unassignSkuFromParent(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleReassignSubmit(parentId: string, qty: string) {
    setSaveError(null);
    if (!parentId) {
      setSaveError("Pick a parent.");
      return;
    }
    if (!qty || Number(qty) <= 0) {
      setSaveError("Qty per parent must be greater than 0.");
      return;
    }
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("parentSkuId", parentId);
    fd.set("qtyPerParent", qty);
    startTransition(async () => {
      const r = await assignSkuToParent(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setReassignOpen(false);
    });
  }

  const productUrl =
    hubspotPortalId && sku.hubspotProductId
      ? `https://app.hubspot.com/contacts/${hubspotPortalId}/objects/0-7/views/all/list?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${sku.hubspotProductId}%22%5D`
      : null;

  // Tree-line indicator: "└─ " for non-root rows
  const indentPx = depth * 16;
  const treeLine = depth > 0 ? "└─ " : "";

  // Both leaves and assemblies can have parents (assembly nesting supported).
  const canBeChild = true;

  const hasNote = (sku.notes ?? "").trim() !== "";
  const isAssembly = sku.skuRole === "assembly";

  // §6.b path-B migration commit 3 — row migrates to canonical
  // .r7b-sku-row structure (7bsetup.jsx SkuTable inner rows
  // lines 145-179 + 7bstyles.css .r7b-sku-row rules at line 116).
  // 7 columns: grip · type · name · category · retail · components ·
  // actions. Variant modifiers `assembly` / `leaf` + state `open`.
  // Assembly left-border accent now comes from canonical
  // .r7b-sku-row.assembly rule (not inline style).
  return (
    <>
      <div
        className={`r7b-sku-row ${sku.skuRole}${isDrawerOpen ? " open" : ""}`}
        draggable={!disabled && !!onDragStart}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        style={
          isDragging
            ? { opacity: 0.4, cursor: "grabbing" }
            : undefined
        }
      >
        {/* §6.b Step 9 — drag handle. The whole row is draggable
            (HTML5 native), but the grip column anchors the visual
            affordance via canonical `.r7b-sku-row .grip { cursor:
            grab }` rule. */}
        <span className="grip" title="Drag to reorder">
          ⠿
        </span>

        {/* Type — canonical .r7b-type badge with .glyph child + label.
            Wraps button-semantics for click-to-toggle; CSS expects
            <span> but button is functionally equivalent and adds a11y. */}
        {(() => {
          const targetRole: Sku["skuRole"] =
            sku.skuRole === "leaf" ? "assembly" : "leaf";
          const canToggle = eligibleRoleTargets(
            sku.skuRole,
            sku.parentSkuId !== null,
            hasChildren,
          ).includes(targetRole);
          const isAsy = sku.skuRole === "assembly";
          return (
            <button
              type="button"
              onClick={() => handleConvertRole(targetRole)}
              disabled={disabled || pending || !canToggle}
              aria-pressed={isAsy}
              aria-label={`Type: ${ROLE_SHORT_LABEL[sku.skuRole]}. ${
                canToggle
                  ? `Click to convert to ${ROLE_SHORT_LABEL[targetRole]}.`
                  : `Cannot convert — has children. Detach children first.`
              }`}
              title={
                canToggle
                  ? `Click to convert to ${ROLE_SHORT_LABEL[targetRole]}`
                  : "Cannot convert to leaf — assembly has children. Detach via ⋯ menu first."
              }
              className={`r7b-type ${sku.skuRole}`}
            >
              <span className="glyph">{ROLE_GLYPH[sku.skuRole]}</span>
              {ROLE_SHORT_LABEL[sku.skuRole]}
            </button>
          );
        })()}

        {/* Product — canonical .name structure: .label-pack > .lbl +
            .product, then separate .pack span. Tree indentation
            preserved as paddingLeft on the wrapper. HAS NOTE chip
            renders inside .pack as canonical .indicator.has-note. */}
        <div className="name" style={{ paddingLeft: `${indentPx}px` }}>
          <div className="label-pack">
            {treeLine && (
              <span className="lbl" style={{ color: "var(--ink-4)" }}>
                {treeLine}
              </span>
            )}
            <span className="lbl">{sku.skuLabel}</span>
            <span className="product">{sku.productName}</span>
          </div>
          <span className="pack">
            {/* Pack sub-text deferred to Slice 11 (Pattern 22 #6).
                When quote_skus.pack lands, the value renders here
                ahead of the units-per-pack chip + HAS NOTE indicator. */}
            <UnitsPerPackCell
              value={unitsPerPack}
              disabled={disabled}
              onChange={(v) => {
                setUnitsPerPack(v);
                scheduleSave({ unitsPerPack: v });
              }}
            />
            {hasNote &&
              (onDrawerToggle ? (
                <span
                  className="indicator has-note"
                  onClick={onDrawerToggle}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDrawerToggle();
                    }
                  }}
                  title={`${sku.notes ?? ""} (click to open notes)`}
                  style={{ cursor: "pointer" }}
                >
                  has note
                </span>
              ) : (
                <span
                  className="indicator has-note"
                  title={sku.notes ?? undefined}
                >
                  has note
                </span>
              ))}
          </span>
          {sku.parentSkuId && (
            <QtyPerParentInline
              skuId={sku.id}
              currentQty={sku.qtyPerParent}
              disabled={disabled}
            />
          )}
        </div>

        {/* Category — Slice 9 deferral (Pattern 22 #5). Em-dash
            placeholder preserves canonical 7-column grid until
            quote_skus.cost_category integration lands. */}
        <span className="category" aria-hidden>
          —
        </span>

        {/* Retail bench — Pattern 29 read↔edit cell wrapped in
            canonical .retail span. Read mode renders $X.XX +
            <span className="sub">retail</span> per canonical.
            Edit mode swaps in an input but preserves the .retail
            wrapper for grid alignment. */}
        <RetailBenchCell
          value={retailBenchmark}
          disabled={disabled}
          onChange={(v) => {
            setRetailBenchmark(v);
            scheduleSave({ retailBenchmark: v });
          }}
        />

        {/* Components — canonical .components class with .empty
            modifier on leaf rows. Click-to-open-drawer on assemblies
            only; canonical CSS handles cursor + hover color. */}
        <span
          className={`components${isAssembly ? "" : " empty"}`}
          onClick={isAssembly && onDrawerToggle ? onDrawerToggle : undefined}
          role={isAssembly && onDrawerToggle ? "button" : undefined}
          tabIndex={isAssembly && onDrawerToggle ? 0 : undefined}
          onKeyDown={
            isAssembly && onDrawerToggle
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDrawerToggle();
                  }
                }
              : undefined
          }
          aria-expanded={isAssembly ? isDrawerOpen : undefined}
          title={
            isAssembly
              ? isDrawerOpen
                ? "Close component drawer"
                : "Open component drawer"
              : undefined
          }
        >
          {isAssembly
            ? `${childCount} comp${childCount === 1 ? "" : "s"} ${isDrawerOpen ? "▾" : "▸"}`
            : "—"}
        </span>

        {/* Actions — canonical .actions cluster. R7b prototype shows
            single ⋯ button; nexus expands with overflow menu carrying
            critical affordances (reassign / detach / refresh / HubSpot
            link / move / delete) that don't have row-level homes yet.
            Keeps the canonical .actions class wrapper so the cell
            grid alignment matches; menu functionality is nexus-specific. */}
        <div className="actions">
          {saveError ? (
            <span
              className="text-xs"
              style={{ color: "var(--bad)", marginRight: 4 }}
              role="alert"
            >
              {saveError}
            </span>
          ) : pending ? (
            <span
              className="text-xs"
              style={{ color: "var(--ink-4)", marginRight: 4 }}
            >
              saving…
            </span>
          ) : null}

          <div className="relative" ref={overflowRef}>
              <button
                type="button"
                onClick={() => setOverflowOpen((v) => !v)}
                disabled={disabled}
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                title="More actions"
              >
                ⋯
              </button>
              {overflowOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded border border-rule bg-paper py-1 shadow-md"
                >
                  {/* §6.b polish-amendment (sweep #10) — Open/Add
                      notes entry restores R7b's ⋯-as-drawer-trigger
                      fidelity for leaf rows. Assembly rows have the
                      Components ▸ cell as primary drawer trigger so
                      this entry is leaf-only. Label flips on
                      hasNote: "Open notes" if note exists,
                      "Add notes" if empty. */}
                  {!isAssembly && onDrawerToggle && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onDrawerToggle();
                        setOverflowOpen(false);
                      }}
                      disabled={disabled}
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-30"
                    >
                      <span className="mr-2 font-mono text-ink-3">📝</span>
                      {hasNote ? "Open notes" : "Add notes"}
                    </button>
                  )}
                  {/* §6.b Step 1 — ↑↓ relocated into overflow until
                      Step 9 wires drag-drop on the Grip column. */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleMove("up");
                      setOverflowOpen(false);
                    }}
                    disabled={disabled}
                    className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-30"
                  >
                    <span className="mr-2 font-mono text-ink-3">↑</span>
                    Move up
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleMove("down");
                      setOverflowOpen(false);
                    }}
                    disabled={disabled}
                    className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-30"
                  >
                    <span className="mr-2 font-mono text-ink-3">↓</span>
                    Move down
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleDelete();
                      setOverflowOpen(false);
                    }}
                    disabled={disabled}
                    title={sku.skuRole !== "leaf" ? "Delete (cascade)" : "Remove SKU"}
                    className="block w-full px-3 py-1.5 text-left text-xs text-bad hover:bg-bad-soft disabled:opacity-30"
                  >
                    <span className="mr-2 font-mono">×</span>
                    {sku.skuRole !== "leaf" ? "Delete (cascade)" : "Remove SKU"}
                  </button>
                  {canBeChild && eligibleParents.length > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setReassignOpen(true);
                        setOverflowOpen(false);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2"
                    >
                      <span className="mr-2 font-mono text-ink-3">
                        {sku.parentSkuId ? "↔" : "↳"}
                      </span>
                      {sku.parentSkuId ? "Reassign parent" : "Assign to parent"}
                    </button>
                  )}
                  {sku.parentSkuId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleDetach();
                        setOverflowOpen(false);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2"
                    >
                      <span className="mr-2 font-mono text-ink-3">⤴</span>
                      Detach from parent
                    </button>
                  )}
                  {sku.hubspotProductId && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        handleRefresh();
                        setOverflowOpen(false);
                      }}
                      title={
                        sku.lastHubspotRefreshAt
                          ? `Last synced ${formatRelative(sku.lastHubspotRefreshAt)}`
                          : undefined
                      }
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2"
                    >
                      <span className="mr-2 font-mono text-ink-3">↻</span>
                      Refresh from HubSpot
                    </button>
                  )}
                  {productUrl && (
                    <a
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={() => setOverflowOpen(false)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2"
                    >
                      <span className="mr-2 font-mono text-ink-3">↗</span>
                      Open in HubSpot
                    </a>
                  )}
                </div>
              )}
            </div>
        </div>
      </div>

      {/* §6.b path-B migration commit 3 — drawer body migrated to
          canonical .r7b-sku-drawer (7bsetup.jsx SkuDrawer lines
          197-246). Mismatch 1 carve disposition (γ) preserved:
          assembly drawer renders a CHILD-SKU NAVIGATION LIST
          (not the canonical inline-editable component table)
          because per-component cost data lives on packaging_inputs
          per §6.c carve. Notes textarea structure matches canonical
          .r7b-sku-notes (label + textarea). */}
      {isDrawerOpen && (
        <div
          className="r7b-sku-drawer"
          role="region"
          aria-label={`Details for ${sku.skuLabel}`}
        >
          {isAssembly && projectId && quoteId && (
            <DrawerChildList
              parentSkuId={sku.id}
              projectId={projectId}
              quoteId={quoteId}
              quoteIdForAdd={quoteId}
              childSkus={childSkus}
              disabled={disabled}
            />
          )}
          {!isAssembly && (
            <div
              className="drawer-title"
              style={{
                marginBottom: 12,
                fontSize: 11,
                color: "var(--ink-3)",
                textTransform: "none",
                letterSpacing: 0,
                fontFamily: "var(--ui)",
                fontStyle: "italic",
              }}
            >
              Leaf SKU — single-line. Cost goes on Cost build; this
              drawer is for notes and metadata.
            </div>
          )}
          <DrawerNotes
            currentNote={sku.notes ?? ""}
            onSave={(value) => {
              const fd = new FormData();
              fd.set("skuId", sku.id);
              fd.set("unitsPerPack", String(sku.unitsPerPack));
              fd.set("retailBenchmark", stateRef.current.retailBenchmark);
              fd.set("notes", value);
              startTransition(async () => {
                const r = await updateSku(fd);
                if (!r.ok) setSaveError(r.error.message);
                else setSaveError(null);
              });
            }}
            disabled={disabled}
            pending={pending}
          />
        </div>
      )}

      {/* Reassign panel — expands below the row when triggered */}
      {reassignOpen && !disabled && (
        <ReassignPanel
          eligibleParents={eligibleParents}
          currentParentId={sku.parentSkuId}
          currentQty={sku.qtyPerParent}
          onCancel={() => setReassignOpen(false)}
          onSubmit={handleReassignSubmit}
        />
      )}
    </>
  );
}

function ReassignPanel({
  eligibleParents,
  currentParentId,
  currentQty,
  onCancel,
  onSubmit,
}: {
  eligibleParents: EligibleParent[];
  currentParentId: string | null;
  currentQty: string | null;
  onCancel: () => void;
  onSubmit: (parentId: string, qty: string) => void;
}) {
  const [parentId, setParentId] = useState(currentParentId ?? "");
  const [qty, setQty] = useState(currentQty ?? "");

  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-l-2 border-gray-300 bg-gray-50 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Parent:</span>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">— select parent —</option>
          {eligibleParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.skuLabel} — {p.productName} ({p.skuRole})
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-600">Qty:</span>
        <input
          type="number"
          step="0.0001"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="qty per parent"
          className="w-32 rounded border border-gray-300 bg-white px-2 py-1 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => onSubmit(parentId, qty)}
        className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-white"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Inline editable qty_per_parent field. Shows current qty as a small
 * number input that commits on blur. Audit-logged via updateQtyPerParent.
 */
function QtyPerParentInline({
  skuId,
  currentQty,
  disabled,
}: {
  skuId: string;
  currentQty: string | null;
  disabled: boolean;
}) {
  const [value, setValue] = useState(currentQty ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = useRef(currentQty ?? "");

  function fire() {
    const trimmed = value.trim();
    if (trimmed === initial.current) return;
    if (!trimmed || Number(trimmed) <= 0) {
      setError("must be > 0");
      setValue(initial.current);
      return;
    }
    setError(null);
    initial.current = trimmed;
    const fd = new FormData();
    fd.set("skuId", skuId);
    fd.set("qty", trimmed);
    startTransition(async () => {
      const r = await updateQtyPerParent(fd);
      if (!r.ok) {
        setError(r.error.message);
        setValue(initial.current);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
      <span>×</span>
      <input
        type="number"
        step="0.0001"
        min={0}
        value={value}
        disabled={disabled || pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={fire}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        className="w-12 rounded border border-gray-200 bg-white px-1 py-0 text-[11px] focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        title="qty per parent"
      />
      <span>per parent</span>
      {pending && <span className="text-gray-400">…</span>}
      {error && (
        <span className="text-red-700" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

// §6.b Step 4 — drawer subcomponents.
//
// DrawerChildList renders inside an assembly's drawer per Mismatch 1
// carved disposition (γ): child-SKU navigation list, NOT inline
// component editor. Each child row links to that leaf's Cost build
// packaging drilldown (per-component cost data lives there until
// §6.c unifies).
//
// DrawerNotes wraps the per-SKU notes textarea (Pushback 2 disposition
// + brief §3.2 zone 2). Autosave on blur; Cmd/Ctrl+Enter explicit
// commit. Always rendered (assembly + leaf).

import { AddAssemblyButton } from "./add-assembly-button";

function DrawerChildList({
  parentSkuId,
  projectId,
  quoteId,
  quoteIdForAdd,
  childSkus,
  disabled,
}: {
  parentSkuId: string;
  projectId: string;
  quoteId: string;
  quoteIdForAdd: string;
  childSkus: ChildRow[];
  disabled: boolean;
}) {
  const _parentSkuId = parentSkuId; // for forcedParentId pass-through below
  return (
    <div className="r6b-drawer-section">
      <div className="r6b-drawer-section-head">
        <p className="r2-eyebrow" style={{ margin: 0 }}>
          Components ({childSkus.length})
        </p>
      </div>
      {childSkus.length === 0 ? (
        <p
          style={{
            margin: "8px 0",
            fontSize: 13,
            color: "var(--ink-3)",
            fontStyle: "italic",
          }}
        >
          No child SKUs yet. Add one below or assign existing SKUs to this
          assembly via the row&rsquo;s ⋯ menu.
        </p>
      ) : (
        <table className="r6b-drawer-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Product</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Qty/parent</th>
              <th style={{ textAlign: "right" }}>Open</th>
            </tr>
          </thead>
          <tbody>
            {childSkus.map((c) => {
              const isLeaf = c.skuRole === "leaf";
              const costsHref = `/projects/${projectId}/quotes/${quoteId}/costs?focus=${c.id}`;
              return (
                <tr key={c.id}>
                  <td className="r6b-drawer-label">{c.skuLabel}</td>
                  <td className="r6b-drawer-product">{c.productName}</td>
                  <td>
                    <span
                      className={`r7b-type ${c.skuRole}`}
                      style={{ pointerEvents: "none" }}
                    >
                      <span className="glyph" aria-hidden>
                        {c.skuRole === "assembly" ? "▤" : "○"}
                      </span>
                      {c.skuRole === "assembly" ? "ASY" : "LEAF"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--ink-3)" }}>
                    {c.qtyPerParent ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {isLeaf ? (
                      <a
                        href={costsHref}
                        className="r6b-drawer-link"
                        title="Edit packaging / cost components on Cost build"
                      >
                        ↗ Cost build
                      </a>
                    ) : (
                      <span style={{ color: "var(--ink-4)" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!disabled && (
        <div style={{ marginTop: 10 }}>
          <AddAssemblyButton
            quoteId={quoteIdForAdd}
            eligibleParents={[]}
            triggerLabel="+ Add child SKU"
            triggerVariant="ghost"
            forcedParentId={_parentSkuId}
          />
        </div>
      )}
    </div>
  );
}

// §6.b path-B migration commit 3 — DrawerNotes renders canonical
// .r7b-sku-notes structure (7bsetup.jsx lines 237-243 +
// 7bstyles.css .r7b-sku-notes rules). <label> with "Per-SKU notes
// · internal-only" suffix; <textarea> below. Pattern 29-style
// blur+⌘Enter commit retained for accessibility.
function DrawerNotes({
  currentNote,
  onSave,
  disabled,
  pending,
}: {
  currentNote: string;
  onSave: (value: string) => void;
  disabled: boolean;
  pending: boolean;
}) {
  const [value, setValue] = useState(currentNote);
  const initial = useRef(currentNote);

  function fire() {
    const next = value.trim();
    if (next === initial.current.trim()) return;
    initial.current = next;
    onSave(next);
  }

  return (
    <div className="r7b-sku-notes">
      <label>
        Per-SKU notes
        <span style={{ color: "var(--ink-4)", marginLeft: 6 }}>
          · internal-only
        </span>
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={fire}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            fire();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        disabled={disabled}
        placeholder="Anything about this SKU — sourcing notes, customer requests, R&D dependencies. Stays internal; not customer-visible."
      />
      {pending && (
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--mono)",
          }}
        >
          saving…
        </span>
      )}
    </div>
  );
}

// §6.b polish-amendment — R6 read↔edit numeric cell (Pattern 29).
// Read mode: formatted $X.XX value + "RETAIL" mono caption.
// Empty: em-dash placeholder.
// Click: switches to edit mode + autofocuses.
// Blur / Enter: commits + returns to read mode.
// Esc: reverts + returns to read mode.
//
// Token discipline: --rule/--accent borders, --paper-2/--paper
// backgrounds. No hardcoded Tailwind gray-*.
//
// If a third cell needs this pattern (e.g., Tier table qty or
// price-adj column at Step 5), extract to a shared
// <EditableNumericCell> primitive in src/components/nav/ or
// src/components/setup/. Until then, scoped here.
function RetailBenchCell({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommitted = useRef(value);

  // Keep draft in sync when value changes from outside (e.g., reset)
  useEffect(() => {
    if (!editing) {
      setDraft(value);
      lastCommitted.current = value;
    }
  }, [value, editing]);

  function enterEdit() {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commit() {
    if (draft !== lastCommitted.current) {
      lastCommitted.current = draft;
      onChange(draft);
    }
    setEditing(false);
  }

  function revert() {
    setDraft(lastCommitted.current);
    setEditing(false);
  }

  const num = value ? Number(value) : NaN;
  const formatted = Number.isFinite(num)
    ? `$${num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : null;

  // §6.b path-B migration commit 3 — render canonical .retail
  // markup (7bstyles.css .r7b-sku-row .retail) for read mode.
  // Pattern 29 read↔edit interaction layered on top: clicking
  // the read-mode cell flips to <input>; blur/Enter commits.
  // Canonical R7b is static; Nexus extends with edit affordance
  // (Pattern 29 banked in CLAUDE.md).
  if (editing) {
    return (
      <span className="retail">
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              revert();
            }
          }}
          placeholder="—"
          className="r6b-retail-input"
        />
      </span>
    );
  }

  return (
    <span
      className="retail"
      onClick={disabled ? undefined : enterEdit}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                enterEdit();
              }
            }
      }
      aria-label={
        formatted
          ? `Retail benchmark ${formatted}. Click to edit.`
          : "Set retail benchmark"
      }
      style={disabled ? undefined : { cursor: "text" }}
    >
      {formatted ?? "—"}
      <span className="sub">retail</span>
    </span>
  );
}

// Phase 1.4 — units_per_pack inline-edit cell (Pattern 29 read↔edit).
// Renders as a small mono "N/pk" chip inside the product cell's .pack
// sub-text. Click flips to a number input; blur/Enter commits via the
// row's scheduleSave plumbing through updateSku. Esc reverts. Default
// value is "1" (per OQ3 disposition: modal dropped the field; default
// to 1 on insert; this cell is the only authoring surface post-create).
function UnitsPerPackCell({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
      lastCommitted.current = value;
    }
  }, [value, editing]);

  function enterEdit() {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commit() {
    const sanitized = draft.trim() === "" ? "1" : draft.trim();
    if (sanitized !== lastCommitted.current) {
      lastCommitted.current = sanitized;
      onChange(sanitized);
    }
    setDraft(sanitized);
    setEditing(false);
  }

  function revert() {
    setDraft(lastCommitted.current);
    setEditing(false);
  }

  const display = (() => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? `${n}/pk` : "1/pk";
  })();

  // Inline chip register — mono 10 / 0.04em / paper-3 bg / 1px rule /
  // 2px padding / 3px radius. Sits next to the canonical .indicator
  // chip so they read as a pair of small caption affordances.
  const chipStyle: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.04em",
    background: "var(--paper-3)",
    border: "1px solid var(--rule)",
    borderRadius: 3,
    padding: "1px 6px",
    color: "var(--ink-3)",
    marginRight: 6,
    verticalAlign: "middle",
  };

  if (editing) {
    return (
      <span style={chipStyle}>
        <input
          ref={inputRef}
          type="number"
          min={1}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              revert();
            }
          }}
          aria-label="Units per pack"
          style={{
            background: "transparent",
            border: "none",
            font: "inherit",
            color: "var(--ink)",
            width: 36,
            padding: 0,
            textAlign: "right",
          }}
        />
        <span style={{ color: "var(--ink-4)" }}>/pk</span>
      </span>
    );
  }

  return (
    <span
      style={{ ...chipStyle, cursor: disabled ? "default" : "text" }}
      onClick={disabled ? undefined : enterEdit}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                enterEdit();
              }
            }
      }
      aria-label={`Units per pack: ${display}. Click to edit.`}
    >
      {display}
    </span>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
