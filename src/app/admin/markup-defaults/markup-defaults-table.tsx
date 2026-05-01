"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteMarkupDefault,
  upsertMarkupDefault,
  type MarkupDefaultRow,
} from "@/app/actions/markup-defaults";
import { validatePercentDecimal } from "@/lib/percent-validation";

const DEBOUNCE_MS = 500;

function decimalToPctDisplay(d: string): string {
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(4)).toString();
}

export function MarkupDefaultsTable({
  rows,
  referenceCounts,
}: {
  rows: MarkupDefaultRow[];
  referenceCounts: Record<string, number>;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2 text-right">Default markup</th>
            <th className="px-3 py-2">Used by</th>
            <th className="px-3 py-2">Updated</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                No categories yet. Add one below.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <ExistingRow
                key={r.category}
                row={r}
                referenceCount={referenceCounts[r.category] ?? 0}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ExistingRow({
  row,
  referenceCount,
}: {
  row: MarkupDefaultRow;
  referenceCount: number;
}) {
  const [pct, setPct] = useState(decimalToPctDisplay(row.defaultMarkupPct));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function fireSave(value: string) {
    const decimal = value === "" ? null : Number(value) / 100;
    if (decimal === null) {
      setError("Markup % is required.");
      return;
    }
    const v = validatePercentDecimal(decimal, "markup");
    if (!v.valid) {
      setError(v.message);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("category", row.category);
    fd.set("defaultMarkupPct", value);
    startTransition(async () => {
      const r = await upsertMarkupDefault(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  function handleChange(value: string) {
    setPct(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(value), DEBOUNCE_MS);
  }

  function handleDelete() {
    // Modal copy per Edward's spec: warn-with-count, don't block.
    // Existing rows keep their saved markup_pct; only the dropdown
    // loses the entry until re-created.
    const message =
      referenceCount > 0
        ? `Delete category "${row.category}"?\n\n` +
          `${referenceCount} existing input row${referenceCount === 1 ? "" : "s"} use${referenceCount === 1 ? "s" : ""} this category and will be unaffected — they keep their saved markup. New rows of this category will have no default markup until you re-create it.`
        : `Delete category "${row.category}"?\n\nNo existing input rows reference this category.`;
    if (!confirm(message)) return;
    const fd = new FormData();
    fd.set("category", row.category);
    startDelete(async () => {
      const r = await deleteMarkupDefault(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-900">{row.category}</td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={pct}
            onChange={(e) => handleChange(e.target.value)}
            className="w-24 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm focus:border-slate-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">%</span>
        </div>
        {error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {referenceCount === 0 ? (
          <span className="text-slate-400">no references</span>
        ) : (
          <span>
            {referenceCount} packaging row{referenceCount === 1 ? "" : "s"}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {row.updatedAt.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right">
        {pending && <span className="mr-2 text-xs text-slate-400">saving…</span>}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

export function AddCategoryForm() {
  const [category, setCategory] = useState("");
  const [pct, setPct] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (category.trim() === "") {
      setError("Category name is required.");
      return;
    }
    if (pct === "") {
      setError("Markup % is required.");
      return;
    }
    const decimal = Number(pct) / 100;
    const v = validatePercentDecimal(decimal, "markup");
    if (!v.valid) {
      setError(v.message);
      return;
    }
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await upsertMarkupDefault(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        setSuccess(`Added "${r.data.category}".`);
        setCategory("");
        setPct("");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-slate-300 bg-white p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-900">
        Add new category
      </h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="text"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g., Primary Packaging"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            name="defaultMarkupPct"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            placeholder="30"
            className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm focus:border-slate-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">%</span>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {success && <p className="mt-2 text-xs text-green-700">{success}</p>}
    </form>
  );
}
