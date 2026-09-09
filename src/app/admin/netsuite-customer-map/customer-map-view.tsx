"use client";

import { useRef, useState, useTransition } from "react";
import {
  beginSave,
  canChoose,
  closePanel,
  initialSession,
  noteSearchIssued,
  openPanel,
  receive,
  saveFailed,
  saveSucceeded,
  setQuery,
  visibleCandidates,
  type SaveTicket,
  type SearchOutcome,
  type SearchTicket,
  type SessionState,
} from "@/lib/admin/customer-search-session";

/**
 * The customer-mapping surface: every rule, no service imports.
 *
 * ── WHY THE SERVICES ARE PROPS ────────────────────────────────────────────
 *
 * The wrapper in `customer-map-table.tsx` supplies the real server actions and
 * `router.refresh`. This component takes them as arguments so it can be
 * MOUNTED in a test with doubles — which is the only thing that establishes
 * that the component invokes the session rules correctly.
 *
 * That distinction is not academic. An earlier version of `runSearch` minted
 * its ticket inside a `setSession` updater and read the variable back on the
 * next line. React does not run updaters synchronously, so the ticket was
 * still null, the handler returned early, and clicking Search issued NO
 * REQUEST AT ALL. Every pure-session test passed, because the rules were never
 * reached. Only mounting the component finds that class of defect.
 *
 * Counters that must be readable at the instant of a click therefore live in
 * refs, and tickets are minted from them BEFORE any state update is queued.
 */

export type CustomerMappingRowView = {
  hubspotCompanyId: string;
  hubspotCompanyName: string | null;
  netsuiteCustomerId: string | null;
  netsuiteCustomerDisplayName: string | null;
  verifiedAt: Date | null;
  latestDealName: string | null;
};

export type SearchService = (
  query: string,
) => Promise<
  | { ok: true; data: SearchOutcome }
  | { ok: false; error: { code: string; message: string } }
>;

export type SaveService = (input: {
  hubspotCompanyId: string;
  netsuiteCustomerId: string;
}) => Promise<
  | {
      ok: true;
      data: { created: boolean; displayName: string | null; terms: string | null };
    }
  | { ok: false; error: { code: string; message: string } }
>;

export function CustomerMapView({
  rows,
  search,
  save,
  refresh,
}: {
  rows: CustomerMappingRowView[];
  search: SearchService;
  save: SaveService;
  refresh: () => void;
}) {
  const [session, setSession] = useState<SessionState>(initialSession);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingSearch, startSearch] = useTransition();
  const [, startSave] = useTransition();

  // Authoritative at click time. State mirrors these; it does not define them.
  const epochRef = useRef(0);
  const seqRef = useRef(0);

  function open(row: CustomerMappingRowView) {
    setNotice(null);
    const epoch = ++epochRef.current;
    setSession((s) =>
      openPanel(s, row.hubspotCompanyId, row.hubspotCompanyName ?? "", epoch),
    );
  }

  function close() {
    const epoch = ++epochRef.current;
    setSession((s) => closePanel(s, epoch));
  }

  function runSearch() {
    const companyId = session.openCompanyId;
    if (!companyId) return;
    // Minted here, from refs and the current render's query. Nothing about
    // this depends on when React chooses to run an updater.
    const ticket: SearchTicket = {
      epoch: epochRef.current,
      seq: ++seqRef.current,
      companyId,
      query: session.query,
    };
    setSession((s) => noteSearchIssued(s, ticket));

    startSearch(async () => {
      const res = await search(ticket.query);
      const outcome: SearchOutcome = res.ok
        ? res.data
        : { state: "unavailable", detail: res.error.message };
      setSession((s) => receive(s, ticket, outcome));
    });
  }

  function choose(companyId: string, netsuiteCustomerId: string) {
    if (!canChoose(session, companyId, netsuiteCustomerId)) return;
    const ticket: SaveTicket = {
      epoch: epochRef.current,
      companyId,
      netsuiteCustomerId,
    };
    setSession((s) => beginSave(s, ticket));

    startSave(async () => {
      const res = await save({
        hubspotCompanyId: companyId,
        netsuiteCustomerId,
      });
      if (!res.ok) {
        // Stays open, on the panel that asked. The admin reads why and retries.
        setSession((s) => saveFailed(s, ticket, res.error.message));
        return;
      }
      // No epoch bump here. It would run unconditionally while the acceptance
      // inside `saveSucceeded` does not, so a stale success would advance the
      // ref past the panel the admin is actually using -- silently killing its
      // searches and saves, because every ticket it then minted could no
      // longer match `panelEpoch`.
      setSession((s) => saveSucceeded(s, ticket));
      // Names the company, because by now the admin may be looking at another.
      const company =
        rows.find((r) => r.hubspotCompanyId === companyId)?.hubspotCompanyName ??
        companyId;
      setNotice(
        `${company} mapped to ${res.data.displayName ?? netsuiteCustomerId}. Governed payment terms: ${
          res.data.terms ?? "none set on the customer"
        }.`,
      );
      refresh();
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
                  data-testid={`open-${row.hubspotCompanyId}`}
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
              data-testid="customer-search-input"
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
              data-testid="customer-search-run"
              onClick={runSearch}
              // NOT disabled while a search is in flight. The sequence rule
              // exists so a second search can safely supersede the first, and
              // disabling here would leave Enter -- which does not check the
              // button -- as the only way to correct a query mid-search. The
              // label reports activity; the control stays usable.
              aria-busy={pendingSearch}
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
            >
              {pendingSearch ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              data-testid="customer-search-cancel"
              onClick={close}
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
            <p data-testid="customer-search-empty" className="mt-3 text-sm text-slate-700">
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
                    data-customer={c.netsuiteCustomerId}
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
                      data-testid={`choose-${c.netsuiteCustomerId}`}
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

      {notice && (
        <p data-testid="customer-map-notice" className="mt-4 text-sm text-slate-700">
          {notice}
        </p>
      )}
    </div>
  );
}
