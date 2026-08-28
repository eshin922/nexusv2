/**
 * Is every component charge priced? — OD-032 step B.
 *
 * ── WHY THIS DOES NOT READ `ChargeEconomics` ────────────────────────────
 *
 * An uncosted charge is STRUCTURAL STATE, not a cost fact. The engine is right
 * to skip it: `componentChargeEconomics` drops a charge with no amount, and
 * `loadComponentCharges` inner-joins the tier table, so a charge with no
 * economics produces no economics — twice over, by two independent paths.
 *
 * That is correct engine behaviour and it is exactly why readiness cannot be
 * derived from it. Measured before this module existed: a charge authored with
 * no cost was invisible to the recovery workspace AND to the send gate, so an
 * operator could author a charge, have nothing price it, and send the quote
 * with nothing reporting the loss. Asking the engine "is anything missing?"
 * asks the wrong layer — the engine only knows what it was given.
 *
 * So this reads the two tables that hold the structural fact: an instance
 * exists, and it either has an amount for every quoted tier or it does not.
 *
 * ── THE INVARIANT A ROW STANDS FOR ──────────────────────────────────────
 *
 * A `quote_charge_instance_tiers` row EXISTS IF AND ONLY IF an operator has
 * stated a positive cost for that tier. `cost_amount` is NOT NULL, zero is
 * refused as a value (Option A), and clearing a cost deletes the row rather
 * than writing a zero. So absence is unambiguous — there is exactly one
 * representation of "no cost stated", and counting rows answers the question.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteTiers,
} from "@/db/schema";
import {
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";

/**
 * Three states, and the middle one is the reason this is not a boolean.
 *
 * `partial` is the dangerous state: the charge IS priced, so it produces real
 * economics and appears everywhere a complete charge appears — just costing
 * less than it does. A boolean would have to call it ready or not-ready, and
 * either answer loses the fact that the operator has started and stopped.
 */
export type ChargeEconomicsState = "none" | "partial" | "complete";

export type ComponentChargeReadiness = {
  chargeInstanceId: string;
  chargeKey: string;
  /** The charge's type label, and the operator's own label where there is one. */
  label: string;
  ownLabel: string | null;
  /** The causal component. */
  quoteLeafId: string;
  state: ChargeEconomicsState;
  /** Quoted tiers with no cost stated, named so the operator can go and fix them. */
  missingTierIds: string[];
  missingTierLabels: string[];
};

export function describeMissing(r: ComponentChargeReadiness): string {
  const name = r.ownLabel ? `${r.label} · ${r.ownLabel}` : r.label;
  if (r.state === "none") return `${name} — no cost at any tier`;
  return `${name} — no cost at ${r.missingTierLabels.join(", ")}`;
}

/**
 * Every component-owned charge on the quote, with what it is missing.
 *
 * Returns COMPLETE charges too. A caller filtering for problems can do so, and
 * a caller that needs to render state per charge — the Costs block does — needs
 * the complete ones as well.
 */
export async function readComponentChargeReadiness(
  quoteId: string,
): Promise<ComponentChargeReadiness[]> {
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
      tierId: quoteChargeInstanceTiers.tierId,
    })
    .from(quoteChargeInstances)
    // LEFT, so an instance with no economics is a row rather than an absence.
    // This is the whole point of the module: the state that must be reported is
    // the one that has nothing to report itself.
    .leftJoin(
      quoteChargeInstanceTiers,
      eq(quoteChargeInstanceTiers.chargeInstanceId, quoteChargeInstances.id),
    )
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        // Component-owned only. A legacy `'@quote'` instance stands for a
        // production column whose amount lives on that column, so it has no
        // tier rows by design and is not missing anything.
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );

  const byInstance = new Map<
    string,
    { chargeKey: string; ownLabel: string | null; quoteLeafId: string; costed: Set<string> }
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
        costed: new Set<string>(),
      };
      byInstance.set(r.chargeInstanceId, e);
    }
    if (r.tierId !== null) e.costed.add(r.tierId);
  }

  return [...byInstance.entries()].map(([chargeInstanceId, e]) => {
    const missing = tiers.filter((t) => !e.costed.has(t.id));
    // Measured against the QUOTED tiers, not against whatever rows exist. A
    // charge costed at every tier it happens to have rows for is complete only
    // if those are all the tiers the quote sells.
    const state: ChargeEconomicsState =
      e.costed.size === 0 ? "none" : missing.length === 0 ? "complete" : "partial";
    return {
      chargeInstanceId,
      chargeKey: e.chargeKey,
      label:
        COMPONENT_CHARGE_LABELS[e.chargeKey as ComponentChargeKey] ?? e.chargeKey,
      ownLabel: e.ownLabel,
      quoteLeafId: e.quoteLeafId,
      state,
      missingTierIds: missing.map((t) => t.id),
      missingTierLabels: missing.map((t) => t.label),
    };
  });
}
