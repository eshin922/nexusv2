import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assemblies,
  assemblyProductionInputs,
  quoteChargeInstances,
  quoteChargeRecovery,
  quoteLeaves,
} from "@/db/schema";
import { ActionGuardError, ERR } from "@/lib/action-result";
import { OTC_COLUMN_TO_CHARGE, type RecoveryChargeKey, type RecoveryMode } from "./registry";
import { refusalFor } from "./resolve";

/**
 * Everything policy needs to know about a quote before it can accept an
 * election, loaded once.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────
 *
 * Both the evaluator and the writer must apply the SAME refusals. They cannot
 * share the helpers by exporting them from either action file, because a
 * `"use server"` module may only export async server actions — exporting a
 * loader from one would publish it as an endpoint.
 *
 * The alternative was a second copy of the policy load, and a second copy is a
 * second authority: the first time they diverged, an election would evaluate
 * cleanly and then be refused at save time, or worse, the reverse.
 */
export type ElectionContext = {
  /** Every distinct `allocate_service_fees_to_cost` in the quote. */
  allocationStates: boolean[];
  /** Charges with any non-zero contribution owned by a Direct Service leaf. */
  directServiceKeys: Set<RecoveryChargeKey>;
  /**
   * What is currently STORED, so policy can be applied to the change alone.
   *
   * Loaded here rather than in either action because both must diff against
   * the same source — and neither can import the other's loader, since a
   * `"use server"` module may only export async server actions.
   */
  /**
   * Prior state, KEYED AT THE GRAIN THE CHARGE IS ELECTED AT.
   *
   * A component charge is keyed by `charge_instance_id`; a legacy production
   * column by `charge_key`, for which the type is the identity.
   *
   * The two cannot share a key space by accident: an instance id is a uuid and
   * a charge key is a short enum name, so a collision is not reachable. Use
   * `storedKeyFor` rather than indexing directly, so the evaluator and the
   * writer cannot drift on how the key is formed — the divergence this map
   * exists to prevent is precisely "evaluated cleanly, refused at save".
   */
  stored: Map<string, string>;
};

export async function loadElectionContext(quoteId: string): Promise<ElectionContext> {
  const assemblyIds = (
    await db.select({ id: assemblies.id }).from(assemblies).where(eq(assemblies.quoteId, quoteId))
  ).map((r) => r.id);
  const leafIds = (
    await db.select({ id: quoteLeaves.id }).from(quoteLeaves).where(eq(quoteLeaves.quoteId, quoteId))
  ).map((r) => r.id);

  const allocRows = [
    ...(assemblyIds.length
      ? await db
          .select({ v: assemblyProductionInputs.allocateServiceFeesToCost })
          .from(assemblyProductionInputs)
          .where(inArray(assemblyProductionInputs.assemblyId, assemblyIds))
      : []),
    ...(leafIds.length
      ? await db
          .select({ v: assemblyProductionInputs.allocateServiceFeesToCost })
          .from(assemblyProductionInputs)
          .where(inArray(assemblyProductionInputs.quoteLeafId, leafIds))
      : []),
  ];
  const allocationStates = [...new Set(allocRows.map((r) => r.v ?? false))];

  const directServiceKeys = new Set<RecoveryChargeKey>();
  if (leafIds.length > 0) {
    const rows = await db
      .select()
      .from(assemblyProductionInputs)
      .where(
        and(
          isNotNull(assemblyProductionInputs.quoteLeafId),
          inArray(assemblyProductionInputs.quoteLeafId, leafIds),
        ),
      );
    for (const row of rows) {
      for (const [column, chargeKey] of Object.entries(OTC_COLUMN_TO_CHARGE) as Array<
        [string, RecoveryChargeKey]
      >) {
        const raw = (row as Record<string, unknown>)[column];
        if (raw === null || raw === undefined) continue;
        // A $0 column is not a contribution. Refusing a placement over money
        // that does not exist would deny a legitimate election.
        if (Math.abs(Number(raw)) > 0) directServiceKeys.add(chargeKey);
      }
    }
  }

  const storedRows = await db
    .select({
      chargeKey: quoteChargeRecovery.chargeKey,
      chargeInstanceId: quoteChargeRecovery.chargeInstanceId,
      mode: quoteChargeRecovery.mode,
      ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
    })
    .from(quoteChargeRecovery)
    .innerJoin(
      quoteChargeInstances,
      eq(quoteChargeInstances.id, quoteChargeRecovery.chargeInstanceId),
    )
    .where(eq(quoteChargeRecovery.quoteId, quoteId));

  return {
    allocationStates: allocationStates.length ? allocationStates : [false],
    directServiceKeys,
    stored: new Map(
      storedRows.map(
        (r) =>
          [
            // `owner_quote_leaf_id IS NOT NULL` is the causal test — the same
            // one the costing loader, the election loader and the writer use.
            // A legacy election's instance is a synthesised `'@quote'` row
            // standing in for a column, and keying by it would make prior state
            // unfindable for every legacy charge.
            storedKeyFor({
              chargeKey: r.chargeKey,
              chargeInstanceId:
                r.ownerQuoteLeafId !== null && r.chargeInstanceId
                  ? r.chargeInstanceId
                  : undefined,
            }),
            r.mode,
          ] as const,
      ),
    ),
  };
}

/**
 * The one place a `stored` key is formed.
 *
 * Both the evaluator and the writer call this, so "did this change?" has ONE
 * answer. Two implementations would be two answers, and the first divergence
 * would evaluate an election cleanly and refuse it at save time — which is the
 * failure this whole context exists to prevent.
 */
export function storedKeyFor(e: {
  chargeKey: string;
  chargeInstanceId?: string;
}): string {
  return e.chargeInstanceId ?? e.chargeKey;
}

/**
 * Refuse an election policy denies, in the boundary's own words.
 *
 * Applied by the evaluator AND the writer. The evaluator matters most for the
 * operator: with evaluate-first they would otherwise see a governed result and
 * then a save failure moments later, which reads as the system changing its
 * mind rather than as a rule.
 */
export function assertElectionAllowed(
  chargeKey: RecoveryChargeKey,
  mode: RecoveryMode,
  ctx: ElectionContext,
): void {
  for (const perAssemblyAllocate of ctx.allocationStates) {
    const reason = refusalFor(chargeKey, mode, {
      perAssemblyAllocate,
      hasDirectServiceContribution: ctx.directServiceKeys.has(chargeKey),
    });
    if (reason) throw new ActionGuardError(ERR.VALIDATION, reason);
  }
}
