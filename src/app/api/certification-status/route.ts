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

export async function GET() {
  const state = hubspotAcceptSyncState();
  return NextResponse.json(
    {
      hubspotAcceptSync: state.suppressed ? "SUPPRESSED" : "ENABLED",
      suppressed: state.suppressed,
      banner: state.banner,
      reason: state.reason,
      // Distinguishes "this runtime has the suppression code" from "this
      // runtime has it switched on". A 404 means the running build predates
      // the feature entirely — which is itself the answer.
      contract: "src/lib/config/certification-mode.ts",
      env: "NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC",
      pid: process.pid,
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
