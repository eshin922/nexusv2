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
  /**
   * Item lines outside any group.
   *
   * These are no longer an error by definition. A Direct Product is a peer
   * projection — assembly-less by the operator's explicit choice — and lands
   * here legitimately. What must hold is that every one of them was PLANNED:
   * an unexpected ungrouped line is still a failure, and a planned one that is
   * ABSENT is the more dangerous failure, because the order still reconciles
   * internally without it.
   */
  ungroupedMembers: ObservedLine[];
  systemLines: ObservedLine[];
}

/**
 * A Direct Product line the accepted quote requires on the Sales Order.
 *
 * Carried separately from `PlannedGroup` because the two are peers with
 * different provider mechanics: a group is expanded by NetSuite, a Direct line
 * is sent whole.
 */
export interface PlannedDirectLine {
  sku: string;
  netsuiteItemId: string;
  quantity: number;
  rate: number;
  /** `rate × quantity`, 4dp — this line's contribution to the accepted total. */
  amount: number;
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
  /**
   * Direct Product lines the accepted quote requires outside the groups.
   * Optional so existing callers keep their exact previous meaning: with none
   * declared, every ungrouped line is unexpected, as before.
   */
  plannedDirectLines: PlannedDirectLine[] = [],
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

  // Only UNPLANNED ungrouped lines block.
  //
  // This planner is the half that ACTS; `evaluateSuccessGate` is the half that
  // REPORTS. Repairing the reporter alone left this one still refusing every
  // ungrouped line, so a mixed order blocked here, no rate was patched at all,
  // and the members stayed at the $0.00 un-priced expansion — observed live on
  // SO2714. A structural assumption has to be lifted everywhere it was encoded,
  // and the acting half matters more than the reporting half.
  const expectedUngrouped = new Set(
    plannedDirectLines.map((l) => String(l.netsuiteItemId)),
  );
  const unexpected = structure.ungroupedMembers.filter(
    (l) => !expectedUngrouped.has(String(l.netsuiteItemId)),
  );
  if (unexpected.length > 0) {
    blockers.push(
      `${unexpected.length} unplanned item line(s) sit outside any group on a grouped order`,
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
  /**
   * Direct Product lines the accepted quote requires. Empty for a
   * group-only order; omitted defaults to empty, so existing callers keep
   * their previous meaning exactly.
   */
  plannedDirectLines?: PlannedDirectLine[];
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
  const plannedDirectLines = args.plannedDirectLines ?? [];

  // 1 · expected group count
  if (structure.groups.length !== plannedGroups.length) {
    failures.push(
      `group count ${structure.groups.length} ≠ planned ${plannedGroups.length}`,
    );
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

  // 6b · Direct Product lines — presence and attribution, not just totals.
  //
  // THE FAILURE THIS EXISTS TO CATCH. A mixed order missing its Direct line
  // reconciles perfectly against its own remaining lines: the groups match
  // their planned amounts, every member is present at the right rate, and
  // nothing looks wrong. Only comparing the observed set against what was
  // ACCEPTED reveals that a product the customer bought never reached the
  // order. Totals alone are structurally incapable of catching it, which is
  // why each planned line is matched individually below.
  let directAmountSum = 0;
  const observedUngrouped = [...structure.ungroupedMembers];

  for (const planned of plannedDirectLines) {
    const idx = observedUngrouped.findIndex(
      (l) => String(l.netsuiteItemId) === String(planned.netsuiteItemId),
    );
    if (idx === -1) {
      // Also assert it was not smuggled INTO a group — a Direct Product that
      // reappears as a group member is misattributed, not merely missing, and
      // the two need different remedies.
      const swallowed = structure.groups.some((g) =>
        g.members.some(
          (m) => String(m.netsuiteItemId) === String(planned.netsuiteItemId),
        ),
      );
      failures.push(
        swallowed
          ? `Direct Product ${planned.sku} (${planned.netsuiteItemId}) appears INSIDE an Item Group — it was accepted as a standalone line`
          : `Direct Product ${planned.sku} (${planned.netsuiteItemId}) is ABSENT from the Sales Order — accepted but never projected`,
      );
      continue;
    }
    const line = observedUngrouped.splice(idx, 1)[0];

    if (Number(line.quantity) !== Number(planned.quantity)) {
      failures.push(
        `Direct Product ${planned.sku}: quantity ${String(line.quantity)} ≠ accepted ${planned.quantity}`,
      );
    }
    if (line.rate === null || !ratesEqual(line.rate, planned.rate)) {
      failures.push(
        `Direct Product ${planned.sku}: rate ${String(line.rate)} ≠ accepted ${planned.rate}`,
      );
    }
    if (line.rate === 0 || line.amount === 0) {
      failures.push(`Direct Product ${planned.sku} is $0.00 — un-priced`);
    }
    if (line.amount !== null) directAmountSum += line.amount;
  }

  // Any ungrouped line left over was never accepted. Previously EVERY ungrouped
  // line was an error; now only the unplanned ones are — the check narrowed
  // rather than disappeared.
  for (const extra of observedUngrouped) {
    failures.push(
      `unexpected ungrouped line: item ${String(extra.netsuiteItemId)} was not part of the accepted quote`,
    );
  }

  // A grouped member must never ALSO appear as a flat line — that is the
  // Probe 7a doubling, observed from the provider side rather than prevented
  // at the payload.
  for (const g of structure.groups) {
    for (const m of g.members) {
      if (
        structure.ungroupedMembers.some(
          (u) => String(u.netsuiteItemId) === String(m.netsuiteItemId),
        )
      ) {
        failures.push(
          `item ${String(m.netsuiteItemId)} appears BOTH inside a group and as a flat line — duplicated`,
        );
      }
    }
  }

  // 7 · Σ group amounts + Σ Direct amounts = accepted total.
  //
  // Summing groups alone was correct only while every line was grouped. Once
  // Direct Products became a peer projection it under-counted the order by
  // exactly the Direct subtotal, so a CORRECT mixed order failed the gate and
  // an order missing its Direct line could have passed it.
  const commercialTotal = groupAmountSum + directAmountSum;
  if (!amountsEqual(commercialTotal, acceptedTotal)) {
    failures.push(
      `Σ group amounts ${groupAmountSum} + Σ Direct amounts ${directAmountSum} = ${commercialTotal} ≠ accepted total ${acceptedTotal}`,
    );
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
