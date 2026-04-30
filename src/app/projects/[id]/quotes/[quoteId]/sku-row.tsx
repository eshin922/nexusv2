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
  eligibleParents,
  hubspotPortalId,
  disabled = false,
}: {
  sku: Sku;
  depth: number;
  hasChildren: boolean;
  eligibleParents: EligibleParent[];
  hubspotPortalId: string | null;
  disabled?: boolean;
}) {
  const [unitsPerPack, setUnitsPerPack] = useState(String(sku.unitsPerPack));
  const [retailBenchmark, setRetailBenchmark] = useState(sku.retailBenchmark ?? "");
  const [notes, setNotes] = useState(sku.notes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ unitsPerPack, retailBenchmark, notes });
  stateRef.current = { unitsPerPack, retailBenchmark, notes };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{
    unitsPerPack: string;
    retailBenchmark: string;
    notes: string;
  }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("skuId", sku.id);
    fd.set("unitsPerPack", s.unitsPerPack);
    fd.set("retailBenchmark", s.retailBenchmark);
    fd.set("notes", s.notes);
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

  return (
    <>
      <div className="grid grid-cols-[1.4fr_2fr_0.9fr_0.6fr_0.7fr_1.4fr_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
        {/* SKU column with tree indentation */}
        <div className="flex items-center" style={{ paddingLeft: `${indentPx}px` }}>
          {treeLine && (
            <span className="font-mono text-xs text-gray-400 mr-1">{treeLine}</span>
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate text-sm text-gray-900">{sku.skuLabel}</span>
            {sku.hubspotProductId && (
              <span className="text-[10px] uppercase tracking-wide text-gray-400">
                from HubSpot
              </span>
            )}
            {!sku.hubspotProductId && (
              <span className="text-[10px] uppercase tracking-wide text-gray-400">
                Nexus-local
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col min-w-0">
          <span className="truncate text-sm text-gray-900">{sku.productName}</span>
          {sku.parentSkuId && (
            <QtyPerParentInline
              skuId={sku.id}
              currentQty={sku.qtyPerParent}
              disabled={disabled}
            />
          )}
        </div>

        {/* Type badge with role-convert dropdown — options filtered by
            current state's valid transitions (defense in depth at server). */}
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

        <input
          value={unitsPerPack}
          type="number"
          min={1}
          required
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setUnitsPerPack(v);
            scheduleSave({ unitsPerPack: v });
          }}
          className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
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
        <input
          value={notes}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setNotes(v);
            scheduleSave({ notes: v });
          }}
          placeholder="—"
          className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />

        <div className="flex items-center gap-1 justify-end">
          {saveError ? (
            <span className="text-xs text-red-700 mr-1" role="alert">{saveError}</span>
          ) : pending ? (
            <span className="text-xs text-gray-400 mr-1">saving…</span>
          ) : null}

          {/* Assembly menu */}
          {canBeChild && eligibleParents.length > 0 && (
            <button
              type="button"
              onClick={() => setReassignOpen((v) => !v)}
              disabled={disabled}
              title={sku.parentSkuId ? "Reassign parent" : "Assign to parent"}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white disabled:opacity-30"
            >
              {sku.parentSkuId ? "↔" : "↳"}
            </button>
          )}
          {sku.parentSkuId && (
            <button
              type="button"
              onClick={handleDetach}
              disabled={disabled}
              title="Detach from parent"
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white disabled:opacity-30"
            >
              ⤴
            </button>
          )}

          {sku.hubspotProductId && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={disabled}
              title={
                sku.lastHubspotRefreshAt
                  ? `Refresh from HubSpot (last synced ${formatRelative(sku.lastHubspotRefreshAt)})`
                  : "Refresh from HubSpot"
              }
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white disabled:opacity-30"
            >
              ↻
            </button>
          )}
          <button
            type="button"
            onClick={() => handleMove("up")}
            disabled={disabled}
            title="Move up"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleMove("down")}
            disabled={disabled}
            title="Move down"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={disabled}
            title={sku.skuRole !== "leaf" ? "Delete (cascade)" : "Remove SKU"}
            className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
          >
            ×
          </button>
          {productUrl && (
            <a
              href={productUrl}
              target="_blank"
              rel="noreferrer"
              title="Open product in HubSpot"
              className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-white"
            >
              ↗
            </a>
          )}
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
