import { COMPONENT_CHARGE_KEYS, type ComponentChargeKey } from "@/lib/commercial-recovery/registry";

export const ASSOCIATED_COST_KEYS = [
  "filling_blending",
  "cm_assembly_packout",
  "project_setup",
  "rd_formulation",
  "testing_micros",
] as const;
export type AssociatedCostKey = (typeof ASSOCIATED_COST_KEYS)[number];
export type ProductTypeChargeKey = ComponentChargeKey | AssociatedCostKey;
export const ASSOCIATED_COST_LABELS: Record<AssociatedCostKey, string> = {
  filling_blending: "Filling / blending",
  cm_assembly_packout: "CM assembly / packout",
  project_setup: "Product setup / changeover",
  rd_formulation: "R&D / formulation",
  testing_micros: "Stability / potency / micros testing",
};

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
