// Charge defaults — writer-boundary verifier.
//
// Enforces: NOTHING under src/ or scripts/ writes `product_type_charge_profile`
// or `product_type_charge_defaults` except the admin action module.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────
//
// The recommendation against a database constraint trigger rests on ONE
// premise: the writer set is a single admin-gated module, so an advisory lock
// taken before each read is sufficient to serialize check-then-write. That
// premise was established by reading the repository, and a reading is a fact
// about a moment. This makes it a fact about every commit.
//
// It does NOT prove the premise. It proves the repository's half of it.
// Anything writing this database from outside the repository -- a psql session,
// a Supabase SQL editor query, a future service, a restored dump, an operator
// with the connection string -- is invisible here and always will be. That is
// a real limit on the recommendation, not a caveat on this file: static
// analysis of a codebase cannot establish a property of a database.
//
// So the honest reading of a PASS is: "no writer was ADDED TO THIS REPOSITORY."
// If an external writer is ever introduced, the constraint-trigger question
// reopens and this verifier will say nothing about it. The cross-table
// invariant would then need enforcement where every writer must pass -- which
// is the database.
//
// ── WHY THE INVARIANT CANNOT BE A CHECK ─────────────────────────────────
//
// `verdict = 'none_expected'` implies no rules. It spans two tables, so no
// CHECK constraint can hold it. The action layer holds it instead, and a
// transaction alone does not: under READ COMMITTED two admins can each read a
// consistent state, each pass their own check, and each commit. The lock is
// what closes that, and the lock only covers writers that take it.
//
// Verified executing, not merely present: `npm run validation:charge-defaults-walk`
// holds the same advisory lock from a separate connection and observes the
// action block until it is released.
//
// SCOPE. Writes only -- inserts, updates, deletes, and raw SQL against either
// table. Reads are unrestricted and are not a hazard: a reader cannot violate
// an invariant.
//
// Failure mode: process.exit(1) with file:line and the matched fragment.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [join(ROOT, "src"), join(ROOT, "scripts")].filter(existsSync);

/**
 * The permitted writers, and the reason each is permitted.
 *
 * Adding an entry here is a decision to widen the writer set, which is the
 * decision the database-enforcement recommendation depends on NOT being taken
 * quietly. A new entry should come with a re-answer to "does the database need
 * to enforce this now?" rather than a rationale for why this one is fine.
 */
const ALLOWLIST: readonly { file: string; why: string }[] = [
  {
    file: "src/app/actions/charge-defaults.ts",
    why: "the admin action module -- every writer is admin-gated, transactional, audited in-transaction, and takes the per-type advisory lock before its first read",
  },
  {
    file: "scripts/gate-1b/charge-defaults-walk.ts",
    why: "the isolated-environment walk. It writes around the actions DELIBERATELY, to manufacture the contradiction the database permits and to run the unlocked control that proves the race is real. Refuses to run against anything but 127.0.0.1:55432",
  },
];

/**
 * Drizzle writes against either table, and raw SQL against either name.
 *
 * `.select().from(x)` is not matched: reading cannot break an invariant, and
 * matching it would make the allowlist a list of readers instead of writers,
 * which is a different and much weaker guarantee.
 */
const TABLES_TS = "(?:productTypeChargeProfile|productTypeChargeDefaults)";
const TABLES_SQL = "(?:product_type_charge_profile|product_type_charge_defaults)";
const VIOLATION_RE = new RegExp(
  [
    `\\.(?:insert|update|delete)\\s*\\(\\s*${TABLES_TS}\\s*\\)`,
    `(?:insert\\s+into|update|delete\\s+from)\\s+"?${TABLES_SQL}"?\\b`,
  ].join("|"),
  "gi",
);

/** Comments are blanked, newlines kept, so prose naming a table is not a hit. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTs(full);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) yield full;
  }
}

type Violation = { file: string; line: number; fragment: string };

const violations: Violation[] = [];
const seen = new Set<string>();

for (const dir of SCAN_DIRS) {
  for (const file of walkTs(dir)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      VIOLATION_RE.lastIndex = 0;
      if (VIOLATION_RE.exec(line)) {
        seen.add(rel);
        if (!ALLOWLIST.some((a) => a.file === rel)) {
          violations.push({ file: rel, line: i + 1, fragment: line.trim() });
        }
      }
    });
  }
}

// An allowlist entry that no longer writes anything is permission granted to
// nobody, and it makes the list read as larger than the real writer set.
const stale = ALLOWLIST.filter((a) => !seen.has(a.file));

// The migration and the Drizzle definitions are not writers and are not listed.
// The verifier would be useless if it could not see a writer at all, so it
// checks that it CAN: if the action module stops matching, the pattern has
// drifted from the code rather than the code having become clean.
const canSeeAWriter = seen.has("src/app/actions/charge-defaults.ts");

if (violations.length > 0 || stale.length > 0 || !canSeeAWriter) {
  if (!canSeeAWriter) {
    console.error(
      "[charge-defaults-writers] FAIL — the verifier matched NO write in the action module.\n" +
        "  It cannot distinguish a clean repository from a broken pattern, so it fails\n" +
        "  rather than passing on an instrument that can no longer express a violation.",
    );
  }
  for (const v of violations) {
    console.error(
      `[charge-defaults-writers] FAIL — ${v.file}:${v.line}\n` +
        `    ${v.fragment}\n` +
        `    This table is written only by src/app/actions/charge-defaults.ts, where the\n` +
        `    cross-table invariant is enforced under a per-type advisory lock. A second\n` +
        `    writer reopens the question of whether the DATABASE should enforce it.`,
    );
  }
  for (const s of stale) {
    console.error(
      `[charge-defaults-writers] FAIL — ${s.file} is allow-listed but writes nothing.\n` +
        `    Remove the entry; a permission with no subject overstates the writer set.`,
    );
  }
  process.exit(1);
}

console.log(
  `[charge-defaults-writers] OK · ${seen.size} writer(s) in the repository, all permitted.\n` +
    "[charge-defaults-writers] NOTE — this establishes only that no writer was added to\n" +
    "  THIS REPOSITORY. A writer outside it (psql, the Supabase SQL editor, another\n" +
    "  service, a restored dump) is invisible to static analysis and always will be.\n" +
    "  If one is ever introduced, the database-enforcement question reopens.",
);
