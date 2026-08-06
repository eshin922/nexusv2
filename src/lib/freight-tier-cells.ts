// Tier-column alignment for the Freight worksheet — pure, no I/O.
//
// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------
//
// **The tier collection is the authority for column order. A destination-break
// row is located by `tierId`, never by position.**
//
// Every tier-positioned cell in the Freight worksheet — freight amount, markup,
// freight type, item/description, and anything added later — renders from the
// ordered `tiers` collection. The break row supplying each cell's value is
// resolved by id. Nothing reads the break array positionally.
//
// ---------------------------------------------------------------------------
// Reference moment (2026-08-06, Validation 2)
// ---------------------------------------------------------------------------
//
// `freight-workbook.ts` loaded `freight_destination_breaks` with no ORDER BY,
// so the array arrived in Postgres heap order — which shifts as rows are
// updated. The amount and markup cells were already correct (`tiers.map` plus
// a lookup by id), but freight type and item/description iterated the break
// array positionally.
//
// Observed on a four-tier quote: the loader returned Tier 1, Tier 3, Tier 2,
// Tier 4 for all three destinations, while the column headings read Tier 1-4.
// Two failures followed:
//
//   · DISPLAY — a value appeared beneath the wrong quantity break. The
//     destination summary chip (tier-ordered, correct) disagreed with the grid
//     directly beneath it.
//
//   · WRITE — more serious. The control carried `name={`mode:${row.tierId}`}`,
//     so the edit followed the ROW, not the COLUMN. An operator editing the
//     cell under "Tier 2" silently wrote Tier 3's break row.
//
// Adding ORDER BY to the loader alone would have hidden this rather than fixed
// it: any future query, cache, realtime patch, or optimistic insert could
// reintroduce an arbitrary order. The ordering is enforced here, at the point
// of use, and the loader's ORDER BY is defence in depth.
//
// Extracting the resolution into a named function is what makes the invariant
// testable against a deliberately scrambled array — the same discipline as
// `freight-break-write.ts`.

/** Minimal shape this module needs — the ordered authority for columns. */
type TierLike = { id: string };

/** Minimal shape this module needs — a per-(destination, tier) break row. */
type BreakLike = { tierId: string };

export type TierCell<TTier, TBreak> = {
  /** The tier this column belongs to. Order follows the tiers collection. */
  tier: TTier;
  /**
   * The break row for this tier, or null when none exists yet. Null is a real
   * state: a tier can exist before its break row is seeded. Callers must render
   * a non-editable placeholder for it — never a control, whose name would
   * otherwise carry an undefined tier id into a write.
   */
  row: TBreak | null;
  /** Zero-based column index, for rules like "flat mode shows the first only". */
  index: number;
};

/**
 * Pair each tier, in the tiers collection's own order, with its break row.
 *
 * Input order of `rows` is irrelevant by construction. Break rows whose tier is
 * not in the collection are dropped: there is no column to render them in, and
 * showing them would push every later column out of alignment — the exact
 * failure this function exists to prevent.
 */
export function alignBreaksToTiers<TTier extends TierLike, TBreak extends BreakLike>(
  tiers: readonly TTier[],
  rows: readonly TBreak[],
): Array<TierCell<TTier, TBreak>> {
  const byTier = new Map<string, TBreak>();
  for (const row of rows) if (!byTier.has(row.tierId)) byTier.set(row.tierId, row);

  return tiers.map((tier, index) => ({ tier, row: byTier.get(tier.id) ?? null, index }));
}
