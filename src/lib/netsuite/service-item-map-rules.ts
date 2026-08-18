import type { NetSuiteOperations } from "@/lib/integrations/netsuite-provider";
import {
  DIRECT_SERVICE_LABELS,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";

/**
 * Direct Service → NetSuite item mapping — the PURE rules.
 *
 * Design: `docs/direct-service-netsuite-mapping-design.md`.
 * Plan + measurement: `docs/direct-service-stage-3-implementation-plan.md` §B.
 *
 * ── WHY THIS IS SEPARATE FROM THE LOADER ──────────────────────────────────
 *
 * Nothing here touches the database or the network. The split is not tidiness:
 * the `indeterminate` vs `gone` distinction is the part of this feature most
 * worth testing and least likely to announce a regression, and a module that
 * imports `@/db` cannot be loaded by the unit-test runner at all. Rules that
 * cannot be exercised are rules that drift.
 *
 * ── THE FOUR FIXED IDENTITIES ─────────────────────────────────────────────
 *
 * `other_service` is absent, by CHECK in the schema rather than by convention.
 * It is the catch-all, carries no single accounting meaning, and takes a
 * per-LINE selection (workstream C). Anything here that special-cased it into
 * a default would be the generic fallback the disposition prohibits.
 */
export const FIXED_SERVICE_IDENTITIES = [
  "formulation",
  "filling_blending",
  "packout_assembly",
  "testing_micros",
] as const satisfies readonly DirectServiceIdentity[];

export type FixedServiceIdentity = (typeof FIXED_SERVICE_IDENTITIES)[number];

export function isFixedServiceIdentity(
  v: DirectServiceIdentity,
): v is FixedServiceIdentity {
  return (FIXED_SERVICE_IDENTITIES as readonly string[]).includes(v);
}

export type StoredServiceMapping = {
  serviceIdentity: FixedServiceIdentity;
  netsuiteItemCode: string;
  netsuiteInternalId: string;
  resolvedAt: Date;
};

/**
 * Live validation verdict for ONE stored mapping.
 *
 * ── WHY `indeterminate` IS ITS OWN CASE, AND NOT A FLAVOUR OF `stale` ─────
 *
 * A NetSuite call that ERRORS tells us nothing about the item. Folding that
 * into "stale" would let one transient API failure mark every mapping stale
 * and block firm-wide completion — and it would do so while reporting a
 * confident, wrong reason.
 *
 * This is the OD-027 lesson in `CLAUDE.md`: a lookup that catches errors and
 * returns "missing" cannot establish nonexistence, because it reports the same
 * value for "deleted" and "the call failed".
 *
 * The distinction is not a precaution — it is a MEASURED property of the API.
 * A nonexistent internal id returns zero rows and does NOT throw (plan §B.2),
 * so `gone` is authoritative and is reachable only when the read succeeded.
 */
export type MappingVerdict =
  /** Resolved, active, usable. */
  | { state: "usable"; itemCode: string }
  /** The read SUCCEEDED and the item is not there. Authoritative. */
  | { state: "gone" }
  /** The read SUCCEEDED and the item exists but is inactive. Authoritative. */
  | { state: "inactive"; itemCode: string }
  /** The read FAILED. Nothing is known. Never treat as evidence of absence. */
  | { state: "indeterminate"; reason: string };

/**
 * Key the port's per-id verdicts back to service identities.
 *
 * The NetSuite call itself lives in `item-resolver.ts` and reaches this
 * through the provider port, NOT by direct import. OD-023 is the reason,
 * recorded on the port itself: a boundary one caller can route around is a
 * boundary for the others only — and the isolated harness must be able to
 * answer this without touching production NetSuite.
 *
 * One round trip for all identities. Measured at plan §B.2: four ids batched
 * is p50 183ms, about what a single SKU-match costs, while validating one id
 * at a time measured slower per call.
 */
export async function validateServiceItemMappings(
  netsuite: Pick<NetSuiteOperations, "validateItemInternalIds">,
  mappings: ReadonlyArray<{
    serviceIdentity: FixedServiceIdentity;
    netsuiteInternalId: string;
  }>,
): Promise<Map<FixedServiceIdentity, MappingVerdict>> {
  const out = new Map<FixedServiceIdentity, MappingVerdict>();
  if (mappings.length === 0) return out;

  const byId = await netsuite.validateItemInternalIds(
    mappings.map((m) => m.netsuiteInternalId),
  );
  for (const m of mappings) {
    out.set(
      m.serviceIdentity,
      byId.get(m.netsuiteInternalId) ?? {
        state: "indeterminate",
        // No verdict is NOT absence. The id was submitted and nothing came
        // back about it, which is a failed read one level up.
        reason: `no verdict returned for internal id ${m.netsuiteInternalId}`,
      },
    );
  }
  return out;
}

/**
 * The operator-facing sentence for a mapping that cannot be used.
 *
 * Separated from the verdict so the three failing states cannot collapse into
 * one message: they have different causes and different remedies, and an
 * operator told "check the mapping" when NetSuite is simply unreachable will
 * go and change a mapping that was correct.
 */
export function describeUnusableMapping(
  identity: DirectServiceIdentity,
  verdict: MappingVerdict | undefined,
): string | null {
  const label = DIRECT_SERVICE_LABELS[identity];
  if (verdict === undefined) {
    return `${label} has no NetSuite item mapping. An admin must map it in Settings → NetSuite before this quote can complete.`;
  }
  switch (verdict.state) {
    case "usable":
      return null;
    case "gone":
      return `${label} is mapped to a NetSuite item that no longer exists. An admin must re-map it in Settings → NetSuite.`;
    case "inactive":
      return `${label} is mapped to NetSuite item ${verdict.itemCode}, which is inactive. An admin must re-map it in Settings → NetSuite.`;
    case "indeterminate":
      // Deliberately does NOT ask the operator to change anything: nothing is
      // known to be wrong with the mapping. Retrying is the whole remedy.
      return `Could not reach NetSuite to confirm the item mapping for ${label}. Nothing has changed — try again shortly. (${verdict.reason})`;
  }
}
