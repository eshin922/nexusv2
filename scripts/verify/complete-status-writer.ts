// Slice 12 Step 8b — status='complete' writer verifier.
//
// Enforces: NO action in `src/app/actions/**` writes `status = 'complete'`
// on the `quotes` table until Step 8c ships `markComplete`. `complete`
// is the irreversible state that fires when the NetSuite Sales Order
// push succeeds; nothing else in the app should be able to reach it.
//
// The `quote_status` enum ALREADY includes 'complete' (Slice 12 Step 2)
// — the value is reachable in the DB. This verifier is the structural
// guard that keeps it write-only from `markComplete`.
//
// Why a prebuild verifier and not just a code review:
//   - Prevents a debug endpoint, migration seed, or bulk-fix script
//     from accidentally flipping a quote to 'complete' outside the
//     canonical write path.
//   - Enforces at commit time, before any code hits prod.
//   - Outlives Slice 12 — once markComplete lands (8c) it's on the
//     allow-list; anyone trying to add a second writer gets flagged.
//
// Allow-list shape (extend, never replace, per CA amendment 6):
//   Set in `ALLOWLIST` below. Each entry is a repo-relative path.
//   Step 8b: EMPTY — no writer exists yet, verifier must find zero
//   matches.
//   Step 8c: add `src/app/actions/quotes.ts` (markComplete) — that
//   file gains the ONLY legitimate writer. Any subsequent addition
//   requires an explicit disposition + allow-list update. The
//   verifier's message on failure names the allow-list requirement
//   explicitly.
//
// What we look for (both drizzle + raw-sql shapes):
//   - `status:` ... `"complete"` on a `.set(...)` call (drizzle style)
//   - `SET status = 'complete'` inside a raw SQL template literal
//   - `status: 'complete'` in an object literal (broad catch)
//
// Run via `node --experimental-strip-types
// scripts/verify/complete-status-writer.ts`. Hooked into prebuild
// alongside the other verifiers.
//
// Failure mode: process.exit(1) with the offending file:line + matched
// fragment + allow-list guidance.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ACTIONS_DIR = join(ROOT, "src", "app", "actions");

// Slice 12 Step 8b: allow-list is EMPTY. Step 8c will add
// `src/app/actions/quotes.ts` — the file that gains the
// `markComplete` action. Do NOT extend the allow-list for any other
// reason without a corresponding CA disposition.
const ALLOWLIST: readonly string[] = [
  // e.g. "src/app/actions/quotes.ts" — added by Step 8c
];

// Match writers targeting `status = 'complete'` (or "complete") in:
//   - drizzle: `.set({ ..., status: "complete", ... })`
//   - raw sql: `sql\`... SET status = 'complete' ...\``
//   - object literal: `{ status: 'complete' }`
//
// Deliberately permissive — false-positives are cheap (allow-list
// entry per legitimate writer); false-negatives are expensive
// (`status='complete'` slips into prod).
const VIOLATION_RE =
  /status\s*:\s*["']complete["']|status\s*=\s*['"]complete['"]/g;

type Violation = { file: string; line: number; fragment: string };

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

function findViolations(): Violation[] {
  const out: Violation[] = [];
  for (const abs of walkTs(ACTIONS_DIR)) {
    const rel = relative(ROOT, abs).replaceAll("\\", "/");
    if (ALLOWLIST.includes(rel)) continue;
    const src = readFileSync(abs, "utf8");
    let m: RegExpExecArray | null;
    VIOLATION_RE.lastIndex = 0;
    while ((m = VIOLATION_RE.exec(src)) !== null) {
      // Compute 1-indexed line number
      let line = 1;
      for (let i = 0; i < m.index; i++) if (src[i] === "\n") line++;
      // Extract the offending line for the report
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const lineEnd = src.indexOf("\n", m.index);
      const fragment = src
        .slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
        .trim();
      out.push({ file: rel, line, fragment });
    }
  }
  return out;
}

const violations = findViolations();
if (violations.length > 0) {
  console.error(
    "✗ complete-status-writer: found writer(s) targeting quotes.status='complete'",
  );
  console.error(
    "  This transition fires only from Slice 12 Step 8c's markComplete action.",
  );
  console.error(
    "  If you're adding markComplete (Step 8c), extend the ALLOWLIST in",
  );
  console.error(
    "  scripts/verify/complete-status-writer.ts. Do NOT add other writers",
  );
  console.error("  without an explicit disposition.\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.fragment}`);
  }
  process.exit(1);
}

console.log(
  `✓ complete-status-writer: zero writers target quotes.status='complete' in src/app/actions/** (allow-list size: ${ALLOWLIST.length})`,
);
