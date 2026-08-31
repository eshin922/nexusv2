/**
 * The canonical model of "what can travel in a shipment".
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 *
 * OD-017 made `quote_leaves.id` the canonical commercial identity and re-keyed
 * `freight_subcategory_items` and the Freight action's eligibility rule onto
 * it. The schema says so outright: "quote_leaves.id is canonical;
 * assembly_leaves.id remains the temporary operational identity."
 *
 * The Costs page kept producing the junction id. It is a UUID, it typechecked,
 * and it went on being posted as `assemblyLeafId` — a field name the action's
 * own comment notes now CARRIES a quote_leaf_id. Between 2026-08-12 and
 * 2026-08-31 every operator attempt to create a shipment was refused, and the
 * only freight in the database was inserted by fixture scripts, which is why
 * nothing surfaced it.
 *
 * That is the failure this module is shaped against: a producer emitting a
 * plausible-but-wrong value of the same type. Consumers of a re-keyed table
 * surface in a type error; producers of the re-keyed IDENTITY do not.
 *
 * Two defences, and neither is a comment:
 *
 *   1. The identity is NAMED. The field is `quoteLeafId`, never `id`. A
 *      producer that reaches for the junction id must now write
 *      `quoteLeafId: row.assembly_leaves.id` — a line that says out loud what
 *      it is doing, rather than one that looks like every other id mapping.
 *   2. The mapping is ONE function, consumed by Create Shipment AND Edit
 *      Contents alike, and it is unit-tested against the historical defect
 *      itself: the junction id must NOT appear in the output, and the
 *      canonical id must.
 *
 * ── DIRECT PRODUCTS ─────────────────────────────────────────────────────
 *
 * A Direct Product has no `assembly_leaves` row, so a builder that reads only
 * the junction cannot see it at all. OD-017 changed the action to accept
 * `assemblyId = null` precisely so a quote made of Direct Components could
 * record freight without inventing a Finished Product to hang it on; leaving
 * them out of this model would keep that capability code-reachable and
 * operator-unreachable. They carry `assemblyId: null`, which is also how their
 * shipments are keyed, so the same equality that groups grouped members groups
 * these.
 */

/**
 * The card id for the single Direct Products group on the Freight surface.
 *
 * Not a UUID, deliberately: it must never be mistaken for — or passed as — a
 * commercial identity. It is a React key and an open-modal token only, and the
 * `assemblyId` the card carries is `null`.
 */
export const DIRECT_PRODUCT_CARD_ID = "direct-products";

/** A quote leaf that an operator may place in a shipment. */
export type FreightSelectableComponent = {
  /**
   * The CANONICAL commercial identity — `quote_leaves.id`.
   *
   * For a grouped member this is `assembly_leaves.quote_leaf_id`, NOT
   * `assembly_leaves.id`. For a Direct Product it is the `quote_leaves.id`
   * itself. This is the value posted as `assemblyLeafId` and the value stored
   * in `freight_subcategory_items.quote_leaf_id`.
   */
  quoteLeafId: string;
  /** `null` for a Direct Product — matching how its shipments are keyed. */
  assemblyId: string | null;
  label: string;
  sku: string | null;
};

/** Row shape from the Costs page's assembly-leaf join. */
export type GroupedMemberRow = {
  assembly_leaves: { id: string; assemblyId: string; quoteLeafId: string };
  leaves: { name: string; sku: string | null };
};

/** Row shape from the Costs page's Direct Product query. */
export type DirectProductRow = {
  quote_leaves: { id: string };
  leaves: { name: string; sku: string | null };
};

/**
 * Build the one selectable-component collection both Freight surfaces read.
 *
 * Grouped members first, in the order the caller supplied (assembly, then
 * position), then Direct Products. Order is the operator's reading order on
 * the surface; it carries no economic meaning.
 */
export function freightSelectableComponents(
  groupedMembers: GroupedMemberRow[],
  directProducts: DirectProductRow[],
): FreightSelectableComponent[] {
  return [
    ...groupedMembers.map((row) => ({
      // The whole defect, and its repair, is this one field.
      quoteLeafId: row.assembly_leaves.quoteLeafId,
      assemblyId: row.assembly_leaves.assemblyId,
      label: row.leaves.name,
      sku: row.leaves.sku,
    })),
    ...directProducts.map((row) => ({
      quoteLeafId: row.quote_leaves.id,
      assemblyId: null,
      label: row.leaves.name,
      sku: row.leaves.sku,
    })),
  ];
}
