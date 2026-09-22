import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { productTypeChargeDefaults } from "@/db/schema";
import { COMPONENT_CHARGE_KEYS, type ComponentChargeKey } from "@/lib/commercial-recovery/registry";
import { indexProductTypeChargeRules } from "@/lib/product-type-charge-defaults-contract";

export type ProductTypeChargeDefault = {
  productTypeValue: string;
  chargeKey: ComponentChargeKey;
  note: string | null;
};

export async function listProductTypeChargeDefaults(): Promise<ProductTypeChargeDefault[]> {
  const rows = await db
    .select({
      productTypeValue: productTypeChargeDefaults.productTypeValue,
      chargeKey: productTypeChargeDefaults.chargeKey,
      note: productTypeChargeDefaults.note,
    })
    .from(productTypeChargeDefaults)
    .orderBy(asc(productTypeChargeDefaults.productTypeValue), asc(productTypeChargeDefaults.chargeKey));

  // The database CHECK is the primary guard. Keep this boundary defensive so a
  // legacy or manually repaired row cannot leak an unknown key into Setup.
  const known = new Set<string>(COMPONENT_CHARGE_KEYS);
  return rows.filter(
    (row): row is ProductTypeChargeDefault => known.has(row.chargeKey),
  );
}

export function indexProductTypeChargeDefaults(
  rows: readonly ProductTypeChargeDefault[],
): Record<string, ComponentChargeKey[]> {
  return indexProductTypeChargeRules(rows);
}
