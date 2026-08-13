/**
 * Certification mode — temporary suppression of Nexus's Accept-side production
 * HubSpot deal mutation.
 *
 * WHY THIS EXISTS. The production HubSpot workflow
 * `NETSUITE: Auto create NetSuite sales order from won deal` is ACTIVE, and its
 * enrollment includes `Deal stage = Won - In production (Sales)`. Its first
 * downstream action creates a **production** NetSuite Sales Order. Nexus
 * certification runs against a NetSuite **sandbox**, so a Nexus Accept that
 * moves a real deal into that stage fires production automation from a
 * sandboxed certification run.
 *
 * Restoring the stage afterwards does NOT undo it — the workflow has already
 * enrolled and acted. The trigger must never fire. That is why this suppresses
 * the write rather than reversing it.
 *
 * SCOPE — deliberately narrow.
 *
 *   SUPPRESSED : deal-property mutation (stage, amount). These are what the
 *                workflow enrolls on and what alters the deal record.
 *   PRESERVED  : every read (stage catalog, deal stage, owners, vendors,
 *                companies, product lookup) — lineage/customer/product
 *                resolution is untouched.
 *   PRESERVED  : ALL Nexus-internal acceptance behaviour — accepted state,
 *                accepted tier, freeze/snapshot, Complete eligibility, and the
 *                sandbox NetSuite path.
 *   PRESERVED  : HubSpot product creation. It is a write, but it is not deal
 *                mutation, does not touch the enrolling property, and library
 *                authoring depends on it.
 *
 * FAIL-SAFE DEFAULT. Absent or unrecognised env ⟹ **suppression OFF**, i.e.
 * normal production synchronisation. The dangerous state is the one that must
 * be asked for explicitly, so a lost or misspelled variable degrades toward
 * production-correct behaviour, never silently toward a disabled integration.
 *
 * RELEASE BLOCKER. This must be OFF at production go-live. See
 * `docs/validation/production-go-live-checklist.md`. `assertHubspotAcceptSyncEnabledForGoLive`
 * is the programmatic form of that gate.
 *
 * Dependency-free on purpose, matching `runtime-config.ts`: app code, scripts,
 * and unit tests all evaluate the identical rule.
 */

export const SUPPRESS_HUBSPOT_ACCEPT_SYNC_ENV =
  "NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC";

/** Operator-facing state string. Deliberately unambiguous — never "maybe". */
export const HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER =
  "HubSpot Accept synchronization is disabled for certification";

export const HUBSPOT_ACCEPT_SYNC_ENABLED_BANNER =
  "HubSpot Accept synchronization is enabled";

/** Recorded in audit_log so a suppressed acceptance is legible forever. */
export const HUBSPOT_SUPPRESSION_REASON =
  "certification_mode: production HubSpot workflow 'NETSUITE: Auto create " +
  "NetSuite sales order from won deal' creates a PRODUCTION NetSuite sales " +
  "order on entry to 'Won - In production'; Nexus certification targets the " +
  "NetSuite sandbox, so the stage/amount write is suppressed at source";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * True only on an explicit affirmative value. Anything else — unset, empty,
 * "0", "false", a typo — is false.
 */
export function isHubspotAcceptSyncSuppressed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SUPPRESS_HUBSPOT_ACCEPT_SYNC_ENV];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

export type HubspotAcceptSyncState = {
  suppressed: boolean;
  /** Ready to render. Never ambiguous. */
  banner: string;
  reason: string | null;
};

export function hubspotAcceptSyncState(
  env: NodeJS.ProcessEnv = process.env,
): HubspotAcceptSyncState {
  const suppressed = isHubspotAcceptSyncSuppressed(env);
  return {
    suppressed,
    banner: suppressed
      ? HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER
      : HUBSPOT_ACCEPT_SYNC_ENABLED_BANNER,
    reason: suppressed ? HUBSPOT_SUPPRESSION_REASON : null,
  };
}

/**
 * Go-live gate. Throws if certification suppression is still active, so the
 * release blocker cannot be satisfied by intent alone. Call from a release
 * verification script — never from a request path (it must not be possible to
 * take the app down by leaving the flag set).
 */
export function assertHubspotAcceptSyncEnabledForGoLive(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isHubspotAcceptSyncSuppressed(env)) return;
  throw new Error(
    `RELEASE BLOCKER — ${HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER}. ` +
      `${SUPPRESS_HUBSPOT_ACCEPT_SYNC_ENV} is set in this environment. Accept ` +
      `will NOT write the governed production deal stage or amount, so the ` +
      `production HubSpot -> NetSuite workflow will never fire. Unset it and ` +
      `re-verify before go-live.`,
  );
}
