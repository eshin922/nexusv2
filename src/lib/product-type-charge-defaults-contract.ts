import type { ComponentChargeKey } from "@/lib/commercial-recovery/registry";

export type ProductTypeChargeRule = {
  productTypeValue: string;
  chargeKey: ComponentChargeKey;
};

/** Build the Setup lookup using HubSpot's raw option value, never its label. */
export function indexProductTypeChargeRules(
  rules: readonly ProductTypeChargeRule[],
): Record<string, ComponentChargeKey[]> {
  const indexed: Record<string, ComponentChargeKey[]> = {};
  for (const rule of rules) {
    (indexed[rule.productTypeValue] ??= []).push(rule.chargeKey);
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
