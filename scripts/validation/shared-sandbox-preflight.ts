/** Read-only checks before any shared-sandbox migration or deployment. */
import postgres from "postgres";
import { assertRuntimeSafety, SHARED_SANDBOX_SUPABASE_REF } from "../../src/lib/config/runtime-config.ts";

async function requireOk(url: string, key: string, label: string): Promise<Response> {
  const response = await fetch(url, {
    // The new sb_* keys are not JWTs. Supabase requires them on apikey only.
    headers: { apikey: key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return response;
}

async function main(): Promise<void> {
  const safety = assertRuntimeSafety();
  if (!safety.sharedSandbox) throw new Error("Set NEXUS_SHARED_SANDBOX=1 for this preflight");

  const base = `https://${SHARED_SANDBOX_SUPABASE_REF}.supabase.co`;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Opaque API keys cannot be checked against the project ref locally. These
  // requests prove they authenticate at the pinned project before any write.
  await requireOk(`${base}/auth/v1/health`, publishable, "Publishable key");
  const bucketResponse = await requireOk(
    `${base}/storage/v1/bucket/quote-pdfs`, secret, "Secret key and PDF bucket",
  );
  const bucket = await bucketResponse.json() as { id?: string; public?: boolean };
  if (bucket.id !== "quote-pdfs" || bucket.public !== false) {
    throw new Error("PDF bucket must exist and be private in the dedicated project");
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 10 });
  try {
    const [row] = await sql`select current_database() as database_name, current_user as user_name`;
    if (row?.database_name !== "postgres" || row?.user_name !== "postgres") {
      throw new Error("Database login does not match the dedicated sandbox project");
    }
  } finally {
    await sql.end();
  }

  console.log("Shared sandbox preflight passed: database identity, API keys, and private PDF bucket.");
}

main().catch((error: unknown) => {
  // Keep credential-bearing URLs and response bodies out of logs.
  console.error(error instanceof Error ? error.message : "Shared sandbox preflight failed");
  process.exitCode = 1;
});
