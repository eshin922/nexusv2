// Track B §4 — the deterministic grouping plan frozen into the SO payload
// snapshot. Pure function tree (no `import "server-only"`) so the primitives
// are unit-testable under the governed runner, matching composition-hash.ts.
//
// WHY THIS EXISTS. Under the OD-004 disposition (2026-08-11) NetSuite grouping
// follows the quote's agreed customer presentation, and where it is required the
// ASSEMBLY is the grouping boundary. Nexus emits one SO line per LEAF, and the
// frozen `payload_snapshot` records every line's sku, rate and quantity but NOT
// which assembly it came from — the attribution is known at line-build time and
// discarded before the payload is frozen.
//
// That gap is what makes the turnkey_only walk unprovable. An administrator who
// groups the wrong leaves produces a CORRECT TOTAL with WRONG COMPOSITION, and
// no read-back can tell, because Nexus never recorded what it intended.
//
// WHAT THIS IS NOT. Not a workflow, not a status model, not a record that
// grouping happened. NetSuite remains the source of truth for the post-push
// result; this is the frozen statement of intent that the result is compared
// AGAINST. Nexus verifies; it does not attest.
//
// THE ENVELOPE, and why the plan must not reach NetSuite. `payload_snapshot` is
// POSTed verbatim as the Sales Order body (`createSalesOrder(payload)`), so
// anything added to it is transmitted. The plan therefore lives under a reserved
// key that is stripped immediately before the POST — on BOTH the fresh-build and
// the durable-replay paths, since a replayed snapshot carries the envelope too.
// Provider behaviour is unchanged by construction: the transmitted body is
// byte-identical to what it would have been.

import {
  computeCompositionHash,
  externalIdForHash,
  type CompositionMember,
} from "./composition-hash";

/** Reserved key. Present in the frozen snapshot; never transmitted. */
export const NEXUS_PLAN_KEY = "__nexusGroupingPlan";

export type GroupingApplicability = "itemized" | "turnkey_only";

/** One emitted SO line, carrying the assembly attribution the payload drops.
 *  Supplied BY the line-build loop — never re-derived here (constraint 3). */
export interface PlanLineInput {
  assemblyId: string;
  assemblySku: string;
  assemblyName: string;
  sku: string;
  netsuiteItemId: string;
  quantity: number;
  rate: number;
}

export interface PlannedMember {
  sku: string;
  netsuiteItemId: string;
  quantity: number;
  rate: number;
  /** `rate × quantity`, rounded to 4dp — this member's contribution. */
  amount: number;
}

export interface PlannedGroup {
  assemblyId: string;
  assemblySku: string;
  assemblyName: string;
  /**
   * Same hash `findOrCreateItemGroup` would compute for this composition.
   * NULL when the composition is not hashable — see `notDerivableReason`.
   */
  compositionHash: string | null;
  /** `nxs-grp-<hash>` — the deterministic group identity. NULL with the hash. */
  externalId: string | null;
  /**
   * Why no deterministic identity could be derived, if none could.
   *
   * THE PLAN IS EVIDENCE, NOT A GATE. `computeCompositionHash` refuses a
   * non-positive member quantity, which a zero-quantity tier produces. Letting
   * that throw would put plan-building in the path of whether a Sales Order
   * pushes at all — changing provider behaviour, which §4 is explicitly not
   * permitted to do. So the group is recorded WITHOUT an identity and says so,
   * which is also more useful to the walk than a crash: an undeliverable group
   * is visible rather than absent.
   *
   * Caught by dry-running the plan against real production data; every unit
   * fixture used positive quantities and none of them reached it.
   */
  notDerivableReason?: string;
  /** Sorted by `netsuiteItemId`, matching the hash's canonical member order. */
  members: PlannedMember[];
  /**
   * THE RECONCILIATION TARGET: Σ member amounts. The group's contribution to
   * the accepted commercial total.
   */
  expectedAmount: number;
  /**
   * The per-unit figure the wrapped line displays, `expectedAmount / tierQty`.
   *
   * DISPLAY FIGURE, NOT THE RECONCILIATION TARGET. At 4dp,
   * `turnkeyUnitPrice × tierQty` can differ from `expectedAmount` by rounding
   * dust; reconcile against `expectedAmount`. Null when tier quantity is
   * unknown or zero — the ratio is undefined, and 0 would assert a free order.
   */
  turnkeyUnitPrice: number | null;
}

