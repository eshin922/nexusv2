import type { NetSuiteOperations } from "@/lib/integrations/netsuite-provider";
import { ActionGuardError, ERR } from "@/lib/action-result";
import {
  SERVICE_IDENTITY_DESTINATION,
  isPerLineDestination,
} from "./bv011-destinations";
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

/**
 * Narrow an incoming identity to one that may carry a FIRM-WIDE mapping.
 *
 * Lives here rather than in the action so it can be exercised: the action
 * module imports the database and cannot be loaded by the unit runner, and
 * "other_service is refused" is a rule, not an action concern.
 *
 * Two rejections, deliberately distinct. An unknown string is not an identity
 * at all; `other_service` IS one and is simply not firm-mappable. Reporting
 * the second as the first would tell an admin they had mistyped something.
 */
export function requireFixedServiceIdentity(raw: unknown): FixedServiceIdentity {
  if (typeof raw !== "string") {
    throw new ActionGuardError(ERR.VALIDATION, "Service identity is required.");
  }
  const known = (
    Object.keys(DIRECT_SERVICE_LABELS) as DirectServiceIdentity[]
  ).find((k) => k === raw);
  if (!known) {
    throw new ActionGuardError(ERR.VALIDATION, `Unknown service identity: ${raw}`);
  }
  if (!isFixedServiceIdentity(known)) {
    // Refused here AND by a schema CHECK. This is the sentence; that is the
    // enforcement. Neither is load-bearing alone.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Other Service has no firm-wide NetSuite item. It is the catch-all and carries no single accounting meaning, so its item is selected per service line on the quote.",
    );
  }
  return known;
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

/**
 * The Direct Service completion gate — MAPPING USABILITY ONLY.
 *
 * Extracted from `mark-complete` so it can be EXERCISED rather than only
 * code-asserted. Driving a real quote to `accepted` to test this would fire the
 * production HubSpot deal-stage push, so the decision has to be provable
 * without the transition.
 *
 * ── THE PROJECTION REFUSAL IS GONE (F1/F4) ────────────────────────────────
 *
 * This gate used to block EVERY service quote, even a fully mapped one, on the
 * grounds that projecting a service onto a Sales Order was not certified. That
 * was correct while it was true. It is no longer true: a Direct Service line's
 * economics now come from the frozen accepted column through
 * `assessProjectionReadiness` and the quantity-1 accounting emitter, its item
 * from its governed BV-011 destination, and the complete order reconciles to
 * the frozen tier total exactly before anything is posted.
 *
 * The original protection is NOT lost with it, because the protection was never
 * really this refusal. It was "a service must never be emitted as a flat
 * Direct-Product-shaped line at whatever quantity and rate the SKU path
 * computes" — and that is now held structurally, in three places that do not
 * depend on anyone remembering:
 *
 *   · services are partitioned out of the SKU loop by `commercialKind`, so the
 *     `SVC-*` identifier is never matched against a NetSuite item code;
 *   · services are excluded from the live structure index, so no service can
 *     acquire a product line's quantity or rate;
 *   · a service line's item and amount come from the frozen matrix, and REG-4
 *     refuses the order if the emitted set does not reproduce the accepted
 *     total exactly.
 *
 * Pattern 56 in the other direction: the accident became deliberate so it could
 * be removed deliberately, once what it stood in for was actually built.
 *
 * ── WHAT STILL BLOCKS, AND WHY IT IS NOT REDUNDANT ────────────────────────
 *
 * An unusable mapping — absent, deleted, inactive, or unconfirmable. Readiness
 * also refuses an unmapped destination, but only by the ABSENCE of a mapping
 * row; it does not ask NetSuite whether the mapped item still exists and is
 * active. This does, so a mapping that has rotted since it was entered is
 * caught here rather than by NetSuite rejecting the CREATE.
 *
 * A PER-LINE destination is no longer blocked here — `other_service`, and since
 * Decision 5 (Accounting, 2026-08-19) `otc_testing` as well. Their item is
 * chosen per line and frozen at send, so whether a given line HAS a selection
 * is a fact about the frozen row, which this gate cannot see and readiness can
 * — and readiness refuses it by name, pointing at Costs rather than Settings.
 *
 * The exemption is keyed on the DESTINATION, not on the fixed/other identity
 * split. The split was a working proxy while `other_service` was the only
 * per-line destination; `testing_micros` is a FIXED identity with a per-line
 * destination, so the proxy and the governance now disagree.
 */
export type DirectServiceGateVerdict =
  | { blocked: false }
  /** The operator (or an admin) can clear this. */
  | { blocked: true; kind: "mapping"; reason: string };

export function evaluateDirectServiceGate(input: {
  serviceIdentities: ReadonlyArray<DirectServiceIdentity | null>;
  mapped: ReadonlySet<FixedServiceIdentity>;
  verdicts: ReadonlyMap<FixedServiceIdentity, MappingVerdict>;
}): DirectServiceGateVerdict {
  const { serviceIdentities, mapped, verdicts } = input;
  if (serviceIdentities.length === 0) return { blocked: false };

  const known = serviceIdentities.filter(
    (id): id is DirectServiceIdentity => id !== null,
  );
  // PER-LINE destinations are exempt, and the test is the DESTINATION rather
  // than the fixed/other split.
  //
  // The split was the right proxy while `other_service` was the only per-line
  // destination. Decision 5 (Accounting, 2026-08-19) made `OTC - Testing`
  // per-line too, and `testing_micros` IS a fixed identity — so the proxy
  // started demanding a firm-wide mapping for a line whose item is chosen per
  // line and frozen at send. It blocked CERT-303 on a mapping row that nothing
  // would ever have read: readiness resolves this line from the frozen
  // selection, and does so correctly.
  //
  // Satisfying it with a firm-wide row would have been worse than the block. It
  // would create a SECOND answer to "which item does this line post to", sitting
  // in Settings looking authoritative while the frozen per-line selection is
  // what actually posts — the divergence Pattern 58 warns about, and the one the
  // readiness resolver was deliberately written in a single pass to avoid.
  const fixed = known
    .filter(isFixedServiceIdentity)
    .filter((id) => !isPerLineDestination(SERVICE_IDENTITY_DESTINATION[id]));

  const problems = fixed
    .map((id) => describeUnusableMapping(id, mapped.has(id) ? verdicts.get(id) : undefined))
    .filter((m): m is string => m !== null);

  if (problems.length > 0) {
    return { blocked: true, kind: "mapping", reason: problems.join(" ") };
  }

  return { blocked: false };
}
