"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCustomerMapping,
  searchNetsuiteCustomersForMapping,
  type CustomerMappingRow,
} from "@/app/actions/netsuite-customer-map";
import type { NetsuiteCustomerCandidate } from "@/lib/integrations/netsuite-provider";

/**
 * Map a HubSpot company to its verified NetSuite customer.
 *
 * ── AMBIGUITY IS SHOWN, NOT RESOLVED ──────────────────────────────────────
 *
 * A name search can match several customers, and often does: parents and
 * subsidiaries, an old record beside its replacement, an inactive duplicate.
 * This surface lists all of them with entity id and active state and requires
 * an explicit choice. It never auto-selects a single match either — "exactly
 * one row came back" is a fact about a search string, not evidence of
 * identity, and the mapping it would write is the one that decides which
 * customer gets invoiced.
 *
 * ── A FAILED SEARCH IS NOT AN EMPTY ONE ───────────────────────────────────
 *
 * The two states are rendered differently and deliberately so. An admin shown
 * "no matches" during a NetSuite outage would reasonably conclude the customer
 * needs creating, and create a duplicate of one that already exists.
 */
export function CustomerMapTable({ rows }: { rows: CustomerMappingRow[] }) {
  const router = useRouter();
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<NetsuiteCustomerCandidate[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "ok" | "empty" | "unavailable"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingSearch, startSearch] = useTransition();
  const [pendingSave, startSave] = useTransition();

  function open(row: CustomerMappingRow) {
    setOpenCompany(row.hubspotCompanyId);
    setQuery(row.hubspotCompanyName ?? "");
    setCandidates([]);
    setSearchState("idle");
    setMessage(null);
  }

  function runSearch() {
    startSearch(async () => {
      setMessage(null);
      const res = await searchNetsuiteCustomersForMapping(query);
      if (!res.ok) {
        setSearchState("unavailable");
        setMessage(res.error.message);
        return;
      }
      if (res.data.state === "unavailable") {
        setCandidates([]);
        setSearchState("unavailable");
        setMessage(
          `NetSuite could not be searched: ${res.data.detail}. This does not mean the customer is absent — try again shortly.`,
        );
        return;
      }
      setCandidates(res.data.candidates);
      setSearchState(res.data.candidates.length === 0 ? "empty" : "ok");
    });
  }

  function choose(companyId: string, candidate: NetsuiteCustomerCandidate) {
    startSave(async () => {
      const res = await saveCustomerMapping({
        hubspotCompanyId: companyId,
        netsuiteCustomerId: candidate.netsuiteCustomerId,
      });
      if (!res.ok) {
        setMessage(res.error.message);
        return;
      }
      setMessage(
        `Mapped to ${res.data.displayName ?? candidate.netsuiteCustomerId}. Governed payment terms: ${
          res.data.terms ?? "none set on the customer"
        }.`,
      );
      setOpenCompany(null);
      router.refresh();
    });
  }

  const unmapped = rows.filter((r) => !r.netsuiteCustomerId).length;

  return (
    <div>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        {unmapped === 0
          ? "Every company Nexus has seen is mapped."
          : `${unmapped} of ${rows.length} companies have no verified NetSuite customer. Until one is mapped, that customer's quotes cannot be sent and print no payment terms.`}
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4">HubSpot company</th>
            <th className="py-2 pr-4">NetSuite customer</th>
            <th className="py-2 pr-4">Verified</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.hubspotCompanyId}
              className="border-b border-slate-100 align-top"
              data-testid="customer-map-row"
              data-mapped={row.netsuiteCustomerId ? "1" : "0"}
            >
              <td className="py-2 pr-4">
                <div className="font-medium text-slate-900">
                  {row.hubspotCompanyName ?? "—"}
                </div>
                <div className="text-xs text-slate-500">
                  {row.hubspotCompanyId}
                  {row.latestDealName ? ` · ${row.latestDealName}` : ""}
                </div>
              </td>
              <td className="py-2 pr-4">
                {row.netsuiteCustomerId ? (
                  <>
                    <div className="text-slate-900">
                      {row.netsuiteCustomerDisplayName ?? "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      internal id {row.netsuiteCustomerId}
                    </div>
                  </>
                ) : (
                  <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    Not mapped
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-xs text-slate-500">
                {row.verifiedAt
                  ? new Date(row.verifiedAt).toLocaleDateString()
                  : "—"}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => open(row)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {row.netsuiteCustomerId ? "Change" : "Map"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openCompany && (
        <div className="mt-6 rounded border border-slate-300 p-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Find the NetSuite customer
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">
            Search by company name or entity id, then choose the record you have
            confirmed is this customer. The chosen customer is read from NetSuite
            before the mapping is saved.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              className="w-80 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Customer name or entity id"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={pendingSearch}
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {pendingSearch ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              onClick={() => setOpenCompany(null)}
              className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700"
            >
              Cancel
            </button>
          </div>

          {searchState === "empty" && (
            <p className="mt-3 text-sm text-slate-700">
              The search ran and matched nothing in NetSuite.
            </p>
          )}
          {searchState === "unavailable" && (
            <p className="mt-3 text-sm text-amber-900">
              {message ?? "NetSuite could not be searched."}
            </p>
          )}

          {candidates.length > 0 && (
            <>
              {candidates.length > 1 && (
                <p className="mt-3 text-xs text-slate-600">
                  {candidates.length} customers match. Choose the one you have
                  confirmed — this decides which customer is invoiced.
                </p>
              )}
              <ul className="mt-2 divide-y divide-slate-100">
                {candidates.map((c) => (
                  <li
                    key={c.netsuiteCustomerId}
                    className="flex items-center justify-between py-2"
                    data-testid="customer-candidate"
                  >
                    <div>
                      <div className="text-sm text-slate-900">
                        {c.companyName ?? "—"}
                        {c.inactive && (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            inactive
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        entity {c.entityId ?? "—"} · internal id{" "}
                        {c.netsuiteCustomerId}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pendingSave}
                      onClick={() => choose(openCompany, c)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Use this customer
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {message && !openCompany && (
        <p className="mt-4 text-sm text-slate-700">{message}</p>
      )}
    </div>
  );
}
