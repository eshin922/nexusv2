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
];

/**
 * Pinned exceptions — currently NONE, and that is the point.
 *
 * There was one: item-groups.ts wrote a bare null actor for unattended NetSuite
 * pushes, because the shared writer fails closed and could not express an act
 * with no person behind it. It was pinned to a count rather than a file, so a
 * second machine writer could not quietly inherit a sanction it was never
 * granted.
 *
 * The actor model resolved it rather than widening it. `actor_kind` makes a
 * machine act sayable — `system`, with an explicit system identity and a null
 * actor_user_id — so item-groups.ts now routes through the writer like
 * everything else, and the exception has no subject left.
 *
 * That is the shape any future case should take. A machine-authored event is
 * not grounds to re-open this list; it is grounds to add a SYSTEM_ACTORS entry.
 * The list stays here, empty and enforced, because an exception mechanism that
 * has to be re-invented under pressure gets invented badly.
 */
const EXCEPTIONS: readonly { file: string; expected: number; why: string }[] = [];

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

function scan(): Map<string, Violation[]> {
  const byFile = new Map<string, Violation[]>();
  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWLIST.includes(rel)) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        VIOLATION_RE.lastIndex = 0;
        if (VIOLATION_RE.exec(line)) {
          const list = byFile.get(rel) ?? [];
          list.push({ file: rel, line: i + 1, fragment: line.trim() });
          byFile.set(rel, list);
        }
      });
    }
  }
  return byFile;
}

const found = scan();
const violations: Violation[] = [];
const countErrors: string[] = [];

for (const [file, hits] of found) {
  const exception = EXCEPTIONS.find((e) => e.file === file);
  if (!exception) {
    violations.push(...hits);
  } else if (hits.length !== exception.expected) {
    // The sanction covers a specific number of call sites, not the file. More
    // than that means a writer was added under cover of someone else's
    // reasoning; fewer means the exception outlived its subject.
    countErrors.push(
      `${file}: ${hits.length} direct insert(s), exception permits exactly ${exception.expected}\n` +
        `    (${exception.why})\n` +
        hits.map((h) => `      line ${h.line}: ${h.fragment}`).join("\n"),
    );
  }
}

// An exception whose file no longer contains any direct insert is stale: the
// subject was converted or removed and the sanction should go with it.
for (const e of EXCEPTIONS) {
  if (!found.has(e.file)) {
    countErrors.push(
      `${e.file}: exception permits ${e.expected} direct insert(s) but none remain — remove the entry`,
    );
  }
}

const GUIDANCE =
  "Every audit row must go through src/lib/audit.ts:\n" +
  "  writeAuditEntry({ userId, entityType, entityId, action, diffJson }, tx)\n" +
  "  writeAuditEntryReturningId(...)  — when derived rows need causedByAuditId\n" +
  "  writeAuditEntries([...], tx)     — cascade batches, one statement\n" +
  "  writeSystemAuditEntry({ systemActor, ... }, tx)  — no person acted\n\n" +
  "Pass the transaction whenever the audit belongs to the write it describes.\n" +
  "A direct insert skips actor resolution and writes a row that names nobody\n" +
  "once that user is deleted.\n\n" +
  "If no person acted, that is not a reason to bypass the writer — it is what\n" +
  "writeSystemAuditEntry is for. Add an entry to SYSTEM_ACTORS so the row reads\n" +
  "as a machine event rather than as a missing human. If an operator triggered\n" +
  "the work, the event is HUMAN even though a machine performed it: the model\n" +
  "draws its line at accountability, not at mechanism.\n";

if (violations.length > 0 || countErrors.length > 0) {
  if (violations.length > 0) {
    console.error(
      `\naudit_log single-writer violation — ${violations.length} direct insert(s):\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.fragment}\n`);
    }
  }
  if (countErrors.length > 0) {
    console.error(`\naudit_log exception drift:\n`);
    for (const c of countErrors) console.error(`  ${c}\n`);
  }
  console.error(GUIDANCE);
  process.exit(1);
}

console.log(
  `audit_log single-writer: OK — no direct inserts under src/ ` +
    `(${ALLOWLIST.length} allow-listed, ${EXCEPTIONS.length} pinned exceptions).`,
);
