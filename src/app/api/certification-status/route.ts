import { NextResponse } from "next/server";
import { hubspotAcceptSyncState } from "@/lib/config/certification-mode";

/**
 * Runtime certification-state probe.
 *
 * WHY THIS EXISTS. Certification suppression is a property of the PROCESS
 * serving the UI, not of the repository. Source code, `.env.local` contents and
 * intended deployment configuration are all inferences about that process —
 * each can be true while the running server disagrees (stale dev server started
 * before the variable was added, a deploy that never picked up the env, a
 * different branch serving the session). Every one of those failure modes ends
 * with an operator believing suppression is active while Accept writes a real
 * production HubSpot deal stage and fires the production NetSuite workflow.
 *
 * So this reports the state from INSIDE the runtime, which is the only place
 * that can answer it.
 *
 * Also satisfies go-live BLOCKER 1 evidence item 1, which requires proof from
 * the deployed environment rather than from a local shell.
 *
 * Read-only. Exposes a boolean, a banner string and a fixed reason — no
 * secrets, no deal data, no configuration values. Deliberately unauthenticated
 * so it is verifiable with a plain request against whichever runtime is serving
 * the session, including before a session exists.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Dynamic import so a NetSuite misconfiguration cannot break the HubSpot half. */
async function loadNetsuiteFacts() {
  const { describeNetsuiteTarget } = await import("@/lib/netsuite/client");
  return describeNetsuiteTarget();
}

export async function GET() {
  const state = hubspotAcceptSyncState();

  // The FLAG is not the guarantee — the composed provider is. The dependency
  // graph is memoized for the process lifetime, and Next dev reloads
  // `.env.local` WITHOUT restarting, so a runtime that composed its graph while
  // suppression was off keeps an undecorated provider while the flag reads
  // SUPPRESSED. Interrogate the provider that would actually be used.
  const { getApplicationDependencies } = await import(
    "@/lib/integrations/composition"
  );
  const { isProviderCertificationSuppressed } = await import(
    "@/lib/integrations/hubspot-certification-suppression"
  );
  const { hubspot } = await getApplicationDependencies();
  const providerSuppressed = isProviderCertificationSuppressed(hubspot);

  // Both layers must agree. Disagreement is reported as its own state rather
  // than resolved in favour of either side.
  const effective =
    state.suppressed && providerSuppressed
      ? "SUPPRESSED"
      : !state.suppressed && !providerSuppressed
        ? "ENABLED"
        : "INCONSISTENT";

  // NetSuite target of THIS process. Same reason the HubSpot facts are read
  // from the runtime: which provider a deployment writes to is a property of
  // the running process, and Vercel configuration is an inference about it.
  //
  // Derived facts only — no account id, no keys, no tokens, no URLs. The
  // resolver and guard are the production ones; see `describeNetsuiteTarget`.
  //
  // Unconfigured is reported as its own state rather than as `false`. A missing
  // variable and a production target are different problems, and collapsing
  // them would let "not configured" read as "configured and refused".
  let netsuite:
    | { configured: true; facts: Awaited<ReturnType<typeof loadNetsuiteFacts>> }
    | { configured: false; reason: string };
  try {
    netsuite = { configured: true, facts: await loadNetsuiteFacts() };
  } catch (e) {
    netsuite = {
      configured: false,
      // Message only — `loadNetsuiteConfig` names the missing variable and
      // never includes its value.
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  return NextResponse.json(
    {
      hubspotAcceptSync: effective,
      flagSuppressed: state.suppressed,
      providerSuppressed,
      ...(effective === "INCONSISTENT"
        ? {
            warning:
              "Flag and composed provider disagree. The dependency graph is " +
              "memoized per process; restart the runtime so the provider is " +
              "composed under the current flag. Do NOT proceed on this state.",
          }
        : {}),
      suppressed: state.suppressed && providerSuppressed,
      banner: state.banner,
      reason: state.reason,
      // Distinguishes "this runtime has the suppression code" from "this
      // runtime has it switched on". A 404 means the running build predates
      // the feature entirely — which is itself the answer.
      contract: "src/lib/config/certification-mode.ts",
      env: "NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC",
      // Certification requires all three: sandbox environment, an account that
      // is sandbox on its own shape, and the guard permitting the write.
      netsuiteConfigured: netsuite.configured,
      netsuiteEnvironment: netsuite.configured ? netsuite.facts.environment : null,
      netsuiteAccountIsSandbox: netsuite.configured
        ? netsuite.facts.accountIsSandbox
        : null,
      netsuiteWriteAuthorizedForCertification: netsuite.configured
        ? netsuite.facts.writeAuthorized
        : null,
      ...(netsuite.configured ? {} : { netsuiteUnconfiguredReason: netsuite.reason }),
      pid: process.pid,
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