export interface GroupingPlan {
  /**
   * False when any planned group lacks a deterministic identity. The walk
   * checks THIS before touching NetSuite — a non-derivable plan cannot serve
   * as a comparison target, and grouping to it would be guesswork.
   */
  derivable: boolean;
  /** Read from the accepted quote's SEND-TIME snapshot. NULL → `itemized`,
   *  matching the customer-PDF adapter's documented default. */
  applicability: GroupingApplicability;
  groupingRequired: boolean;
  tierQty: number | null;
  /** Empty when `itemized` — an itemized quote acquires no grouping
   *  requirement (constraint 2). */
  groups: PlannedGroup[];
  /** Per-line assembly attribution. Present in BOTH cases: the itemized walk
   *  still needs to prove which lines were preserved ungrouped. */
  lineAttribution: Array<{
    sku: string;
    netsuiteItemId: string;
    assemblyId: string;
    assemblySku: string;
    assemblyName: string;
  }>;
}

/** 4dp, matching the NetSuite line-rate discipline elsewhere in this tree. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function buildGroupingPlan(input: {
  detailLevel: GroupingApplicability | null;
  customerNetsuiteId: string;
  tierQty: number | null;
  lines: PlanLineInput[];
}): GroupingPlan {
  const applicability: GroupingApplicability = input.detailLevel ?? "itemized";
  const groupingRequired = applicability === "turnkey_only";

  const lineAttribution = input.lines.map((l) => ({
    sku: l.sku,
    netsuiteItemId: l.netsuiteItemId,
    assemblyId: l.assemblyId,
    assemblySku: l.assemblySku,
    assemblyName: l.assemblyName,
  }));

  if (!groupingRequired) {
    return { derivable: true, applicability, groupingRequired, tierQty: input.tierQty, groups: [], lineAttribution };
  }

  // Group by assembly, preserving first-seen order so the plan reads in the
  // same order as the emitted lines.
  const byAssembly = new Map<string, PlanLineInput[]>();
  for (const line of input.lines) {
    const bucket = byAssembly.get(line.assemblyId);
    if (bucket) bucket.push(line);
    else byAssembly.set(line.assemblyId, [line]);
  }

  const groups: PlannedGroup[] = [];
  for (const [assemblyId, lines] of byAssembly) {
    const head = lines[0];

    const members: PlannedMember[] = lines
      .map((l) => ({
        sku: l.sku,
        netsuiteItemId: l.netsuiteItemId,
        quantity: l.quantity,
        rate: l.rate,
        amount: round4(l.rate * l.quantity),
      }))
      .sort((a, b) => a.netsuiteItemId.localeCompare(b.netsuiteItemId));

    // The SAME hash inputs `findOrCreateItemGroup` uses: customer × base SKU ×
    // members{netsuiteItemId, quantity}. Reusing the governed function rather
    // than restating its canonicalization is the point — a second
    // implementation would drift and the plan would stop matching the group.
    const hashMembers: CompositionMember[] = members.map((m) => ({
      netsuiteItemId: m.netsuiteItemId,
      quantity: m.quantity,
    }));
    let compositionHash: string | null = null;
    let notDerivableReason: string | undefined;
    try {
      compositionHash = computeCompositionHash({
        customerNetsuiteId: input.customerNetsuiteId,
        baseSku: head.assemblySku,
        members: hashMembers,
      });
    } catch (e) {
      notDerivableReason = e instanceof Error ? e.message : String(e);
    }

    const expectedAmount = round4(members.reduce((sum, m) => sum + m.amount, 0));
    const turnkeyUnitPrice =
      input.tierQty && input.tierQty > 0 ? round4(expectedAmount / input.tierQty) : null;

    groups.push({
      assemblyId,
      assemblySku: head.assemblySku,
      assemblyName: head.assemblyName,
      compositionHash,
      externalId: compositionHash ? externalIdForHash(compositionHash) : null,
      ...(notDerivableReason ? { notDerivableReason } : {}),
      members,
      expectedAmount,
      turnkeyUnitPrice,
    });
  }

  return {
    derivable: groups.every((g) => g.compositionHash !== null),
    applicability,
    groupingRequired,
    tierQty: input.tierQty,
    groups,
    lineAttribution,
  };
}

/** Attach the plan to the payload that gets FROZEN. Never call this on the
 *  object handed to the provider. */
export function attachGroupingPlan(
  payload: Record<string, unknown>,
  plan: GroupingPlan,
): Record<string, unknown> {
  return { ...payload, [NEXUS_PLAN_KEY]: plan };
}

/** Remove the envelope immediately before transmission. Safe on payloads that
 *  never carried one, which is what makes it correct to call unconditionally on
 *  both the fresh-build and durable-replay paths. */
export function stripGroupingPlan(payload: Record<string, unknown>): Record<string, unknown> {
  if (!(NEXUS_PLAN_KEY in payload)) return payload;
  const { [NEXUS_PLAN_KEY]: _plan, ...rest } = payload;
  return rest;
}

/** Read the frozen plan back out of a stored snapshot, for walk comparison. */
export function readGroupingPlan(payload: Record<string, unknown> | null): GroupingPlan | null {
  if (!payload) return null;
  const plan = payload[NEXUS_PLAN_KEY];
  return plan && typeof plan === "object" ? (plan as GroupingPlan) : null;
}
