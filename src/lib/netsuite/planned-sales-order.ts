/**
 * THE ONE STRUCTURAL PRODUCER for a Sales Order — pure, provider-independent.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * The Sales Order tab rendered its "everything below goes to NetSuite exactly
 * as shown" list from `view.skus` — the CUSTOMER DOCUMENT — with every line at
 * the tier quantity. The send path built something else entirely: for
 * `turnkey_only` it emits Item Group header lines and lets NetSuite expand the
 * members, so O3's ×2 components would post at 2,400 while the operator
 * approved a screen showing 1,200.
 *
 * Two producers of one structure, free to disagree, at an irreversible
 * boundary. This session has now found that shape four times (#537, #538,
 * #540, #541), so the repair is not a second preview-shaped implementation —
 * it is ONE builder that the push path consumes too.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
 *
 * No NetSuite reads. No NetSuite writes. In particular it never calls
 * `findOrCreateItemGroup`, which POSTs a new Item Group master when the
 * composition has not been seen — a side effect no operator should trigger by
 * opening a tab.
 *
 * Provider resolution stays downstream and stays narrow:
 *
 *     planned Group identity (externalId) -> NetSuite internal id
 *
 * The EXTERNAL id is deterministic from the frozen composition, so a preview
 * can name the Group it intends without asking the provider whether it exists
 * yet. `netsuiteInternalId` is therefore the one field a preview legitimately
 * cannot fill, and it is modelled as absent rather than invented.
 *
 * ── THE INPUTS ARE ALREADY RESOLVED ─────────────────────────────────────
 *
 * `frozenLines` arrive from `buildFrozenSalesOrder` (which resolves SKUs — a
 * provider READ) and `liveByLeafId` from the live structure. Both are the
 * caller's to obtain; this function only arranges them. That is what keeps it
 * pure while still describing the real order.
 */

import {
  buildGroupingPlan,
  type GroupingPlan,
  type PlanLineInput,
} from "@/lib/netsuite/grouping-plan";
import type { FrozenSalesOrderLine } from "@/lib/netsuite/frozen-sales-order";
import type { SalesOrderLine } from "@/lib/netsuite/sales-orders";

/** The live structure facts a frozen line needs, keyed by `quote_leaves.id`. */
export type LiveStructureEntry = {
  child: { sku: string | null; name: string | null };
  assembly: { name: string } | null;
  assemblyId: string | null;
  assemblySku: string | null;
  assemblyName: string | null;
  qtyPerParent: number;
  unitCost: number | null;
};

/**
 * One row of the order as it will be structured, in send order.
 *
 * `group` / `member` / `end_group` appear only for `turnkey_only`. A member row
 * is NOT sent as its own payload line — NetSuite expands it from the Group
 * definition — but it IS what the order becomes, and it is the fact an operator
 * has to see before approving. Modelled explicitly so the preview shows the
 * expansion without claiming it is a transmitted line.
 */
export type PlannedRow =
  | {
      role: "group";
      assemblyId: string;
      sku: string;
      name: string;
      /** Deterministic from the frozen composition. Known before the provider. */
      externalId: string | null;
      compositionHash: string | null;
      /** The group-line quantity: the accepted tier quantity. */
      quantity: number;
      /** Why no deterministic identity could be derived, when none could. */
      notDerivableReason?: string;
    }
  | {
      role: "member";
      sku: string;
      netsuiteItemId: string;
      /** The DEFINITION multiplier — how many per group. */
      qtyPerParent: number;
      /** ABSOLUTE: group quantity x qtyPerParent. What NetSuite expands to. */
      quantity: number;
      rate: number;
      amount: number;
    }
  | { role: "end_group"; assemblyId: string }
  /** A Direct Product: no group expands it, so it is sent as its own line. */
  | { role: "direct"; line: SalesOrderLine }
  /** Separately billed OTC and Direct Service. Quantity 1 by construction. */
  | { role: "accounting"; line: SalesOrderLine };

export type PlannedSalesOrder = {
  applicability: "itemized" | "turnkey_only";
  groupingRequired: boolean;
  tierQty: number | null;
  plan: GroupingPlan;
  /** Flat product lines, as the ungrouped payload sends them. */
  lines: SalesOrderLine[];
  directLines: SalesOrderLine[];
  accountingLines: SalesOrderLine[];
  planLines: PlanLineInput[];
  emitted: Array<{
    frozen: FrozenSalesOrderLine;
    soLine: SalesOrderLine;
    assemblyId: string | null;
    qtyPerGroup: number;
  }>;
  /** The order's STRUCTURE, in send order. What a faithful preview renders. */
  rows: PlannedRow[];
};

