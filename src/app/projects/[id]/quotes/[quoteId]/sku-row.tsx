"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  assignSkuToParent,
  convertLeafToAssemblyWithMigrate,
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
  /** Leaf-detach micro-slice Sub-item 3 follow-up — true when this
   * SKU was auto-created by `convertLeafToAssemblyWithMigrate` (or
   * the cleanup-pass adapter). Type badge convert is disabled on
   * these rows to prevent nested `-CMP-CMP-...` chains. */
  isAutoMigrateArtifact: boolean;
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
  /** Leaf-detach micro-slice Sub-item 1b — drives the conditional
   * confirmation modal on the drawer's per-row Detach affordance.
   * Server-computed: notes non-empty OR retailBenchmark non-null. */
  hasPreservableData: boolean;
};

export function SkuRow({
  sku,
  depth,
  hasChildren,
  childCount,
  childSkus = [],
  eligibleParents,
  currentParentLabel = null,
  hasCostData = false,
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
  /** Leaf-detach micro-slice Sub-item 1 — current parent's skuLabel
   * (only meaningful when sku.parentSkuId !== null). Drives the
   * overflow menu's "Detach from {parent name}" copy and the
   * confirmation modal's prompt. */
  currentParentLabel?: string | null;
  /** Leaf-detach micro-slice Sub-item 3 — true when this SKU has
   * any per-SKU cost-input row. Gates the smart-migrate modal on
   * leaf → assembly Type-badge clicks: cost data present → modal
   * opens; cost data absent → silent toggle. */
  hasCostData?: boolean;
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
  // Leaf-detach micro-slice Sub-item 1 — detach confirmation modal
  // state. Two entry points feed the same modal:
  //   - Overflow menu Detach (Sub-item 1a): targets sku.id; parent
  //     label comes from currentParentLabel prop.
  //   - Drawer child-list Detach (Sub-item 1b): targets a child's
  //     id; parent label is THIS row's sku.skuLabel (since the
  //     drawer is open inside this assembly row).
  // Modal opens only when the target has preservable data; silent
  // detach skips it entirely.
  const [detachContext, setDetachContext] = useState<
    | {
        targetSkuId: string;
        parentLabel: string | null;
      }
    | null
  >(null);
  // Leaf-detach micro-slice Sub-item 2 — cascade-detach confirmation
  // modal state. Open when PM clicks the Type badge on an assembly
  // row with ≥1 children to demote it to leaf. PM confirms → all
  // direct children detach as standalone leaves; role flips to
  // leaf; atomic transaction.
  const [cascadeConvertModalOpen, setCascadeConvertModalOpen] =
    useState(false);
  // Leaf-detach micro-slice Sub-item 3 — smart-migrate confirmation
  // modal state. Open when PM clicks Type badge on a leaf row that
  // has cost data. Confirm → server creates auto-named child leaf
  // + reparents cost rows + flips original to assembly.
  const [smartMigrateModalOpen, setSmartMigrateModalOpen] =
    useState(false);
  // Slice RI.8 — overflow menu state for action cluster compression
  // (Designer audit Q2 approved). Houses the four conditional
  // affordances (assembly reassign / detach / HubSpot refresh /
  // HubSpot product link) behind a `⋯` button. Click + ESC +
  // outside-click closes. Full keyboard arrow nav is polish,
  // deferred per Designer's drop-and-defer fallback.
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Sweep mid-slice hotfix v3 — createPortal escapes the row's DOM
  // entirely. v1 (position:absolute + flip-logic) and v2 (position:
  // fixed + computed coords) both clipped because the menu was still
  // a descendant of .r7b-card (overflow:hidden) inside .r7b-sku-row
  // (display:grid). Even with position:fixed, the menu was clipped
  // (Edward smoke v2 found only Add notes + Move up visible, missing
  // Move down + Delete). Root cause was likely a grid-cell overflow
  // chain that pinned the menu's effective render box. v3 portals
  // the menu directly into document.body so it has zero structural
  // dependencies on the row's parent tree.
  const [overflowMenuPos, setOverflowMenuPos] = useState<
    { top: number; right: number } | null
  >(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  // Step 10 Edward smoke (2026-05-14) — separate ref for the
  // portal-mounted menu container. The portal moves the menu out
  // of `overflowRef`'s DOM ancestry; the outside-click handler
  // needs to check both refs (trigger AND portaled menu) or every
  // click inside the menu fires as an "outside click" and
  // unmounts the menu before the button's onClick can run.
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ retailBenchmark, unitsPerPack });
  stateRef.current = { retailBenchmark, unitsPerPack };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Sweep mid-slice hotfix v2 — fixed-position menu coords.
  // On open, measure trigger's getBoundingClientRect. Compute
  // menu's top/right coords for position:fixed render. If
  // remaining viewport space below is insufficient (estimated
  // 240px menu height), position menu ABOVE the trigger instead
  // — top = trigger.top - 240 - 4 (mb-1 gap).
  // Re-measures on each open so scroll position changes between
  // opens get the right coords.
  useEffect(() => {
    if (!overflowOpen || !overflowRef.current) return;
    const rect = overflowRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const ESTIMATED_MENU_HEIGHT = 240;
    const GAP = 4;
    const top =
      spaceBelow < ESTIMATED_MENU_HEIGHT
        ? rect.top - ESTIMATED_MENU_HEIGHT - GAP
        : rect.bottom + GAP;
    const right = window.innerWidth - rect.right;
    setOverflowMenuPos({ top, right });
  }, [overflowOpen]);

  // Slice RI.8 — overflow menu close-on-outside-click + ESC.
  // Step 10 Edward smoke fix (2026-05-14) — outside-click check now
  // accepts EITHER the trigger ref (overflowRef) OR the portaled
  // menu ref (overflowMenuRef). Previously only overflowRef was
  // checked, but the v3 portal hotfix moved the menu DOM to
  // document.body — descendants of the menu were no longer in
  // overflowRef's tree, so every menu-item click fired as an
  // "outside click" and unmounted the menu before React's onClick
  // could run. All menu items appeared broken (Edward repro:
  // "Assign to parent does nothing").
  useEffect(() => {
    if (!overflowOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = overflowRef.current?.contains(target) ?? false;
      const insideMenu = overflowMenuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) {
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

    // Leaf-detach micro-slice Sub-item 2 — assembly → leaf with
    // children opens the cascade-detach confirmation modal instead
    // of firing the action directly. PM confirms → cascade flag set
    // on the action call; children detach atomically.
    if (sku.skuRole === "assembly" && newRole === "leaf" && hasChildren) {
      setCascadeConvertModalOpen(true);
      return;
    }

    // Leaf-detach micro-slice Sub-item 3 — leaf → assembly with
    // cost data opens the smart-migrate confirmation modal.
    // Confirm → server creates auto-named child leaf + reparents
    // cost rows + flips original to assembly atomically. PM-
    // visible scenario gate: no cost data → silent toggle through
    // the default path below.
    if (sku.skuRole === "leaf" && newRole === "assembly" && hasCostData) {
      setSmartMigrateModalOpen(true);
      return;
    }

    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("newRole", newRole);
    startTransition(async () => {
      const r = await convertSkuRole(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function runSmartMigrate() {
    setSmartMigrateModalOpen(false);
    setSaveError(null);
    const fd = new FormData();
    fd.set("skuId", sku.id);
    startTransition(async () => {
      const r = await convertLeafToAssemblyWithMigrate(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function runCascadeConvert() {
    setCascadeConvertModalOpen(false);
    setSaveError(null);
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("newRole", "leaf");
    fd.set("cascadeDetachChildren", "true");
    startTransition(async () => {
      const r = await convertSkuRole(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  // Leaf-detach micro-slice Sub-item 1 — detach trigger split into
  // a confirmation-gated dispatcher + the actual action call.
  //
  // Confirmation gate: if the SKU carries preservable data (notes
  // OR retail bench), open the canonical confirmation modal so the
  // PM sees what'll be preserved. If the SKU is empty, fire the
  // action silently — no modal overhead for a clean detach.
  //
  // Pattern 31 disposition (Edward + CA, May 2026): brief specified
  // a new action `detachLeafFromParent` with audit key
  // `sku_detached_from_parent`. Existing `unassignSkuFromParent`
  // (since Slice 5.5) provides the same semantics — writes
  // parent_sku_id + qty_per_parent to NULL on the child row, audit
  // key `unassigned_from_parent`. Brief's action/audit naming was a
  // design-time placeholder; existing implementation satisfies
  // intent. No rename — preserves audit-log continuity for prior
  // entries.
  function rowHasPreservableDetachData(): boolean {
    return (
      (sku.notes !== null && sku.notes.trim() !== "") ||
      (sku.retailBenchmark !== null && String(sku.retailBenchmark).trim() !== "")
    );
  }

  function triggerDetach() {
    if (rowHasPreservableDetachData()) {
      setDetachContext({
        targetSkuId: sku.id,
        parentLabel: currentParentLabel,
      });
    } else {
      runDetach(sku.id);
    }
  }

  // Sub-item 1b — drawer child-row Detach entry point. Same modal
  // shape; target is the child SKU, parent label is THIS row's
  // label (the drawer renders inside an assembly row).
  function triggerChildDetach(childSkuId: string, childHasData: boolean) {
    if (childHasData) {
      setDetachContext({
        targetSkuId: childSkuId,
        parentLabel: sku.skuLabel,
      });
    } else {
      runDetach(childSkuId);
    }
  }

  function runDetach(targetSkuId: string) {
    setDetachContext(null);
    setSaveError(null);
    const fd = new FormData();
    fd.set("skuId", targetSkuId);
    startTransition(async () => {
      const r = await unassignSkuFromParent(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  // Legacy callers; preserved for back-compat (overflow menu calls
  // triggerDetach; older non-conditional callers can keep
  // handleDetach).
  function handleDetach() {
    triggerDetach();
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
          const canToggleViaValidator = eligibleRoleTargets(
            sku.skuRole,
            sku.parentSkuId !== null,
            hasChildren,
          ).includes(targetRole);
          // Leaf-detach micro-slice Sub-item 2 — assembly with
          // children + clicking-to-leaf was REFUSED by the
          // validator (canToggleViaValidator=false). The cascade
          // path opens a confirmation modal so the click is
          // semantically valid; the validator's refusal becomes a
          // gate on the SILENT path only. The handler still gates
          // server-side via the cascadeDetachChildren flag.
          const isCascadeCase =
            sku.skuRole === "assembly" &&
            targetRole === "leaf" &&
            hasChildren;
          // Sub-item 3 follow-up (Edward disposition (a)):
          // disable Type badge entirely on auto-created -CMP
          // children to prevent nested -CMP-CMP-... chains.
          // Tooltip explains why; PM flattens by converting the
          // parent assembly back to leaf via the cascade path.
          const isAutoArtifact = sku.isAutoMigrateArtifact;
          const canToggle =
            !isAutoArtifact && (canToggleViaValidator || isCascadeCase);
          const isAsy = sku.skuRole === "assembly";
          return (
            <button
              type="button"
              onClick={() => handleConvertRole(targetRole)}
              disabled={disabled || pending || !canToggle}
              aria-pressed={isAsy}
              aria-label={`Type: ${ROLE_SHORT_LABEL[sku.skuRole]}. ${
                isAutoArtifact
                  ? "Auto-generated cost-data artifact — type is locked."
                  : canToggle
                    ? isCascadeCase
                      ? `Click to convert to leaf (will detach ${childCount} children).`
                      : `Click to convert to ${ROLE_SHORT_LABEL[targetRole]}.`
                    : `Cannot convert.`
              }`}
              title={
                isAutoArtifact
                  ? "Auto-generated cost-data child — convert the parent assembly back to leaf to flatten this hierarchy."
                  : canToggle
                    ? isCascadeCase
                      ? `Convert to leaf — children will be detached (confirmation modal)`
                      : `Click to convert to ${ROLE_SHORT_LABEL[targetRole]}`
                    : "Cannot convert."
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
              // Designer audit Finding 02 — tree-line is a decorative
              // connector, not a SKU label. Strip the .lbl className
              // (which carried canonical .lbl typography that's wrong
              // for the connector glyph) and use a dedicated mono-10
              // ink-4 register.
              <span
                aria-hidden
                style={{
                  color: "var(--ink-4)",
                  marginRight: 4,
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                }}
              >
                {treeLine}
              </span>
            )}
            <span
              className="lbl"
              title={buildOriginTooltip(sku)}
              style={{ cursor: "help" }}
            >
              {sku.skuLabel}
            </span>
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
              {overflowOpen && overflowMenuPos && createPortal(
                // Step 10 Edward smoke (2026-05-14) — migrated from
                // Tailwind utility classes (text-xs / px-3 / py-1.5
                // etc.) to canonical .r7b-overflow-menu register in
                // r7b-primitives.css. The v3 portal hotfix moves the
                // menu to document.body; Tailwind utilities weren't
                // winning the cascade post-portal (items rendered at
                // body-default 14px without canonical padding/spacing).
                // Canonical CSS class register defines the visual
                // register explicitly + wins selector specificity.
                <div
                  role="menu"
                  ref={overflowMenuRef}
                  className="r7b-overflow-menu"
                  style={{
                    position: "fixed",
                    top: overflowMenuPos.top,
                    right: overflowMenuPos.right,
                    zIndex: 1000,
                  }}
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
                      className="r7b-overflow-menu-item"
                    >
                      <span className="glyph">📝</span>
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
                    className="r7b-overflow-menu-item"
                  >
                    <span className="glyph">↑</span>
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
                    className="r7b-overflow-menu-item"
                  >
                    <span className="glyph">↓</span>
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
                    className="r7b-overflow-menu-item danger"
                  >
                    <span className="glyph">×</span>
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
                      className="r7b-overflow-menu-item"
                    >
                      <span className="glyph">
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
                        setOverflowOpen(false);
                        triggerDetach();
                      }}
                      className="r7b-overflow-menu-item"
                    >
                      <span className="glyph">⤴</span>
                      {currentParentLabel
                        ? `Detach from ${currentParentLabel}`
                        : "Detach from parent"}
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
                      className="r7b-overflow-menu-item"
                    >
                      <span className="glyph">↻</span>
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
                      className="r7b-overflow-menu-item"
                    >
                      <span className="glyph">↗</span>
                      Open in HubSpot
                    </a>
                  )}
                </div>,
                document.body,
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
          {/* Canonical R7b drawer pattern: <div class="drawer-title">
              announces the section, then the body table sits below.
              Pattern 19 carve preserved — Mismatch 1 γ replaces
              canonical inline-editable .r7b-comp-table with a
              child-SKU navigation list (DrawerChildList). The
              drawer-title header stays canonical-aligned. */}
          {isAssembly && projectId && quoteId && (
            <>
              <div className="drawer-title">
                Components ({childSkus.length})
              </div>
              <DrawerChildList
                parentSkuId={sku.id}
                projectId={projectId}
                quoteId={quoteId}
                quoteIdForAdd={quoteId}
                childSkus={childSkus}
                disabled={disabled}
                onDetachChild={triggerChildDetach}
              />
            </>
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
              Leaf SKU — single-line. Cost goes on Costs; this
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

      {/* Leaf-detach micro-slice Sub-item 1 — confirmation modal.
          Renders only when a detach target has preservable data
          (notes OR retail bench); the silent-detach path bypasses
          this modal entirely. Canonical .r7b-modal-* register (same
          chrome as the §6.b Add-product modal). Both entry points
          (overflow menu + drawer child-row) feed the same modal via
          the detachContext state. */}
      {detachContext && !disabled && (
        <DetachConfirmModal
          parentLabel={detachContext.parentLabel}
          onCancel={() => setDetachContext(null)}
          onConfirm={() => runDetach(detachContext.targetSkuId)}
          pending={pending}
        />
      )}

      {/* Leaf-detach micro-slice Sub-item 2 — cascade-detach
          confirmation modal. Opens when PM clicks Type badge on an
          assembly row with ≥1 children to demote it to leaf.
          Brief Q4 LOCKED copy: "Convert {sku} to leaf? {N}
          children will be detached as standalone leaves (their
          notes, retail bench, and data preserved)." */}
      {cascadeConvertModalOpen && !disabled && (
        <CascadeConvertConfirmModal
          skuLabel={sku.skuLabel}
          childCount={childCount}
          onCancel={() => setCascadeConvertModalOpen(false)}
          onConfirm={runCascadeConvert}
          pending={pending}
        />
      )}

      {/* Leaf-detach micro-slice Sub-item 3 — smart-migrate
          confirmation modal. Opens when PM clicks Type badge on a
          leaf with cost data. Brief Q1 LOCKED: deterministic
          silent auto-naming `{ORIGINAL-SKU}-CMP`. */}
      {smartMigrateModalOpen && !disabled && (
        <SmartMigrateConfirmModal
          skuLabel={sku.skuLabel}
          onCancel={() => setSmartMigrateModalOpen(false)}
          onConfirm={runSmartMigrate}
          pending={pending}
        />
      )}
    </>
  );
}

// Designer audit Finding 05 (MEDIUM) — rewrote with canonical
// .r7b-sku-reassign tokens (var(--paper-2) bg + var(--rule) +
// .btn primitives). Previous shape used hardcoded gray-* Tailwind
// that failed dark-mode: bg-gray-50 didn't theme; bg-gray-900 on
// the Save button was darker than var(--ink) so the button read
// black-on-black in dark mode. Now uses .btn primary sm + .btn
// ghost sm primitives same as the Add-product modal foot.
// Leaf-detach micro-slice Sub-item 1 — canonical R7b confirmation
// modal for detach-with-preservable-data. Renders inline via
// `.r7b-modal-backdrop` + `.r7b-modal` chrome (same shape as
// §6.b Add-product modal). Brief Q4 LOCKED copy: "Convert {sku}
// to leaf? {N} children..." for cascade-detach; here for the
// single-leaf detach the copy is "Detach this leaf from
// {parent}? Notes, retail bench, and drawer state will be
// preserved on the standalone leaf." per brief Sub-item 1.
//
// The modal is structurally separate from ReassignPanel (which is
// the inline-expanding parent-picker). Detach is a confirmation,
// not a multi-input form.
function DetachConfirmModal({
  parentLabel,
  onCancel,
  onConfirm,
  pending,
}: {
  parentLabel: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="r7b-modal-backdrop" onClick={onCancel}>
      <div
        className="r7b-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Detach from parent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r7b-modal-head">
          <h2>Detach from {parentLabel ?? "parent"}?</h2>
          <p className="sub">
            Notes, retail bench, and drawer state will be preserved on the
            standalone leaf.
          </p>
        </div>
        <div
          className="r7b-modal-body"
          style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
        >
          <button
            type="button"
            className="btn ghost sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Detaching…" : "Detach"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Leaf-detach micro-slice Sub-item 2 — canonical R7b confirmation
// modal for assembly → leaf cascade-detach. Brief Q4 LOCKED copy.
// Same `.r7b-modal-*` chrome as DetachConfirmModal; primary CTA
// label "Convert and detach {N} children" to make the cascade
// outcome explicit (PM reads the button copy and knows what's
// about to happen).
function CascadeConvertConfirmModal({
  skuLabel,
  childCount,
  onCancel,
  onConfirm,
  pending,
}: {
  skuLabel: string;
  childCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const childWord = childCount === 1 ? "child" : "children";
  return (
    <div className="r7b-modal-backdrop" onClick={onCancel}>
      <div
        className="r7b-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Convert assembly to leaf"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r7b-modal-head">
          <h2>Convert {skuLabel} to leaf?</h2>
          <p className="sub">
            {childCount} {childWord} will be detached as standalone leaves
            (their notes, retail bench, and data preserved).
          </p>
        </div>
        <div
          className="r7b-modal-body"
          style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
        >
          <button
            type="button"
            className="btn ghost sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending
              ? "Converting…"
              : `Convert and detach ${childCount} ${childWord}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Leaf-detach micro-slice Sub-item 3 — canonical R7b confirmation
// modal for leaf → assembly smart-migrate. Brief copy: "Convert
// {sku} to assembly? Cost data on this leaf will be moved to a
// new child leaf '{auto-name}' (auto-created, all cost lines
// preserved). You can rename the new child after." Brief Q1
// LOCKED: deterministic silent auto-name `{ORIGINAL-SKU}-CMP`.
// The auto-name is shown as info (not editable per Q1
// disposition).
function SmartMigrateConfirmModal({
  skuLabel,
  onCancel,
  onConfirm,
  pending,
}: {
  skuLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="r7b-modal-backdrop" onClick={onCancel}>
      <div
        className="r7b-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Convert leaf to assembly"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="r7b-modal-head">
          <h2>Convert {skuLabel} to assembly?</h2>
          <p className="sub">
            Cost data on this leaf will be moved to a new child leaf{" "}
            <strong>{skuLabel}-CMP</strong> (auto-created, all cost lines
            preserved). You can rename the new child after.
          </p>
        </div>
        <div
          className="r7b-modal-body"
          style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
        >
          <button
            type="button"
            className="btn ghost sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Converting…" : "Convert and migrate cost data"}
          </button>
        </div>
      </div>
    </div>
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
    <div className="r7b-sku-reassign">
      <div className="form">
        <label>Parent</label>
        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">— select parent —</option>
          {eligibleParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.skuLabel} — {p.productName} ({p.skuRole})
            </option>
          ))}
        </select>
        <label>Qty</label>
        <input
          className="qty"
          type="number"
          step="0.0001"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="qty per parent"
        />
      </div>
      <button
        type="button"
        className="btn primary sm"
        onClick={() => onSubmit(parentId, qty)}
      >
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={onCancel}>
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

  // Designer audit Finding 02 (HIGH) — tokenize the qty-per-parent
  // inline pill. Previous shape used hardcoded gray-* Tailwind which
  // failed dark-mode + violated Pattern 19 (silent extension of
  // canonical .name structure without documented rationale). Now
  // uses var(--paper-3) bg + var(--rule) border + var(--ink-*) ink
  // palette so the affordance themes correctly. Pattern 19 rationale
  // for keeping the THIRD child of .name (canonical only has 2):
  // assembly children rendered as nested rows are a Nexus extension
  // — the data shape genuinely differs from canonical's flat SKU
  // table; PMs need the qty editor adjacent to the child row.
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--mono)",
        fontSize: 10,
        color: "var(--ink-4)",
        letterSpacing: "0.04em",
      }}
    >
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
        title="qty per parent"
        style={{
          width: 44,
          padding: "0 4px",
          background: "var(--paper-3)",
          border: "1px solid var(--rule)",
          borderRadius: 3,
          color: "var(--ink-2)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          textAlign: "right",
        }}
      />
      <span>per parent</span>
      {pending && <span style={{ color: "var(--ink-4)" }}>…</span>}
      {error && (
        <span style={{ color: "var(--bad)" }} role="alert">
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

import { AddProductModal } from "./add-product-modal";

// Edward pre-PR fidelity check 2 (May 2026) — DrawerChildList
// rewritten to use canonical `.r7b-comp-table` grid grammar
// VERBATIM. Previous attempt renamed classes to .r7b-child-list-*
// but kept HTML <table> semantics; visual register didn't match
// canonical (different padding, different thead/row registers,
// table-collapse behavior differs from grid-aligned columns).
//
// Now uses canonical `.r7b-comp-table` outer + `.r7b-comp-thead` /
// `.r7b-comp-row` / `.r7b-comp-foot` children, all grid-based.
// Same grammar canonical R7b uses for the inline-editable
// component editor AND R6 `.r6-dt` data tables use across the
// Costs drilldowns — single consistent table register across
// the app.
//
// Carve-specific deviations (Mismatch 1 γ):
//   - Column count: 5 (Label, Product, Type, Qty/parent, Open)
//     instead of canonical 7. Nexus-override grid-template-columns
//     applied via .r7b-comp-table.child-list modifier in
//     r1-setup.css.
//   - Cell content: display-only (no .input class on children) —
//     per-component cost data lives on packaging_inputs keyed to
//     leaf SKUs; inline editing across the boundary deferred to
//     §6.c.
//   - Foot's `.add-line` action carries the "+ Add child SKU"
//     trigger to a child-creation form (AddAssemblyButton with
//     forcedParentId).
function DrawerChildList({
  parentSkuId,
  projectId,
  quoteId,
  quoteIdForAdd,
  childSkus,
  disabled,
  onDetachChild,
}: {
  parentSkuId: string;
  projectId: string;
  quoteId: string;
  quoteIdForAdd: string;
  childSkus: ChildRow[];
  disabled: boolean;
  /** Leaf-detach micro-slice Sub-item 1b — per-row Detach button
   * callback. Caller (SkuRow, the assembly's row) handles the
   * confirmation modal + action dispatch; this list just signals
   * which child to detach + whether it has preservable data. */
  onDetachChild: (childSkuId: string, hasPreservableData: boolean) => void;
}) {
  const _parentSkuId = parentSkuId; // for forcedParentId pass-through below
  return (
    <div className="r7b-comp-table child-list">
      <div className="r7b-comp-thead">
        <span>Label</span>
        <span>Product</span>
        <span>Type</span>
        <span className="num">Qty / parent</span>
        <span className="num">Open</span>
      </div>
      {childSkus.length === 0 ? (
        // Sweep Step 1 — migrated to canonical .r7b-empty-state
        // primitive. Earlier shape used .r7b-comp-row + single-column
        // grid override which worked but was structurally weird
        // (empty-state inside a comp-row). Pattern 19 disposition:
        // the data shape really IS different — "no rows" ≠ "one
        // special row" — so the primitive matches the semantic.
        <p className="r7b-empty-state">
          No child SKUs yet. Add one below or assign existing SKUs to this
          assembly via the row&rsquo;s ⋯ menu.
        </p>
      ) : (
        childSkus.map((c) => {
          const isLeaf = c.skuRole === "leaf";
          const costsHref = `/projects/${projectId}/quotes/${quoteId}/costs?focus=${c.id}`;
          return (
            <div key={c.id} className="r7b-comp-row">
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--ink)",
                }}
              >
                {c.skuLabel}
              </span>
              <span style={{ color: "var(--ink-2)" }}>{c.productName}</span>
              <span>
                <span
                  className={`r7b-type ${c.skuRole}`}
                  style={{ pointerEvents: "none" }}
                >
                  <span className="glyph" aria-hidden>
                    {c.skuRole === "assembly" ? "▤" : "○"}
                  </span>
                  {c.skuRole === "assembly" ? "ASY" : "LEAF"}
                </span>
              </span>
              <span className="num" style={{ color: "var(--ink-3)" }}>
                {c.qtyPerParent ?? "—"}
              </span>
              <span
                className="num"
                style={{ display: "inline-flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}
              >
                {isLeaf ? (
                  <a
                    href={costsHref}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      color: "var(--accent-ink)",
                      textDecoration: "none",
                    }}
                    title="Edit packaging / cost components on Costs"
                  >
                    ↗ Costs
                  </a>
                ) : (
                  <span style={{ color: "var(--ink-4)" }}>—</span>
                )}
                {/* Leaf-detach micro-slice Sub-item 1b — per-row
                    Detach affordance. Brief Q3 LOCKED copy "✕ Detach".
                    Click triggers the same confirmation-gated detach
                    flow as the leaf row's overflow menu (Sub-item 1a)
                    via the onDetachChild callback. */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onDetachChild(c.id, c.hasPreservableData)}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      color: "var(--ink-3)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title={`Detach ${c.skuLabel} from this assembly`}
                  >
                    ✕ Detach
                  </button>
                )}
              </span>
            </div>
          );
        })
      )}
      {!disabled && (
        <div className="r7b-comp-foot">
          {/* Canonical `.add-line` register: full-width grid span +
              accent-ink mono uppercase. AddProductModal renders the
              closed-state trigger here; click opens the HubSpot-
              first picker (Sub-task B). Previously used
              AddAssemblyButton which created Nexus-local leaves;
              Edward smoke 2026-05-14 surfaced that every leaf
              needs a HubSpot link for the HubSpot↔NetSuite product
              library sync. AddProductModal's PullExisting +
              CreateNew flows both produce HubSpot-tied SKUs. */}
          <span className="add-line" style={{ padding: 0 }}>
            <AddProductModal
              quoteId={quoteIdForAdd}
              forcedParentId={_parentSkuId}
              triggerLabel="+ Add child SKU"
              triggerVariant="ghost"
            />
          </span>
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

// Leaf-detach micro-slice Sub-item 3 follow-up (Edward smoke 2026-
// 05-14) — hover-tooltip content on the SKU label cell. Three-line
// origin summary varies by row state:
//   - HubSpot-linked: source + product ID + last sync time
//   - Nexus-local: "Nexus-local SKU · Not tied to HubSpot"
//   - Auto-migrate child: marked + inherited HubSpot info OR
//     "legacy auto-artifact pre-fix" callout when null
// Native `title` attribute renders the tooltip; multi-line via
// embedded \n characters (cross-browser standard).
function buildOriginTooltip(sku: {
  hubspotProductId: string | null;
  lastHubspotRefreshAt: Date | null;
  isAutoMigrateArtifact: boolean;
}): string {
  const hasHubspot = !!sku.hubspotProductId;
  const syncLine = sku.lastHubspotRefreshAt
    ? `Last synced ${formatRelative(sku.lastHubspotRefreshAt)}`
    : "Never synced";
  if (sku.isAutoMigrateArtifact) {
    if (hasHubspot) {
      return `Auto-migrate child\nHubSpot product · ID ${sku.hubspotProductId} (inherited)\n${syncLine}`;
    }
    return `Auto-migrate child\nNot tied to HubSpot (legacy auto-artifact pre-fix)`;
  }
  if (hasHubspot) {
    return `HubSpot product · ID ${sku.hubspotProductId}\n${syncLine}`;
  }
  return `Nexus-local SKU\nNot tied to HubSpot`;
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
