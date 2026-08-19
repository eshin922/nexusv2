/**
 * The BV-011 accounting destination catalogue.
 *
 * This module is the AUTHORITY for what a fee means. Admins configure which
 * NetSuite record a destination posts to; they do not configure which
 * destination an input belongs to, and nothing here is editable at runtime.
 *
 * That split is the whole point of keying the mapping table on the destination
 * rather than on the economic source. `rd_total` and the `formulation` Direct
 * Service both mean `OTC - Formulation`. Under source-keying that is two
 * mapping rows for one NetSuite item, free to drift apart; under
 * destination-keying it is one row and cannot.
 *
 * Source: `docs/business-validation/BV-011-production-otc-accounting-map.md`.
 * Sixteen destinations, six Inventory and ten Non-inventory.
 */

import type { DirectServiceIdentity } from "@/lib/product-structure/direct-service";

export type Bv011Destination =
  // §1.a finished-good component / item
  | "otc_filling"
  | "otc_packout"
  | "otc_raws"
  // §1.b OTC / service lines
  | "otc_freight_duties_tariffs"
  | "otc_customs"
  | "otc_setup"
  | "otc_artwork"
  | "otc_tooling"
  | "otc_formulation"
  | "otc_testing"
  | "otc_other_service"
  | "otc_dies"
  | "otc_print_plates"
  | "otc_samples"
  | "otc_processing_fee"
  | "otc_cartons";

/**
 * The item type BV-011 governs for each destination.
 *
 * Held here rather than in the mapping table so there is exactly one copy. A
 * column would be a second copy, free to drift from the document that governs
 * it — and the drift would be invisible, because both would look authoritative.
 *
 * It is not decoration: an admin who maps `OTC - Tooling` to a Non-inventory
 * record has made an accounting error the Verify step can catch, and catching
 * it needs the governed expectation to be readable.
 */
export type Bv011ItemType = "inventory" | "non_inventory";

export const BV011_DESTINATIONS: ReadonlyArray<{
  key: Bv011Destination;
  label: string;
  itemType: Bv011ItemType;
  section: "1.a" | "1.b";
}> = [
  { key: "otc_filling", label: "OTC - Filling", itemType: "inventory", section: "1.a" },
  { key: "otc_packout", label: "OTC - Packout", itemType: "inventory", section: "1.a" },
  { key: "otc_raws", label: "OTC - Raws", itemType: "inventory", section: "1.a" },
  { key: "otc_freight_duties_tariffs", label: "OTC - Freight, Duties, Tariffs", itemType: "inventory", section: "1.b" },
  { key: "otc_customs", label: "OTC - Customs", itemType: "inventory", section: "1.b" },
  { key: "otc_setup", label: "OTC - Setup", itemType: "non_inventory", section: "1.b" },
  { key: "otc_artwork", label: "OTC - Artwork", itemType: "non_inventory", section: "1.b" },
  { key: "otc_tooling", label: "OTC - Tooling", itemType: "inventory", section: "1.b" },
  { key: "otc_formulation", label: "OTC - Formulation", itemType: "non_inventory", section: "1.b" },
  { key: "otc_testing", label: "OTC - Testing", itemType: "non_inventory", section: "1.b" },
  { key: "otc_other_service", label: "OTC - Other Service", itemType: "non_inventory", section: "1.b" },
  { key: "otc_dies", label: "OTC - Dies", itemType: "non_inventory", section: "1.b" },
  { key: "otc_print_plates", label: "OTC - Print Plates", itemType: "non_inventory", section: "1.b" },
  { key: "otc_samples", label: "OTC - Samples", itemType: "non_inventory", section: "1.b" },
  { key: "otc_processing_fee", label: "OTC - Processing Fee", itemType: "non_inventory", section: "1.b" },
  { key: "otc_cartons", label: "OTC - Cartons", itemType: "non_inventory", section: "1.b" },
];

const BY_KEY = new Map(BV011_DESTINATIONS.map((d) => [d.key, d] as const));

export function bv011Label(key: Bv011Destination): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function bv011ItemType(key: Bv011Destination): Bv011ItemType {
  const d = BY_KEY.get(key);
  if (!d) throw new Error(`[bv011] unknown destination ${key}`);
  return d.itemType;
}

/**
 * Separately-billed OTC fee column → destination.
 *
 * `toolingArtworkTotal` is ABSENT ON PURPOSE and its absence is load-bearing.
 * It is the legacy combined column, and BV-011 governs its two halves as
 * different destinations with different item types. No entry can be correct
 * for it, so a lookup returns undefined and the caller must treat that as
 * "unresolved legacy", not as "no destination".
 */
export const OTC_COLUMN_DESTINATION = {
  setupFeeTotal: "otc_setup",
  toolingTotal: "otc_tooling",
  artworkTotal: "otc_artwork",
  rdTotal: "otc_formulation",
  otherServiceTotal: "otc_other_service",
} as const satisfies Record<string, Bv011Destination>;

export type OtcColumn = keyof typeof OTC_COLUMN_DESTINATION;

/** The legacy combined column. Named once, here, so nothing string-matches it. */
export const LEGACY_COMBINED_OTC_COLUMN = "toolingArtworkTotal" as const;

/**
 * Direct Service identity → destination.
 *
 * `other_service` maps to `OTC - Other Service` semantically, but that
 * destination has NO firm-level NetSuite record by design — migration 0081's
 * CHECK forbids the row. Its item is chosen per line. So the semantic mapping
 * is present here and the RECORD lookup must still go through the per-line
 * selection; a caller that reads this map and stops has skipped a step.
 */
export const SERVICE_IDENTITY_DESTINATION = {
  formulation: "otc_formulation",
  filling_blending: "otc_filling",
  packout_assembly: "otc_packout",
  testing_micros: "otc_testing",
  other_service: "otc_other_service",
} as const satisfies Record<DirectServiceIdentity, Bv011Destination>;

/** True when this destination's NetSuite record is chosen per line, not per firm. */
export function isPerLineDestination(key: Bv011Destination): boolean {
  return key === "otc_other_service";
}
