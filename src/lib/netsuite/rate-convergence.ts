// Grouped Sales Order — negotiated member-rate convergence executor.
//
// Step 3 executor. Design: docs/validation/od-004-grouped-so-recovery-contract.md
//
// Provider access is INJECTED, so the whole loop — including crash/resume — is
// provable without touching NetSuite. `markComplete` supplies the real
// implementations; tests supply fakes.
//
// THE ADDRESS RULE, proven on a disposable sandbox order (SO 361241,
// 2026-08-12, since deleted):
//
//   the PATCH address is the expanded line's OWN provider-supplied address.
//
// Never REST array position — the collection omits the mainline and system
// rows, so position [0] carried address /item/1 and the first MEMBER sat at
// position [1] with address /item/2. Patching by position would have written
// the Group header instead of the member, succeeding silently against the
// wrong commercial line.
//
// Never SuiteQL ids or line sequence numbers either — after a single member
// PATCH the TaxGroup row's id moved 5 → 6 while commercial lines kept theirs.
// They are not stable across mutation.
//
// SuiteQL/B3 remains valuable as INDEPENDENT verification evidence. It is
// never cross-correlated with REST rows to manufacture an address.

import type { PlannedGroup } from "./grouping-plan";
import {
  evaluateSuccessGate,
  normalizeStructure,
  planRateConvergence,
  type ObservedHeader,
  type ObservedLine,
  type ObservedLineKind,
  type HeaderExpectation,
  type SuccessGateResult,
} from "./so-structure";

/** One line exactly as `readSalesOrderLines` returns it. */
export interface ProviderLine {
  /** The provider's own address. The ONLY value PATCH may be aimed at. */
  line: number;
  itemId: string | null;
  itemType: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  classId: string | null;
}

export interface ConvergenceProvider {
  readLines(soId: string): Promise<ProviderLine[]>;
  readHeader(soId: string): Promise<ObservedHeader>;
  patchLine(soId: string, address: number, patch: { rate: number }): Promise<void>;
}

/** NetSuite line kinds that are structure or system, not commercial members. */
const GROUP_TYPES = new Set(["Group"]);
const END_GROUP_TYPES = new Set(["EndGroup"]);
const SYSTEM_TYPES = new Set(["TaxGroup", "ShipItem", "Discount", "Subtotal", "Markup"]);

/**
 * Map provider lines to the structural shape, carrying the provider address
 * through untouched.
 *
 * The address is copied verbatim from `line`. Nothing here computes,
 * re-bases, or infers an index — if a provider line ever arrives without one,
 * `patchAddress` stays null and the planner refuses to target it.
 */
export function toObservedLines(lines: ProviderLine[]): ObservedLine[] {
  return lines.map((l) => {
    const t = l.itemType ?? "";
    const kind: ObservedLineKind = GROUP_TYPES.has(t)
      ? "group"
      : END_GROUP_TYPES.has(t)
        ? "endGroup"
        : SYSTEM_TYPES.has(t)
          ? "system"
          : "member";
    return {
      kind,
      netsuiteItemId: l.itemId,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      classId: l.classId,
      patchAddress: typeof l.line === "number" ? l.line : null,
    };
  });
}

export interface ConvergenceOutcome {
  /** Rate PATCHes actually issued this run. */
  patched: Array<{ address: number; netsuiteItemId: string; rate: number }>;
  /** Members already at the planned rate — skipped, not re-written. */
  alreadyCorrect: number;
  /** Structural refusals. Non-empty ⇒ nothing was patched. */
  blockers: string[];
  gate: SuccessGateResult;
}

/**
 * Drive an existing Sales Order to its frozen negotiated rates and verify.
 *
 * CONVERGENT, not replayed. Every invocation re-reads the order, re-derives
 * addresses from that read, skips members already correct, and patches only
 * what still differs — so a run interrupted at any point is completed by
 * simply running again, and a run against a finished order performs no
 * commercial mutation at all.
 *
 * Never creates anything. The caller must already hold a `netsuite_so_id`.
 */
export async function runRateConvergence(args: {
  soId: string;
  plannedGroups: PlannedGroup[];
  tierQty: number;
  acceptedTotal: number;
  expectHeader: HeaderExpectation;
  provider: ConvergenceProvider;
  /** Expected Item-derived Class per member item id, for the gate. */
  expectedClassByItemId?: Map<string, string>;
}): Promise<ConvergenceOutcome> {
  const { soId, plannedGroups, tierQty, acceptedTotal, expectHeader, provider } = args;

  // 1-2 · fresh read, every invocation. Addresses are never carried across
  // runs; a stale address is how a "safe" single-line PATCH writes the wrong
  // line.
  const before = normalizeStructure(toObservedLines(await provider.readLines(soId)));

  // 3-5 · compare against the frozen plan. Any structural blocker refuses the
  // WHOLE run — patching into a structure that does not match the plan would
  // make a wrong order reconcile on totals.
  const plan = planRateConvergence(plannedGroups, before, tierQty);

  const patched: ConvergenceOutcome["patched"] = [];
  if (plan.blockers.length === 0) {
    // 6-7 · patch each mismatch at ITS OWN observed provider address.
    for (const p of plan.patches) {
      await provider.patchLine(soId, p.address, { rate: p.desiredRate });
      patched.push({ address: p.address, netsuiteItemId: p.netsuiteItemId, rate: p.desiredRate });
    }
  }

  // 8-9 · re-read the whole order and verify against PROVIDER state, not
  // against what was sent.
  const after = normalizeStructure(toObservedLines(await provider.readLines(soId)));
  const header = await provider.readHeader(soId);
  const gate = evaluateSuccessGate({
    plannedGroups,
    structure: after,
    tierQty,
    acceptedTotal,
    header,
    expectHeader,
    expectedClassByItemId: args.expectedClassByItemId,
  });

  // Structural refusals are gate failures too — a blocked run must never
  // report a passing gate just because the order happened to look complete.
  const failures = plan.blockers.length > 0
    ? { pass: false, failures: [...plan.blockers, ...gate.failures] }
    : gate;

  return { patched, alreadyCorrect: plan.alreadyCorrect, blockers: plan.blockers, gate: failures };
}
