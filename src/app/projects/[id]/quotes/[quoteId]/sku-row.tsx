"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteSku,
  moveSku,
  refreshSkuFromHubspot,
  updateSku,
} from "@/app/actions/quotes";

type Sku = {
  id: string;
  hubspotProductId: string;
  skuLabel: string;
  productName: string;
  unitsPerPack: number;
  retailBenchmark: string | null;
  notes: string | null;
  lastHubspotRefreshAt: Date | null;
};

const DEBOUNCE_MS = 500;

export function SkuRow({
  sku,
  isFirst,
  isLast,
  hubspotPortalId,
  disabled = false,
}: {
  sku: Sku;
  isFirst: boolean;
  isLast: boolean;
  hubspotPortalId: string | null;
  disabled?: boolean;
}) {
  // Controlled state for editable fields. HubSpot-sourced fields stay
  // read-only (rendered from the prop directly).
  const [unitsPerPack, setUnitsPerPack] = useState(String(sku.unitsPerPack));
  const [retailBenchmark, setRetailBenchmark] = useState(sku.retailBenchmark ?? "");
  const [notes, setNotes] = useState(sku.notes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
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
    if (!confirm(`Remove "${sku.productName}" from this quote?`)) return;
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

  const productUrl = hubspotPortalId
    ? `https://app.hubspot.com/contacts/${hubspotPortalId}/objects/0-7/views/all/list?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${sku.hubspotProductId}%22%7D%5D`
    : null;

  return (
    <div className="grid grid-cols-[1.4fr_2.4fr_0.7fr_0.9fr_2fr_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
      {/* HubSpot-sourced: read-only, badge */}
      <ReadOnlyCell value={sku.skuLabel} />
      <ReadOnlyCell value={sku.productName} />

      {/* Nexus-local: controlled, editable */}
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
          <span className="text-xs text-red-700 mr-1" role="alert">
            {saveError}
          </span>
        ) : pending ? (
          <span className="text-xs text-gray-400 mr-1">saving…</span>
        ) : null}
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
        <button
          type="button"
          onClick={() => handleMove("up")}
          disabled={disabled || isFirst}
          title="Move up"
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => handleMove("down")}
          disabled={disabled || isLast}
          title="Move down"
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled}
          title="Remove SKU"
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
  );
}

function ReadOnlyCell({ value }: { value: string }) {
  return (
    <div className="flex flex-col">
      <span className="truncate px-1.5 py-1 text-sm text-gray-900">{value}</span>
      <span className="px-1.5 text-[10px] uppercase tracking-wide text-gray-400">
        from HubSpot
      </span>
    </div>
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
