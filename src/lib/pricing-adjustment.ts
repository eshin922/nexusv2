export function composePricingAdjustment(
  currentAdjustment: number,
  adjustmentDelta: number,
): number {
  return Number(
    ((1 + currentAdjustment) * (1 + adjustmentDelta) - 1).toFixed(4),
  );
}
