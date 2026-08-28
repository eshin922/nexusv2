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

/**
 * The charges each component already owns, for the Setup authoring sheet.
 *
 * ── WHY IDENTITY AND NOT A COUNT ────────────────────────────────────────
 *
 * The sheet has two questions to answer and a count can only answer one.
 * "Does this component already have a Tooling charge?" needs the TYPE; "what
 * distinguishes a second one from the first?" needs the LABELS that already
 * exist, because a label is what tells two charges of a type apart. A count by
 * type would answer the first and leave the second to be guessed, which is the
 * ambiguity the instance grain was introduced to remove.
 *
 * `chargeInstanceId` rides along because the identity is the fact. A caller
 * that has it cannot later be tempted to reconstruct one from a type and a
 * position — the shape OD-028 exists to warn about.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 *
 * `AssemblyTreeBody` declared `existingComponentCharges` as OPTIONAL and no
 * caller ever passed it. So the sheet believed every component owned nothing:
 * the "already has N" warning never rendered, the distinct-label input never
 * appeared, and a second charge of a type submitted with `label: null`.
 *
 * `ensureChargeInstance` is idempotent on (quote, type, owner, label) — rightly,
 * since re-submitting one commercial fact must not mint a rival identity — so
 * that second submission RESOLVED TO THE FIRST and reported success. Measured
 * on production 2026-08-28: three submissions, two charges, no error shown.
 *
 * Nothing was corrupted. But two same-type charges on one component, which the
 * model supports and the Recovery grain exists to give back, could not be
 * authored at all.
 */
export type ExistingComponentCharge = {
  chargeInstanceId: string;
  /** The causal owner — `quote_leaves.id`. */
  quoteLeafId: string;
  chargeKey: string;
  label: string | null;
};

export async function readExistingComponentCharges(
  quoteId: string,
): Promise<ExistingComponentCharge[]> {
  const rows = await db
    .select({
      chargeInstanceId: quoteChargeInstances.id,
      quoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      chargeKey: quoteChargeInstances.chargeKey,
      label: quoteChargeInstances.label,
    })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        // Component-owned only. A legacy `'@quote'` charge is owned by the
        // engagement and belongs to no component's picker.
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );
  return rows.map((r) => ({
    chargeInstanceId: r.chargeInstanceId,
    // Non-null by the WHERE above; the narrowing is for the compiler, which
    // cannot see a predicate expressed in SQL.
    quoteLeafId: r.quoteLeafId as string,
    chargeKey: r.chargeKey,
    label: r.label,
  }));
}
