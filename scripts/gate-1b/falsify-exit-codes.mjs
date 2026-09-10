/**
 * Prove the gates can fail.
 *
 * A gate that has only ever been observed green is indistinguishable from a
 * gate that cannot go red -- which is precisely the defect being repaired here:
 * `pr-557-artifact-checks.ts` ended in an unconditional `process.exit(0)` and
 * reported success no matter what it found.
 *
 * Each case below breaks one thing deliberately, asserts the exit code moves,
 * and restores the file. The run ends by confirming green is restored, because
 * a falsification that leaves the tree broken has proved the wrong thing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TS_RUNNER = [
  "--env-file=.env.validation.local",
  "--experimental-strip-types",
  "--conditions=react-server",
  "--experimental-loader",
  "./scripts/support/src-resolver.mjs",
];

function run(args, env = {}, drop = []) {
  const merged = { ...process.env, ...env };
  // Deleted, not blanked. An EMPTY provider value is an INVALID value, which
  // `assertRuntimeSafety` rejects on its own -- a real refusal, but not the
  // path being tested. A mistaken invocation has the variable ABSENT.
  for (const key of drop) delete merged[key];
  const r = spawnSync("node", args, { env: merged, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? "CAUGHT " : "MISSED "} ${label.padEnd(46)} ${detail}`);
}

const ARTIFACT = "scripts/gate-1b/pr-557-artifact-checks.ts";
const original = readFileSync(ARTIFACT, "utf8");

// ── baseline ──────────────────────────────────────────────────────────────
const base = run([...TS_RUNNER, ARTIFACT]);
check("baseline is green", base.code === 0, `exit=${base.code}`);

// ── 1 · a FAIL must exit nonzero ──────────────────────────────────────────
writeFileSync(
  ARTIFACT,
  original.replace('expect: "Net 30"', 'expect: "DELIBERATELY WRONG"'),
);
const failed = run([...TS_RUNNER, ARTIFACT]);
check(
  "a FAIL verdict exits nonzero",
  failed.code !== 0 && /FAIL\s+A3p:mapped/.test(failed.out),
  `exit=${failed.code}`,
);

// ── 2 · a BLOCKED must exit nonzero ───────────────────────────────────────
writeFileSync(
  ARTIFACT,
  original.replace(
    'quote: "f6f8a904-5cdd-4e70-8ed7-2cf5a267e6cd"',
    'quote: "00000000-0000-0000-0000-000000000000"',
  ),
);
const blocked = run([...TS_RUNNER, ARTIFACT]);
check(
  "a BLOCKED verdict exits nonzero",
  blocked.code !== 0 && /BLOCKED/.test(blocked.out),
  `exit=${blocked.code}`,
);

writeFileSync(ARTIFACT, original);

// ── 3 · the runtime guard refuses a non-isolated environment ──────────────
// Launched WITHOUT the validation env file, exactly as a mistaken invocation
// would be. It must refuse, and it must refuse before the database module
// prints its diagnostic -- refusing after that has already opened a pool.
const unguarded = run(
  [
    "--experimental-strip-types",
    "--conditions=react-server",
    "--experimental-loader",
    "./scripts/support/src-resolver.mjs",
    ARTIFACT,
  ],
  {},
  [
    "NEXUS_ISOLATED_TEST",
    "NEXUS_AUTH_PROVIDER",
    "NEXUS_HUBSPOT_PROVIDER",
    "NEXUS_NETSUITE_PROVIDER",
    "NEXUS_ARTIFACT_PROVIDER",
    "NEXUS_REALTIME_PROVIDER",
    "NEXUS_VALIDATION_IDENTITY",
  ],
);
const refused = unguarded.code !== 0 && /refusing to run outside the isolated/.test(unguarded.out);
const beforeDb = !/\[db-diag\]/.test(unguarded.out);
check(
  "guard refuses a non-isolated runtime",
  refused,
  `exit=${unguarded.code}`,
);
check(
  "and refuses BEFORE the db module initialises",
  refused && beforeDb,
  beforeDb ? "no [db-diag] emitted" : "[db-diag] appeared — pool opened first",
);

// ── 4 · the HTTP gate refuses a non-loopback target ───────────────────────
const remote = run(["scripts/gate-1b/pr-557-checks.mjs"], {
  CHECK_BASE: "https://nexus.thedps.co",
});

// 4b - loopback alone is not enough: the providers must be DECLARED isolated,
// because a loopback app started from the production profile is still that.
const undeclared = run(
  ["scripts/gate-1b/pr-557-checks.mjs"],
  {},
  [
    "NEXUS_AUTH_PROVIDER",
    "NEXUS_HUBSPOT_PROVIDER",
    "NEXUS_NETSUITE_PROVIDER",
    "NEXUS_ARTIFACT_PROVIDER",
    "NEXUS_REALTIME_PROVIDER",
  ],
);
check(
  "HTTP gate refuses undeclared providers on loopback",
  undeclared.code !== 0 && /not declared isolated/.test(undeclared.out),
  `exit=${undeclared.code}`,
);
check(
  "HTTP gate refuses a non-loopback CHECK_BASE",
  remote.code !== 0 && /refusing to run against/.test(remote.out),
  `exit=${remote.code}`,
);

// ── restore ───────────────────────────────────────────────────────────────
const restored = run([...TS_RUNNER, ARTIFACT]);
check("green restored", restored.code === 0, `exit=${restored.code}`);

const missed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - missed.length}/${results.length} falsifications behaved as required`,
);
process.exit(missed.length > 0 ? 1 : 0);
