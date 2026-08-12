// OD-012 Repair 2 — schema drift detection.
//
// Compares src/db/schema.ts against the governed migration baseline and reports
// drift. NEVER writes into drizzle/.
//
// Seeding matters: drizzle-kit has no split in/out, so the scratch directory is
// seeded from the governed drizzle/ first. Generating into an EMPTY directory
// diffs against nothing and emits the whole schema — which looks like
// catastrophic drift and is really just a missing baseline.
//
// Expected: ZERO statements. Anything emitted is real schema.ts-vs-baseline
// drift — classify it, never apply it blindly.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = ".drizzle-drift";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync("drizzle", OUT, { recursive: true });

const before = new Set(readdirSync(OUT).filter((f) => f.endsWith(".sql")));

try {
  execFileSync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "generate", "--config=drizzle.drift.config.ts", "--name=drift_probe"],
    { stdio: "pipe" },
  );
} catch (e) {
  console.error("[schema-drift] drizzle-kit generate failed:\n" + String(e.stdout ?? e));
  process.exit(1);
}

const added = readdirSync(OUT).filter((f) => f.endsWith(".sql") && !before.has(f));
if (added.length === 0) {
  console.log("[schema-drift] OK · zero statements — schema.ts matches the migration baseline.");
  process.exit(0);
}

const body = readFileSync(`${OUT}/${added[0]}`, "utf8");
const statements = body
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !/^--/.test(s));

if (statements.length === 0) {
  console.log("[schema-drift] OK · zero statements — schema.ts matches the migration baseline.");
  process.exit(0);
}

console.error(
  `[schema-drift] DRIFT · ${statements.length} statement(s) in ${OUT}/${added[0]}\n` +
    `  This is real schema.ts-vs-baseline drift. Classify it. Do NOT apply it blindly,\n` +
    `  and do NOT copy it into drizzle/ — governed migrations are hand-authored.\n` +
    statements.slice(0, 10).map((s) => "  " + s.split("\n")[0]).join("\n"),
);
process.exit(1);
