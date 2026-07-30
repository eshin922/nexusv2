import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import {
  assertRuntimeSafety,
  VALIDATION_DATABASE_MARKER,
} from "../../src/lib/config/runtime-config.ts";

const root = path.resolve(import.meta.dirname, "../..");
const composeFile = path.join(root, "docker-compose.validation.yml");
const artifactRoot = path.join(root, ".artifacts", "validation");

function run(
  command: string,
  args: string[],
  opts: { allowFailure?: boolean } = {},
): number {
  const rendered = [command, ...args].join(" ");
  console.log(`[validation] ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  const status = result.status ?? 1;
  if (status !== 0 && !opts.allowFailure) {
    throw new Error(`[validation] command failed (${status}): ${rendered}`);
  }
  return status;
}

function runCapture(command: string, args: string[]): string {
  const rendered = [command, ...args].join(" ");
  console.log(`[validation] ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `[validation] command failed (${result.status ?? 1}): ${rendered}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function assertDestructiveTarget(): void {
  const safety = assertRuntimeSafety();
  if (
    safety.mode !== "isolated" ||
    !safety.database?.name.includes(VALIDATION_DATABASE_MARKER)
  ) {
    throw new Error(
      "[validation] destructive command refused: target is not an isolated validation database",
    );
  }
}

function dockerCompose(args: string[]): number {
  return run("docker", ["compose", "-f", composeFile, ...args]);
}

function start(): void {
  assertRuntimeSafety();
  dockerCompose(["up", "-d", "--wait"]);
  readiness();
}

function readiness(): void {
  assertRuntimeSafety();
  run("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "nexus-validation-db",
    "pg_isready",
    "-U",
    "nexus_validation",
    "-d",
    "nexus_validation_test",
  ]);
}

function migrate(): void {
  assertRuntimeSafety();
  run("node", [
    "node_modules/drizzle-kit/bin.cjs",
    "migrate",
  ]);
  schemaVersion();
}

function schemaVersion(): void {
  assertRuntimeSafety();
  const output = runCapture("docker", [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "nexus-validation-db",
    "psql",
    "-U",
    "nexus_validation",
    "-d",
    "nexus_validation_test",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    [
      "select count(*) from drizzle.__drizzle_migrations;",
      "select case when exists(",
      "select 1 from information_schema.columns",
      "where table_schema='public' and table_name='quotes'",
      "and column_name='netsuite_so_tranid'",
      ") then 'schema-ready' else 'schema-incomplete' end;",
    ].join(" "),
  ]);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines[0] !== "47" || lines[1] !== "schema-ready") {
    throw new Error(
      `[validation] schema assertion failed: expected 47 + schema-ready, got ${JSON.stringify(lines)}`,
    );
  }
  console.log(`[validation] schema assertion passed: ${lines.join(", ")}`);
}

function reset(): void {
  assertDestructiveTarget();
  dockerCompose(["down", "-v", "--remove-orphans"]);
  start();
  migrate();
}

function teardown(): void {
  assertDestructiveTarget();
  dockerCompose(["down", "-v", "--remove-orphans"]);
  if (existsSync(artifactRoot)) {
    const resolved = path.resolve(artifactRoot);
    const expected = path.resolve(root, ".artifacts", "validation");
    if (resolved !== expected || !resolved.startsWith(root + path.sep)) {
      throw new Error(
        `[validation] artifact cleanup refused for unexpected path: ${resolved}`,
      );
    }
    rmSync(resolved, { recursive: true, force: true });
    console.log(`[validation] removed ${resolved}`);
  }
}

function proveIsolation(): void {
  const safety = assertRuntimeSafety();
  console.log(
    JSON.stringify(
      {
        mode: safety.mode,
        database: safety.database,
        providers: safety.providers,
        credentials: "absent (asserted)",
        network: "loopback allowlist only",
      },
      null,
      2,
    ),
  );
}

const command = process.argv[2];
const commands: Record<string, () => void> = {
  start,
  readiness,
  migrate,
  "schema-version": schemaVersion,
  reset,
  teardown,
  "prove-isolation": proveIsolation,
};

if (!command || !(command in commands)) {
  console.error(
    `Usage: cli.ts <${Object.keys(commands).join("|")}>`,
  );
  process.exit(2);
}

commands[command]();
