// Slice 12 Step 8b — status='complete' writer verifier.
// Slice 12 Step 8c-3 (2026-07-28) — scope EXTENDED to src/lib/** per
// CA fix. Prior version walked only src/app/actions/**; the actual
// .set({status:'complete'}) landed in src/lib/netsuite/mark-complete.ts,
// which the verifier didn't cover. Guard reporting success on a
// condition it wasn't checking is worse than no guard.
//
// Enforces: NO code outside the allow-list writes `status = 'complete'`
// on the `quotes` table. `complete` is the irreversible state that
// fires when the NetSuite Sales Order push succeeds; nothing else in
// the app should be able to reach it.
//
// The `quote_status` enum ALREADY includes 'complete' (Slice 12 Step 2)
// — the value is reachable in the DB. This verifier is the structural
// guard that keeps it write-only from `markComplete`'s orchestrator.
//
// Why a prebuild verifier and not just a code review:
//   - Prevents a debug endpoint, migration seed, or bulk-fix script
//     from accidentally flipping a quote to 'complete' outside the
//     canonical write path.
//   - Enforces at commit time, before any code hits prod.
//   - Outlives Slice 12 — once markComplete lands (8c-3) its orchestrator
//     file is on the allow-list; anyone trying to add a second writer
//     gets flagged.
//
// Allow-list shape (extend, never replace, per CA amendment 6):
//   Set in `ALLOWLIST` below. Each entry is a repo-relative path.
//   Post-8c-3: `src/lib/netsuite/mark-complete.ts` — the orchestrator
//   that flips status=complete inside runMarkComplete's freeze-tx.
//   Any subsequent addition requires an explicit CA disposition.
//
// What we look for (both drizzle + raw-sql shapes):
//   - `status:` ... `"complete"` on a `.set(...)` call (drizzle style)
//   - `SET status = 'complete'` inside a raw SQL template literal
//   - `status: 'complete'` in an object literal (broad catch)
//
// Coverage:
//   src/app/actions/**
//   src/lib/**
//   scripts/** (via targeted opt-in — smoke provisioners may seed
//               fixtures with status=complete; each such script must
//               be allow-listed explicitly. Currently no scripts
//               write complete.)
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
const SCAN_DIRS: readonly string[] = [
  join(ROOT, "src", "app", "actions"),
  join(ROOT, "src", "lib"),
];

const ALLOWLIST: readonly string[] = [
  // Slice 12 Step 8c-3 (2026-07-28) — markComplete's orchestrator.
  // runMarkComplete does the .set({status:'complete'}) inside the
  // freeze-tx. This is the ONLY legitimate writer.
  //
  // Removing this entry MUST cause the verifier to fail — tested
  // during 8c-3 build via a delete-and-run pass, confirmed.
  "src/lib/netsuite/mark-complete.ts",
];

// Match writers targeting `status = 'complete'` (or "complete") in:
//   - drizzle: `.set({ ..., status: "complete", ... })`
//   - raw sql: `sql\`... SET status = 'complete' ...\``
//   - object literal: `{ status: 'complete' }`
//
// Word-boundary `\b` on `status` so we DON'T match `to_status:
// "complete"` (which is a diff_json audit value, not a WRITE to
// quotes.status). CA fix 2026-07-28.
//
// Comment stripping (line + block) applied BEFORE match to avoid
// catching documentation of the write ("//   9. DB tx: freeze +
// status='complete' + audit"). Same fix.
//
// Deliberately permissive on the write shapes — false-positives are
// cheap (allow-list entry per legitimate writer); false-negatives
// are expensive (`status='complete'` slips into prod).
const VIOLATION_RE =
  /\bstatus\s*:\s*["']complete["']|\bstatus\s*=\s*['"]complete['"]/g;

/**
 * Strip single-line `//...` comments and block `/* ... *​/` comments
 * so the write-shape regex only runs against executable code.
 * Preserves newlines so line numbers stay accurate.
 */
function stripComments(src: string): string {
  // Block comments — collapse to same-line-count whitespace
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  // Line comments — replace to end-of-line
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

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
  for (const scanDir of SCAN_DIRS) {
    for (const abs of walkTs(scanDir)) {
      const rel = relative(ROOT, abs).replaceAll("\\", "/");
      if (ALLOWLIST.includes(rel)) continue;
      const rawSrc = readFileSync(abs, "utf8");
      const src = stripComments(rawSrc);
      let m: RegExpExecArray | null;
      VIOLATION_RE.lastIndex = 0;
      while ((m = VIOLATION_RE.exec(src)) !== null) {
        // Compute 1-indexed line number
        let line = 1;
        for (let i = 0; i < m.index; i++) if (src[i] === "\n") line++;
        // Extract the offending line for the report — read from
        // rawSrc so the report shows the actual source text (not the
        // comment-stripped variant with whitespace).
        const lineStart = rawSrc.lastIndexOf("\n", m.index) + 1;
        const lineEnd = rawSrc.indexOf("\n", m.index);
        const fragment = rawSrc
          .slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
          .trim();
        out.push({ file: rel, line, fragment });
      }
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
    "  This transition fires only from Slice 12 Step 8c-3's markComplete orchestrator.",
  );
  console.error(
    "  If you're adding a legitimate second writer, extend the ALLOWLIST in",
  );
  console.error(
    "  scripts/verify/complete-status-writer.ts (requires CA disposition).\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.fragment}`);
  }
  process.exit(1);
}

console.log(
  `✓ complete-status-writer: zero writers target quotes.status='complete' outside allow-list (scanned ${SCAN_DIRS.length} dirs; allow-list size: ${ALLOWLIST.length})`,
);
