// Ambiguous-CREATE reconciliation — PURE RULES.
//
// Free of `server-only`, the database and the network, so "may this attempt
// create an order?" and "is this provider order ours?" are testable without
// either. `create-reconciliation.ts` performs the provider query and imports
// its decisions from here. Same split as attempt-lifecycle{,-rules}.ts.
//
// WHY THIS EXISTS. `X-NetSuite-Idempotency-Key` is not honoured by the account
// (measured 2026-08-13: two identical CREATEs with one key produced SO2705 and
// SO2706). So a retry of an attempt whose CREATE outcome is unknown is a real
// duplicate-order vector, and the only remaining provider backstop — the
// duplicate-deal UserEvent — prevents the second ORDER while leaving the first
// one orphaned, because Nexus never learned its id.
//
// The rule this module enforces:
//
//   Once an external Sales Order MAY exist, the attempt must not enter a state
//   that permits a fresh CREATE until provider reconciliation has established
//   whether it does.
//
// Design: docs/validation/netsuite-idempotency-probe-and-recovery-design.md

import type { PlannedGroup } from "./grouping-plan";
import {
  matchGroupMembership,
  type NormalizedStructure,
} from "./so-structure";

/** A Sales Order observed at the provider, as a candidate for adoption. */
export interface CandidateSalesOrder {
  internalId: string;
  tranid: string | null;
  /** Provider transaction type. Anything but `SalesOrd` disqualifies. */
  transactionType: string | null;
  entityId: string | null;
  hubspotDealId: string | null;
  /** Present for a converged order; null/other pre-convergence. See below. */
  total: number | null;
}

export interface AdoptionExpectation {
  customerId: string;
  hubspotDealId: string;
  tierQty: number;
  plannedGroups: PlannedGroup[];
}

export type AdoptionVerdict =
  | { adopt: true }
  | { adopt: false; failures: string[] };

/**
 * Does this provider order correspond to the frozen attempt?
 *
 * ASSERTS IDENTITY AND STRUCTURE ONLY — deliberately NOT rates, and NOT the
 * order total.
 *
 * A response can be lost immediately after the bare grouped CREATE and before
 * any member-rate PATCH. At that moment the order legitimately carries
 * item-derived default rates and therefore a total that is NOT the accepted
 * commercial total. Requiring either here would refuse adoption in exactly the
 * case adoption exists to serve, and the refusal would strand the very order
 * that was created.
 *
 * Commercial correctness is not waived, only relocated: an adopted order enters
 * `awaiting_rates`, runs the existing convergence loop, and must still pass the
 * unweakened final gate (`evaluateSuccessGate`) before it can reach
 * `succeeded`. Adoption answers "is this the intended order?"; the final gate
 * answers "is it commercially correct?" — and an adopted-but-wrong order cannot
 * pass the second question.
 *
 * Structure comparison reuses `matchGroupMembership` rather than re-deriving
 * it, so the request-vs-provider representation gap (request sends Group lines;
 * the provider expands Group → members → EndGroup) is handled by the one
 * implementation already certified for it. Raw JSON equality is never used.
 */
export function evaluateAdoptionCandidate(args: {
  candidate: CandidateSalesOrder;
  structure: NormalizedStructure;
  expect: AdoptionExpectation;
}): AdoptionVerdict {
  const { candidate, structure, expect } = args;
  const failures: string[] = [];

  // A flat/itemized order offers no grouped structure to correlate against, so
  // the only evidence available is deal + customer + type. That is too thin to
  // authorise mutating an order, so adoption is refused rather than granted on
  // weak evidence. This is NOT a regression for the flat path: reconciliation
  // still runs, so the duplicate CREATE is still prevented — the outcome is
  // fail-closed with the order's id in hand, which is strictly better than
  // today's silent orphan. Grouped adoption is the certified path.
  if (expect.plannedGroups.length === 0) {
    return {
      adopt: false,
      failures: [
        "no planned groups — a flat order carries insufficient structural evidence for automatic adoption; manual reconciliation required",
      ],
    };
  }

  // 1 · transaction type
  if (candidate.transactionType !== "SalesOrd") {
    failures.push(
      `transaction type ${String(candidate.transactionType)} ≠ SalesOrd`,
    );
  }

  // 2 · governed deal identity — the field the UserEvent itself keys on
  if (String(candidate.hubspotDealId ?? "") !== String(expect.hubspotDealId)) {
    failures.push(
      `deal id ${String(candidate.hubspotDealId)} ≠ expected ${expect.hubspotDealId}`,
    );
  }

  // 3 · customer
  if (String(candidate.entityId ?? "") !== String(expect.customerId)) {
    failures.push(
      `customer ${String(candidate.entityId)} ≠ expected ${expect.customerId}`,
    );
  }

  // 4 · grouped-vs-flat shape
  if (structure.groups.length !== expect.plannedGroups.length) {
    failures.push(
      `group count ${structure.groups.length} ≠ planned ${expect.plannedGroups.length}`,
    );
  }
  if (structure.ungroupedMembers.length > 0) {
    failures.push(
      `${structure.ungroupedMembers.length} item line(s) outside any group`,
    );
  }

  // 5 · Item Group membership + quantities, per group, by item id within group
  const n = Math.min(structure.groups.length, expect.plannedGroups.length);
  for (let i = 0; i < n; i++) {
    const planned = expect.plannedGroups[i];
    const observed = structure.groups[i];
    // Group identity is asserted through MEMBERSHIP, not through the group
    // record's own internal id. `PlannedGroup` carries a composition hash and
    // external id, not a NetSuite item id — the id is resolved separately by
    // `findOrCreateItemGroup`. `evaluateSuccessGate` takes the same route, and
    // reusing it keeps one interpretation of grouped structure rather than two.
    for (const p of matchGroupMembership(planned, observed, expect.tierQty)) {
      failures.push(`${p.assemblySku}: ${p.problem}`);
    }
  }

  return failures.length === 0 ? { adopt: true } : { adopt: false, failures };
}

