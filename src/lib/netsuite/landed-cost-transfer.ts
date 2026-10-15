import type { FrozenSalesOrderLine } from "@/lib/netsuite/frozen-sales-order";

type LandedRollup = {
  skuId: string;
  skuRole: string;
  perTier: readonly {
    tierId: string;
    totalContainerFreightBeforeMarkup: number;
    totalDutyTariffBeforeMarkup: number;
  }[];
};

export type LandedCostTransfer = {
  costPerProductUnit: number;
  costForCharge: number;
};

/**
 * A separately billed landed charge moves its raw cost estimate along with
 * its sell amount. The accepted lines decide which leaves are separate; live
 * costing supplies only the accounting cost basis, never commercial money.
 */
export function landedCostTransfers(
  frozenLines: readonly FrozenSalesOrderLine[],
  rollups: readonly LandedRollup[],
  tierId: string,
): Map<string, LandedCostTransfer> {
  const charges = frozenLines.filter(
    (line) => line.kind === "otc" && line.destination === "otc_freight_duties_tariffs",
  );
  const transfers = new Map<string, LandedCostTransfer>();
  if (charges.length === 0) return transfers;

  const products = new Map(
    frozenLines
      .filter((line) => line.kind === "direct_product" || line.kind === "item_group_member")
      .filter((line) => line.quoteLeafId !== null)
      .map((line) => [line.quoteLeafId!, line] as const),
  );
  const byLeaf = new Map(rollups.filter((r) => r.skuRole === "leaf").map((r) => [r.skuId, r] as const));
  for (const charge of charges) {
    const leafId = charge.quoteLeafId;
    if (!leafId || transfers.has(leafId)) {
      throw new Error("A separate landed charge must identify one unique product leaf.");
    }
    const product = products.get(leafId);
    const perTier = byLeaf.get(leafId)?.perTier.find((pt) => pt.tierId === tierId);
    if (!product || !perTier || product.quantity === null) {
      throw new Error(`The separate landed charge for ${charge.description} has no product cost basis.`);
    }
    const costPerProductUnit =
      Number(perTier.totalContainerFreightBeforeMarkup) +
      Number(perTier.totalDutyTariffBeforeMarkup);
    if (!Number.isFinite(costPerProductUnit) || costPerProductUnit < 0) {
      throw new Error(`The landed cost basis for ${charge.description} is invalid.`);
    }
    transfers.set(leafId, {
      costPerProductUnit,
      costForCharge: costPerProductUnit * product.quantity,
    });
  }
  return transfers;
}
