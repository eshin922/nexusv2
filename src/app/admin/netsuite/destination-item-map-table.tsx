"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  saveDestinationMapping,
  type DestinationMappingRow,
} from "@/app/actions/netsuite-destination-map";

/**
 * BV-011 destination → NetSuite item.
 *
 * Every governed destination is listed, mapped or not. Showing only the mapped
 * ones would hide exactly the rows a blocked projection is about to name.
 *
 * The item type column is NOT editable and is not a preference: BV-011 governs
 * whether a destination is an Inventory or Non-inventory item, and an admin who
 * maps `OTC - Tooling` to a Non-inventory record has made an accounting error.
 * It is shown so that error is visible at the moment of mapping.
 */
export function DestinationItemMapTable({
  rows,
}: {
  rows: DestinationMappingRow[];
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function save(destination: string, itemCode: string) {
    // Pattern 47(f) — pending is keyed to the row that initiated it, so saving
    // one destination cannot disable the others.
    setPendingKey(destination);
    setErrors((e) => ({ ...e, [destination]: "" }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("destination", destination);
      fd.set("netsuiteItemCode", itemCode);
      const r = await saveDestinationMapping(fd);
      setPendingKey(null);
      if (!r.ok) {
        setErrors((e) => ({ ...e, [destination]: r.error.message }));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Destination</th>
            <th className="py-2 pr-4 font-medium">BV-011 item type</th>
            <th className="py-2 pr-4 font-medium">NetSuite item</th>
            <th className="py-2 pr-4 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DestinationRow
              key={row.destination}
              row={row}
              pending={pendingKey === row.destination}
              error={errors[row.destination] ?? ""}
              onSave={save}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DestinationRow({
  row,
  pending,
  error,
  onSave,
}: {
  row: DestinationMappingRow;
  pending: boolean;
  error: string;
  onSave: (destination: string, itemCode: string) => void;
}) {
  const [draft, setDraft] = useState(row.netsuiteItemCode ?? "");

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-3 pr-4">
        <div className="font-medium text-slate-900">{row.label}</div>
        <div className="font-mono text-xs text-slate-500">{row.destination}</div>
      </td>
      <td className="py-3 pr-4 text-slate-700">
        {row.governedItemType === "inventory" ? "Inventory" : "Non-inventory"}
      </td>
      <td className="py-3 pr-4">
        {row.perLine ? (
          <span className="text-slate-500">
            Chosen per line — no firm-wide item
          </span>
        ) : (
          <div className="flex items-start gap-2">
            <input
              className="w-48 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              value={draft}
              // Pattern 47(e) — `pending` never disables the INPUT. A disabled
              // input drops focus mid-save and the next keystroke goes nowhere.
              onChange={(e) => setDraft(e.target.value)}
              placeholder="NetSuite item code"
            />
            <button
              type="button"
              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              disabled={pending || draft.trim() === ""}
              title={
                draft.trim() === ""
                  ? "Enter a NetSuite item code first"
                  : pending
                    ? "Resolving this code against NetSuite…"
                    : undefined
              }
              onClick={() => onSave(row.destination, draft)}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        {error ? (
          <p className="mt-1 max-w-md text-xs text-red-700">{error}</p>
        ) : null}
      </td>
      <td className="py-3 pr-4">
        {row.perLine ? (
          <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            Per line
          </span>
        ) : row.netsuiteInternalId ? (
          <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            Mapped · id {row.netsuiteInternalId} · last checked{" "}
            {row.resolvedAt
              ? new Date(row.resolvedAt).toLocaleDateString()
              : "—"}
          </span>
        ) : (
          <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            Unmapped
          </span>
        )}
      </td>
    </tr>
  );
}
