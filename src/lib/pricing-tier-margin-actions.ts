import type { Cell } from "./pricing-classifier";
import { liftToClear } from "./pricing-suggestions";

export type TierMarginAction = { cell: Cell; value: number };

/** Stage only priceable cells. A direct price cannot receive a lift. */
export function tierTargetLifts(cells: readonly Cell[], tierId: number, target: number): TierMarginAction[] {
  if (!Number.isFinite(target) || target <= 0 || target >= 1) return [];
  const actions: TierMarginAction[] = [];
  for (const cell of cells) {
    if (cell.tier_id !== tierId || cell.override_applied || cell.margin_pct === null || cell.margin_pct >= target) continue;
    const incremental = liftToClear(cell.sell_unit, cell.cost_unit, target, cell.recovery_unit ?? 0);
    if (incremental === null) continue;
    const value = Math.ceil(((1 + (cell.lift_applied_pct ?? 0)) * (1 + incremental) - 1) * 1e4) / 1e4;
    if (value > 0 && value < 100) actions.push({ cell, value });
  }
  return actions;
}

/** A requested exact margin replaces each cell's sell price, including existing direct prices. */
export function tierExactMarginPrices(cells: readonly Cell[], tierId: number, margin: number): TierMarginAction[] {
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) return [];
  const actions: TierMarginAction[] = [];
  for (const cell of cells) {
    if (cell.tier_id !== tierId || cell.cost_unit === null || cell.cost_unit <= 0 || cell.sell_unit === null) continue;
    // Direct prices store four decimals. Ceiling prevents rounding below the requested margin.
    const value = Math.ceil((cell.cost_unit / (1 - margin)) * 1e4) / 1e4;
    if (value > 0 && value < 1e6) actions.push({ cell, value });
  }
  return actions;
}
