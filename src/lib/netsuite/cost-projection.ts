// Governed product cost → NetSuite's standard Accounting cost basis.
//
// WHAT THIS IS. A one-shot projection of the cost Nexus already governs onto the
// fields NetSuite's Unit Cost display and margin reporting actually read
// (`costEstimateType` + `costEstimateRate`). It is not a repair of missing data:
// Nexus has always transmitted the governed unit cost, but only to
// `custcol_dps_unit_cost`, a custom column those standard surfaces do not read.
// With the native field unset NetSuite falls back to the item master's costing
// method, which on the certified Sales Orders was AVGCOST against an empty basis
// — displayed as blank — and on other items resolves to LASTPURCHPRICE figures
// wholly unrelated to the quote.
//
// WHY IT IS SEPARATE FROM RATE CONVERGENCE. Rate convergence exists because the
// commercial rates must sum to the accepted total; it re-reads, compares and
// re-patches until that gate passes. Cost has no such invariant — it is a
// straight projection with nothing to converge toward. Folding it into that loop
// would subject a one-shot value to a retry mechanism built for a different
// problem, and would let a cost mismatch fail a commercial gate it has no
// bearing on. Cost is written once, after member identities exist, and reported.
//
// WHY IT IS NOT A GATE. A cost-projection failure must not block a Sales Order
// that is commercially correct. Accounting's basis being unset is a reporting
// degradation; refusing the push over it would convert a reporting problem into
// an operational one at the irreversible commit point. Failures are collected
// and surfaced, never thrown.

/** One line as read back from the provider. Matches `readSalesOrderLines`. */
export interface ProjectionLine {
  line: number;
  itemId: string | null;
  itemType: string | null;
  quantity: number | null;
}

/** Governed cost for one member, keyed by the NetSuite item it resolved to. */
export interface GovernedMemberCost {
  netsuiteItemId: string;
  /** Null ⇒ no governed cost; the line is skipped, never written as zero. */
  unitCost: number | null;
}

export interface CostProjectionAction {
  /** Per-line address for the scalar PATCH URL. */
  address: number;
  netsuiteItemId: string;
  unitCost: number;
}

export interface CostProjectionPlan {
  actions: CostProjectionAction[];
  /** Lines deliberately not written, with the reason. Evidence, not noise. */
  skipped: Array<{ address: number; reason: string }>;
}

/**
 * Decide which lines receive a governed cost. Pure — no I/O, no provider.
 *
 * Structural lines are excluded by TYPE rather than by guessing from a missing
 * field: an Item Group header and its EndGroup marker carry no cost fields at
 * all, and the 2026-08-13 sandbox probe confirmed that cost sent on a group
 * line is accepted and silently discarded. Writing to them would be a no-op
 * that reads like success.
 */
export function planCostProjection(args: {
  lines: ProjectionLine[];
  governed: GovernedMemberCost[];
}): CostProjectionPlan {
  const costByItem = new Map<string, number | null>();
  for (const g of args.governed) {
    // First writer wins. Two members resolving to the SAME NetSuite item must
    // agree on cost — they are the same product — so a later differing value
    // would be a contradiction, not an update. Keeping the first makes the
    // projection order-independent for agreeing inputs and refuses to silently
    // pick a winner between disagreeing ones.
    if (!costByItem.has(g.netsuiteItemId)) costByItem.set(g.netsuiteItemId, g.unitCost);
  }

  const actions: CostProjectionAction[] = [];
  const skipped: CostProjectionPlan["skipped"] = [];

  for (const l of args.lines) {
    const type = l.itemType ?? "";
    if (type === "Group" || type === "EndGroup") {
      skipped.push({ address: l.line, reason: `structural line (${type})` });
      continue;
    }
    if (!l.itemId) {
      skipped.push({ address: l.line, reason: "no item id on line" });
      continue;
    }
    if (!costByItem.has(l.itemId)) {
      skipped.push({ address: l.line, reason: "line not in the governed plan" });
      continue;
    }
    const cost = costByItem.get(l.itemId) ?? null;
    if (cost === null) {
      // Absent governed cost leaves NetSuite's own default intact. A zero would
      // assert the product is free; silence asserts nothing.
      skipped.push({ address: l.line, reason: "no governed cost — default preserved" });
      continue;
    }
    actions.push({ address: l.line, netsuiteItemId: l.itemId, unitCost: cost });
  }

  return { actions, skipped };
}

export interface CostProjectionOutcome {
  written: number;
  skipped: number;
  failures: Array<{ address: number; message: string }>;
}

/**
 * Execute the plan through the per-line scalar PATCH boundary.
 *
 * `patchLine` is the narrow single-line function — never a full-sublist PATCH,
 * which returns 204 while silently adding a second group expansion.
 */
export async function projectGovernedCosts(args: {
  plan: CostProjectionPlan;
  patchLine: (address: number, unitCost: number) => Promise<void>;
}): Promise<CostProjectionOutcome> {
  const failures: CostProjectionOutcome["failures"] = [];
  let written = 0;

  for (const a of args.plan.actions) {
    try {
      await args.patchLine(a.address, a.unitCost);
      written += 1;
    } catch (e) {
      // Collected, not thrown — see the header. One member failing to receive
      // its cost basis must not unwind a commercially complete Sales Order.
      failures.push({
        address: a.address,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { written, skipped: args.plan.skipped.length, failures };
}
