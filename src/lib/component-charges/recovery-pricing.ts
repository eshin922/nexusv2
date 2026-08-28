/**
 * Does every ELECTED component charge carry the recovery pricing its treatment
 * requires?
 *
 * ── WHY THIS IS NOT PART OF READINESS ───────────────────────────────────
 *
 * `readiness.ts` answers a different question — "what does DPS pay?" — and its
 * three states are about COST. Costs renders them, and the send gate refuses on
 * them with the words "no cost entered". Folding a pricing dimension into
 * `complete` would silently change what that word means for every existing
 * caller, which is a redesign of a working state machine to carry a fact it was
 * never about. Separate question, separate diagnostic, same shape.
 *
 * ── WHAT IT FOUND ───────────────────────────────────────────────────────
 *
 * Measured on Production 2026-08-28. Two charges on one component, cost entered
 * at all four tiers, both elected `separate`, no recovery ask anywhere:
 *
 *   Recovery workspace : "not priced"          — correct, and BV-013-honest
 *   customer document  : "One-time fees $0.00" — INCORRECT
 *   Finalize           : enabled, data-state="ready" — INCORRECT
 *   sendQuote          : no refusal            — INCORRECT
 *
 * $2,700 of charges the operator elected to bill separately, stated to the
 * customer as zero, on a quote the surface called ready. Nothing refused
 * because nothing asked this question: the cost gate covers cost, the placement
 * gate covers placement, and `isUnbillablePlacement` is scoped to Direct
 * Services. Recovery pricing had no gate at all.
 *
 * ── WHY NULL IS NOT ZERO, HERE OF ALL PLACES ────────────────────────────
 *
 * The tempting repair is to coalesce a missing ask to 0 and let the arithmetic
 * proceed. That converts "nobody has priced this" into "we have decided to
 * recover nothing" — a real, different, governed decision that `absorbed`
 * already expresses. BV-013 holds: unknown is not zero, and the fix for an
 * unknown is to refuse, never to invent a number for it.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstances,
  quoteChargeInstanceTiers,
  quoteChargeRecovery,
  quoteTiers,
} from "@/db/schema";
import {
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import {
  describeMissingAsk,
  treatmentRequiresAsk,
  type ChargeRecoveryPricingGap,
} from "@/lib/component-charges/recovery-pricing-rule";

// Re-exported so every consumer has one import site for the diagnostic, whether
// it needs the rule, the sentence or the reader.
export { describeMissingAsk, treatmentRequiresAsk };
export type { ChargeRecoveryPricingGap };

/**
 * Every elected component charge that is missing recovery pricing.
 *
 * Returns ONLY the gaps. Unlike `readComponentChargeReadiness` — which returns
 * complete charges too because Costs renders a chip for each — every consumer of
 * this one is asking "is anything wrong?", and both of them are refusals.
 *
 * The tier set is the QUOTED tiers, not whatever rows happen to exist. A charge
 * priced at every tier it has a row for is complete only if those are all the
 * tiers the quote sells — the same measure `readiness` takes, for the same
 * reason.
 */
export async function readChargeRecoveryPricingGaps(
  quoteId: string,
): Promise<ChargeRecoveryPricingGap[]> {
  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, sortOrder: quoteTiers.sortOrder })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(quoteTiers.sortOrder, quoteTiers.label);

  const rows = await db
    .select({
      chargeInstanceId: quoteChargeInstances.id,
      chargeKey: quoteChargeInstances.chargeKey,
      ownLabel: quoteChargeInstances.label,
      quoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      mode: quoteChargeRecovery.mode,
      tierId: quoteChargeInstanceTiers.tierId,
      recoveryAsk: quoteChargeInstanceTiers.recoveryAsk,
    })
    .from(quoteChargeInstances)
    // LEFT on both. An elected charge with no tier rows at all is the worst
    // case of exactly this gap, and an inner join would drop it — reporting
    // nothing wrong about the charge with nothing entered.
    .leftJoin(
      quoteChargeRecovery,
      eq(quoteChargeRecovery.chargeInstanceId, quoteChargeInstances.id),
    )
    .leftJoin(
      quoteChargeInstanceTiers,
      eq(quoteChargeInstanceTiers.chargeInstanceId, quoteChargeInstances.id),
    )
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        // Component-owned only, matching the readiness scope. A legacy
        // `'@quote'` instance stands for a production column priced through the
        // production markup path; it has no per-tier ask by design.
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );

  const byInstance = new Map<
    string,
    {
      chargeKey: string;
      ownLabel: string | null;
      quoteLeafId: string;
      mode: string | null;
      /** Tiers carrying a NON-NULL ask. A row with a null ask is not priced. */
      asked: Set<string>;
    }
  >();
  for (const r of rows) {
    let e = byInstance.get(r.chargeInstanceId);
    if (!e) {
      e = {
        chargeKey: r.chargeKey,
        ownLabel: r.ownLabel,
        // Non-null by the WHERE above; the narrowing is for the compiler, which
        // cannot see a predicate expressed in SQL.
        quoteLeafId: r.quoteLeafId as string,
        mode: r.mode ?? null,
        asked: new Set<string>(),
      };
      byInstance.set(r.chargeInstanceId, e);
    }
    // A tier row EXISTING is not a tier being priced. `recovery_ask` is
    // nullable and defaults to null, so the presence of the row says only that
    // a cost was entered.
    if (r.tierId !== null && r.recoveryAsk !== null) e.asked.add(r.tierId);
  }

  const gaps: ChargeRecoveryPricingGap[] = [];
  for (const [chargeInstanceId, e] of byInstance) {
    if (!treatmentRequiresAsk(e.mode)) continue;
    const missing = tiers.filter((t) => !e.asked.has(t.id));
    if (missing.length === 0) continue;
    gaps.push({
      chargeInstanceId,
      chargeKey: e.chargeKey,
      label:
        COMPONENT_CHARGE_LABELS[e.chargeKey as ComponentChargeKey] ?? e.chargeKey,
      ownLabel: e.ownLabel,
      quoteLeafId: e.quoteLeafId,
      mode: e.mode as string,
      missingTierIds: missing.map((t) => t.id),
      missingTierLabels: missing.map((t) => t.label),
    });
  }
  return gaps;
}
