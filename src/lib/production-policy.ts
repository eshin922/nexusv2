/**
 * Aggregate view of a per-assembly production policy.
 *
 * `allocate_service_fees_to_cost` is per-assembly on `assembly_production_inputs`
 * — the schema, the costing adapter and the customer-view resolver all model it
 * that way, and the 2026-08-11 repair moved the operator control onto the
 * assembly it governs precisely because one quote-level copy had been
 * broadcasting across every assembly and making A=ON / B=OFF unreachable.
 *
 * A quote-level control over a per-assembly value therefore has no single value
 * to display. It has three honest states and one empty one, and the whole point
 * of naming them here is that `mixed` cannot be rendered as either `on` or
 * `off` by accident — a bulk control that shows ON while one assembly is OFF is
 * the broadcast defect again, this time in the read direction.
 */

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
 * Either resolution FLATTENS divergence — that is what a bulk control does, and
 * it is why the per-assembly control stays on the assembly it governs so the
 * divergence is re-expressible afterwards.
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
