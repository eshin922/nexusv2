// Phase 3 · the staging model — the pure half.
//
// Separated from the provider because JSX cannot be type-stripped by the test
// runner, and because the separation is honest anyway: `diffSets` IS H3, and
// H3 is logic, not presentation. A property listed High severity should be
// testable without mounting anything.
//
//     `isStaged` is a DIFFERENCE, not a property.
//
// Phase 3 names the failure precisely: derived from the working set alone it
// stays true forever after Apply, and "the failure is silent" — the page keeps
// offering to commit changes that are already committed, and nothing looks
// broken. There is no flag below for that reason. The two sets are compared on
// every render, and after Apply they are identical, so the comparison yields
// nothing. It cannot get stuck because there is no state to get stuck in.

// ── the set ───────────────────────────────────────────────────────────────

/** A cell, addressed the way lifts and overrides both address one. */
export type CellRef = { quoteLeafId: string; tierId: string };

export function cellKey(ref: CellRef): string {
  return `${ref.quoteLeafId}::${ref.tierId}`;
}

/**
 * The inverse. The ONLY place a staging key is taken apart.
 *
 * Hand-splitting was how the halves got misnamed: one site wrote
 * `const [quoteSkuId, tierId] = key.split("::")` and thereby asserted, in a
 * variable name, that the canonical half was an engine SKU id. It is not, and
 * nothing objected — both are strings, both are UUIDs, and the engine simply
 * ignored a row it could not match. Staged direct prices did nothing at all.
 *
 * A named parse returns a `CellRef`, so the halves keep the names they were
 * given and a caller that needs the engine's identity has to go and resolve it.
 */
export function parseCellKey(key: string): CellRef {
  const [quoteLeafId, tierId] = key.split("::");
  return { quoteLeafId, tierId };
}

/** A cell as the ENGINE addresses it. Deliberately not `CellRef`. */
export type EngineCellRef = { quoteSkuId: string; tierId: string };

/** The engine's own key for an override row, so comparisons happen in one space. */
export function engineCellKey(ref: EngineCellRef): string {
  return `${ref.quoteSkuId}::${ref.tierId}`;
}

/**
 * Canonical quote-leaf identity → the engine's SKU identity. The governed
 * boundary between the two, and the only sanctioned crossing.
 *
 * `CostingLift` is keyed on canonical identity by design, so lifts never come
 * through here. `CostingCellOverride.quoteSkuId` is the engine's, so overrides
 * always must.
 *
 * FAILS CLOSED on both missing and ambiguous — the same posture `resolveNode`
 * takes, and for the same reason. A second match is not a near-miss to resolve
 * by taking the first: "the first" is an ordering accident, and the two are
 * different commercial lines. Returning null means the caller emits nothing,
 * which loses a staged change visibly rather than moving the wrong cell's
 * price.
 */
/**
 * The inverse: engine SKU identity → canonical quote-leaf identity.
 *
 * Needed to SEED the committed set. Persisted overrides arrive keyed the
 * engine's way (`CostingCellOverride.quoteSkuId`), and the staging model
 * addresses cells canonically, so an override already in effect has to be
 * translated before it can be represented as something the operator can stage
 * a change against.
 *
 * Fails closed, symmetrically with `resolveEngineCell`. A persisted override
 * whose SKU carries no canonical attachment cannot be expressed as a staging
 * key at all — the caller keeps it in the costing input unchanged rather than
 * dropping it, because it is real and in effect even though it is not
 * stageable.
 */
export function resolveCanonicalCell(
  ref: EngineCellRef,
  skus: ReadonlyArray<{ id: string; canonicalQuoteLeafId?: string | null }>,
): CellRef | null {
  let found: string | null = null;
  for (const sku of skus) {
    if (sku.id !== ref.quoteSkuId) continue;
    if (!sku.canonicalQuoteLeafId) return null;
    if (found !== null) return null; // ambiguous
    found = sku.canonicalQuoteLeafId;
  }
  return found === null ? null : { quoteLeafId: found, tierId: ref.tierId };
}

export function resolveEngineCell(
  ref: CellRef,
  skus: ReadonlyArray<{ id: string; canonicalQuoteLeafId?: string | null }>,
): EngineCellRef | null {
  let found: string | null = null;
  for (const sku of skus) {
    if (!sku.canonicalQuoteLeafId) continue;
    if (sku.canonicalQuoteLeafId !== ref.quoteLeafId) continue;
    if (found !== null) return null; // ambiguous
    found = sku.id;
  }
  return found === null ? null : { quoteSkuId: found, tierId: ref.tierId };
}

