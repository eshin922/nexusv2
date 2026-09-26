export type ShipmentSplit = {
  percentage: number;
  quantities: Array<{ tierId: string; total: number; units: number }>;
};

export function splitShipmentQuantities(tiers: Array<{ id: string; qty: number | null }>, percentage: number): [ShipmentSplit, ShipmentSplit] {
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100 || Math.round(percentage * 100) !== percentage * 100) throw new Error("Enter a percentage between 0 and 100, with up to two decimal places.");
  const first = tiers.map((tier) => {
    if (!Number.isSafeInteger(tier.qty) || tier.qty === null || tier.qty < 2) throw new Error("Every order option needs at least two whole units to split.");
    const units = Math.round(tier.qty * percentage / 100);
    if (units < 1 || units >= tier.qty) throw new Error("Choose a percentage that leaves at least one unit in each shipment for every order option.");
    return { tierId: tier.id, total: tier.qty, units };
  });
  if (!first.length) throw new Error("Add order options before splitting a shipment.");
  return [{ percentage, quantities: first }, { percentage: Math.round((100 - percentage) * 100) / 100, quantities: first.map((row) => ({ ...row, units: row.total - row.units })) }];
}
