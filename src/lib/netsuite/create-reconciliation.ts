// Ambiguous-CREATE reconciliation — PROVIDER SIDE.
//
// Owns the query and the read-back. Every decision is imported from
// `create-reconciliation-rules.ts`, which is pure and separately tested.
//
// Design: docs/validation/netsuite-idempotency-probe-and-recovery-design.md

import { suiteQL } from "./client";
import { readSalesOrderLines } from "./item-groups";
import { toObservedLines, type ProviderLine } from "./rate-convergence";
import { normalizeStructure } from "./so-structure";
import {
  decideReconciliation,
  evaluateAdoptionCandidate,
  type AdoptionExpectation,
  type AdoptionVerdict,
  type CandidateSalesOrder,
  type ReconciliationDecision,
  type ReconciliationTrigger,
} from "./create-reconciliation-rules";

export type {
  CandidateSalesOrder,
  ReconciliationDecision,
  ReconciliationTrigger,
} from "./create-reconciliation-rules";

/**
 * Every Sales Order carrying this governed deal id.
 *
 * STATUS IS DELIBERATELY NOT FILTERED. The duplicate-deal UserEvent does not
 * exempt closed orders — SO2624 is `Closed` and still blocks — so a
 * reconciliation that filtered by status could report zero while the provider
 * refuses to create. The query must see exactly what the guard sees.
 */
export async function findSalesOrdersByDealId(
  hubspotDealId: string,
): Promise<CandidateSalesOrder[]> {
  const rows = (
    await suiteQL<{
      id: string;
      tranid: string | null;
      entity: string | null;
      custbody_dps_deal_id: string | null;
      foreigntotal: string | null;
    }>(
      `SELECT id, tranid, entity, custbody_dps_deal_id, foreigntotal
         FROM transaction
        WHERE type = 'SalesOrd' AND custbody_dps_deal_id = '${hubspotDealId.replace(/'/g, "''")}'`,
    )
  ).items;

  return rows.map((r) => ({
    internalId: String(r.id),
    tranid: r.tranid ?? null,
    // The query already constrains type; carried explicitly so the pure rule
    // asserts it rather than trusting the caller's WHERE clause.
    transactionType: "SalesOrd",
    entityId: r.entity == null ? null : String(r.entity),
    hubspotDealId:
      r.custbody_dps_deal_id == null ? null : String(r.custbody_dps_deal_id),
    total: r.foreigntotal == null ? null : Number(r.foreigntotal),
  }));
}

/**
 * Reconcile before issuing (or re-issuing) a CREATE.
 *
 * Returns `create` only when the provider positively shows no order for this
 * deal. Everything else is `adopt` or `fail_closed` — never a fallthrough to
 * CREATE, because the whole point is that an unknown outcome is not a safe one.
 *
 * The candidate's structure is read back and normalised through the same
 * `toObservedLines` → `normalizeStructure` path the convergence loop and the
 * final gate already use, so the request-vs-provider representation gap
 * (request sends Group lines; the provider expands Group → members → EndGroup)
 * is interpreted by one implementation rather than two.
 *
 * The read happens only in the single-candidate case, which is the only case
 * `decideReconciliation` verifies.
 */
/**
 * Sales Order ids already durably owned by a Nexus quote OTHER than `quoteId`.
 *
 * Read from Nexus's own durable state, never inferred from the provider: the
 * provider cannot tell which of a deal's scenarios an order belongs to, which
 * is precisely the gap that let a certification attempt adopt SO2707.
 *
 * Both sources are consulted because they can diverge: `netsuite_so_pushes`
 * holds attempts that never reached the quote row (including ones stuck
 * mid-lifecycle), while `quotes.netsuite_so_id` holds completed pushes.
 */
export async function loadForeignOwnedSalesOrderIds(
  quoteId: string,
): Promise<Set<string>> {
  const { db } = await import("@/db");
  const { netsuiteSoPushes, quotes } = await import("@/db/schema");
  const { and, isNotNull, ne } = await import("drizzle-orm");

  const [pushRows, quoteRows] = await Promise.all([
    db
      .select({ soId: netsuiteSoPushes.netsuiteSoId })
      .from(netsuiteSoPushes)
      .where(
        and(
          isNotNull(netsuiteSoPushes.netsuiteSoId),
          ne(netsuiteSoPushes.quoteId, quoteId),
        ),
      ),
    db
      .select({ soId: quotes.netsuiteSoId })
      .from(quotes)
      .where(and(isNotNull(quotes.netsuiteSoId), ne(quotes.id, quoteId))),
  ]);

  return new Set(
    [...pushRows, ...quoteRows]
      .map((r) => r.soId)
      .filter((id): id is string => Boolean(id))
      .map(String),
  );
}

export async function reconcileBeforeCreate(args: {
  trigger: ReconciliationTrigger;
  expect: AdoptionExpectation;
  /**
   * The quote making this attempt. Required to distinguish "an order for this
   * deal" from "this quote's order" — without it, a sibling scenario's
   * completed Sales Order is indistinguishable from this attempt's.
   */
  quoteId?: string;
  /** Injectable for tests; defaults to the live provider. */
  findByDealId?: (dealId: string) => Promise<CandidateSalesOrder[]>;
  readLines?: (soId: string) => Promise<ProviderLine[]>;
  /** Injectable for tests; defaults to Nexus's durable ownership record. */
  loadForeignOwned?: (quoteId: string) => Promise<Set<string>>;
}): Promise<ReconciliationDecision> {
  const find = args.findByDealId ?? findSalesOrdersByDealId;
  const read = args.readLines ?? readSalesOrderLines;
  const loadOwned = args.loadForeignOwned ?? loadForeignOwnedSalesOrderIds;

  const candidates = await find(args.expect.hubspotDealId);

  // Fail closed rather than silently skipping the veto: without a quote id
  // there is no way to tell this attempt's order from a sibling's, and the
  // permissive reading of that ambiguity is what caused the SO2707 incident.
  const foreignOwned = args.quoteId
    ? await loadOwned(args.quoteId)
    : new Set<string>();
  const isOwnedByAnotherQuote = args.quoteId
    ? (c: CandidateSalesOrder) => foreignOwned.has(String(c.internalId))
    : () => true;

  // Fails closed if it is ever reached without a read — an unverifiable
  // candidate must never be adopted by default.
  let verify: (c: CandidateSalesOrder) => AdoptionVerdict = () => ({
    adopt: false,
    failures: ["candidate structure was not read"],
  });

  if (candidates.length === 1) {
    const structure = normalizeStructure(
      toObservedLines(await read(candidates[0].internalId)),
    );
    verify = (c) =>
      evaluateAdoptionCandidate({ candidate: c, structure, expect: args.expect });
  }

  return decideReconciliation({
    trigger: args.trigger,
    candidates,
    verify,
    isOwnedByAnotherQuote,
  });
}