/** Why reconciliation was entered. Governs what ZERO candidates means. */
export type ReconciliationTrigger = "ambiguous_attempt" | "duplicate_deal";

export type ReconciliationDecision =
  | { action: "create" }
  | { action: "adopt"; candidate: CandidateSalesOrder }
  | { action: "fail_closed"; reason: string; failures: string[] };

/**
 * Decide what an ambiguous attempt may do, given what the provider holds.
 *
 * The ONLY difference between the two triggers is the meaning of zero
 * candidates:
 *
 *   ambiguous_attempt — the previous POST may never have landed. Zero orders is
 *                       positive evidence that it did not. CREATE may proceed.
 *   duplicate_deal    — the provider has just asserted an order EXISTS for this
 *                       deal. Zero orders contradicts that assertion, which
 *                       means the guard matched on something this query cannot
 *                       see. That is the clearest possible fail-closed, never a
 *                       licence to create.
 *
 * Adoption is never granted on count alone: a single candidate is a candidate,
 * and must still pass `verify`.
 */
export function decideReconciliation(args: {
  trigger: ReconciliationTrigger;
  candidates: CandidateSalesOrder[];
  verify: (c: CandidateSalesOrder) => AdoptionVerdict;
  /**
   * OWNERSHIP VETO. True when this NetSuite Sales Order id is already durably
   * associated with a DIFFERENT Nexus quote — another push row, another
   * quote's `netsuite_so_id`, or another accepted snapshot.
   *
   * WHY THIS IS SEPARATE FROM VERIFICATION. Candidates are found by
   * `custbody_dps_deal_id`, which identifies the HubSpot DEAL. A deal
   * legitimately carries many Nexus scenarios, so "one Sales Order carries this
   * deal id" does not mean "this attempt's Sales Order" — it may be a sibling
   * quote's completed order. Structural verification cannot separate them: a
   * sibling scenario on the same deal can look structurally plausible.
   *
   * Ownership is checked BEFORE verification and vetoes it, because adopting an
   * order that belongs to another quote leads to rate convergence rewriting a
   * completed order's commercial terms. That is the 2026-08-13 SO2707 incident.
   *
   * Optional so existing callers and tests keep their meaning; when absent, no
   * ownership claim is asserted and behaviour is unchanged.
   */
  isOwnedByAnotherQuote?: (c: CandidateSalesOrder) => boolean;
}): ReconciliationDecision {
  const { trigger, candidates, verify } = args;
  const ownedByAnother = args.isOwnedByAnotherQuote ?? (() => false);

  if (candidates.length === 0) {
    return trigger === "ambiguous_attempt"
      ? { action: "create" }
      : {
          action: "fail_closed",
          reason:
            "provider reported DUPLICATED DEAL but no Sales Order carries this deal id — contradiction; manual reconciliation required",
          failures: [],
        };
  }

  if (candidates.length > 1) {
    return {
      action: "fail_closed",
      reason: `${candidates.length} Sales Orders carry this deal id — manual reconciliation required`,
      failures: candidates.map(
        (c) => `${c.internalId}${c.tranid ? ` (${c.tranid})` : ""}`,
      ),
    };
  }

  const only = candidates[0];

  // Ownership first. A structurally plausible candidate that belongs to another
  // quote must never be adopted, and checking it before verification means no
  // verification outcome can override it.
  if (ownedByAnother(only)) {
    return {
      action: "fail_closed",
      reason:
        `Sales Order ${only.internalId}${only.tranid ? ` (${only.tranid})` : ""} is already owned by a ` +
        `different Nexus quote. Candidates are matched on HubSpot deal id, and one deal legitimately ` +
        `carries several scenarios — this order belongs to a sibling quote, not to this attempt. ` +
        `Adopting it would rewrite a completed order's commercial terms. Manual reconciliation required.`,
      failures: [`owned by another quote: ${only.internalId}`],
    };
  }

  const verdict = verify(only);
  if (verdict.adopt) return { action: "adopt", candidate: only };
  return {
    action: "fail_closed",
    reason: `the single Sales Order carrying this deal id could not be verified as this attempt's order — manual reconciliation required`,
    failures: verdict.failures,
  };
}
