"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeCustomerSkuCode,
  saveCustomerSkuCode,
  searchSkuCustomers,
  type CustomerSkuCode,
  type SkuCustomerCandidate,
} from "@/app/actions/sku-registry";

/**
 * The SKU-code list, and the one control that adds to it.
 *
 * ── READINESS IS SHOWN, NOT IMPLIED ──────────────────────────────────────
 *
 * Every row says whether it can issue. A code with no counter looks identical
 * to a ready one in every other respect -- same customer, same mnemonic --
 * and an operator who could not tell them apart would report generation as
 * broken for a customer whose setup simply has not been done.
 *
 * ── A USED CODE HAS NO REMOVE CONTROL ────────────────────────────────────
 *
 * Absent rather than disabled, and the row says why. Once an identifier has
 * been issued the code is in HubSpot, in NetSuite and on quotes already sent;
 * there is no version of removing it that leaves those correct.
 */
export function SkuCodesTable({ rows }: { rows: CustomerSkuCode[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkuCustomerCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SkuCustomerCandidate | null>(null);
  const [code, setCode] = useState("");

  function runSearch() {
    setError(null);
    setResults(null);
    if (query.trim().length < 2) {
      setError("Type at least two characters to search.");
      return;
    }
    setSearching(true);
    void searchSkuCustomers(query).then((r) => {
      setSearching(false);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setResults(r.data);
    });
  }

  function save() {
    if (!picked) return;
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("hubspotCompanyId", picked.companyId);
    fd.set("customerLabel", picked.name);
    fd.set("token", code);
    start(async () => {
      const r = await saveCustomerSkuCode(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setNotice(
        `${r.data.token} saved for ${picked.name}. It is awaiting setup — its starting number still has to be established before it can issue a SKU.`,
      );
      setPicked(null);
      setCode("");
      setResults(null);
      setQuery("");
      router.refresh();
    });
  }

  function remove(token: string) {
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("token", token);
    start(async () => {
      const r = await removeCustomerSkuCode(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setNotice(`${r.data.token} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── add ──────────────────────────────────────────────────────── */}
      <div className="rounded border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Add a code</h2>
        <p className="mt-1 max-w-2xl text-xs text-slate-600">
          Find the customer, then type their mnemonic. Nothing is proposed for
          you: a code is a permanent namespace, and one derived from a name
          would make a typo permanent.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search HubSpot customers"
            data-testid="customer-query"
            placeholder="Customer name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            data-testid="customer-search"
            onClick={runSearch}
            disabled={searching}
            className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {results && results.length === 0 && (
          <p className="mt-2 text-xs text-slate-600" data-testid="customer-none">
            No company matches. The customer has to exist in HubSpot before a
            code can be attached to their record.
          </p>
        )}

        {results && results.length > 0 && (
          <ul className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto" data-testid="customer-results">
            {results.map((c) => (
              <li key={c.companyId}>
                <button
                  type="button"
                  onClick={() => setPicked(c)}
                  // A company that already has a code is shown rather than
                  // hidden: "why isn't my customer in the list" is a worse
                  // question than "they already have one, and it is ELE".
                  disabled={c.existingToken !== null}
                  data-testid={`customer-${c.companyId}`}
                  className={`w-full rounded px-2 py-1 text-left text-sm ${
                    picked?.companyId === c.companyId
                      ? "bg-slate-900 text-white"
                      : c.existingToken
                        ? "cursor-not-allowed text-slate-400"
                        : "hover:bg-slate-100"
                  }`}
                >
                  {c.name}
                  {c.existingToken && (
                    <span className="ml-2 font-mono text-xs">
                      already {c.existingToken}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-700">
              Code for <strong>{picked.name}</strong>:
            </span>
            <input
              type="text"
              aria-label="SKU code"
              data-testid="code-input"
              placeholder="MISTR"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={12}
              className="w-32 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase"
            />
            <button
              type="button"
              data-testid="code-save"
              onClick={save}
              disabled={pending || code.trim() === ""}
              className="rounded bg-slate-900 px-2.5 py-1 text-sm text-white disabled:bg-slate-300"
            >
              {pending ? "Saving…" : "Save code"}
            </button>
            <span className="text-xs text-slate-500">
              Saved as awaiting setup — it cannot issue a SKU yet.
            </span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-amber-900" data-testid="code-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-slate-700" data-testid="code-notice">
          {notice}
        </p>
      )}

      {/* ── the list ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">No customer has a SKU code yet.</p>
      ) : (
        <table className="w-full text-sm" data-testid="codes-table">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2">Customer</th>
              <th className="py-2">Code</th>
              <th className="py-2">Generation</th>
              <th className="py-2">Issued</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.token} className="border-b border-slate-100" data-testid={`code-row-${r.token}`}>
                <td className="py-2">{r.customerLabel}</td>
                <td className="py-2 font-mono">{r.token}</td>
                <td className="py-2">
                  {r.readiness === "ready" ? (
                    <span className="text-emerald-700" data-testid={`ready-${r.token}`}>
                      Ready · next {r.nextNumber}
                    </span>
                  ) : (
                    <span className="text-amber-800" data-testid={`awaiting-${r.token}`}>
                      Awaiting setup
                    </span>
                  )}
                </td>
                <td className="py-2 text-slate-600">{r.issuedCount}</td>
                <td className="py-2 text-right">
                  {r.issuedCount > 0 || r.readiness === "ready" ? (
                    <span className="text-xs text-slate-400" data-testid={`locked-${r.token}`}>
                      {r.issuedCount > 0
                        ? "in use — cannot be removed"
                        : "seeded — cannot be removed"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`remove-${r.token}`}
                      onClick={() => remove(r.token)}
                      disabled={pending}
                      className="text-xs text-slate-500 underline hover:text-slate-900"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
