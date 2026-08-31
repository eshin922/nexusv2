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
  | "otc_cartons"
  // §amendment 2026-08-31 — Item Group-owned economics. OUTSIDE the `otc_*`
  // namespace on purpose: an `otc_*` destination is a one-time charge, and
  // this is recurring economics that scale with the accepted tier quantity.
  // The namespace is the statement of that difference.
  | "item_group_production";

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
  // AMENDED 2026-08-20 — Accounting disposition. Pack-out / Assembly is billed
  // as a SERVICE, so its NetSuite item is governed Non-inventory. Corrected
  // from "inventory", which was recorded before any item existed to check it
  // against: the sandbox has 67 OTC-coded fee items and every one is
  // NonInvtPart, so "inventory" could never have been satisfied by a real
  // OTC item. The destination key is unchanged — there is no `otc_assembly`.
  { key: "otc_packout", label: "OTC - Packout", itemType: "non_inventory", section: "1.a" },
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
  // ── THE SEVENTEENTH ───────────────────────────────────────────────────
  //
  // What a NetSuite Group cannot say. A Group header carries a quantity and no
  // sell value — `rate` and `netamount` are NULL on it at the database level
  // while every member carries both, and the subtotal is the sum of the MEMBER
  // amounts. So an Item Group's OWN economics need a line, and none of the
  // sixteen above means what that line means: each names a specific one-time
  // charge, or an input that §1.a says explicitly "does not become a separate
  // OTC or service line".
  //
  // It carries `assemblyOwnUnitSellPerUnit × accepted tier quantity`:
  // production cost, its governed markup, and the recovery of charges the
  // operator elected Included. Those stay INSIDE it — not emitted separately,
  // not allocated into member rates, and their Recovery election is not
  // reinterpreted to suit the ERP.
  //
  // Section "1.b" because it IS a distinct line rather than a fold into
  // component economics; the section field only distinguishes those two
  // shapes, and there is no third. The `otc_*` question is answered by the
  // KEY, which is where it belongs.
  //
  // Non-inventory by census, not by assumption: all six existing sell-side
  // destination items are NonInvtPart / Resale. See the BV-011 amendment.
  {
    key: "item_group_production",
    label: "Item Group Production / Conversion",
    itemType: "non_inventory",
    section: "1.b",
  },
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

/**
 * Destinations whose NetSuite record is chosen PER LINE rather than per firm.
 *
 * `otc_other_service` is per-line because it is the catch-all — two quotes can
 * use it for unrelated charges, so migration 0081 refuses it a firm row by
 * CHECK. `otc_testing` is per-line for a different reason, settled by
 * Accounting in Case 0: the account carries several genuinely distinct testing
 * items in concurrent use (Micro Testing, HRIPT, Re-Test), and one firm-wide
 * mapping would collapse a distinction Accounting keeps.
 *
 * ── THIS SET IS THE WHOLE SWITCH ─────────────────────────────────────────
 *
 * Freeze, readiness and posted-provenance are already destination-driven and
 * read this predicate; none of them names a destination. Adding one here is
 * what makes it per-line everywhere, which is why Case 0 was implemented as one
 * governed extension rather than five selectors.
 *
 * ── THE KEYING TRIPWIRE ──────────────────────────────────────────────────
 *
 * `quote_other_service_items` is keyed by OWNER — (quote, assembly XOR leaf) —
 * with no destination discriminator. That holds only while at most ONE
 * per-line destination can attach to a given owner.
 *
 * A Direct Service leaf carries exactly one service identity and therefore
 * exactly one destination, so `otc_testing` via the service path is safe. The
 * moment a per-line destination arrives as an OTC FEE COLUMN, one assembly
 * could need two selections and the key admits one — that needs a `destination`
 * column, a new unique key, and a backfill. Do not add such a destination here
 * without doing that first.
 */
const PER_LINE_DESTINATIONS = new Set<Bv011Destination>([
  "otc_other_service",
  "otc_testing",
]);

/** True when this destination's NetSuite record is chosen per line, not per firm. */
export function isPerLineDestination(key: Bv011Destination): boolean {
  return PER_LINE_DESTINATIONS.has(key);
}
