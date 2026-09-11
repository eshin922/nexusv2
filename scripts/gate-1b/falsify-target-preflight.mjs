/**
 * Prove the HTTP preflight can refuse.
 *
 * Three cases, all required to move the exit code:
 *
 *   1 · an isolated RUNNER pointed at a non-isolated localhost TARGET
 *   2 · a run requesting PM against a target serving ADMIN
 *   3 · matching isolated runs, PM and ADMIN, which must pass
 *
 * Case 1 uses a local STUB rather than a real non-isolated app. Starting the
 * real server from the production profile would open the shared production
 * database to prove a point about a checking script -- the stub establishes
 * exactly the same thing (what the preflight does when a target reports it is
 * not isolated) and touches nothing.
 *
 * Cases 2 and 3 need the real isolated app, since the claim is about the
 * identity it actually serves.
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";

const REAL = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";
const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? "CAUGHT " : "MISSED "} ${label.padEnd(52)} ${detail}`);
}

function runChecks(env) {
  const r = spawnSync("node", ["scripts/gate-1b/pr-557-checks.mjs"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A localhost target that honestly reports it is NOT isolated. */
function stub(payload, status = 200) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url?.startsWith("/api/validation-runtime")) {
        if (status !== 200) {
          res.writeHead(status);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>stub</body></html>");
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

// ── 1 · isolated runner, non-isolated localhost target ────────────────────
{
  const { server, base } = await stub({
    mode: "production",
    providers: { auth: "production", hubspot: "production", netsuite: "production", artifacts: "production", realtime: "production" },
    database: { name: "postgres", carriesValidationMarker: false },
    identity: { email: "someone@thedps.co", role: "admin" },
  });
  const r = runChecks({ CHECK_BASE: base });
  server.close();
  check(
    "non-isolated localhost target is refused",
    r.code !== 0 && /not isolated|mode="production"/.test(r.out),
    `exit=${r.code}`,
  );
}

// ── 1b · a target that cannot describe itself is refused, not assumed ─────
{
  const { server, base } = await stub(null, 404);
  const r = runChecks({ CHECK_BASE: base });
  server.close();
  check(
    "target without runtime facts is refused (404 is not a pass)",
    r.code !== 0 && /did not report runtime facts/.test(r.out),
    `exit=${r.code}`,
  );
}

// ── 1c · an isolated-looking target on the WRONG database is refused ──────
{
  const { server, base } = await stub({
    mode: "isolated",
    providers: { auth: "isolated", hubspot: "isolated", netsuite: "isolated", artifacts: "isolated", realtime: "isolated" },
    database: { name: "postgres", carriesValidationMarker: false },
    identity: { email: "pm@nexus-validation.invalid", role: "pm" },
  });
  const r = runChecks({ CHECK_BASE: base });
  server.close();
  check(
    "isolated mode on a non-validation database is refused",
    r.code !== 0 && /validation marker/.test(r.out),
    `exit=${r.code}`,
  );
}

// ── 2 · requested PM, observed ADMIN ──────────────────────────────────────
{
  const r = runChecks({ CHECK_BASE: REAL, NEXUS_VALIDATION_IDENTITY: "pm" });
  const blocked = /BLOCKED\s+C:identity/.test(r.out);
  const notRewritten = !/C:admin:map/.test(r.out);
  check(
    "requested PM against an admin target is BLOCKED",
    r.code !== 0 && blocked,
    `exit=${r.code}`,
  );
  check(
    "and its expectations are NOT rewritten to admin",
    notRewritten,
    notRewritten ? "no admin access checks ran" : "admin expectations were substituted",
  );
}

// ── 3 · matching runs pass ────────────────────────────────────────────────
{
  const r = runChecks({ CHECK_BASE: REAL, NEXUS_VALIDATION_IDENTITY: "admin" });
  check(
    "matching ADMIN run passes",
    r.code === 0 && /C:admin:map/.test(r.out),
    `exit=${r.code}`,
  );
}

console.log(
  "\\nNOTE: the matching PM run is exercised separately, against an app started" +
    "\\nfor pm — identity is a property of the running server, so it cannot be" +
    "\\nswitched from here.",
);

const missed = results.filter((r) => !r.ok);
console.log(
  `\\n${results.length - missed.length}/${results.length} falsifications behaved as required`,
);
process.exit(missed.length > 0 ? 1 : 0);
