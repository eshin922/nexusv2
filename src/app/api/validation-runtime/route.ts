import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

/**
 * What runtime is THIS process, and whose session is it serving?
 *
 * ── WHY THE TARGET HAS TO ANSWER ──────────────────────────────────────────
 *
 * A checking script knows its own environment and nothing about the server it
 * is pointed at. Those are different processes: an app can be started from one
 * profile and a check launched from another, and every reading the check makes
 * about "the environment" then describes the wrong one. That is not
 * hypothetical — a run launched as `pm` against an app serving `admin`
 * produced two failures that were purely the mismatch.
 *
 * The same reasoning `certification-status` states for suppression applies
 * here: configuration files and intended deployment are INFERENCES about a
 * running process, and only the process can answer for itself.
 *
 * ── WHY IT READS THE COMPOSED GRAPH AND NOT THE ENVIRONMENT ───────────────
 *
 * Validation-mode selection is confined to startup composition, and
 * `composition-boundary.test.ts` enforces that no source file outside it reads
 * `NEXUS_*` or calls `assertRuntimeSafety`. An earlier draft of this route did
 * both, and the boundary test caught it.
 *
 * Honouring the rule produced better evidence than breaking it would have. The
 * providers carry the `kind` that STARTUP selected, so reporting those reports
 * what the process actually composed — not what an environment variable says
 * it should have composed, which can differ when a variable changed after the
 * server booted. The database is likewise asked for its own name rather than
 * having it parsed out of a connection string.
 *
 * ── WHY IT 404s OUTSIDE ISOLATED MODE ─────────────────────────────────────
 *
 * It reports which identity is signed in, which is not something a production
 * surface should publish. So outside isolated composition it does not exist:
 * 404, revealing nothing — not the mode, not the providers, not that a check
 * was refused.
 *
 * A caller therefore cannot read a 404 as "probably fine". Absent facts are
 * absent, and the harness treats them as blocking rather than assuming an
 * isolation it could not confirm.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { getApplicationDependencies } = await import(
    "@/lib/integrations/composition"
  );

  let deps: Awaited<ReturnType<typeof getApplicationDependencies>>;
  try {
    deps = await getApplicationDependencies();
  } catch {
    // A graph that cannot be composed is not an isolated one.
    return new NextResponse(null, { status: 404 });
  }

  // The kinds STARTUP chose, read off the composed objects themselves.
  const providers = {
    auth: deps.authentication.identity.kind,
    artifacts: deps.artifacts.kind,
    hubspot: deps.hubspot.kind,
    netsuite: deps.netsuite.kind,
  };
  const isolated = Object.values(providers).every((k) => k === "isolated");
  if (!isolated) {
    return new NextResponse(null, { status: 404 });
  }

  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");

  // The database this process is actually connected to. Asking it beats
  // parsing a connection string, which is one more inference about the thing
  // rather than the thing.
  let databaseName: string | null = null;
  try {
    const rows = await db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    databaseName = (rows as unknown as { name: string }[])[0]?.name ?? null;
  } catch {
    databaseName = null;
  }

  const identity = await deps.authentication.identity.current();
  let role: string | null = null;
  if (identity) {
    // The role comes from the row the authorization guards read. An email
    // prefix is a naming convention, and would be a second inference in a
    // file whose whole purpose is removing them.
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.clerkUserId, identity.externalUserId))
      .limit(1);
    role = row?.role ?? null;
  }

  return NextResponse.json(
    {
      mode: "isolated",
      providers,
      providerNames: {
        auth: deps.authentication.identity.name,
        artifacts: deps.artifacts.name,
        hubspot: deps.hubspot.name,
        netsuite: deps.netsuite.name,
      },
      database: {
        name: databaseName,
        carriesValidationMarker: Boolean(
          databaseName?.includes("nexus_validation"),
        ),
      },
      identity: identity
        ? { email: identity.email, externalUserId: identity.externalUserId, role }
        : null,
      pid: process.pid,
      readAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
