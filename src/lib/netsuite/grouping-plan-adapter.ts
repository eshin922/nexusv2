// Frozen grouping plan -> NetSuite Item Group primitive.
//
// Step 2 of the API-driven Item Group path.
// Design: docs/validation/od-004-grouped-so-recovery-contract.md
//         docs/validation/od-004-item-group-capability-matrix.md
//
// Pure: no `server-only`, no database, no NetSuite client. The bridge is
// decisions and shapes; the callers do the I/O. That keeps every rule here
// provable without a provider.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO
//
//  1. It never recomputes a composition hash or an external identity. The
//     frozen plan already carries `compositionHash` and `nxs-grp-<hash>`, and
//     those ARE the deterministic identity. A second derivation — even one
//     that agrees today — is a second authority that can drift.
//  2. It never puts a commercial rate on the Item Group header. Probe 7a
//     established the group-header rate is ignored, and that member pricing
//     arrives by per-line PATCH (Step 3). A rate here would look like pricing
//     and do nothing.

import type { PlannedGroup } from "./grouping-plan";

/** The member shape `findOrCreateItemGroup` consumes. */
export interface AdaptedMember {
  netsuiteItemId: string;
  quantity: number;
  sku: string;
  name: string;
}

/** Everything the adapter needs that is not on the plan itself. */
export interface GroupAdapterContext {
  /**
   * The SAME subsidiary the Sales Order uses. Sourced from governed authority
   * by the caller — never hardcoded.
   *
   * Corrects the Probe-7-era gap: `findOrCreateItemGroup` did not send
   * `subsidiary`, and NetSuite refuses members whose subsidiaries are not
   * contained by the group's:
   *
   *   "You may not add members to a group/kit/assembly unless the subsidiaries
   *    for those members completely contain the subsidiaries of the
   *    group/kit/assembly."
   *
   * Observed live on the manual save (2026-08-12), so this is a measured
   * constraint rather than an anticipated one.
   */
  subsidiaryId: string;
  customerNetsuiteId: string;
  customerDisplay: string;
  dealName: string;
  hubspotDealId: string;
  quoteId: string | null;
  userId: string | null;
}

export interface AdaptedGroupInput {
  hashInput: {
    customerNetsuiteId: string;
    baseSku: string;
    members: Array<{ netsuiteItemId: string; quantity: number }>;
  };
  members: AdaptedMember[];
  subsidiaryId: string;
  customerDisplay: string;
  dealName: string;
  hubspotDealId: string;
  quoteId: string | null;
  userId: string | null;
  /**
   * The identity the PLAN froze. Carried through so the caller can assert the
   * primitive returned this exact identity rather than deriving its own.
   */
  expectedExternalId: string;
  expectedCompositionHash: string;
}

export class GroupAdapterError extends Error {
  // Declared as a field rather than a constructor parameter property: the
  // governed test runner uses Node's strip-only type removal, which does not
  // support parameter properties.
  assemblySku: string;

  constructor(message: string, assemblySku: string) {
    super(message);
    this.name = "GroupAdapterError";
    this.assemblySku = assemblySku;
  }
}

/**
 * Convert one frozen planned group into the primitive's input.
 *
 * Refuses a group without a deterministic identity. `PlannedGroup` documents
 * itself as evidence rather than a gate — non-derivable groups are recorded,
 * not thrown on, so the plan stays buildable. But emitting one onto a Sales
 * Order is a different act: without an identity there is nothing to reuse
 * deterministically and nothing to verify a reuse against.
 */
