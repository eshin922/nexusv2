"use server";

import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { chargePolicy, type RecoveryChargeKey, type RecoveryMode } from "@/lib/commercial-recovery/registry";
import type { ProposedElections } from "@/app/actions/costing";
import {
  assertElectionAllowed,
  loadElectionContext,
} from "@/lib/commercial-recovery/election-context";
import type { AuthoritativeProjection } from "@/components/quote/authoritative-projection";

/**
 * What a candidate election WOULD do — evaluated by the governed engine, and
 * written nowhere.
 *
 * ── WHY THIS IS SEPARATE FROM THE WRITER ────────────────────────────────
 *
 * The election used to be persisted first and evaluated second, so the operator
 * waited on a database round trip before the surface could tell them anything.
 * Measured on production: 1994-4041ms from click to any visible change, and for
 * those seconds the control looked like it had done nothing. It was reported as
 * broken, repeatedly, and every answer of the form "the write persisted" was
 * answering a question nobody had asked.
 *
 * Nothing about that ordering was load-bearing. `QuoteCostingInput.chargeElections`
 * is an INPUT — the engine takes elections as data and does not fetch them —
 * which is what `measureRecoveryImpact` has always relied on. This exposes the
 * same substitution to a read.
 *
 * ── IT IS THE RESOLVER, NOT A LIGHTER PARALLEL ANSWER ───────────────────
 *
 * The whole safety of evaluate-first rests here. A cheaper "what probably
 * changed" computation would be a second authority over customer economics, and
 * the first time it disagreed the operator would be reading a number the
 * customer's document does not carry. This runs the SAME `resolveCustomerView`
 * a page load runs, over the same construction, and returns the same shape the
 * writer returns — so the surface cannot tell an evaluated projection from a
 * persisted one, and does not have to.
 *
 * ── NO WRITES, AND NO AUDIT ─────────────────────────────────────────────
 *
 * Deliberately silent. An operator trying three placements to see which one
 * clears the floor has taken no commercial action, and writing an audit row per
 * exploratory click would bury the elections that were actually made under the
 * ones that were merely considered.
 */
export async function evaluateChargeRecovery(input: {
  quoteId: string;
  elections: { chargeKey: string; mode: string }[];
}): Promise<ActionResult<AuthoritativeProjection>> {
  return runAction(async () => {
    await ensureUser();

    const quoteId = input.quoteId.trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    // Validated through the registry, the same gate the writer uses. An
    // unknown key must not reach the engine as data merely because this path
    // does not persist — an evaluation the operator cannot act on is worse
    // than a refusal.
    const elections: ProposedElections = input.elections.map((e) => {
      const key = e.chargeKey as RecoveryChargeKey;
      chargePolicy(key); // throws on an unknown key
      return { chargeKey: key, mode: e.mode as RecoveryMode };
    });

    // POLICY FIRST, and here rather than only at save time. With evaluate-first
    // the operator would otherwise see a governed result and a save failure
    // moments later, which reads as the system changing its mind rather than as
    // a rule it was always going to apply.
    const ctx = await loadElectionContext(quoteId);
    for (const e of elections) assertElectionAllowed(e.chargeKey, e.mode, ctx);

    const resolved = await resolveCustomerView({ quoteId, proposedElections: elections });
    if (!resolved.ok) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "This quote could not be evaluated. Reload and try again.",
      );
    }

    return { view: resolved.view, recoveryRows: resolved.recoveryRows };
  });
}
