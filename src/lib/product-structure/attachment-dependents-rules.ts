// Attachment-dependent accounting — PURE.
//
// Free of `server-only` and the database so the operator sentence and the
// cascade table list are testable, and so the coverage guard can import the
// list without pulling a database connection into the test process.
// `attachment-dependents.ts` gathers the counts and imports its shapes here.

export type DependentCount = {
  /** Operator-facing singular noun. Pluralised by the caller. */
  singular: string;
  plural: string;
  count: number;
};

export type AttachmentDependents = {
  /** Non-empty entries only, in the order an operator would weigh them. */
  entries: DependentCount[];
  total: number;
};

/**
 * The tables a `quote_leaves` delete cascades. Order is the order the
 * operator reads: what they entered by hand first, derived state last.
 *
 * Kept as an exported list of table NAMES so the coverage test can compare it
 * against the schema without importing the query bodies.
 */
export const CASCADING_DEPENDENT_TABLES = [
  "assembly_leaf_inputs",
  "assembly_production_inputs",
  "assembly_leaf_overrides",
  "assembly_leaf_targets",
  "quote_client_targets",
  "quote_leaf_lifts",
  "freight_subcategory_items",
  "freight_leg_component_tier_costs",
  "quote_other_service_items",
  // Structural rather than economic: the grouped-membership junction itself.
  // It disappears with the attachment by definition, so counting it as data
  // "at risk" would inflate the number with the thing being removed.
  "assembly_leaves",
] as const;

/** Tables excluded from the count, and why — read by the coverage test. */
export const NOT_COUNTED: Record<string, string> = {
  assembly_leaves:
    "the membership junction IS the attachment; counting it would inflate the number with the thing being removed",
};

/**
 * The sentence the operator reads. Concrete counts, and the irreversibility
 * said plainly — no hedging, and no reassurance about anything they did not
 * ask about.
 */
export function describeDependents(d: AttachmentDependents): string | null {
  if (d.entries.length === 0) return null;
  const parts = d.entries.map(
    (e) => `${e.count} ${e.count === 1 ? e.singular : e.plural}`,
  );
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Also deletes ${list}. This cannot be undone.`;
}
