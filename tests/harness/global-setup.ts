import { assertRuntimeSafety } from "../../src/lib/config/runtime-config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resetFixtureWorld,
  seedFixtureWorld,
} from "./fixtures/world";

export default async function globalSetup() {
  const runtime = assertRuntimeSafety();
  if (runtime.mode !== "isolated") {
    throw new Error("[playwright] isolated runtime proof failed");
  }
  for (const [name, provider] of Object.entries(runtime.providers)) {
    if (provider !== "isolated") {
      throw new Error(`[playwright] ${name} provider is not isolated`);
    }
  }
  const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
  await resetFixtureWorld(runId);
  const manifest = await seedFixtureWorld(runId);
  const directory = path.resolve(
    process.cwd(),
    ".artifacts",
    "validation",
    runId,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "fixture-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
