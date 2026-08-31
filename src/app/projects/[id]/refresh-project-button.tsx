"use client";

import { useState, useTransition } from "react";
import { refreshFromHubspot } from "@/app/actions/projects";

/**
 * Re-pull this project's HubSpot deal context.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * `refreshFromHubspot` has been the governed re-sync writer since V1 and had
 * no operator caller, because `/import` was believed to be the synchronization
 * entry point. It is not, for a project that already exists: `importDeal`
 * resolves the project by deal id and RETURNS BEFORE `syncDealById`, so a
 * second import refreshes nothing. The early return is what makes import safe
 * and also what makes it useless as a refresh.
 *
 * The consequence is not cosmetic. `hubspot_deals_cache.associated_company_id`
 * is the lineage `customer-terms.ts` reads to resolve a customer's governed
 * payment terms, and `markComplete` reads the same lineage to choose the Sales
 * Order's customer. A deal re-associated in HubSpot therefore stayed stale in
 * Nexus with no operator path to correct it, and the quote refused to send with
 * a reason the operator could not act on.
 *
 * ── WHAT IT CANNOT TOUCH ────────────────────────────────────────────────
 *
 * The action writes five HubSpot-derived project fields plus the refresh
 * timestamp, and upserts the deal's cache row. It references no quote,
 * assembly, cost, pricing or recovery table, so a refresh cannot alter
 * commercial state at any lifecycle stage. That is why it needs no draft guard:
 * it does not touch anything a freeze protects.
 *
 * ── NOT AUTOMATIC ───────────────────────────────────────────────────────
 *
 * Deliberately operator-initiated. A background refresh would move the client
 * name and deal stage under a quote someone is reading, and those feed the
 * customer document. The operator asks, and sees what changed.
 */
export function RefreshProjectButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { kind: "ok"; changed: number } | { kind: "error"; message: string } | null
  >(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId);
      try {
        const r = await refreshFromHubspot(fd);
        setResult({ kind: "ok", changed: r.fieldsChanged });
      } catch (e) {
        // The action throws on a deal HubSpot no longer has, and on transport
        // failure. Surfaced verbatim: "nothing happened" and "it failed" are
        // different facts and the operator is about to act on which it was.
        setResult({
          kind: "error",
          message: e instanceof Error ? e.message : "Refresh failed.",
        });
      }
    });
  }

  return (
    <span className="proj-refresh">
      <button
        type="button"
        className="proj-refresh-btn"
        onClick={run}
        disabled={pending}
        title="Re-pull deal name, client, stage and owner from HubSpot, and re-sync this deal's cached association."
      >
        {pending ? "Refreshing…" : "↻ Refresh from HubSpot"}
      </button>
      {result?.kind === "ok" ? (
        <span className="proj-refresh-ok" role="status">
          {/* Zero changed is a real, useful answer -- it says the refresh ran
              and HubSpot agrees with what Nexus already held. Reporting it as
              a bare success would leave the operator unable to tell that from
              a refresh that corrected something. */}
          {result.changed === 0
            ? " up to date"
            : ` updated ${result.changed} field${result.changed === 1 ? "" : "s"}`}
        </span>
      ) : null}
      {result?.kind === "error" ? (
        <span className="proj-refresh-err" role="alert">
          {" "}
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
