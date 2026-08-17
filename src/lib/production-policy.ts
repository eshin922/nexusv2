/**
 * Aggregate view of allocation policy across a quote.
 *
 * ── AUTHORITY (business disposition, 2026-08-17) ──────────────────────────
 *
 * For V1, `Allocate service fees to unit cost` is QUOTE-WIDE operator
 * authority: set once from the Production section header and applied across
 * all assemblies. V1 does not need operators to create new divergence.
 *
 * ── WHY AN AGGREGATE IS STILL REQUIRED ────────────────────────────────────
 *
 * Authoring is quote-wide; STORAGE is per-assembly. `assembly_production_inputs
 * .allocate_service_fees_to_cost` is keyed by `assembly_id`, and the costing
 * adapter and customer-view resolver both consume it that way, so divergent
 * rows can exist and produce genuinely different money per assembly
 * (`tests/unit/assembly-allocation-policy-scope.test.ts`).
 *
 * A quote-level control over that therefore has no single value to display. It
 * has three honest states and one empty one, and the point of naming them is
 * that `mixed` cannot be rendered as `on` or `off` by accident: showing ON
 * while one assembly is OFF would state something false about money.
 *
 * Normalising the persistence is deferred architecture/accounting cleanup for
 * the bounded Production/OTC workstream. Nothing here presumes its outcome —
 * if the column ever becomes quote-level, `mixed` becomes unreachable and this
 * module gets simpler, which is a fine way for it to end.
 */

/**
 * The governed policy for an Item Group with NO persisted row yet.
 *
 * Defined once because the READ and the WRITE must agree: the aggregate shown
 * to the operator has to be the value a first write would persist, or the
 * control reports one thing and saves another.
 *
 * Unanimous across the three places that already answer this — the schema
 * defaults (`customer_ships_raws` false, `allocate_service_fees_to_cost`
 * true), the policy action's own no-op comment, and the per-cell INSERT
 * branch's fallback when an assembly has no sibling row to inherit from.
 */
export const DEFAULT_ASSEMBLY_POLICY = {
  customerShipsRaws: false,
  allocateServiceFeesToCost: true,
} as const;

export type AllocationAggregate = "on" | "off" | "mixed" | "none";

/**
 * `none` when there is nothing to aggregate. It is NOT a default of `on`:
 * a quote with no assemblies has no allocation policy to state, and answering
 * `on` would put a live-looking control over nothing.
 */
export function aggregateAllocation(
  policies: Iterable<{ allocateServiceFeesToCost: boolean }>,
): AllocationAggregate {
  let seen = 0;
  let on = 0;
  for (const p of policies) {
    seen += 1;
    if (p.allocateServiceFeesToCost) on += 1;
  }
  if (seen === 0) return "none";
  if (on === seen) return "on";
  if (on === 0) return "off";
  return "mixed";
}

/**
 * What a click on the bulk control resolves to.
 *
 * `mixed` resolves to ON rather than toggling, because there is nothing to
 * toggle: the control has no prior uniform state to invert. ON is the schema
 * default (`allocate_service_fees_to_cost` defaults true) and the
 * amortized-into-per-unit treatment the section header describes, so resolving
 * upward is the less surprising of the two.
 *
 * Either resolution FLATTENS pre-existing divergence, deliberately: under V1's
 * quote-wide authority that is the operator setting the quote's policy, and it
 * is the only exit from `mixed`. It is not silent — the control reads `mixed`
 * and says so before the click, in both the consequence line and the title.
 */
export function resolveBulkAllocation(state: AllocationAggregate): boolean | null {
  switch (state) {
    case "on":
      return false;
    case "off":
    case "mixed":
      return true;
    case "none":
      return null;
  }
}

/** Section-header wording for the same aggregate. */
export function describeAllocation(state: AllocationAggregate): string {
  switch (state) {
    case "on":
      return "amortized";
    case "off":
      return "billed separately";
    case "mixed":
      return "mixed by product";
    case "none":
      return "—";
  }
}