export function buildPlannedSalesOrder(input: {
  detailLevel: "itemized" | "turnkey_only" | null;
  customerNetsuiteId: string;
  tierQty: number | null;
  frozenLines: readonly FrozenSalesOrderLine[];
  liveByLeafId: ReadonlyMap<string, LiveStructureEntry>;
  /** The governed live cost for a line — the Accounting basis. */
  accountingCostFor: (line: FrozenSalesOrderLine) => number | null;
}): PlannedSalesOrder {
  const lines: SalesOrderLine[] = [];
  const directLines: SalesOrderLine[] = [];
  const accountingLines: SalesOrderLine[] = [];
  const emitted: PlannedSalesOrder["emitted"] = [];
  const planLines: PlanLineInput[] = [];

  for (const frozenLine of input.frozenLines) {
    const isProduct =
      frozenLine.kind === "item_group_member" || frozenLine.kind === "direct_product";

    // FROZEN. The rate is rendered at the transmitted precision, so the number
    // checked by REG-4 is the number NetSuite receives.
    const lineRate = Number(frozenLine.rate);

    if (!isProduct) {
      // OTC and Direct Service. Quantity 1 by construction — the emitter
      // carries the frozen amount as the rate and multiplies by nothing.
      const soLine: SalesOrderLine = {
        netsuiteItemId: frozenLine.netsuiteItemId,
        sku: frozenLine.sku ?? frozenLine.description,
        description: frozenLine.description,
        quantity: frozenLine.quantity,
        rate: lineRate,
        unitCost: input.accountingCostFor(frozenLine),
      };
      accountingLines.push(soLine);
      emitted.push({ frozen: frozenLine, soLine, assemblyId: null, qtyPerGroup: 1 });
      continue;
    }

    // Structure agreement already proved this resolves. Asserted, not
    // defaulted — a fallback is how a re-keyed identity gets silently absorbed.
    const live = frozenLine.quoteLeafId
      ? input.liveByLeafId.get(frozenLine.quoteLeafId)
      : undefined;
    if (!live) {
      throw new Error(
        `[plannedSalesOrder] frozen line "${frozenLine.description}" passed the structure ` +
          "agreement guard but has no live structure entry. Refusing.",
      );
    }

    const soLine: SalesOrderLine = {
      netsuiteItemId: frozenLine.netsuiteItemId,
      sku: live.child.sku as string,
      description:
        live.child.name ||
        (live.assembly ? `${live.assembly.name} — ${live.child.sku}` : (live.child.sku as string)),
      quantity: frozenLine.quantity,
      rate: lineRate,
      unitCost: live.unitCost,
    };
    lines.push(soLine);
    if (live.assembly === null) directLines.push(soLine);
    emitted.push({
      frozen: frozenLine,
      soLine,
      assemblyId: live.assemblyId,
      qtyPerGroup: live.qtyPerParent,
    });
    planLines.push({
      assemblyId: live.assemblyId,
      assemblySku: live.assemblySku,
      assemblyName: live.assemblyName,
      sku: live.child.sku as string,
      netsuiteItemId: frozenLine.netsuiteItemId,
      quantity: frozenLine.quantity,
      qtyPerParent: live.qtyPerParent,
      rate: lineRate,
      unitCost: live.unitCost,
    });
  }

  // The accounting half rides the flat line list. It is never a group member,
  // so it cannot collide with an expanded member.
  lines.push(...accountingLines);

  const plan = buildGroupingPlan({
    detailLevel: input.detailLevel,
    customerNetsuiteId: input.customerNetsuiteId,
    tierQty: input.tierQty,
    lines: planLines,
  });

  // ── THE STRUCTURE, IN SEND ORDER ──────────────────────────────────────
  //
  // Grouped members are REPLACED by their group; Direct Products are not,
  // because no group expands them. That is the same rule the send path applies
  // when it swaps `payloadForSend` — stated once, here, so the two cannot
  // disagree about which lines survive grouping.
  const rows: PlannedRow[] = [];
  if (plan.groupingRequired && plan.groups.length > 0) {
    for (const g of plan.groups) {
      rows.push({
        role: "group",
        assemblyId: g.assemblyId,
        sku: g.assemblySku,
        name: g.assemblyName,
        externalId: g.externalId,
        compositionHash: g.compositionHash,
        quantity: plan.tierQty ?? 0,
        ...(g.notDerivableReason ? { notDerivableReason: g.notDerivableReason } : {}),
      });
      for (const m of g.members) {
        rows.push({
          role: "member",
          sku: m.sku,
          netsuiteItemId: m.netsuiteItemId,
          qtyPerParent: m.qtyPerParent,
          // ABSOLUTE. NetSuite computes this from the Group definition; the
          // preview states it because it is the fact the operator approves.
          quantity: (plan.tierQty ?? 0) * m.qtyPerParent,
          rate: m.rate,
          amount: m.amount,
        });
      }
      rows.push({ role: "end_group", assemblyId: g.assemblyId });
    }
    for (const l of directLines) rows.push({ role: "direct", line: l });
  } else {
    // Itemized: every product line stands on its own, exactly as before.
    for (const l of lines) {
      if (accountingLines.includes(l)) continue;
      rows.push({ role: "direct", line: l });
    }
  }
  for (const l of accountingLines) rows.push({ role: "accounting", line: l });

  return {
    applicability: plan.applicability,
    groupingRequired: plan.groupingRequired,
    tierQty: plan.tierQty,
    plan,
    lines,
    directLines,
    accountingLines,
    planLines,
    emitted,
    rows,
  };
}
