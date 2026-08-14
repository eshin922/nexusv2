/**
 * Product Type → Spec Schema. The governed mapping. Step 3.
 *
 * Product Type is HubSpot's `hs_product_type` and is the operator-facing
 * classification everywhere in Nexus. Spec Schema is internal behaviour: which
 * specification fields apply. Nexus derives the second from the first and does
 * not maintain a second operator-authored taxonomy to select it.
 *
 * WHY A CODE CONSTANT AND NOT A TABLE. A table would be a second mutable
 * authority with no administrative workflow behind it, so it would drift
 * silently — which is the exact failure this whole architecture change removes.
 * Fifteen-odd values, reviewed in a pull request and pinned by tests, is the
 * honest form.
 *
 * KEYED BY INTERNAL VALUE, NEVER LABEL. Three options diverge, and they are
 * among the largest categories: "Primary Packaging" is stored as `Primary`,
 * "Secondary Packaging" as `Secondary`, "Logistics" as `Third Party Logistics`.
 * A label-keyed map would silently resolve nothing for roughly half the
 * catalogue.
 */

/** The three schemas that exist. Each has a real field set in `product_types`. */
export type SpecSchemaId = "primary" | "secondary" | "tertiary";

/**
 * Resolution outcome.
 *
 * `no_schema` is EXPLICIT and is not an absence: "specifications legitimately
 * do not apply to this category" and "we have not decided" must never look
 * identical, because the first is a finished answer and the second is a bug.
 *
 * `unmapped` exists so an unknown authoritative value cannot quietly become
 * `no_schema`. It is surfaced rather than thrown: an operator's page should not
 * crash because someone added an option in HubSpot. The loud failure belongs in
 * CI, where `specSchemaMappingIsExhaustive` fails the build against the fetched
 * vocabulary — a human sees it before an operator does.
 */
export type SpecSchemaResolution =
  | { kind: "schema"; schemaId: SpecSchemaId }
  | { kind: "no_schema" }
  | { kind: "unmapped"; value: string };

/** Authoritative HubSpot internal value → Spec Schema, or explicit NO_SCHEMA. */
const MAPPING: Record<string, SpecSchemaId | "NO_SCHEMA"> = {
  // Packaging — a schema applies.
  Primary: "primary",
  Secondary: "secondary",
  "Tertiary Packaging": "tertiary",
  // Printed secondary components. Same field set as a secondary carton:
  // material, size, colour, coating, finishing, quantities.
  Labels: "secondary",
  "Cards, Booklets": "secondary",

  // Not packaging. NO_SCHEMA is the correct, finished answer for each of these
  // — a freight charge or a design service has no product specification, and
  // fabricating a schema to avoid an empty state would be inventing data.
  "Soft Goods and Accessories": "NO_SCHEMA",
  "Raw ingredients": "NO_SCHEMA",
  "Finished Goods": "NO_SCHEMA",
  "Filling and Packout Services": "NO_SCHEMA",
  "One Time Charges": "NO_SCHEMA",
  Freight: "NO_SCHEMA",
  Design: "NO_SCHEMA",
  "R&D / Testing": "NO_SCHEMA",
  "Third Party Logistics": "NO_SCHEMA",
  Turnkey: "NO_SCHEMA",
  Formulation: "NO_SCHEMA",
};

/**
 * Resolve a Spec Schema from an authoritative Product Type.
 *
 * `null` in means the product has NO authoritative classification, which is a
 * different state from "classified, no schema applies" — it is `NO TYPE SET`,
 * and the caller must distinguish them. That is why this returns `unmapped`
 * only for an unrecognised non-null value and never for absence.
 */
export function resolveSpecSchema(
  productType: string | null | undefined,
): SpecSchemaResolution | null {
  if (!productType) return null; // NO TYPE SET — not a mapping outcome.
  const hit = MAPPING[productType];
  if (hit === undefined) return { kind: "unmapped", value: productType };
  if (hit === "NO_SCHEMA") return { kind: "no_schema" };
  return { kind: "schema", schemaId: hit };
}

/** Every value the mapping disposes. Test seam for the exhaustiveness check. */
export function mappedProductTypeValues(): string[] {
  return Object.keys(MAPPING);
}

/**
 * Is the mapping exhaustive over the authoritative vocabulary?
 *
 * This is the fail-loud. Run against the fetched option set, it names any
 * authoritative value with no disposition — so adding an option in HubSpot
 * fails the build rather than silently resolving to no_schema for products the
 * firm has classified deliberately.
 */
export function specSchemaMappingIsExhaustive(
  vocabularyValues: readonly string[],
): { exhaustive: true } | { exhaustive: false; missing: string[] } {
  const missing = vocabularyValues.filter((v) => MAPPING[v] === undefined);
  return missing.length === 0
    ? { exhaustive: true }
    : { exhaustive: false, missing };
}

/** The `product_types.id` a schema resolves to. Those rows keep their fields. */
export const SPEC_SCHEMA_PRODUCT_TYPE_ID: Record<SpecSchemaId, string> = {
  primary: "leaf_primary_packaging",
  secondary: "leaf_secondary_packaging",
  tertiary: "leaf_tertiary_packaging",
};
