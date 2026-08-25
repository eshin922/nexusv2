import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";
import { chargePolicy } from "@/lib/commercial-recovery/registry";

/**
 * Recovery placed where the customer's quote cannot bill it.
 *
 * ── THE DEFECT THIS NAMES ────────────────────────────────────────────────
 *
 * A Direct Service leaf is already a priced customer line, and the customer
 * projection builds one-time lines per ASSEMBLY — `otc:${assemblyId}:${field}`.
 * A leaf with no parent assembly has no such key, so a charge it owns cannot
 * become a fee line no matter what it is placed at.
 *
 * Place one `separate_line` anyway and the engine counts its recovery as tier
 * revenue while the document bills nothing for it. On quote 4781e4bb that was
 * $1,727.60 / $3,283.00 / $172.20 / $1,727.60 across four tiers — revenue the
 * margin math believed in and the customer was never asked to pay.
 *
 * Electing this is now refused (`DIRECT_SERVICE_NOT_SEPARATELY_BILLABLE`). This
 * finds the states that were created BEFORE the refusal existed.
 *
 * ── WHY THIS DETECTS RATHER THAN REPAIRS ─────────────────────────────────
 *
 * Correcting one of these changes what a real customer owes. So nothing here
 * moves a number: it reports, the send gate refuses, and an operator decides.
 * A silent repair would be a commercial decision taken by a deployment.
 *
 * Read from the CONSTRUCTED state — what the engine actually did — rather than
 * from the persisted election, so a placement that arrived by any route is
 * caught, and there is one authority for what is in force.
 *
 * Pure. No query, and no arithmetic on money: amounts are reported as the
 * construction stated them.
 */

export type UnbillablePlacement = {
  chargeKey: RecoveryChargeKey;
  /** The charge's canonical name, as Card 1 and the quote both show it. */
  label: string;
  /** The Direct Service that owns the contribution. */
  ownerLabel: string;
  tierId: string;
  tierLabel: string;
  /**
   * What the engine counted as revenue and the document does not bill.
   *
   * NULL when no governed rate resolves (BV-013). Null is not zero: the
   * placement is still unbillable, the amount is simply unknown.
   */
  unbilledRevenue: number | null;
};

type PlacedCharge = {
  chargeKey: string;
  placement: string;
  ownerKind: string;
  recoverableSell: number | null;
};

type Rollup = {
  skuLabel?: string | null;
  productName?: string | null;
  skuId: string;
  perTier: readonly {
    tierId: string;
    constructed?: { charges?: readonly PlacedCharge[] } | null;
  }[];
};

export function findUnbillablePlacements(input: {
  skuRollups: readonly Rollup[];
  tierLabels: ReadonlyMap<string, string>;
}): UnbillablePlacement[] {
  const found: UnbillablePlacement[] = [];
  for (const sku of input.skuRollups) {
    for (const cell of sku.perTier) {
      for (const charge of cell.constructed?.charges ?? []) {
        if (charge.ownerKind !== "direct_service") continue;
        if (charge.placement !== "separate_line") continue;
        found.push({
          chargeKey: charge.chargeKey as RecoveryChargeKey,
          label: chargePolicy(charge.chargeKey as RecoveryChargeKey).label,
          ownerLabel: sku.skuLabel || sku.productName || sku.skuId,
          tierId: cell.tierId,
          tierLabel: input.tierLabels.get(cell.tierId) ?? cell.tierId,
          unbilledRevenue: charge.recoverableSell,
        });
      }
    }
  }
  return found;
}

/**
 * The operator-facing work list, one line per affected tier.
 *
 * Every tier, not the first — an operator who resolves one and is refused for
 * the next has been made to discover the work one item at a time.
 */
export function describeUnbillablePlacements(rows: readonly UnbillablePlacement[]): string[] {
  return rows.map((r) => {
    const amount =
      r.unbilledRevenue === null
        ? "an amount nothing governs"
        : `$${r.unbilledRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return (
      `${r.tierLabel} — ${r.label} on ${r.ownerLabel} is set to bill separately, ` +
      `but ${r.ownerLabel} is a Direct Service and has no separate fee line on the ` +
      `customer's quote. ${amount} counts as revenue the customer is not billed. ` +
      `Set ${r.label} to In unit price, or remove the charge.`
    );
  });
}

/**
 * The same finding, grouped for the pre-flight checklist.
 *
 * One line per (charge, owner) with every affected tier and its amount, rather
 * than the gate's one-line-per-tier work list: the checklist is read before the
 * operator acts, and four near-identical sentences about one charge read as
 * four problems.
 *
 * The words live beside the detection so the surface and the boundary cannot
 * describe the same state differently.
 */
export function summariseUnbillablePlacements(rows: readonly UnbillablePlacement[]): string[] {
  const groups = new Map<string, UnbillablePlacement[]>();
  for (const r of rows) {
    const k = `${r.chargeKey}::${r.ownerLabel}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((g) => {
    const first = g[0]!;
    const amounts = g
      .map((r) =>
        r.unbilledRevenue === null
          ? `${r.tierLabel}: not governed`
          : `${r.tierLabel}: $${r.unbilledRevenue.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
      )
      .join(" · ");
    return (
      `Unresolved - ${first.label} on ${first.ownerLabel} is set to bill separately, ` +
      `but ${first.ownerLabel} is a Direct Service and has no separate fee line on ` +
      `the customer's quote. It counts as revenue the customer is not billed ` +
      `(${amounts}). Set ${first.label} to In unit price, or remove the charge.`
    );
  });
}
