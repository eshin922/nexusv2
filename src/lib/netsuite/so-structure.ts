// Grouped Sales Order — structural normalization, rate convergence planning,
// and the final verification gate.
//
// Step 3 of the API-driven Item Group path.
// Design: docs/validation/od-004-grouped-so-recovery-contract.md
//
// Pure: no `server-only`, no database, no NetSuite client. Every rule here is
// provable against mocked provider shapes, which is the point — the dangerous
// decisions (which line to patch, whether an order is commercially complete)
// must be testable without touching a provider.
//
// ─────────────────────────────────────────────────────────────────────────
// THE LINE-ADDRESS BOUNDARY — read this before using `patchAddress`
// ─────────────────────────────────────────────────────────────────────────
//
// `patchSalesOrderLine` addresses a line as:
//
//     PATCH /salesOrder/{soId}/item/{lineIdx}
//
// What `{lineIdx}` actually is has NOT been established. At least three
// candidate numbers exist for the same physical line and they need not agree:
//
//   1. the REST sublist element's own `line` field
//      (`item.items[N].line` — see scripts/parity/so-field-parity.ts:186)
//   2. that element's ARRAY POSITION `N` in `item.items[]`
//   3. SuiteQL `transactionLine.id` / `linesequencenumber`
//
// Concretely, on SO2701 the SuiteQL ids were 0,1,2,3,4 where 0 is the mainline
// and 4 is a system TaxGroup line. If the REST sublist omits mainline and
// system rows, array position and SuiteQL id are OFF BY ONE — and a
// PATCH aimed one line off does not fail. It succeeds, against the wrong line,
// producing a commercially wrong but structurally valid Sales Order. That is
// strictly worse than a failed PATCH.
//
// So this module NEVER computes an address. `ObservedLine.patchAddress` is
// opaque and must be supplied verbatim by whatever read-back the provider
// itself authorises. `planRateConvergence` refuses to plan a PATCH for any
// line whose address is absent, rather than falling back to an index it could
// have derived.
//
// Establishing that mapping requires a live provider observation on a
// disposable transaction. Until it lands, the convergence planner is complete
// and proven, and the executor that consumes it is not authorised to run.

import type { PlannedGroup } from "./grouping-plan";

/** How the provider itself addresses this line for PATCH. Opaque — never derived. */
export type LineAddress = number;

export type ObservedLineKind = "group" | "member" | "endGroup" | "system";

/**
 * One line as observed from the provider.
 *
 * `patchAddress` is null for any line the read-back could not authoritatively
 * address. Planning refuses to target those rather than guessing.
 */
export interface ObservedLine {
  kind: ObservedLineKind;
  netsuiteItemId: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  /** Class id, from the Item record. Verified as preserved, never sent. */
  classId?: string | null;
  patchAddress: LineAddress | null;
}

export interface NormalizedGroup {
  /** The Item Group record's internal id, from the header line. */
  groupItemId: string | null;
  headerQuantity: number | null;
  members: ObservedLine[];
  /** The EndGroup terminator, which carries the group's rolled total. */
  endGroupAmount: number | null;
  /** True when a `Group` opened but no `EndGroup` closed it. */
  unterminated: boolean;
}

export interface NormalizedStructure {
  groups: NormalizedGroup[];
  /** Item lines outside any group — must be empty on a turnkey_only order. */
  ungroupedMembers: ObservedLine[];
  systemLines: ObservedLine[];
}

/**
 * Fold a flat observed line list into `Group → members → EndGroup`.
 *
 * Structure comes from the provider's own line kinds, never from ordering
 * assumptions or SKU heuristics: a `Group` opens, subsequent item lines belong
 * to it, and `EndGroup` closes it carrying the rolled amount. System lines
 * (tax, shipping) are partitioned out — they are not governed commercial
 * fields and must not be mistaken for members.
 */