/**
 * Everything an operator can have pending.
 *
 * One object, compared wholesale. The alternative — a flag per lever — is what
 * makes `isStaged` a property instead of a difference, and H3 is the record of
 * why that goes wrong.
 */
export interface PricingSet {
  /** Surgical lifts by cell key. */
  lifts: Readonly<Record<string, number>>;
  /** Direct prices by cell key. Terminal; blocks a lift on the same cell. */
  overrides: Readonly<Record<string, number>>;
  /** Quote-wide adjustment. */
  globalAdj: number;
}

/**
 * What the quote CARRIES, expressed as a staging set.
 *
 * Extracted from the provider for the same reason `diffSets` was: it is logic,
 * not presentation, and the provider previously held a copy that a test held a
 * second copy of. Two copies of a seeding rule is two seeding rules.
 *
 * The asymmetry between the two levers is the whole content of this function:
 *
 *   - LIFTS need no translation. `quote_leaf_lifts` keys on the canonical
 *     attachment, which is the identity a staging key already carries.
 *   - OVERRIDES do. `assembly_leaf_overrides` keys on the legacy junction
 *     (OD-017), so each is crossed on the way in and one that cannot be
 *     crossed is OMITTED rather than dropped — it stays real and in effect in
 *     the costing input, it is simply not addressable as a staging key, so
 *     nothing the operator does can be about it.
 */
export function seedCommittedSet(source: {
  lifts: ReadonlyArray<{ quoteLeafId: string; tierId: string; liftPct: number }>;
  cellOverrides: ReadonlyArray<{
    quoteSkuId: string;
    tierId: string;
    sellPriceOverride: number;
  }>;
  skus: ReadonlyArray<{ id: string; canonicalQuoteLeafId?: string | null }>;
  globalAdj: number;
}): PricingSet {
  const lifts: Record<string, number> = {};
  for (const l of source.lifts) {
    lifts[cellKey({ quoteLeafId: l.quoteLeafId, tierId: l.tierId })] = l.liftPct;
  }
  const overrides: Record<string, number> = {};
  for (const o of source.cellOverrides) {
    const canonical = resolveCanonicalCell(
      { quoteSkuId: o.quoteSkuId, tierId: o.tierId },
      source.skus,
    );
    if (canonical === null) continue;
    overrides[cellKey(canonical)] = o.sellPriceOverride;
  }
  return { lifts, overrides, globalAdj: source.globalAdj };
}

/**
 * One pending difference, named for the operator.
 *
 * Removals are changes too, and are their own kinds. "Remove the lift on
 * GLW-50 · T2" is a thing to stage, review and discard — collapsing it into
 * an absence would make it invisible in the staging bar, which is the one
 * place the operator looks to see what they are about to commit.
 */
export type StagedChange =
  | { kind: "lift"; key: string; pct: number }
  | { kind: "lift-removed"; key: string }
  | { kind: "override"; key: string; value: number }
  | { kind: "override-removed"; key: string }
  | { kind: "adj"; from: number; to: number };

/**
 * Float comparison for the adjustment.
 *
 * Not a commercial predicate — it answers "did the operator move this
 * control", not "is this compliant". A bare `!==` would report a staged change
 * from float noise after a round-trip through a percentage input, and the
 * staging bar would offer to commit a change nobody made.
 */
export const ADJ_EPSILON = 1e-9;

/** The diff. Computed, never stored — see H3 above. */
export function diffSets(committed: PricingSet, working: PricingSet): StagedChange[] {
  const out: StagedChange[] = [];

  for (const [key, pct] of Object.entries(working.lifts)) {
    if (committed.lifts[key] === undefined) out.push({ kind: "lift", key, pct });
    else if (committed.lifts[key] !== pct) out.push({ kind: "lift", key, pct });
  }
  for (const key of Object.keys(committed.lifts)) {
    if (working.lifts[key] === undefined) out.push({ kind: "lift-removed", key });
  }

  for (const [key, value] of Object.entries(working.overrides)) {
    if (committed.overrides[key] === undefined) out.push({ kind: "override", key, value });
    else if (committed.overrides[key] !== value) out.push({ kind: "override", key, value });
  }
  for (const key of Object.keys(committed.overrides)) {
    if (working.overrides[key] === undefined) {
      out.push({ kind: "override-removed", key });
    }
  }

  if (Math.abs(working.globalAdj - committed.globalAdj) > ADJ_EPSILON) {
    out.push({ kind: "adj", from: committed.globalAdj, to: working.globalAdj });
  }
  return out;
}
