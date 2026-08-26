// Deal-order readiness — PURE RULES.
//
// Free of `server-only`, the database and the network, so "may this quote's
// deal still produce a Sales Order?" is testable without either.
// `deal-order-readiness.ts` gathers the facts and imports its decision from
// here. Same split as create-reconciliation{,-rules}.ts and
// attempt-lifecycle{,-rules}.ts.
//
// WHAT IT DECIDES — and what it deliberately does not.
//
// It PREDICTS a refusal. It does not cause one, cannot authorise a send, and
// weakens no guard. `_dps_ue_prevent_dupplicated_so.js` (NetSuite) refuses the
// second CREATE and `decideReconciliation`'s ownership veto refuses to adopt a
// sibling's order; both stay exactly as they are. See
// `docs/validation/cert-303-push-blocker-duplicate-deal.md` for the governed
// rule this predicts, and `deal-order-readiness.ts` for why it exists.
//
// THREE PROVIDER OUTCOMES, NEVER TWO. `not_consulted`, `answered` and `failed`
// are distinct inputs. Folding `failed` into "answered with nothing" is the
// error Pattern 60 is about: a read failure would then read as positive
// evidence of absence, and this surface would claim a readiness it never
// established.

/** A sibling Nexus quote on the same deal that already holds an order. */
export interface SiblingOrder {
  salesOrderInternalId: string;
  salesOrderTranid: string | null;
  quoteNumber: string | null;
  scenarioLabel: string | null;
}

/** What the provider said, if it was asked at all. */
export type ProviderLookup =
  | { kind: "not_consulted" }
  | {
      kind: "answered";
      /** The first Sales Order carrying the deal id, or null for none. */
      first: { internalId: string; tranid: string | null } | null;
    }
  | { kind: "failed"; reason: string };

export interface DealOrderFacts {
  /** This quote's own Sales Order, when it already has one. */
  ownSalesOrderId: string | null;
  hubspotDealId: string | null;
  sibling: SiblingOrder | null;
  provider: ProviderLookup;
}

export type DealOrderBlocker = {
  kind: "deal_already_ordered";
  hubspotDealId: string;
  salesOrderInternalId: string;
  salesOrderTranid: string | null;
  /** Set only when a Nexus quote claims the order. */
  siblingQuoteNumber: string | null;
  siblingScenarioLabel: string | null;
  remediation: string;
};

export type DealOrderReadiness = {
  /** `unknown` when NetSuite could not be reached — never conflated with `ok`. */
  status: "ok" | "blocked" | "unknown";
  blocker: DealOrderBlocker | null;
  /** Populated only when status is `unknown`. */
  unknownReason: string | null;
};

const OK: DealOrderReadiness = {
  status: "ok",
  blocker: null,
  unknownReason: null,
};

/**
 * The operator-facing remedy.
 *
 * Names the governed action, not the internal one. The send-time refusal says
 * "manual reconciliation required", which describes no step an operator can
 * take in this product — that phrasing is what made Run 1's W9 a dead end
 * rather than a redirection.
 */
export function dealOrderRemediation(args: {
  salesOrderTranid: string | null;
  siblingQuoteNumber: string | null;
}): string {
  const order = args.salesOrderTranid
    ? `Sales Order ${args.salesOrderTranid}`
    : "a Sales Order";
  const from = args.siblingQuoteNumber ? ` from ${args.siblingQuoteNumber}` : "";
  return (
    `This deal already has ${order}${from}. One HubSpot deal produces at most one ` +
    `Sales Order, so this scenario cannot create its own. A second order belongs ` +
    `on a second deal — create one in HubSpot and import it as a new project.`
  );
}

export function decideDealOrderReadiness(
  facts: DealOrderFacts,
): DealOrderReadiness {
  // This quote IS the deal's order. A re-send resumes rather than duplicates,
  // and blocking it would refuse the recovery path the retry logic depends on.
  if (facts.ownSalesOrderId) return OK;

  const dealId = facts.hubspotDealId;
  if (!dealId) return OK;

  // Source 1 · Nexus. Free, certain, and sufficient on its own — no provider
  // call can contradict a sibling that demonstrably holds the order.
  if (facts.sibling) {
    return {
      status: "blocked",
      blocker: {
        kind: "deal_already_ordered",
        hubspotDealId: dealId,
        salesOrderInternalId: facts.sibling.salesOrderInternalId,
        salesOrderTranid: facts.sibling.salesOrderTranid,
        siblingQuoteNumber: facts.sibling.quoteNumber,
        siblingScenarioLabel: facts.sibling.scenarioLabel,
        remediation: dealOrderRemediation({
          salesOrderTranid: facts.sibling.salesOrderTranid,
          siblingQuoteNumber: facts.sibling.quoteNumber,
        }),
      },
      unknownReason: null,
    };
  }

  // Source 2 · the provider, which is the authority. Nexus's silence is NOT
  // evidence: the HubSpot workflow `NETSUITE: Auto create NetSuite sales order
  // from won deal` creates orders Nexus never sees, and they consume the deal
  // exactly as ours do.
  switch (facts.provider.kind) {
    case "failed":
      return {
        status: "unknown",
        blocker: null,
        unknownReason: facts.provider.reason,
      };
    case "not_consulted":
      // Nothing was asked, so nothing was established. Only reachable when a
      // caller deliberately skips the network; say so rather than implying the
      // provider agreed.
      return {
        status: "unknown",
        blocker: null,
        unknownReason: "NetSuite was not consulted.",
      };
    case "answered": {
      const first = facts.provider.first;
      if (!first) return OK;
      return {
        status: "blocked",
        blocker: {
          kind: "deal_already_ordered",
          hubspotDealId: dealId,
          salesOrderInternalId: first.internalId,
          salesOrderTranid: first.tranid,
          // No Nexus quote claims it — which is exactly what makes it worth
          // naming, because the operator has nowhere else to learn it.
          siblingQuoteNumber: null,
          siblingScenarioLabel: null,
          remediation: dealOrderRemediation({
            salesOrderTranid: first.tranid,
            siblingQuoteNumber: null,
          }),
        },
        unknownReason: null,
      };
    }
  }
}