export function normalizeStructure(lines: ObservedLine[]): NormalizedStructure {
  const groups: NormalizedGroup[] = [];
  const ungroupedMembers: ObservedLine[] = [];
  const systemLines: ObservedLine[] = [];
  let open: NormalizedGroup | null = null;

  for (const line of lines) {
    if (line.kind === "system") {
      systemLines.push(line);
      continue;
    }
    if (line.kind === "group") {
      // A second `Group` before an `EndGroup` means the previous one never
      // closed. Recorded rather than silently merged.
      if (open) {
        open.unterminated = true;
        groups.push(open);
      }
      open = {
        groupItemId: line.netsuiteItemId,
        headerQuantity: line.quantity,
        members: [],
        endGroupAmount: null,
        unterminated: false,
      };
      continue;
    }
    if (line.kind === "endGroup") {
      if (open) {
        open.endGroupAmount = line.amount;
        groups.push(open);
        open = null;
      }
      // An EndGroup with no open Group is malformed input; it contributes
      // nothing rather than inventing a group.
      continue;
    }
    // member
    if (open) open.members.push(line);
    else ungroupedMembers.push(line);
  }
  if (open) {
    open.unterminated = true;
    groups.push(open);
  }

  return { groups, ungroupedMembers, systemLines };
}

export interface MembershipProblem {
  assemblySku: string;
  problem: string;
}

/**
 * Match one planned group's members against one observed group's members.
 *
 * MATCHING IS BY ITEM ID WITHIN A GROUP, NEVER BY SKU ACROSS THE ORDER.
 * Case B repeats `DPS-BOTTLE-0001` in both groups at different negotiated
 * rates ($4 in A, $2 in B). SKU-only matching would make those two lines
 * interchangeable, and a swap between them preserves the $12,000 total
 * exactly — reconciling perfectly while shipping wrong economics. The group
 * boundary is what disambiguates them, so membership is only ever compared
 * inside a single group.
 *
 * A repeated item id WITHIN one group is a duplicate and is rejected, not
 * summed.
 */
export function matchGroupMembership(
  planned: PlannedGroup,
  observed: NormalizedGroup,
  tierQty: number,
): MembershipProblem[] {
  const problems: MembershipProblem[] = [];
  const push = (problem: string) => problems.push({ assemblySku: planned.assemblySku, problem });

  if (observed.unterminated) push("group is not terminated by an EndGroup line");

  const seen = new Set<string>();
  const observedById = new Map<string, ObservedLine>();
  for (const m of observed.members) {
    const id = m.netsuiteItemId === null ? "(null)" : String(m.netsuiteItemId);
    if (seen.has(id)) push(`duplicate member ${id} within the group`);
    seen.add(id);
    observedById.set(id, m);
  }

  for (const pm of planned.members) {
    const id = String(pm.netsuiteItemId);
    const got = observedById.get(id);
    if (!got) {
      push(`missing member ${id} (${pm.sku})`);
      continue;
    }
    // Expected transaction quantity = tier quantity × per-group member
    // quantity. The plan's member.quantity IS the transaction quantity for the
    // accepted tier, so it is compared directly; tierQty is carried so the
    // group header's own quantity can be checked against it.
    if (got.quantity !== pm.quantity) {
      push(`member ${id} quantity ${String(got.quantity)} ≠ planned ${pm.quantity}`);
    }
  }
  for (const id of observedById.keys()) {
    if (!planned.members.some((pm) => String(pm.netsuiteItemId) === id)) {
      push(`unexpected member ${id} present in the group`);
    }
  }

  if (observed.headerQuantity !== null && observed.headerQuantity !== tierQty) {
    push(`group header quantity ${observed.headerQuantity} ≠ tier quantity ${tierQty}`);
  }

  return problems;
}

export interface PlannedPatch {
  assemblySku: string;
  netsuiteItemId: string;
  address: LineAddress;
  observedRate: number | null;
  desiredRate: number;
}

export interface ConvergencePlan {
  patches: PlannedPatch[];
  /** Members already at the planned rate — skipped, not re-patched. */
  alreadyCorrect: number;
  /** Reasons planning could not produce a safe patch set. Non-empty ⇒ refuse. */
  blockers: string[];
}