export function adaptPlannedGroup(
  group: PlannedGroup,
  ctx: GroupAdapterContext,
): AdaptedGroupInput {
  if (!group.compositionHash || !group.externalId) {
    throw new GroupAdapterError(
      `Grouping plan carries no deterministic identity for assembly ${group.assemblySku}` +
        (group.notDerivableReason ? ` — ${group.notDerivableReason}` : "") +
        ". Refusing to emit an Item Group line without one.",
      group.assemblySku,
    );
  }
  if (group.members.length === 0) {
    throw new GroupAdapterError(
      `Grouping plan group ${group.assemblySku} has no members.`,
      group.assemblySku,
    );
  }
  if (!ctx.subsidiaryId) {
    throw new GroupAdapterError(
      `No subsidiary available for Item Group ${group.assemblySku}. NetSuite refuses ` +
        `members whose subsidiaries are not contained by the group's, so the group ` +
        `cannot be created without one.`,
      group.assemblySku,
    );
  }

  return {
    hashInput: {
      customerNetsuiteId: ctx.customerNetsuiteId,
      baseSku: group.assemblySku,
      // Plan members are already sorted by netsuiteItemId, matching the hash's
      // canonical order. Passed through untouched — reordering here would
      // silently change the hash the primitive computes.
      members: group.members.map((m) => ({
        netsuiteItemId: m.netsuiteItemId,
        quantity: m.quantity,
      })),
    },
    members: group.members.map((m) => ({
      netsuiteItemId: m.netsuiteItemId,
      quantity: m.quantity,
      sku: m.sku,
      name: m.sku,
    })),
    subsidiaryId: ctx.subsidiaryId,
    customerDisplay: ctx.customerDisplay,
    dealName: ctx.dealName,
    hubspotDealId: ctx.hubspotDealId,
    quoteId: ctx.quoteId,
    userId: ctx.userId,
    expectedExternalId: group.externalId,
    expectedCompositionHash: group.compositionHash,
  };
}

/** A member as NetSuite currently holds it, read back from `itemMember`. */
export interface ActualGroupMember {
  netsuiteItemId: string;
  quantity: number;
}

export interface MembershipVerdict {
  matches: boolean;
  /** Human-readable divergence, empty when matching. */
  problems: string[];
}

/**
 * Verify a FOUND/REUSED Item Group still matches the frozen plan.
 *
 * WHY EXTERNAL-ID LOOKUP IS NOT SUFFICIENT AUTHORITY. `nxs-grp-<hash>` proves
 * the group was created for this composition once. It does not prove the group
 * still HAS that composition: a NetSuite administrator can add, remove or
 * re-quantify members afterwards, and the external id does not change when
 * they do. Emitting such a group would produce a Sales Order that reconciles
 * on identity while shipping the wrong contents — the exact
 * attribution-without-reconciliation failure banked in CLAUDE.md.
 *
 * Fails CLOSED. The caller refuses before Sales Order CREATE; it does not
 * rewrite the group. Item Groups are shared NetSuite master data, and silently
 * re-editing one to match our plan could change other orders' meaning.
 */
export function verifyReusedGroupMembership(
  planned: AdaptedGroupInput,
  actual: ActualGroupMember[],
): MembershipVerdict {
  const problems: string[] = [];

  const plannedById = new Map(
    planned.hashInput.members.map((m) => [String(m.netsuiteItemId), m.quantity]),
  );
  const actualById = new Map<string, number>();
  for (const m of actual) {
    const id = String(m.netsuiteItemId);
    // A duplicated member id in NetSuite is itself a divergence, not something
    // to silently sum away.
    if (actualById.has(id)) {
      problems.push(`member ${id} appears more than once in the NetSuite group`);
    }
    actualById.set(id, m.quantity);
  }

  for (const [id, qty] of plannedById) {
    if (!actualById.has(id)) {
      problems.push(`missing member ${id} (planned quantity ${qty})`);
      continue;
    }
    const got = actualById.get(id) as number;
    if (got !== qty) {
      problems.push(`member ${id} quantity ${got} does not match planned ${qty}`);
    }
  }
  for (const id of actualById.keys()) {
    if (!plannedById.has(id)) {
      problems.push(`unexpected member ${id} present in the NetSuite group`);
    }
  }

  return { matches: problems.length === 0, problems };
}

/**
 * Assert the primitive returned the identity the PLAN froze.
 *
 * Guards against the two authorities silently diverging: if the primitive ever
 * computed a different hash for the same composition, the plan — which is the
 * commercial authority and the reconciliation target — must win, and the
 * mismatch must be loud rather than absorbed.
 */
export function assertIdentityMatchesPlan(
  planned: AdaptedGroupInput,
  actual: { compositionHash: string; netsuiteExternalId: string },
): void {
  if (actual.compositionHash !== planned.expectedCompositionHash) {
    throw new GroupAdapterError(
      `Item Group composition hash ${actual.compositionHash} does not match the frozen plan's ` +
        `${planned.expectedCompositionHash}. Two deterministic identities have diverged.`,
      planned.hashInput.baseSku,
    );
  }
  if (actual.netsuiteExternalId !== planned.expectedExternalId) {
    throw new GroupAdapterError(
      `Item Group external id ${actual.netsuiteExternalId} does not match the frozen plan's ` +
        `${planned.expectedExternalId}.`,
      planned.hashInput.baseSku,
    );
  }
}
