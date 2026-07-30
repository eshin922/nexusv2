import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  resetFixtureWorld,
  seedFixtureWorld,
  fixtureRecordIds,
  type FixtureManifest,
} from "../../tests/harness/fixtures/world.ts";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

const command = process.argv[2];
const runId = process.argv[3] ?? process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const artifactDirectory = path.resolve(
  process.cwd(),
  ".artifacts",
  "validation",
  runId,
);
const manifestPath = path.join(artifactDirectory, "fixture-manifest.json");

async function validate(manifest?: FixtureManifest) {
  assertRuntimeSafety();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const { projectIds, quoteIds } = fixtureRecordIds(runId);
  try {
    const [counts] = await sql<{
      projects: number;
      quotes: number;
      tiers: number;
      pushes: number;
      invalid_external_ids: number;
    }[]>`
      select
        (select count(*)::int from projects
          where id in ${sql(projectIds)}) as projects,
        (select count(*)::int from quotes
          where id in ${sql(quoteIds)}) as quotes,
        (select count(*)::int from quote_tiers qt
          where qt.quote_id in ${sql(quoteIds)}) as tiers,
        (select count(*)::int from netsuite_so_pushes nsp
          where nsp.quote_id in ${sql(quoteIds)}) as pushes,
        (select count(*)::int from projects
          where id in ${sql(projectIds)}
            and hubspot_deal_id !~ '^[0-9]+$') as invalid_external_ids
    `;
    const expected = { projects: 5, quotes: 5, tiers: 10, pushes: 2 };
    for (const [key, value] of Object.entries(expected)) {
      if (counts[key as keyof typeof expected] !== value) {
        throw new Error(`[fixtures] expected ${value} ${key}, found ${counts[key as keyof typeof expected]}`);
      }
    }
    if (counts.invalid_external_ids !== 0) {
      throw new Error("[fixtures] found a non-validation external identifier");
    }
    if (manifest && Object.keys(manifest.quotes).length !== 5) {
      throw new Error("[fixtures] manifest does not contain every lifecycle state");
    }
    return counts;
  } finally {
    await sql.end();
  }
}

async function main() {
  if (command === "seed") {
    await resetFixtureWorld(runId);
    const manifest = await seedFixtureWorld(runId);
    const counts = await validate(manifest);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, counts }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ command, runId, manifestPath, counts }));
    return;
  }
  if (command === "reset") {
    await resetFixtureWorld(runId);
    await rm(artifactDirectory, { recursive: true, force: true });
    console.log(JSON.stringify({ command, runId }));
    return;
  }
  if (command === "validate") {
    const counts = await validate();
    console.log(JSON.stringify({ command, runId, counts }));
    return;
  }
  throw new Error("Usage: fixtures.ts <seed|validate|reset> [run-id]");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