/**
 * Decide which member lines need a rate PATCH, and to what.
 *
 * CONVERGENT BY CONSTRUCTION:
 *   - desired rates come ONLY from the frozen plan, never from the order;
 *   - members already at the planned rate are skipped, so a fully-correct
 *     order produces zero patches and therefore zero commercial mutation;
 *   - the observed structure is an input, so a fresh read on every invocation
 *     is the caller's only obligation for a partial retry to converge.
 *
 * REFUSES rather than guesses when a line carries no provider-supplied
 * address — see the line-address boundary at the top of this file.
 */
export function planRateConvergence(
  plannedGroups: PlannedGroup[],
  structure: NormalizedStructure,
  tierQty: number,
): ConvergencePlan {
  const patches: PlannedPatch[] = [];
  const blockers: string[] = [];
  let alreadyCorrect = 0;

  if (structure.groups.length !== plannedGroups.length) {
    blockers.push(
      `observed ${structure.groups.length} group(s), plan expects ${plannedGroups.length}`,
    );
    return { patches, alreadyCorrect, blockers };
  }
  if (structure.ungroupedMembers.length > 0) {
    blockers.push(
      `${structure.ungroupedMembers.length} item line(s) sit outside any group on a grouped order`,
    );
  }

  for (let i = 0; i < plannedGroups.length; i++) {
    const planned = plannedGroups[i];
    const observed = structure.groups[i];

    const membership = matchGroupMembership(planned, observed, tierQty);
    if (membership.length > 0) {
      // Never patch into a structure that does not match the plan — patching
      // a wrong-membership order would make it look correct on totals.
      for (const p of membership) blockers.push(`${p.assemblySku}: ${p.problem}`);
      continue;
    }

    for (const pm of planned.members) {
      const line = observed.members.find(
        (m) => String(m.netsuiteItemId) === String(pm.netsuiteItemId),
      ) as ObservedLine;

      if (line.rate !== null && ratesEqual(line.rate, pm.rate)) {
        alreadyCorrect++;
        continue;
      }
      if (line.patchAddress === null) {
        blockers.push(
          `${planned.assemblySku}: member ${pm.netsuiteItemId} needs a rate change but the ` +
            `read-back supplied no provider line address — refusing to derive one`,
        );
        continue;
      }
      patches.push({
        assemblySku: planned.assemblySku,
        netsuiteItemId: String(pm.netsuiteItemId),
        address: line.patchAddress,
        observedRate: line.rate,
        desiredRate: pm.rate,
      });
    }
  }

  // ANY blocker refuses the WHOLE plan, not just the offending group.
  //
  // Without this, a sound group would still yield patches while a divergent
  // sibling was blocked — and a caller that logged `blockers` but proceeded
  // with `patches` would half-price an order whose structure it had already
  // been told not to trust. Refusal is total so that ignoring it cannot cause
  // partial commercial mutation.
  if (blockers.length > 0) {
    return { patches: [], alreadyCorrect, blockers };
  }

  return { patches, alreadyCorrect, blockers };
}

/** 4dp comparison, matching the NetSuite line-rate discipline. */
function ratesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.00005;
}

/** Money comparison at cent tolerance. */
function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export interface HeaderExpectation {
  customerId: string;
  hubspotDealId: string;
  businessSegmentId: string | null;
  /** NetSuite-owned; presence is checked, the value is NetSuite's. */
  termsPresent: boolean;
}

export interface ObservedHeader {
  customerId: string | null;
  hubspotDealId: string | null;
  businessSegmentId: string | null;
  termsId: string | null;
}

export interface SuccessGateResult {
  pass: boolean;
  failures: string[];
}

/**
 * THE FINAL GATE. Every assertion is observed FROM NETSUITE after the last
 * PATCH and read-back — never inferred from what was sent.
 *
 * Header equality is explicitly NOT sufficient: a correct header over wrong
 * membership or wrong rates is the failure this whole path exists to prevent.
 * Both are required, and membership/rate failures are reported even when the
 * header is perfect.
 */
