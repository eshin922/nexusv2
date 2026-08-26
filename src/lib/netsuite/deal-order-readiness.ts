import "server-only";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { findSalesOrdersByDealId } from "./create-reconciliation";
import {
  decideDealOrderReadiness,
  type DealOrderReadiness,
  type ProviderLookup,
} from "./deal-order-readiness-rules";

export type {
  DealOrderBlocker,
  DealOrderReadiness,
} from "./deal-order-readiness-rules";

/**
 * Has this quote's HubSpot deal already produced a Sales Order — asked BEFORE
 * the operator commits, not by pressing Send.
 *
 * FACT-GATHERING ONLY. Every decision lives in
 * `deal-order-readiness-rules.ts`, which is free of the database and the
 * network and is where the properties are asserted.
 *
 * ── THE RULE THIS PREDICTS ──────────────────────────────────────────────
 *
 * `docs/validation/cert-303-push-blocker-duplicate-deal.md`, the disposition
 * of 2026-08-19:
 *
 *   One HubSpot deal may produce at most one Nexus-created NetSuite Sales
 *   Order. A deal may contain multiple quote scenarios. Once one scenario
 *   completes to NetSuite, a sibling scenario must not create or adopt another
 *   Sales Order on that same deal.
 *
 * Two independent guards enforce it and NEITHER is weakened here. The NetSuite
 * account's `_dps_ue_prevent_dupplicated_so.js` refuses the second CREATE, and
 * `decideReconciliation`'s ownership veto refuses to ADOPT a sibling quote's
 * order rather than rewriting a completed order's commercial terms — the
 * SO2707 incident. This module only asks the same question earlier.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────
 *
 * Run 1 W9 hit the refusal after Preview, Finalize, PDF and Acceptance had all
 * indicated normal progress. The operator learned that a governed rule forbade
 * the send by pressing the one button labelled irreversible, and the message
 * named an internal order id and "manual reconciliation required" — which
 * names no action they can take.
 *
 * The refusal is fully pre-computable, and it is the third member of a family
 * already repaired twice: `identity-readiness.ts` exists because
 * `product_sku_missing` and `product_item_unresolved` were BOTH discovered the
 * same way during #428 Part B. This is the third, and it is the one that
 * arrives latest in the lifecycle — which is why it is surfaced at Acceptance
 * as well, before the operator tells a customer yes.
 *
 * ── TWO SOURCES, DELIBERATELY ───────────────────────────────────────────
 *
 * The Nexus read alone would be incomplete: the provider refuses on ANY Sales
 * Order carrying the deal id, including orders Nexus never created — the
 * HubSpot workflow `NETSUITE: Auto create NetSuite sales order from won deal`
 * makes exactly those. A sibling quote holding `netsuite_so_id` is therefore
 * SUFFICIENT evidence, and its absence is not evidence of the provider's
 * agreement.
 *
 * Status is filtered at neither layer — a Closed order still blocks the guard
 * (SO2624), so a readiness check that filtered it out would report ready
 * against a send that cannot succeed. `findSalesOrdersByDealId` is unfiltered
 * for the same reason, in its own words.
 *
 * ── ADVISORY ────────────────────────────────────────────────────────────
 *
 * READINESS VISIBILITY ONLY. `markComplete` remains the authority. Being
 * advisory is what makes a read failure safe: a NetSuite outage degrades this
 * to `unknown`, never to a false "ready" and never to a false block.
 *
 * ── COST ────────────────────────────────────────────────────────────────
 *
 * One indexed DB read always; one SuiteQL call only when that read finds
 * nothing. A quote whose deal is already consumed by a sibling — the case this
 * exists for — costs no network at all.
 */
export async function loadDealOrderReadiness(
  quoteId: string,
): Promise<DealOrderReadiness> {
  const [row] = await db
    .select({
      ownSoId: quotes.netsuiteSoId,
      hubspotDealId: projects.hubspotDealId,
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (!row) {
    return { status: "ok", blocker: null, unknownReason: null };
  }

  // Short-circuit before any query the decision cannot use. Both cases decide
  // `ok` on facts already in hand, so gathering more would be work spent to
  // reach the same answer.
  if (row.ownSoId || !row.hubspotDealId) {
    return decideDealOrderReadiness({
      ownSalesOrderId: row.ownSoId,
      hubspotDealId: row.hubspotDealId,
      sibling: null,
      provider: { kind: "not_consulted" },
    });
  }

  const dealId = row.hubspotDealId;

  const [sibling] = await db
    .select({
      quoteNumber: quotes.quoteNumber,
      scenarioLabel: quotes.scenarioLabel,
      soId: quotes.netsuiteSoId,
      soTranid: quotes.netsuiteSoTranid,
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(
      and(
        eq(projects.hubspotDealId, dealId),
        ne(quotes.id, quoteId),
        isNotNull(quotes.netsuiteSoId),
      ),
    )
    .limit(1);

  if (sibling?.soId) {
    return decideDealOrderReadiness({
      ownSalesOrderId: null,
      hubspotDealId: dealId,
      sibling: {
        salesOrderInternalId: sibling.soId,
        salesOrderTranid: sibling.soTranid,
        quoteNumber: sibling.quoteNumber,
        scenarioLabel: sibling.scenarioLabel,
      },
      provider: { kind: "not_consulted" },
    });
  }

  let provider: ProviderLookup;
  try {
    const candidates = await findSalesOrdersByDealId(dealId);
    const first = candidates[0];
    provider = {
      kind: "answered",
      first: first
        ? { internalId: first.internalId, tranid: first.tranid }
        : null,
    };
  } catch (e) {
    // A read failure is NOT evidence of absence.
    provider = {
      kind: "failed",
      reason:
        e instanceof Error
          ? `NetSuite deal lookup failed: ${e.message}`
          : "NetSuite deal lookup failed.",
    };
  }

  return decideDealOrderReadiness({
    ownSalesOrderId: null,
    hubspotDealId: dealId,
    sibling: null,
    provider,
  });
}
