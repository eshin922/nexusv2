// Slice RI.7 — scenario_status ↔ quote.status invariant verifier.
//
// CR-SM DEC-5 commits to action-layer enforcement only for v1 — no DB
// CHECK constraint. This script is the defense-in-depth: if anything
// bypasses the action layer (manual SQL, future bulk ops, HubSpot
// webhooks), drift would silently accumulate. Run periodically (or
// add to CI) to catch.
//
// Invariants enforced:
//
//   I-1: If any quote in a scenario has `quote.status='accepted'`,
//        that scenario's `scenario_status` MUST be 'accepted'.
//
//   I-2: If a quote has `quote.status='accepted'`, the project MUST
//        NOT have any OTHER scenario with `scenario_status='active'`
//        (sibling-drop on accept per Slice 12 commitment).
//
//   I-3: drop_reason is required when scenario_status='dropped'
//        (already in CLAUDE.md as a separate UX_BACKLOG entry, but
//        cheap to verify here too).
//
//   I-4: quote_number is set only on quotes where status != 'draft'
//        (RI.7 DEC-4 — number assigns at send; drafts have no number).
//
// Run: npm run verify:scenario-quote-invariant
// CI integration: add to a nightly job or pre-deploy step when
// production data volume grows enough that manual SQL becomes
// tempting. For v1 internal-tool scale, run on demand.

// Run via `node --env-file=.env.local --experimental-strip-types <path>`.
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

type Violation = {
  rule: "I-1" | "I-2" | "I-3" | "I-4";
  detail: string;
};

const violations: Violation[] = [];

async function checkI1() {
  // Any quote.status='accepted' must imply scenario_status='accepted'
  // on its row. Each quote row carries its own scenario_status — they
  // should be aligned for accepted quotes.
  const rows = (await sql`
    SELECT id, project_id, scenario_label, status, scenario_status
    FROM quotes
    WHERE status = 'accepted' AND scenario_status != 'accepted'
  `) as unknown as Array<{
    id: string;
    project_id: string;
    scenario_label: string;
    status: string;
    scenario_status: string;
  }>;
  for (const r of rows) {
    violations.push({
      rule: "I-1",
      detail: `quote ${r.id} (project ${r.project_id} / scenario "${r.scenario_label}"): status='accepted' but scenario_status='${r.scenario_status}'`,
    });
  }
}

async function checkI2() {
  // For every project with an accepted scenario, no OTHER scenario in
  // the same project should be scenario_status='active'.
  //
  // Note: this only flags the cross-row drift after an accept.
  // Within the same scenario, multiple version rows share the
  // scenario_status; that's expected and not a violation.
  const rows = (await sql`
    WITH accepted_projects AS (
      SELECT DISTINCT project_id
      FROM quotes
      WHERE scenario_status = 'accepted'
    )
    SELECT q.id, q.project_id, q.scenario_label, q.scenario_status
    FROM quotes q
    JOIN accepted_projects ap ON ap.project_id = q.project_id
    WHERE q.scenario_status = 'active'
  `) as unknown as Array<{
    id: string;
    project_id: string;
    scenario_label: string;
    scenario_status: string;
  }>;
  for (const r of rows) {
    violations.push({
      rule: "I-2",
      detail: `quote ${r.id} (project ${r.project_id} / scenario "${r.scenario_label}"): scenario_status='active' on a project with an accepted sibling — sibling-drop didn't fire`,
    });
  }
}

async function checkI3() {
  const rows = (await sql`
    SELECT id, project_id, scenario_label, scenario_status, drop_reason
    FROM quotes
    WHERE scenario_status = 'dropped' AND drop_reason IS NULL
  `) as unknown as Array<{
    id: string;
    project_id: string;
    scenario_label: string;
    scenario_status: string;
    drop_reason: string | null;
  }>;
  for (const r of rows) {
    violations.push({
      rule: "I-3",
      detail: `quote ${r.id} (project ${r.project_id} / scenario "${r.scenario_label}"): scenario_status='dropped' but drop_reason IS NULL`,
    });
  }
}

async function checkI4() {
  // quote_number is assigned at sendQuote (RI.7 DEC-4). Drafts
  // shouldn't have one; sent+ should. We flag both directions.
  const stragglers = (await sql`
    SELECT id, status, quote_number
    FROM quotes
    WHERE status = 'draft' AND quote_number IS NOT NULL
  `) as unknown as Array<{
    id: string;
    status: string;
    quote_number: string;
  }>;
  for (const r of stragglers) {
    violations.push({
      rule: "I-4",
      detail: `quote ${r.id}: status='draft' but quote_number='${r.quote_number}' assigned — number should be cleared on revert-to-draft (Slice 15)`,
    });
  }

  const missing = (await sql`
    SELECT id, status
    FROM quotes
    WHERE status IN ('sent', 'accepted', 'superseded', 'lost')
      AND quote_number IS NULL
  `) as unknown as Array<{ id: string; status: string }>;
  for (const r of missing) {
    violations.push({
      rule: "I-4",
      detail: `quote ${r.id}: status='${r.status}' but quote_number IS NULL — sendQuote action didn't assign or row predates RI.7`,
    });
  }
}

async function main() {
  console.log("scenario_status ↔ quote.status invariant check\n");

  await checkI1();
  await checkI2();
  await checkI3();
  await checkI4();

  await sql.end();

  if (violations.length === 0) {
    console.log("OK — no violations");
    return;
  }

  console.log(`FAIL — ${violations.length} violation(s):`);
  for (const v of violations) {
    console.log(`  [${v.rule}] ${v.detail}`);
  }
  console.log(
    "\nNote: I-4 'status != draft but quote_number IS NULL' is EXPECTED for",
  );
  console.log(
    "quotes that landed before migration 0020 (pre-RI.7). Those rows have",
  );
  console.log(
    "status='sent' but no quote_number was ever assigned — backfill is a",
  );
  console.log(
    "separate operation if Edward wants to retrofit numbers for historical",
  );
  console.log("quotes.");

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