export function evaluateSuccessGate(args: {
  plannedGroups: PlannedGroup[];
  structure: NormalizedStructure;
  tierQty: number;
  acceptedTotal: number;
  header: ObservedHeader;
  expectHeader: HeaderExpectation;
  /** Expected Class id per member item id, from the NetSuite Item record. */
  expectedClassByItemId?: Map<string, string>;
}): SuccessGateResult {
  const failures: string[] = [];
  const { plannedGroups, structure, tierQty, acceptedTotal, header, expectHeader } = args;

  // 1 · expected group count
  if (structure.groups.length !== plannedGroups.length) {
    failures.push(
      `group count ${structure.groups.length} ≠ planned ${plannedGroups.length}`,
    );
  }
  if (structure.ungroupedMembers.length > 0) {
    failures.push(`${structure.ungroupedMembers.length} item line(s) outside any group`);
  }

  const n = Math.min(structure.groups.length, plannedGroups.length);
  let groupAmountSum = 0;

  for (let i = 0; i < n; i++) {
    const planned = plannedGroups[i];
    const observed = structure.groups[i];

    // 2,3,4 · membership, duplicates/extras/missing, quantities
    for (const p of matchGroupMembership(planned, observed, tierQty)) {
      failures.push(`${p.assemblySku}: ${p.problem}`);
    }

    for (const pm of planned.members) {
      const line = observed.members.find(
        (m) => String(m.netsuiteItemId) === String(pm.netsuiteItemId),
      );
      if (!line) continue; // already reported by membership

      // 5 · negotiated rate
      if (line.rate === null || !ratesEqual(line.rate, pm.rate)) {
        failures.push(
          `${planned.assemblySku}: member ${pm.netsuiteItemId} rate ${String(line.rate)} ≠ planned ${pm.rate}`,
        );
      }
      // 8 · no governed commercial member left at $0.00
      if (line.rate === 0 || line.amount === 0) {
        failures.push(
          `${planned.assemblySku}: member ${pm.netsuiteItemId} is $0.00 — the un-priced expansion state`,
        );
      }
      // Item-derived Class preserved
      const expectedClass = args.expectedClassByItemId?.get(String(pm.netsuiteItemId));
      if (expectedClass !== undefined && line.classId !== undefined) {
        if (String(line.classId) !== String(expectedClass)) {
          failures.push(
            `${planned.assemblySku}: member ${pm.netsuiteItemId} class ${String(line.classId)} ≠ Item-derived ${expectedClass}`,
          );
        }
      }
    }

    // 6 · group amount equals expectedAmount
    if (observed.endGroupAmount === null) {
      failures.push(`${planned.assemblySku}: no EndGroup amount observed`);
    } else {
      groupAmountSum += observed.endGroupAmount;
      if (!amountsEqual(observed.endGroupAmount, planned.expectedAmount)) {
        failures.push(
          `${planned.assemblySku}: group amount ${observed.endGroupAmount} ≠ expected ${planned.expectedAmount}`,
        );
      }
    }
  }

  // 7 · Σ group amounts = accepted total
  if (!amountsEqual(groupAmountSum, acceptedTotal)) {
    failures.push(`Σ group amounts ${groupAmountSum} ≠ accepted total ${acceptedTotal}`);
  }

  // Header — checked IN ADDITION, never INSTEAD.
  if (String(header.customerId) !== String(expectHeader.customerId)) {
    failures.push(`customer ${String(header.customerId)} ≠ ${expectHeader.customerId}`);
  }
  if (String(header.hubspotDealId) !== String(expectHeader.hubspotDealId)) {
    failures.push(`HubSpot deal ${String(header.hubspotDealId)} ≠ ${expectHeader.hubspotDealId}`);
  }
  if (
    expectHeader.businessSegmentId !== null &&
    String(header.businessSegmentId) !== String(expectHeader.businessSegmentId)
  ) {
    failures.push(
      `Business Segment ${String(header.businessSegmentId)} ≠ ${expectHeader.businessSegmentId}`,
    );
  }
  if (expectHeader.termsPresent && !header.termsId) {
    failures.push("NetSuite-owned Terms absent from the order");
  }

  return { pass: failures.length === 0, failures };
}
