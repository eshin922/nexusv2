/**
 * Client Target resolution — one rule, one place.
 *
 *     effective target = tier target ?? common target
 *
 * Pure, and shared by everything that needs an answer: the adapter that feeds
 * the engine, the Setup surface that authors it, and the Costs and Pricing
 * surfaces that read it. Resolution happening once is the point — the model it
 * replaced was resolved differently in two places, and the two disagreed
 * whenever a tier carried its own target.
 *
 * ── WHAT REPLACED WHAT ────────────────────────────────────────────────────
 *
 * The prior read path collapsed per-(leaf, tier) persistence to ONE value per
 * SKU row — "the first non-null target found while iterating tiers" — and then
 * computed every cell's headroom against it. The engine meanwhile compared each
 * cell to its own true target. Two bases for one question, agreeing only while
 * every tier shared a target, which is the only state that ever existed.
 *
 * Nothing here collapses. A tier without its own target inherits the common
 * one; a tier without either has none, and `null` says so rather than standing
 * in for zero.
 */

/** One persisted row, as the loader returns it. */
export type ClientTargetRow = {
  /** Exactly one of these two identifies the sellable unit. */
  assemblyId: string | null;
  quoteLeafId: string | null;
  /** NULL = the common target, applying to every tier. */
  tierId: string | null;
  clientTargetPricePerUnit: number;
};

/**
 * Targets for one sellable unit, indexed for resolution.
 *
 * `common` is null when the operator has cleared it while leaving tier-specific
 * targets standing — a real state, and one the surface names ("1 tier targeted
 * · 3 unset") rather than one to be prevented.
 */
export type UnitTargets = {
  common: number | null;
  byTier: ReadonlyMap<string, number>;
};

/** Empty, shared — a unit with no targets allocates nothing. */
const NO_TARGETS: UnitTargets = { common: null, byTier: new Map() };

/**
 * Group rows by sellable unit.
 *
 * The unit key is whichever id column is set. The two are disjoint UUID spaces
 * and the schema's CHECK guarantees exactly one, so a single map is safe and a
 * row that somehow carried both or neither is skipped rather than guessed at.
 */
export function indexClientTargets(
  rows: ReadonlyArray<ClientTargetRow>,
): ReadonlyMap<string, UnitTargets> {
  const out = new Map<string, { common: number | null; byTier: Map<string, number> }>();
  for (const r of rows) {
    const unitId = unitKeyOf(r);
    if (unitId === null) continue;
    let entry = out.get(unitId);
    if (entry === undefined) {
      entry = { common: null, byTier: new Map() };
      out.set(unitId, entry);
    }
    if (r.tierId === null) entry.common = r.clientTargetPricePerUnit;
    else entry.byTier.set(r.tierId, r.clientTargetPricePerUnit);
  }
  return out;
}

/** Null when a row identifies no unit, or impossibly identifies two. */
export function unitKeyOf(r: ClientTargetRow): string | null {
  if (r.assemblyId !== null && r.quoteLeafId !== null) return null;
  return r.assemblyId ?? r.quoteLeafId;
}

/**
 * The target in force for one tier, and whether it is the tier's own.
 *
 * `source` is returned rather than left for the caller to infer by comparing
 * values: a tier override that happens to equal the common target is still an
 * override, and an operator who set one deliberately should see it named.
 */
export function resolveClientTarget(
  targets: UnitTargets | undefined,
  tierId: string,
): { value: number | null; source: "tier" | "common" | "none" } {
  const t = targets ?? NO_TARGETS;
  const own = t.byTier.get(tierId);
  if (own !== undefined) return { value: own, source: "tier" };
  if (t.common !== null) return { value: t.common, source: "common" };
  return { value: null, source: "none" };
}

/**
 * How the row summarises itself when the drawer is shut.
 *
 * Three states, and the third is the one that needs care. With no common target
 * but some tier targets set, a summary like "2 targets" reads as though the
 * quote is covered; "2 tiers targeted · 2 unset" says what is actually true.
 */
export function summariseClientTargets(
  targets: UnitTargets | undefined,
  tierCount: number,
): string | null {
  const t = targets ?? NO_TARGETS;
  const overrides = t.byTier.size;
  if (t.common === null && overrides === 0) return null;
  if (t.common !== null) {
    return overrides === 0
      ? "all tiers"
      : `${tierCount - overrides} tier${tierCount - overrides === 1 ? "" : "s"} · ` +
        `${overrides} override${overrides === 1 ? "" : "s"}`;
  }
  const unset = Math.max(0, tierCount - overrides);
  return `${overrides} tier${overrides === 1 ? "" : "s"} targeted · ${unset} unset`;
}

/**
 * The facts a surface may state about one cell, and nothing more.
 *
 * No verdict. "Above the client target" is commercially relevant and may still
 * be the right quote, so this returns the gap and lets the surface say
 * "$0.35 above client target" — a fact — rather than a word like
 * "uncompetitive" that decides something nobody has defined.
 *
 * `marginAtTarget` answers the question an operator actually asks next: if we
 * did quote at their number, what would we make? Null when there is no target,
 * no cost, or a target of zero — at zero there is no revenue to take a margin
 * of, and `-Infinity` is not an answer.
 */
export function clientTargetFacts(args: {
  target: number | null;
  quotedSellPerUnit: number | null;
  costPerUnit: number | null;
}): {
  gapAbs: number | null;
  gapPct: number | null;
  marginAtTarget: number | null;
} | null {
  const { target, quotedSellPerUnit, costPerUnit } = args;
  if (target === null) return null;
  const gapAbs =
    quotedSellPerUnit === null ? null : quotedSellPerUnit - target;
  const gapPct =
    gapAbs === null || target === 0 ? null : gapAbs / target;
  const marginAtTarget =
    costPerUnit === null || target <= 0 ? null : (target - costPerUnit) / target;
  return { gapAbs, gapPct, marginAtTarget };
}

/** Operator wording for a gap. Factual and directional; never a verdict. */
export function describeGap(gapAbs: number | null): string | null {
  if (gapAbs === null) return null;
  // A hundredth of a cent either way is the same price, and "$0.00 above
  // client target" reads as a difference when there is none.
  if (Math.abs(gapAbs) < 0.00005) return "at client target";
  const usd = Math.abs(gapAbs).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${usd} ${gapAbs > 0 ? "above" : "below"} client target`;
}
