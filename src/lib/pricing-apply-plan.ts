// Phase 3 · Package 1 — what an Apply actually changes.
//
// Separated from the action for the reason `diffSets` is separated from the
// provider: this is logic, and logic that needs a database to exercise is
// logic that does not get exercised. Everything here is a pure function of
// "what the operator intends" and "what the quote carries".
//
// ── THE SET IS COMPLETE, NOT A DELTA ──────────────────────────────────────
//
// `planApply` is handed the intended END STATE, not a list of edits. An
// intended set that omits a cell is REMOVING it. That is the only shape in
// which "remove the lift on GLW-50 · T2" can be expressed at all — a
// delta-shaped call has no way to say a thing is gone — and removal is the
// change an operator most needs to survive a reload.
//
// ── WHY COMPARISON IS NUMERIC ─────────────────────────────────────────────
//
// Stored values are Postgres `numeric` and arrive as strings: `"0.0770"` and
// `"0.077"` are the same lift. Comparing them as text reports a change on
// every Apply, which writes a row, writes an audit entry, and tells the
// operator something happened when nothing did.

export type LiftIntent = {
  quoteLeafId: string;
  tierId: string;
  /** Multiplicative. `0.077` is +7.7%. */
  liftPct: number;
};

export type OverrideIntent = {
  quoteLeafId: string;
  tierId: string;
  sellPrice: number;
};

/** A stored row, already resolved to canonical identity by the caller. */
export type PersistedValue = { key: string; stored: string };

export type PlannedChange = { key: string; from: string | null; to: string };
export type PlannedRemoval = { key: string; from: string };

export type ApplyPlan = {
  liftsSet: PlannedChange[];
  liftsRemoved: PlannedRemoval[];
  overridesSet: PlannedChange[];
  overridesRemoved: PlannedRemoval[];
  /**
   * Per-tier adjustments, keyed by tier id.
   *
   * The fourth lever. It is staged like the other three: the staging set
   * carries it, the preview evaluates it, and Apply sends the COMPLETE
   * intended set, so an absent tier is a removal.
   *
   * It was not always. Until P3-016 the recommendation CTAs wrote
   * `quote_tiers.tier_price_adj_pct` at click time and nothing staged one,
   * which is why this field's presence in the plan was originally justified
   * by Return to baseline alone. That reason still holds and is no longer
   * the only one.
   */
  tierAdjSet: PlannedChange[];
  tierAdjRemoved: PlannedRemoval[];
  /** Null when the quote-wide adjustment did not move. */
  globalAdj: { from: string; to: string } | null;
  changeCount: number;
};

/**
 * The composite address of one cell, as it appears in `audit_log.entity_id`.
 *
 * `:` rather than the staging layer's `::`. Deliberately different: a staging
 * key is a browser-session address and an entity id is a durable one, and a
 * shared separator would invite one to be parsed as the other.
 */
export const applyCellId = (quoteLeafId: string, tierId: string) =>
  `${quoteLeafId}:${tierId}`;

/** Split an `applyCellId`. The only place one comes apart. */
export function parseApplyCellId(id: string): {
  quoteLeafId: string;
  tierId: string;
} {
  const [quoteLeafId, tierId] = id.split(":");
  return { quoteLeafId, tierId };
}

/** `"0.0770"` and `"0.077"` are one lift, not two. */
export const sameStoredNumber = (a: string, b: string) => Number(a) === Number(b);

function diffOne(
  intended: ReadonlyMap<string, string>,
  persisted: ReadonlyMap<string, string>,
): { set: PlannedChange[]; removed: PlannedRemoval[] } {
  const set: PlannedChange[] = [];
  const removed: PlannedRemoval[] = [];
  for (const [key, to] of intended) {
    const from = persisted.get(key) ?? null;
    if (from !== null && sameStoredNumber(from, to)) continue;
    set.push({ key, from, to });
  }
  for (const [key, from] of persisted) {
    if (!intended.has(key)) removed.push({ key, from });
  }
  return { set, removed };
}

export function planApply(input: {
  intendedLifts: ReadonlyMap<string, string>;
  intendedOverrides: ReadonlyMap<string, string>;
  /**
   * What the quote carries. For overrides this is the CANONICALLY ADDRESSABLE
   * subset only — a persisted override on a junction with no canonical row is
   * real and in effect but cannot appear in a canonically-addressed set, so its
   * absence from that set is not a removal. It is unrepresentable. Treating it
   * as a removal would delete a price the operator never saw, let alone chose
   * to remove.
   */
  persistedLifts: ReadonlyMap<string, string>;
  persistedOverrides: ReadonlyMap<string, string>;
  intendedTierAdj: ReadonlyMap<string, string>;
  persistedTierAdj: ReadonlyMap<string, string>;
  globalAdjFrom: string;
  globalAdjTo: string;
}): ApplyPlan {
  const lifts = diffOne(input.intendedLifts, input.persistedLifts);
  const overrides = diffOne(input.intendedOverrides, input.persistedOverrides);
  const tierAdj = diffOne(input.intendedTierAdj, input.persistedTierAdj);
  const globalAdj = sameStoredNumber(input.globalAdjFrom, input.globalAdjTo)
    ? null
    : { from: input.globalAdjFrom, to: input.globalAdjTo };

  // A NEW GLOBAL ADJUSTMENT CLEARS EXISTING TIER OVERRIDES.
  //
  // Precedence is `tier ?? global`, so a tier carrying its own rate ignores the
  // quote-wide one entirely. On a live quote every tier held a legacy
  // Setup-origin rate, so an operator applied 300%, saw it persisted and
  // displayed, and it moved nothing: 3.0 was in force nowhere while four tier
  // rates of 0.2911 and 0.1115 were.
  //
  // Two pricing authorities were live at once and the newer one silently lost.
  // Explanatory copy would not have fixed that — it would have documented it.
  // So setting a global rate is now a statement about the whole quote, and it
  // clears the exceptions.
  //
  // A tier override SET IN THE SAME APPLY survives, because the operator asked
  // for both in one gesture and the exception is deliberate. Only stale ones go.
  const tierAdjRemoved = [...tierAdj.removed];
  if (globalAdj !== null) {
    const explicit = new Set(tierAdj.set.map((c) => c.key));
    const alreadyRemoved = new Set(tierAdj.removed.map((c) => c.key));
    for (const [key, from] of input.persistedTierAdj) {
      if (explicit.has(key) || alreadyRemoved.has(key)) continue;
      tierAdjRemoved.push({ key, from });
    }
  }

  return {
    liftsSet: lifts.set,
    liftsRemoved: lifts.removed,
    overridesSet: overrides.set,
    overridesRemoved: overrides.removed,
    tierAdjSet: tierAdj.set,
    tierAdjRemoved,
    globalAdj,
    changeCount:
      lifts.set.length +
      lifts.removed.length +
      overrides.set.length +
      overrides.removed.length +
      tierAdj.set.length +
      tierAdjRemoved.length +
      (globalAdj === null ? 0 : 1),
  };
}
