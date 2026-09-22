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
  let rows: Array<{ productTypeValue: string; chargeKey: string; note: string | null }>;
  try {
    rows = await db
      .select({
        productTypeValue: productTypeChargeDefaults.productTypeValue,
        chargeKey: productTypeChargeDefaults.chargeKey,
        note: productTypeChargeDefaults.note,
      })
      .from(productTypeChargeDefaults)
      .orderBy(asc(productTypeChargeDefaults.productTypeValue), asc(productTypeChargeDefaults.chargeKey));
  } catch (error) {
    // The defaults table is additive. Keep Setup usable during rollout when
    // the application is ahead of migration 0132, using the same advisory
    // seed that migration installs. These suggestions never create charges.
    if ((error as { code?: string })?.code !== "42P01") throw error;
    rows = [
      { productTypeValue: "Primary", chargeKey: "tooling", note: null },
      { productTypeValue: "Primary", chargeKey: "samples", note: null },
      { productTypeValue: "Secondary", chargeKey: "print_plates", note: null },
      { productTypeValue: "Secondary", chargeKey: "tooling", note: null },
      { productTypeValue: "Secondary", chargeKey: "samples", note: null },
      { productTypeValue: "Ingestibles", chargeKey: "samples", note: null },
      { productTypeValue: "Topicals", chargeKey: "samples", note: null },
    ];
  }

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
