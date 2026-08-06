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
 * The machine-actor exception, pinned to a COUNT and not merely to a file.
 *
 * A file-level allow-list entry would let a second machine writer be added to
 * the same file and inherit a sanction it was never granted — which is how a
 * narrow exception becomes a category. Requiring an exact count means the
 * exception covers the one call site it was reasoned about, and anything else
 * in the same file fails the build.
 *
 * If more machine writers legitimately appear, the answer is an explicit
 * system-actor model — an actor-kind on the row, so a machine event is
 * readable AS a machine event — not a wider allow-list. A Pricing provenance
 * chain must never terminate here: these rows are not evidence of a person.
 */
const EXCEPTIONS: readonly { file: string; expected: number; why: string }[] = [
  // Gate 1A, 2026-08-06. NetSuite Item Group audit rows are written by a
  // machine step whose actor is `userId: string | null`. Converting it would
  // change behaviour three ways at once: the shared writer would reject the
  // null actor and abort a NetSuite push mid-flight; suppressing the row would
  // change which events emit; and inventing a system actor would introduce a
  // synthetic person into a trace whose whole premise is that it terminates in
  // a real one. None is a neutral conversion, and neutrality was the sweep's
  // constraint.
  //
  // Removing this entry, or adding a second direct insert to this file, MUST
  // fail the verifier. Both confirmed by running it.
  {
    file: "src/lib/netsuite/item-groups.ts",
    expected: 1,
    why: "machine-actor NetSuite Item Group write; actor is `string | null`",
  },
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
  "  writeAuditEntries([...], tx)     — cascade batches, one statement\n\n" +
  "Pass the transaction whenever the audit belongs to the write it describes.\n" +
  "A direct insert skips actor resolution and writes a row that names nobody\n" +
  "once that user is deleted.\n\n" +
  "A machine-authored event is NOT a reason to widen the exception. It needs an\n" +
  "explicit system-actor contract, so the row reads as a machine event rather\n" +
  "than as a person — a Pricing provenance chain must never terminate in one.\n";

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
    `(${ALLOWLIST.length} allow-listed, ${EXCEPTIONS.length} pinned exception).`,
);
