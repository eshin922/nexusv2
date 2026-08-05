import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  freightLegComponentTierCosts,
  freightLegs,
  leaves,
  quoteLeaves,
  quoteTiers,
} from "@/db/schema";
import {
  assertQuoteCostsResolved,
  type UnresolvedQuoteCost,
} from "./quote-cost-completeness-contract";

export async function loadUnresolvedQuoteCosts(
  quoteId: string,
): Promise<UnresolvedQuoteCost[]> {
  const [packaging, freight] = await Promise.all([db
    .select({
      quoteLeafId: assemblyLeaves.quoteLeafId,
      assemblyLeafId: assemblyLeafInputs.assemblyLeafId,
      tierId: assemblyLeafInputs.tierId,
      tierLabel: quoteTiers.label,
      lineGroupId: assemblyLeafInputs.lineGroupId,
      leafSku: leaves.sku,
      leafName: leaves.name,
    })
    .from(assemblyLeafInputs)
    .innerJoin(
      assemblyLeaves,
      eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
    )
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .innerJoin(leaves, eq(leaves.id, assemblyLeaves.leafId))
    .innerJoin(quoteTiers, eq(quoteTiers.id, assemblyLeafInputs.tierId))
    .where(
      and(
        eq(assemblies.quoteId, quoteId),
        isNull(assemblyLeafInputs.unitCost),
      ),
    ),
  db
    .select({
      quoteLeafId: quoteLeaves.id,
      assemblyLeafId: quoteLeaves.id,
      tierId: freightLegComponentTierCosts.tierId,
      tierLabel: quoteTiers.label,
      lineGroupId: freightLegComponentTierCosts.freightLegId,
      leafSku: leaves.sku,
      leafName: leaves.name,
    })
    .from(freightLegComponentTierCosts)
    .innerJoin(
      quoteLeaves,
      eq(quoteLeaves.id, freightLegComponentTierCosts.quoteLeafId),
    )
    .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
    .innerJoin(quoteTiers, eq(quoteTiers.id, freightLegComponentTierCosts.tierId))
    .innerJoin(
      freightLegs,
      eq(freightLegs.id, freightLegComponentTierCosts.freightLegId),
    )
    .where(
      and(
        eq(quoteLeaves.quoteId, quoteId),
        isNull(freightLegComponentTierCosts.actualFreightCost),
      ),
    ),
  ]);
  return [...packaging, ...freight];
}

export async function requireResolvedQuoteCosts(quoteId: string): Promise<void> {
  assertQuoteCostsResolved(await loadUnresolvedQuoteCosts(quoteId));
}
