import "server-only";
import type { HubSpotOperations } from "@/lib/integrations/hubspot-provider";
import {
  HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER,
  HUBSPOT_SUPPRESSION_REASON,
} from "@/lib/config/certification-mode";

/**
 * Certification-mode HubSpot decorator — the HARD boundary.
 *
 * Call sites guard themselves (they must, so Accept still succeeds internally
 * and the audit records the truth). This decorator exists because call-site
 * guards only protect the paths someone enumerated. Wrapping the provider makes
 * "no production deal mutation occurs" a property of the dependency graph
 * rather than of my enumeration being complete — including from paths added
 * later by someone who never read this file.
 *
 * It THROWS rather than silently no-oping. A silent no-op would let a future
 * caller believe a write landed. Loud refusal is the point: reaching here means
 * a deal-mutating path was not guarded, and that is a defect to see, not to
 * absorb.
 *
 * Everything else — every read, plus product creation — passes through
 * untouched via spread, so the wrapper stays correct as the interface grows.
 */

export class HubspotWriteSuppressedError extends Error {
  readonly operation: string;
  constructor(operation: string, detail: string) {
    super(
      `${HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER} — refused ${operation}. ` +
        `${detail} Reason: ${HUBSPOT_SUPPRESSION_REASON}`,
    );
    this.name = "HubspotWriteSuppressedError";
    this.operation = operation;
  }
}

/**
 * Marker proving a provider instance is ACTUALLY decorated.
 *
 * The env flag and the composed graph can disagree. `getApplicationDependencies`
 * memoizes for the process lifetime (`dependenciesPromise ??=`), so a runtime
 * that composed its graph while suppression was OFF keeps an UNDECORATED
 * provider even after the env is reloaded — Next dev reloads `.env.local`
 * without restarting. Reading the flag would report SUPPRESSED while this hard
 * boundary is absent.
 *
 * So the probe must interrogate the provider it would actually use, not the
 * variable that was meant to select it.
 */
export const CERTIFICATION_SUPPRESSED_MARKER = Symbol.for(
  "nexus.hubspot.certificationSuppressed",
);

export function isProviderCertificationSuppressed(
  provider: HubSpotOperations,
): boolean {
  return (
    (provider as unknown as Record<symbol, unknown>)[
      CERTIFICATION_SUPPRESSED_MARKER
    ] === true
  );
}

export function withCertificationSuppression(
  base: HubSpotOperations,
): HubSpotOperations {
  const decorated: HubSpotOperations = {
    ...base,

    updateDealStage: async (dealId, _stageId, _opts) => {
      throw new HubspotWriteSuppressedError(
        "updateDealStage",
        `Deal ${dealId} was NOT modified; no stage or amount was written.`,
      );
    },

    updateDealAmount: async (dealId, _amount) => {
      throw new HubspotWriteSuppressedError(
        "updateDealAmount",
        `Deal ${dealId} was NOT modified; no amount was written.`,
      );
    },
  };

  // Non-enumerable so it never leaks into spreads, logs or serialization; the
  // marker is an identity assertion about this object, not part of the
  // provider contract.
  Object.defineProperty(decorated, CERTIFICATION_SUPPRESSED_MARKER, {
    value: true,
    enumerable: false,
  });
  return decorated;
}
