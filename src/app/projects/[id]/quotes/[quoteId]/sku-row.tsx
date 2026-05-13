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

const ROLE_LABEL: Record<Sku["skuRole"], string> = {
  leaf: "Leaf",
  assembly: "Assembly",
};

const ROLE_BADGE: Record<Sku["skuRole"], string> = {
  leaf: "bg-gray-100 text-gray-700",
  assembly: "bg-blue-100 text-blue-800",
};

export function SkuRow({
  sku,
  depth,
  hasChildren,
  childCount,
  eligibleParents,
  hubspotPortalId,
  disabled = false,
}: {
  sku: Sku;
  depth: number;
  hasChildren: boolean;
  /** §6.b Step 1 — children count for the Components column. */
  childCount: number;
  eligibleParents: EligibleParent[];
  hubspotPortalId: string | null;
  disabled?: boolean;
}) {
  // §6.b Step 1 — units_per_pack and notes inputs removed from row.
  // Notes returns in Step 4 (per-SKU drawer textarea); units_per_pack
  // has no R7b body home post-creation (Add-product modal in Step 8
  // sets it). Pre-existing data is preserved on the server side.
  const [retailBenchmark, setRetailBenchmark] = useState(sku.retailBenchmark ?? "");

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
  const stateRef = useRef({ retailBenchmark });
  stateRef.current = { retailBenchmark };

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
  }>;

  // §6.b Step 1 — updateSku still takes the full input shape;
  // pre-existing units_per_pack + notes pass through unchanged
  // (read from props.sku snapshot) so the action layer doesn't
  // null them out on a retail-benchmark-only save.
  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("unitsPerPack", String(sku.unitsPerPack));
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

  return (
    <>
      {/* §6.b Step 1 — 6-column row per brief §3.1.
          Columns: Grip · Type · Product (stack) · Retail bench · Components · ⋯
          Left-border accent (Step 1 amendment fidelity) — assembly rows
          render a 2px var(--accent) left border; leaf rows render the
          same width as transparent so vertical alignment is preserved
          (brief §3.1: "Left-border accent for assembly distinction"). */}
      <div
        className="grid grid-cols-[36px_80px_2fr_120px_120px_36px] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
        style={{
          borderLeft: isAssembly
            ? "2px solid var(--accent)"
            : "2px solid transparent",
        }}
      >
        {/* Grip — static glyph in Step 1; drag wires in Step 9. */}
        <span
          aria-hidden
          className="select-none text-center text-base text-ink-4"
          title="Drag to reorder (wires in §6.b step 9)"
        >
          ⠿
        </span>

        {/* Type — existing select dropdown in Step 1; Step 2 swaps for
            badge + click-to-toggle. */}
        <div>
          <select
            value={sku.skuRole}
            disabled={disabled || pending}
            onChange={(e) => handleConvertRole(e.target.value as Sku["skuRole"])}
            className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[sku.skuRole]} disabled:opacity-50`}
            title="Change SKU role"
          >
            {eligibleRoleTargets(
              sku.skuRole,
              sku.parentSkuId !== null,
              hasChildren,
            ).map((target) => (
              <option key={target} value={target}>
                {ROLE_LABEL[target]}
              </option>
            ))}
          </select>
        </div>

        {/* Product — stacked label / product_name / {pack if non-null} +
            HAS NOTE chip. Tree indentation preserved on label line. */}
        <div className="flex flex-col min-w-0" style={{ paddingLeft: `${indentPx}px` }}>
          <div className="flex items-center gap-2">
            {treeLine && (
              <span className="font-mono text-xs text-gray-400">{treeLine}</span>
            )}
            <span className="truncate text-sm font-medium text-gray-900">
              {sku.skuLabel}
            </span>
            {hasNote && (
              <span
                className="rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-warn"
                title={sku.notes ?? undefined}
              >
                HAS NOTE
              </span>
            )}
          </div>
          <span className="truncate text-xs text-ink-3">
            {sku.productName}
            {/* §6.b Pattern 22 #6 — pack sub-text NULL-safe; appears the
                moment Slice 11 lands quote_skus.pack. Until then, only
                productName renders on this line. */}
          </span>
          {sku.parentSkuId && (
            <QtyPerParentInline
              skuId={sku.id}
              currentQty={sku.qtyPerParent}
              disabled={disabled}
            />
          )}
        </div>

        {/* Retail bench — kept as inline input (R6 carry-forward). */}
        <input
          value={retailBenchmark}
          type="number"
          step="0.01"
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setRetailBenchmark(v);
            scheduleSave({ retailBenchmark: v });
          }}
          placeholder="—"
          className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />

        {/* Components — assemblies show count + "▸" pointer (drawer wires
            in Step 3); leaves show em-dash. Step 1 renders as visual
            badge; click-to-open-drawer wires in Step 3. */}
        <div className="text-xs text-ink-3">
          {isAssembly ? (
            <span title="Click to expand components (drawer wires in §6.b step 3)">
              {childCount} {childCount === 1 ? "comp" : "comps"} ▸
            </span>
          ) : (
            <span aria-hidden>—</span>
          )}
        </div>

        {/* ⋯ overflow — Step 1 absorbs the displaced ↑↓× cluster buttons
            (drag-drop replaces ↑↓ in Step 9). Conditional affordances
            (reassign / detach / refresh / HubSpot link) remain. */}
        <div className="flex items-center justify-end gap-1">
          {saveError ? (
            <span className="text-xs text-red-700 mr-1" role="alert">{saveError}</span>
          ) : pending ? (
            <span className="text-xs text-ink-4 mr-1">saving…</span>
          ) : null}

          <div className="relative" ref={overflowRef}>
              <button
                type="button"
                onClick={() => setOverflowOpen((v) => !v)}
                disabled={disabled}
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                title="More actions"
                className="rounded border border-rule px-1.5 py-0.5 text-xs hover:bg-paper-2 disabled:opacity-30"
              >
                ⋯
              </button>
              {overflowOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded border border-rule bg-paper py-1 shadow-md"
                >
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
