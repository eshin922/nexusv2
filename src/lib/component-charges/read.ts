/**
 * Component-owned charges for a quote, shaped for the Costs surface.
 *
 * ── SHAPE A · A CHARGE RENDERS WHERE ITS OWNER ALREADY LIVES ─────────────
 *
 * Component charges are read by their CAUSAL owner — `owner_quote_leaf_id`, a
 * real foreign key — so the Packaging drilldown can nest each one under the
 * component that caused it.
 *
 * `owner_ref` is never read here. It is text, it is `'@quote'` for a legacy
 * charge, and for OD-032 purposes a legacy charge's owner is the engagement
 * rather than any component — so filtering on the typed column is both the
 * correct question and the one that cannot accidentally include a coerced
 * anchor.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
} from "@/db/schema";

export type ComponentChargeForCosts = {
  chargeInstanceId: string;
  /** The `quote_leaves` id that caused it. */
  quoteLeafId: string;
  chargeKey: string;
  label: string | null;
  /** Per tier, as stored. Strings, because they are money. */
  amounts: { tierId: string; cost: string; recoveryAsk: string | null }[];
};

export async function readComponentChargesForCosts(
  quoteId: string,
): Promise<ComponentChargeForCosts[]> {
  const rows = await db
    .select({
      chargeInstanceId: quoteChargeInstances.id,
      quoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      chargeKey: quoteChargeInstances.chargeKey,
      label: quoteChargeInstances.label,
      tierId: quoteChargeInstanceTiers.tierId,
      cost: quoteChargeInstanceTiers.costAmount,
      recoveryAsk: quoteChargeInstanceTiers.recoveryAsk,
    })
    .from(quoteChargeInstances)
    .leftJoin(
      quoteChargeInstanceTiers,
      eq(quoteChargeInstanceTiers.chargeInstanceId, quoteChargeInstances.id),
    )
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );

  const byInstance = new Map<string, ComponentChargeForCosts>();
  for (const r of rows) {
    // Non-null by the WHERE above; the narrowing is for the compiler, which
    // cannot see a predicate expressed in SQL.
    const owner = r.quoteLeafId as string;
    let charge = byInstance.get(r.chargeInstanceId);
    if (!charge) {
      charge = {
        chargeInstanceId: r.chargeInstanceId,
        quoteLeafId: owner,
        chargeKey: r.chargeKey,
        label: r.label,
        amounts: [],
      };
      byInstance.set(r.chargeInstanceId, charge);
    }
    // LEFT JOIN, so an instance with no economics yet appears with an empty
    // amounts list rather than vanishing. Authoring refuses to create one, but
    // a reader that silently dropped a charge would hide the state rather than
    // showing it.
    if (r.tierId !== null) {
      charge.amounts.push({
        tierId: r.tierId,
        cost: r.cost ?? "0",
        recoveryAsk: r.recoveryAsk,
      });
    }
  }
  return [...byInstance.values()];
}
