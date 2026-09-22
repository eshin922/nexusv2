"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { productTypeChargeDefaults } from "@/db/schema";
import { requireAdminAction } from "@/lib/admin-guard";
import { writeAuditEntry } from "@/lib/audit";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { COMPONENT_CHARGE_KEYS } from "@/lib/commercial-recovery/registry";
import {
  ASSOCIATED_COST_KEYS,
  type ProductTypeChargeKey,
} from "@/lib/product-type-charge-defaults-contract";
import { loadHubspotProductTypeOptions } from "@/lib/hubspot-product-type-vocabulary";

/**
 * Save the advisory charge suggestions for one live HubSpot Product Type.
 * The raw option value is the key; labels are display-only. An empty selection
 * removes the suggestions and leaves the type in the honest `needs review`
 * state. No quote charge instances are read or changed here.
 */
export async function saveProductTypeChargeDefaults(
  productTypeValue: string,
  requestedKeys: readonly string[],
): Promise<ActionResult<{ productTypeValue: string; chargeKeys: ProductTypeChargeKey[] }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();
    if (typeof productTypeValue !== "string" || !Array.isArray(requestedKeys)) {
      throw new ActionGuardError(ERR.VALIDATION, "A Product Type and charge list are required.");
    }
    const value = productTypeValue;
    if (!value.trim()) {
      throw new ActionGuardError(ERR.VALIDATION, "Choose a HubSpot Product Type.");
    }

    const options = await loadHubspotProductTypeOptions({ refresh: true });
    const option = options.find((candidate) => candidate.value === value);
    if (!option) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "That Product Type is no longer available in HubSpot. Refresh Settings and try again.",
      );
    }

    const allowed = new Set<string>([...COMPONENT_CHARGE_KEYS, ...ASSOCIATED_COST_KEYS]);
    const uniqueKeys = [...new Set(requestedKeys)];
    if (uniqueKeys.some((key) => !allowed.has(key))) {
      throw new ActionGuardError(ERR.VALIDATION, "One or more charge types are invalid.");
    }
    const chargeKeys = uniqueKeys as ProductTypeChargeKey[];

    const changed = await db.transaction(async (tx) => {
      const prior = await tx
        .select({
          chargeKey: productTypeChargeDefaults.chargeKey,
          note: productTypeChargeDefaults.note,
        })
        .from(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value))
        .orderBy(asc(productTypeChargeDefaults.chargeKey));
      const before = prior.map((row) => row.chargeKey).sort();
      const after = [...chargeKeys].sort();
      if (before.length === after.length && before.every((key, index) => key === after[index])) {
        return false;
      }

      await tx
        .delete(productTypeChargeDefaults)
        .where(eq(productTypeChargeDefaults.productTypeValue, value));
      if (chargeKeys.length > 0) {
        await tx.insert(productTypeChargeDefaults).values(
          chargeKeys.map((chargeKey) => ({
            productTypeValue: value,
            chargeKey,
            note: prior.find((row) => row.chargeKey === chargeKey)?.note ?? null,
            updatedByUserId: admin.id,
          })),
        );
      }

      await writeAuditEntry({
        userId: admin.id,
        entityType: "product_type_charge_defaults",
        entityId: value,
        entityLabel: option.label,
        action: after.length === 0 ? "clear" : before.length === 0 ? "create" : "update",
        diffJson: {
          from: { productTypeValue: value, chargeKeys: before },
          to: { productTypeValue: value, chargeKeys: after },
        },
        summary: `Updated one-time charge suggestions for ${option.label}.`,
      }, tx);
      return true;
    });

    if (changed) revalidatePath("/admin/product-type-charge-defaults");
    return { productTypeValue: value, chargeKeys };
  });
}
