import type { FrozenSalesOrderLine } from "@/lib/netsuite/frozen-sales-order";

/**
 * Arrange the frozen order into the structures `markComplete` already posts.
 *
 * ── THE DIVISION OF AUTHORITY ────────────────────────────────────────────
 *
 * The frozen matrix governs WHAT WAS SOLD — quantity, sell rate, line amount,
 * OTC and Direct Service economics, and the accepted commercial total.
 *
 * Live structure is permitted to say only HOW an already-frozen line is
 * GROUPED for NetSuite: which Item Group a member belongs to, that group's SKU
 * and name, and how many of the member one group contains. Nothing structural
 * may introduce, remove, or re-price a commercial line.
 *
 * `unitCost` is the one live COMMERCIAL-ADJACENT value that remains, and it is
 * not commercial: it feeds `custcol_dps_unit_cost`, an accounting cost-reporting
 * basis. It never touches a sell rate, an amount, or REG-4. Historical
 * cost-basis reproducibility, if it is ever wanted, is a separate governed
 * snapshot rather than a widening of this one.
 *
 * ── THE STRUCTURE AGREEMENT GUARD ────────────────────────────────────────
 *
 * Both directions are checked, because each hides a different failure:
 *
 *   · a LIVE product with no frozen line would be a line added to the order
 *     after the customer accepted it — billing for something never quoted;
 *   · a FROZEN product with no live structure would be a line silently dropped,
 *     and the order would still reconcile against whatever remained if the
 *     total were recomputed rather than compared to the frozen one.
 *
 * Re-keying is caught by the same comparison: an identity that changed appears
 * as one missing and one extra, and both refuse.
 */

export type LiveStructureMember = {
  /** `quote_leaves.id` — the governed commercial identity. */
  quoteLeafId: string;
  sku: string | null;
  /** Null for a Direct Product. */
  assemblyId: string | null;
  assemblySku: string | null;
  assemblyName: string | null;
  /** How many of this leaf ONE Item Group contains. */
  qtyPerParent: number;
  /** Live cost basis. Reporting only — never a commercial figure. */
  unitCost: number | null;
};

export type StructureDisagreement =
  | {
      kind: "live_line_not_frozen";
      quoteLeafId: string;
      sku: string | null;
      detail: string;
    }
  | {
      kind: "frozen_line_not_in_structure";
      quoteLeafId: string;
      description: string;
      detail: string;
    }
  | {
      kind: "quantity_disagrees_with_structure";
      quoteLeafId: string;
      description: string;
      detail: string;
    };

/**
 * Compare the structural identities NetSuite grouping needs against the frozen
 * commercial line set.
 */
export function checkStructureAgreement(input: {
  frozenLines: ReadonlyArray<FrozenSalesOrderLine>;
  liveMembers: ReadonlyArray<LiveStructureMember>;
  tierQty: number;
}): StructureDisagreement[] {
  const out: StructureDisagreement[] = [];

  const frozenProducts = input.frozenLines.filter(
    (l) => l.kind === "item_group_member" || l.kind === "direct_product",
  );
  const frozenByLeaf = new Map(
    frozenProducts
      .filter((l) => l.quoteLeafId !== null)
      .map((l) => [l.quoteLeafId!, l] as const),
  );
  const liveByLeaf = new Map(input.liveMembers.map((m) => [m.quoteLeafId, m] as const));

  for (const live of input.liveMembers) {
    if (!frozenByLeaf.has(live.quoteLeafId)) {
      out.push({
        kind: "live_line_not_frozen",
        quoteLeafId: live.quoteLeafId,
        sku: live.sku,
        detail: `${live.sku ?? live.quoteLeafId} is on the quote now but is not in the frozen accepted line set. It was added after the customer accepted; posting it would bill for something never quoted.`,
      });
    }
  }

  for (const frozen of frozenProducts) {
    if (frozen.quoteLeafId === null) {
      out.push({
        kind: "frozen_line_not_in_structure",
        quoteLeafId: "",
        description: frozen.description,
        detail: `"${frozen.description}" was frozen without a commercial identity, so it cannot be matched to the current structure. Revise and re-send.`,
      });
      continue;
    }
    const live = liveByLeaf.get(frozen.quoteLeafId);
    if (!live) {
      out.push({
        kind: "frozen_line_not_in_structure",
        quoteLeafId: frozen.quoteLeafId,
        description: frozen.description,
        detail: `"${frozen.description}" is in the frozen accepted line set but no longer in the quote's structure. It was removed after acceptance; dropping it from the order would under-bill what the customer accepted.`,
      });
      continue;
    }

    // The frozen quantity is the LINE's own — tier order size × qty-per-parent.
    // If the structure now says a different multiplier, the frozen amount and
    // the expansion NetSuite performs cannot both be right.
    const expected = input.tierQty * live.qtyPerParent;
    if (frozen.quantity !== expected) {
      out.push({
        kind: "quantity_disagrees_with_structure",
        quoteLeafId: frozen.quoteLeafId,
        description: frozen.description,
        detail: `"${frozen.description}" was frozen at ${frozen.quantity} units, but the current structure gives ${input.tierQty} × ${live.qtyPerParent} = ${expected}. The composition changed after acceptance; NetSuite would expand to a quantity the frozen amount was never priced for.`,
      });
    }
  }

  return out;
}
