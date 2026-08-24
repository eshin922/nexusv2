/**
 * The constructed commercial state a fixture's production rows would produce.
 *
 * ── BUILT ENTIRELY FROM PRODUCTION CODE ─────────────────────────────────
 *
 * `chargeEconomicsFor` and `constructCommercial` are the engine's own
 * functions. Nothing here reimplements the economics or the placement rule,
 * because a fixture that computes them independently agrees with the engine
 * right up until one of them changes — and then it tells the reader the engine
 * is fine while the engine is not.
 *
 * ── WHY FIXTURES NEED THIS AT ALL ───────────────────────────────────────
 *
 * The projection no longer derives one-time charge amounts itself; it reads
 * the state the engine constructed. That is the point of the cutover — two
 * layers deciding the same thing is how the engine's revenue and the
 * customer's document came to disagree by ~1e-12 on eight real rows.
 *
 * The consequence is that a hand-assembled `costing` fixture is no longer a
 * complete input: it must carry the construction, exactly as a real bundle
 * does. That is a real coupling, and it is the intended one.
 */

import { chargeEconomicsFor, type CostingProductionInput } from "../../src/lib/costing.ts";
import { constructCommercial } from "../../src/lib/commercial-recovery/construct.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

/**
 * A minimal `skuRollups` entry carrying an owner's construction.
 *
 * The projection skips non-leaf rollups when building unit lines and consults
 * them only for the construction, so an assembly entry needs nothing else. The
 * engine's real assembly rollup is a full record; this is the part the
 * projection reads, and giving a fixture more would be inventing agreement.
 */
export function constructionRollup(
  ownerId: string,
  production: readonly CostingProductionInput[],
  ratePct: number | null,
  elections: readonly ChargeElection[] = [],
) {
  const tierIds = [...new Set(production.map((p) => p.tierId))];
  return {
    skuId: ownerId,
    skuRole: "assembly" as const,
    perTier: tierIds.map((tierId) => {
      const row = production.find((p) => p.tierId === tierId) ?? null;
      return {
        tierId,
        constructed: constructCommercial(
          chargeEconomicsFor(row, ratePct),
          elections,
          row?.allocateServiceFeesToCost,
        ),
      };
    }),
  };
}
