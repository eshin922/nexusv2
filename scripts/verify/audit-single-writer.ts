// Gate 1A — audit_log single-writer verifier.
//
// Enforces: NOTHING under src/ inserts into `audit_log` except
// `src/lib/audit.ts`.
//
// WHY THIS EXISTS. Before Gate 1A, 69 call sites across 20 files inserted
// audit rows directly, through seven separately-defined private helpers with
// differing signatures. That arrangement has a specific failure mode: adding a
// column to the table does not make it populated, it makes it populated at the
// sites someone remembered to update. Call site 70 gets written by copying one
// of the other 69, and whichever one the author happens to read decides whether
// provenance survives.
//
// That is the same shape Costs certification found twice — packaging fan-out
// implemented on the tier axis but not the attach axis, and the causal-revision
// contract present on one write path of eleven. Both were "implemented
// correctly everywhere they were implemented," and both looked intermittent
// precisely because the gap depended on which path an operator took.
//
// The sweep closed the 69. This verifier is what stops the 70th, and it is the
// load-bearing half: a convention that depends on recall is not a contract.
//
// WHAT A BYPASS WOULD COST. `writeAuditEntry` resolves the acting user and
// fails closed if the id does not resolve, then snapshots actor_user_id and a
// never-empty actor_display_name. A direct insert skips all three and writes a
// row that names nobody the moment that user is deleted — the broken terminal
// the Pricing trace stops on. An unattributable audit row cannot be repaired
// after the fact; the actor is only knowable at write time.
//
// SCOPE. src/** only. Both the drizzle shape and raw SQL are matched, since
// either would bypass the writer.
//
// NOT IN SCOPE, deliberately: scripts/**. Six raw-SQL fixture provisioners
// write audit rows directly; that is already logged as a separate
// invariant-governance defect and is fixture-side, not a runtime write path.
// Widening this verifier to scripts/ would fail the build on a known,
// separately-tracked issue and pressure someone into an allow-list entry that
// then reads as sanctioned. Fixture writers are governed by Pattern 53
// (fixtures read from source), not by this guard.
//
// Failure mode: process.exit(1) with file:line, the matched fragment, and the
// conversion the author should make instead.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS: readonly string[] = [join(ROOT, "src")];

const ALLOWLIST: readonly string[] = [
  // The writer itself.
  "src/lib/audit.ts",

  // DOCUMENTED EXCEPTION — Gate 1A, 2026-08-06.
  //
  // NetSuite Item Group audit rows are written by a machine step whose actor
  // is `userId: string | null`. Converting it would change behaviour three
  // ways at once: the shared writer would reject the null actor and abort a
  // NetSuite push mid-flight; suppressing the row instead would change which
  // events emit; and inventing a system actor would introduce a synthetic
  // person into a trace whose whole premise is that it terminates in a real
  // one. None of those is a neutral conversion, and the sweep's constraint was
  // neutrality.
  //
  // This is a machine-actor gap, not an oversight. Resolving it means deciding
  // how the trace represents a system action — a business decision, carried
  // forward separately. Until then the site keeps its prior behaviour exactly,
  // and this entry is the record of why.
  //
  // Removing this entry MUST fail the verifier. Confirmed by delete-and-run.
  "src/lib/netsuite/item-groups.ts",
];

// Drizzle: `.insert(auditLog)`, with or without a `tx.`/`db.` receiver.
// Raw SQL: `INSERT INTO audit_log`, any casing/whitespace.
const VIOLATION_RE =
  /\.insert\s*\(\s*auditLog\s*\)|insert\s+into\s+audit_log\b/gi;

/**
 * Strip line and block comments before matching, so the prose above (which
 * names both shapes) does not flag itself. Newlines preserved so reported line
 * numbers stay accurate.
 */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

type Violation = { file: string; line: number; fragment: string };

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

function findViolations(): Violation[] {
  const out: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWLIST.includes(rel)) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        VIOLATION_RE.lastIndex = 0;
        const match = VIOLATION_RE.exec(line);
        if (match) {
          out.push({ file: rel, line: i + 1, fragment: line.trim() });
        }
      });
    }
  }
  return out;
}

const violations = findViolations();

if (violations.length > 0) {
  console.error(
    `\naudit_log single-writer violation — ${violations.length} direct insert(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.fragment}\n`);
  }
  console.error(
    "Every audit row must go through src/lib/audit.ts:\n" +
      "  writeAuditEntry({ userId, entityType, entityId, action, diffJson }, tx)\n" +
      "  writeAuditEntryReturningId(...)  — when derived rows need causedByAuditId\n" +
      "  writeAuditEntries([...], tx)     — cascade batches, one statement\n\n" +
      "Pass the transaction whenever the audit belongs to the write it describes.\n" +
      "A direct insert skips actor resolution and writes a row that names nobody\n" +
      "once that user is deleted.\n",
  );
  process.exit(1);
}

console.log(
  `audit_log single-writer: OK — no direct inserts under src/ ` +
    `(${ALLOWLIST.length} allow-listed).`,
);
