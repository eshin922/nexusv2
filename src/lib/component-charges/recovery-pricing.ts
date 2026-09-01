/**
 * Does every ELECTED component charge carry a RESOLVED recovery?
 *
 * THE QUERY ONLY. The decision is `computeChargeRecoveryGaps` in
 * `recovery-pricing-rule.ts`, which imports no database and is therefore
 * exercised directly by fixtures rather than through a mock of this file. This
 * module's whole job is to load the two tables and the quote's governed markup
 * rates and hand them over.
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
 * ── WHAT #496 FOUND, AND WHY THE INVARIANT SURVIVES THE REPAIR ──────────
 *
 * Measured on Production 2026-08-28. Two charges on one component, cost entered
 * at all four tiers, both elected `separate`, nothing pricing them:
 *
 *   Recovery workspace : "not priced"          — correct, and BV-013-honest
 *   customer document  : "One-time fees $0.00" — INCORRECT
 *   Finalize           : enabled, data-state="ready" — INCORRECT
 *   sendQuote          : no refusal            — INCORRECT
 *
 * $2,700 of charges the operator elected to bill separately, stated to the
 * customer as zero, on a quote the surface called ready. That invariant still
 * holds and is still enforced.
 *
 * ── WHAT CHANGED: THE AUTHORITY, NOT THE QUESTION ───────────────────────
 *
 * #496 expressed it as `recovery_ask IS NOT NULL`. #501, the next day, made the
 * charge TYPE the pricing authority and DELETED the input that wrote that
 * column — so from 2026-08-29 the gate required a value no surface could supply
 * and no engine consumed. Every quote with a costed, elected component charge
 * was unsendable, and nothing said so until O3 became the first quote in the
 * database to have one. Before it, every instance had zero tier rows, so the
 * COST gate refused first and this one was never reached: a gate that held only
 * because nothing had ever got to it.
 *
 * `recovery_ask` is not read here any more, in any sense. It is neither the
 * commercial authority nor a fallback nor a tiebreak.
 *
 * ── THE PINNED RATES, NOT TODAY'S ───────────────────────────────────────
 *
 * `resolveQuoteCommercialSettings` supplies the markup defaults, so a sent or
 * accepted quote is measured against the rates PINNED to it rather than
 * whatever the admin table says now. The gate and the engine read the same
 * settings for the same quote, which is the only way they can agree about
 * whether it may go out.
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
import { resolveQuoteCommercialSettings } from "@/lib/commercial-settings";
import {
  computeChargeRecoveryGaps,
  type ChargeRecoveryInstanceInput,
  type ChargeRecoveryPricingGap,
} from "@/lib/component-charges/recovery-pricing-rule";

// DELIBERATELY NOT RE-EXPORTED.
//
// An earlier revision re-exported the pure rule from here "so callers have one
// import site". A client component then imported the describe helper from this
// module, and this module imports `@/db` — which pulled postgres into the
// browser bundle and failed the build with `Can't resolve 'fs'`. TypeScript and
// `verify:ci` were both clean; only the bundler could see it.
//
// So the split is load-bearing, not cosmetic: anything a client may touch lives
// in `recovery-pricing-rule.ts`, and the only export here is the one that reads
// the database. Making the wrong import impossible beats fixing it once.

/**
 * Every elected component charge whose recovery is unresolved.
 *
 * Returns ONLY the gaps. Unlike `readComponentChargeReadiness` — which returns
 * complete charges too because Costs renders a chip for each — every consumer of
 * this one is asking "is anything wrong?", and both of them are refusals.
 *
 * The tier set is the QUOTED tiers, not whatever rows happen to exist.
 */
export async function readChargeRecoveryPricingGaps(
  quoteId: string,
): Promise<ChargeRecoveryPricingGap[]> {
  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, sortOrder: quoteTiers.sortOrder })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(quoteTiers.sortOrder, quoteTiers.label);
  if (tiers.length === 0) return [];

  const rows = await db
    .select({
      chargeInstanceId: quoteChargeInstances.id,
      chargeKey: quoteChargeInstances.chargeKey,
      ownLabel: quoteChargeInstances.label,
      quoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      mode: quoteChargeRecovery.mode,
      tierId: quoteChargeInstanceTiers.tierId,
      cost: quoteChargeInstanceTiers.costAmount,
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
        // production markup path; it is not on this chain by design.
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );

  const byInstance = new Map<string, ChargeRecoveryInstanceInput & { costByTier: Map<string, number> }>();
  for (const r of rows) {
    let e = byInstance.get(r.chargeInstanceId);
    if (!e) {
      e = {
        chargeInstanceId: r.chargeInstanceId,
        chargeKey: r.chargeKey,
        ownLabel: r.ownLabel,
        label:
          COMPONENT_CHARGE_LABELS[r.chargeKey as ComponentChargeKey] ?? r.chargeKey,
        // Non-null by the WHERE above; the narrowing is for the compiler, which
        // cannot see a predicate expressed in SQL.
        quoteLeafId: r.quoteLeafId as string,
        mode: r.mode ?? null,
        costByTier: new Map<string, number>(),
      };
      byInstance.set(r.chargeInstanceId, e);
    }
    if (r.tierId !== null && r.cost !== null) e.costByTier.set(r.tierId, Number(r.cost));
  }
  if (byInstance.size === 0) return [];

  const { markupDefaults } = await resolveQuoteCommercialSettings(quoteId);

  return computeChargeRecoveryGaps({
    tiers,
    instances: [...byInstance.values()],
    markupDefaults,
  });
}
