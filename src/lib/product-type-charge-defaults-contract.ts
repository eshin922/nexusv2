import { COMPONENT_CHARGE_KEYS, type ComponentChargeKey } from "@/lib/commercial-recovery/registry";
import type { ProductTypeChargeKey } from "@/lib/product-type-charge-defaults";

export type ProductTypeChargeRule = {
  productTypeValue: string;
  chargeKey: ProductTypeChargeKey;
};

/** Build the Setup lookup using HubSpot's raw option value, never its label. */
export function indexProductTypeChargeRules(
  rules: readonly ProductTypeChargeRule[],
): Record<string, ComponentChargeKey[]> {
  const indexed: Record<string, ComponentChargeKey[]> = {};
  for (const rule of rules) {
    if ((COMPONENT_CHARGE_KEYS as readonly string[]).includes(rule.chargeKey)) {
      (indexed[rule.productTypeValue] ??= []).push(rule.chargeKey as ComponentChargeKey);
    }
  }
  return indexed;
}

export function suggestionsForProductType(
  indexed: Readonly<Record<string, readonly ComponentChargeKey[]>>,
  rawHubSpotValue: string | null | undefined,
): readonly ComponentChargeKey[] {
  if (!rawHubSpotValue) return [];
  return indexed[rawHubSpotValue] ?? [];
}
