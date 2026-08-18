"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveServiceItemMapping,
  verifyServiceItemMapping,
  type ServiceMappingRow,
} from "@/app/actions/netsuite-service-map";
import type { MappingVerdict } from "@/lib/netsuite/service-item-map";

/**
 * The four fixed Direct Service mappings.
 *
 * ── STATE IS THREE-VALUED, PLUS ONE ───────────────────────────────────────
 *
 * unmapped / mapped / stale, and `indeterminate` when a live check could not
 * reach NetSuite. The fourth is not a rendering nicety: showing "stale" for a
 * failed read would tell an admin their mapping is broken when nothing is
 * known to be wrong with it, and they would go and change something correct.
 */
function StateChip({
  row,
  verdict,
}: {
  row: ServiceMappingRow;
  verdict: MappingVerdict | null;
}) {
  const base =
    "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium";
  if (!row.netsuiteInternalId) {
    return (
      <span className={`${base} bg-amber-100 text-amber-900`}>Unmapped</span>
    );
  }
  if (!verdict) {
    // Stored state with no live check. Says LAST KNOWN rather than implying a
    // confirmation this render did not perform.
    return (
      <span className={`${base} bg-slate-100 text-slate-700`}>
        Mapped · last checked{" "}
        {row.resolvedAt ? new Date(row.resolvedAt).toLocaleDateString() : "—"}
      </span>
    );
  }
  switch (verdict.state) {
    case "usable":
      return (
        <span className={`${base} bg-emerald-100 text-emerald-900`}>
          Mapped
        </span>
      );
    case "gone":
      return (
        <span className={`${base} bg-red-100 text-red-900`}>
          Stale · item no longer exists
        </span>
      );
    case "inactive":
      return (
        <span className={`${base} bg-red-100 text-red-900`}>
          Stale · item inactive
        </span>
      );
    case "indeterminate":
      return (
        <span
          className={`${base} bg-slate-100 text-slate-700`}
          title={verdict.reason}
        >
          Could not check
        </span>
      );
  }
}

function Row({ row }: { row: ServiceMappingRow }) {
  const router = useRouter();
  // Per-control transitions, per Pattern 47(f): a Verify in flight must not
  // disable the Remap field beside it, and neither may disable another row's.
  const [savePending, startSave] = useTransition();
  const [verifyPending, startVerify] = useTransition();
  const [editing, setEditing] = useState(!row.netsuiteInternalId);
  const [code, setCode] = useState(row.netsuiteItemCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<MappingVerdict | null>(row.verdict);

  function save() {
    setError(null);
    setNote(null);
    const fd = new FormData();
    fd.set("serviceIdentity", row.serviceIdentity);
    fd.set("netsuiteItemCode", code);
    startSave(async () => {
      const r = await saveServiceItemMapping(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setEditing(false);
      // A save resolves, so the mapping is confirmed as of now.
      setVerdict({ state: "usable", itemCode: r.data.itemCode });
      setNote(`Mapped to ${r.data.itemCode} · internal ID ${r.data.internalId}.`);
      router.refresh();
    });
  }

  function verify() {
    setError(null);
    setNote(null);
    startVerify(async () => {
      const r = await verifyServiceItemMapping(row.serviceIdentity);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setVerdict(r.data.verdict);
      if (r.data.verdict.state === "indeterminate") {
        // Not an error state and not a stale state. The mapping is untouched.
        setNote(`NetSuite could not be reached. Nothing changed.`);
      }
      router.refresh();
    });
  }

  return (
    <tr className="border-b border-slate-200 align-top">
      <td className="py-3 pr-4 font-medium text-slate-900">{row.label}</td>
      <td className="py-3 pr-4">
        {editing ? (
          <input
            className="w-56 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            value={code}
            placeholder="NetSuite item code"
            /* Pattern 47(e): never `disabled={pending}` on an input — a
               disabled element drops focus mid-save. The button carries the
               in-flight state instead. */
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        ) : (
          <span className="font-mono text-sm text-slate-700">
            {row.netsuiteItemCode ?? "—"}
          </span>
        )}
      </td>
      <td className="py-3 pr-4 font-mono text-sm text-slate-500">
        {row.netsuiteInternalId ?? "—"}
      </td>
      <td className="py-3 pr-4">
        <StateChip row={row} verdict={verdict} />
        {note && <div className="mt-1 text-xs text-slate-600">{note}</div>}
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </td>
      <td className="py-3 text-right">
        {editing ? (
          <>
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              onClick={save}
              disabled={savePending || code.trim().length === 0}
              title={
                code.trim().length === 0
                  ? "Enter the NetSuite item code first"
                  : undefined
              }
            >
              {savePending ? "Resolving…" : "Save"}
            </button>
            {row.netsuiteInternalId && (
              <button
                type="button"
                className="ml-2 rounded px-3 py-1 text-sm text-slate-600"
                onClick={() => {
                  setEditing(false);
                  setCode(row.netsuiteItemCode ?? "");
                  setError(null);
                }}
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
              onClick={verify}
              disabled={verifyPending}
            >
              {verifyPending ? "Checking…" : "Verify"}
            </button>
            <button
              type="button"
              className="ml-2 rounded px-3 py-1 text-sm text-slate-600"
              onClick={() => setEditing(true)}
            >
              Remap
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export function ServiceItemMapTable({ rows }: { rows: ServiceMappingRow[] }) {
  return (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="pb-2 pr-4 font-medium">Nexus service</th>
          <th className="pb-2 pr-4 font-medium">NetSuite item code</th>
          <th className="pb-2 pr-4 font-medium">Internal ID</th>
          <th className="pb-2 pr-4 font-medium">State</th>
          <th className="pb-2 text-right font-medium">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.serviceIdentity} row={r} />
        ))}
      </tbody>
    </table>
  );
}
