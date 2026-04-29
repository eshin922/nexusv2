"use client";

import { useRef, useState } from "react";
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

export function SkuRow({
  sku,
  isFirst,
  isLast,
  hubspotPortalId,
}: {
  sku: Sku;
  isFirst: boolean;
  isLast: boolean;
  hubspotPortalId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);

  const initialRef = useRef<Record<string, string>>({
    unitsPerPack: String(sku.unitsPerPack),
    retailBenchmark: sku.retailBenchmark ?? "",
    notes: sku.notes ?? "",
  });

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.currentTarget.name;
    const value = e.currentTarget.value;
    if (initialRef.current[name] !== value) {
      initialRef.current[name] = value;
      setSaving(true);
      formRef.current?.requestSubmit();
      setTimeout(() => setSaving(false), 600);
    }
  }

  const productUrl = hubspotPortalId
    ? `https://app.hubspot.com/contacts/${hubspotPortalId}/objects/0-7/views/all/list?filters=%5B%7B%22property%22%3A%22hs_object_id%22%2C%22operator%22%3A%22EQ%22%2C%22value%22%3A%22${sku.hubspotProductId}%22%7D%5D`
    : null;

  return (
    <form
      ref={formRef}
      action={updateSku}
      className="grid grid-cols-[1.4fr_2.4fr_0.7fr_0.9fr_2fr_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
    >
      <input type="hidden" name="skuId" value={sku.id} />

      {/* HubSpot-sourced: read-only */}
      <ReadOnlyCell value={sku.skuLabel} />
      <ReadOnlyCell value={sku.productName} />

      {/* Nexus-local: editable */}
      <input
        name="unitsPerPack"
        type="number"
        min={1}
        defaultValue={String(sku.unitsPerPack)}
        required
        onBlur={handleBlur}
        className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none"
      />
      <input
        name="retailBenchmark"
        type="number"
        step="0.01"
        defaultValue={sku.retailBenchmark ?? ""}
        placeholder="—"
        onBlur={handleBlur}
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-gray-300 focus:bg-white focus:outline-none"
      />
      <input
        name="notes"
        defaultValue={sku.notes ?? ""}
        placeholder="—"
        onBlur={handleBlur}
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-gray-300 focus:bg-white focus:outline-none"
      />

      <div className="flex items-center gap-1 justify-end">
        {saving && <span className="text-xs text-gray-400 mr-1">saving…</span>}
        <button
          type="submit"
          formAction={refreshSkuFromHubspot}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white"
          title={
            sku.lastHubspotRefreshAt
              ? `Refresh from HubSpot (last synced ${formatRelative(sku.lastHubspotRefreshAt)})`
              : "Refresh from HubSpot"
          }
        >
          ↻
        </button>
        <button
          type="submit"
          formAction={moveSku}
          name="direction"
          value="up"
          disabled={isFirst}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="submit"
          formAction={moveSku}
          name="direction"
          value="down"
          disabled={isLast}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          title="Move down"
        >
          ↓
        </button>
        <button
          type="submit"
          formAction={deleteSku}
          onClick={(e) => {
            if (!confirm(`Remove "${sku.productName}" from this quote?`))
              e.preventDefault();
          }}
          className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
          title="Remove SKU"
        >
          ×
        </button>
        {productUrl && (
          <a
            href={productUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-white"
            title="Open product in HubSpot"
          >
            ↗
          </a>
        )}
      </div>
    </form>
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
