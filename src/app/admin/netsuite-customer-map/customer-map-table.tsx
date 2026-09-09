"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveCustomerMapping,
  searchNetsuiteCustomersForMapping,
  type CustomerMappingRow,
} from "@/app/actions/netsuite-customer-map";
import {
  beginSave,
  canChoose,
  closePanel,
  initialSession,
  issueSearch,
  openPanel,
  receive,
  saveFailed,
  saveSucceeded,
  setQuery,
  visibleCandidates,
  type SessionState,
} from "@/lib/admin/customer-search-session";

/**
 * Map a HubSpot company to its verified NetSuite customer.
 *
 * The panel is a thin binding over `customer-search-session`, which holds
 * every rule worth proving:
 *
 *  · a response is admitted only if its company and sequence still hold, so
 *    switching companies mid-search cannot leave one company's candidates
 *    under another company's heading;
 *  · a candidate can only be chosen from the open company's own search;
 *  · a failed save keeps the panel open with the reason inside it, so the
 *    admin can read it and retry rather than clicking into silence.
 *
 * Those live in a pure module because a race that exists only inside a
 * component is a race nothing can test.
 *
 * ── AMBIGUITY IS SHOWN, NOT RESOLVED ──────────────────────────────────────
 *
 * A name search matches several customers often enough: parents and
 * subsidiaries, an old record beside its replacement, an inactive duplicate.
 * All of them are listed with entity id and active state, and the choice is
 * explicit — including when only one matches, because "one row came back" is a
 * fact about a search string and not evidence of identity.
 */
export function CustomerMapTable({ rows }: { rows: CustomerMappingRow[] }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>(initialSession);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSearch, startSearch] = useTransition();
  const [, startSave] = useTransition();

  function open(row: CustomerMappingRow) {
    setNotice(null);
    setSession((s) => openPanel(s, row.hubspotCompanyId, row.hubspotCompanyName ?? ""));
  }

  function runSearch() {
    // The ticket is minted from the CURRENT state and compared against the
    // state at return. Anything that happened in between — a second search, a
    // different company, a closed panel — invalidates it.
    let ticket: ReturnType<typeof issueSearch>["ticket"] | null = null;
    setSession((s) => {
      const next = issueSearch(s);
      ticket = next.ticket;
      return next.state;
    });

    startSearch(async () => {
      const issued = ticket;
      if (!issued) return;
      const res = await searchNetsuiteCustomersForMapping(issued.query);
      const outcome = res.ok
        ? res.data
        : ({ state: "unavailable", detail: res.error.message } as const);
      setSession((s) => receive(s, issued, outcome));
    });
  }

  function choose(companyId: string, netsuiteCustomerId: string) {
    if (!canChoose(session, companyId, netsuiteCustomerId)) return;
    setSession(beginSave);
    startSave(async () => {
      const res = await saveCustomerMapping({
        hubspotCompanyId: companyId,
        netsuiteCustomerId,
      });
      if (!res.ok) {
        // Stays open. The admin reads why, and clicks again.
        setSession((s) => saveFailed(s, res.error.message));
        return;
      }
      setNotice(
        `Mapped to ${res.data.displayName ?? netsuiteCustomerId}. Governed payment terms: ${
          res.data.terms ?? "none set on the customer"
        }.`,
      );
      setSession(saveSucceeded);
      router.refresh();
    });
  }

  const outcome = visibleCandidates(session);
  const candidates = outcome?.state === "ok" ? outcome.candidates : [];
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

      {session.openCompanyId && (
        <div
          className="mt-6 rounded border border-slate-300 p-4"
          data-testid="customer-map-panel"
          data-company={session.openCompanyId}
        >
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
              value={session.query}
              onChange={(e) => {
                const v = e.target.value;
                setSession((s) => setQuery(s, v));
              }}
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
              onClick={() => setSession(closePanel)}
              className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700"
            >
              Cancel
            </button>
          </div>

          {session.panelError && (
            <p
              role="alert"
              data-testid="customer-map-save-error"
              className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {session.panelError}
            </p>
          )}

          {outcome?.state === "ok" && candidates.length === 0 && (
            <p className="mt-3 text-sm text-slate-700">
              The search ran and matched nothing in NetSuite.
            </p>
          )}
          {outcome?.state === "unavailable" && (
            <p
              data-testid="customer-search-unavailable"
              className="mt-3 text-sm text-amber-900"
            >
              NetSuite could not be searched: {outcome.detail}. This does not
              mean the customer is absent — try again shortly.
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
                      disabled={session.saving}
                      onClick={() =>
                        choose(session.openCompanyId!, c.netsuiteCustomerId)
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {session.saving ? "Saving…" : "Use this customer"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {notice && !session.openCompanyId && (
        <p className="mt-4 text-sm text-slate-700">{notice}</p>
      )}
    </div>
  );
}
