// Pattern 47 — Autosave focus-stability verifier.
//
// Asserts that no <input>, <textarea>, or <select> element in the
// `src/` tree has a `disabled` attribute that includes `pending` —
// the anti-pattern documented in CLAUDE.md Pattern 47 rule (e). The
// brief is: pending is for UI status indicators ("saving…" captions),
// not for blocking the input element. Blocking input mid-save drops
// browser focus and breaks autosave UX (the Aisha-demo tier-6
// symptom, May 15 2026).
//
// Buttons may still use `disabled={pending}` for double-click
// protection — Pattern 47 carve-out — and are intentionally NOT
// flagged by this verifier.
//
// Run via `node --experimental-strip-types
// scripts/verify/autosave-focus-stability.ts`. Hooked into the
// prebuild step alongside `verify:boundaries`.
//
// Failure mode: process.exit(1) with the offending file:line +
// matched fragment.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");

// Match opening tag of <input|textarea|select> through the first `>`
// (closing of the opening tag), including any attribute that contains
// `disabled={...pending...}`. Multiline DOTALL via `s` flag because
// attributes commonly span multiple lines.
const VIOLATION_RE =
  /<(input|textarea|select)\b[^>]*?disabled=\{[^}]*\bpending\b[^}]*\}[^>]*\/?>/gs;

type Violation = { file: string; line: number; fragment: string };

function* walkTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      // Skip generated / build / dependency directories.
      if (entry === "node_modules" || entry === ".next") continue;
      yield* walkTsx(full);
    } else if (entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

function findViolations(file: string): Violation[] {
  const content = readFileSync(file, "utf8");
  const found: Violation[] = [];
  for (const match of content.matchAll(VIOLATION_RE)) {
    const idx = match.index ?? 0;
    const line = content.slice(0, idx).split("\n").length;
    const fragment = match[0].replace(/\s+/g, " ").trim();
    found.push({
      file: relative(ROOT, file),
      line,
      fragment: fragment.length > 200 ? fragment.slice(0, 197) + "…" : fragment,
    });
  }
  return found;
}

const all: Violation[] = [];
for (const file of walkTsx(SRC_DIR)) {
  all.push(...findViolations(file));
}

if (all.length === 0) {
  console.log(
    "✓ Pattern 47 rule (e) verified: zero <input|textarea|select> elements with disabled={...pending...}",
  );
  process.exit(0);
}

console.error(
  `✗ Pattern 47 rule (e) violation: ${all.length} <input|textarea|select> element(s) have disabled attribute including 'pending'.`,
);
console.error("");
console.error(
  "Pattern 47 (CLAUDE.md) — Autosave focus-stability rule (e):",
);
console.error(
  "  disabled attribute MUST NOT include `pending` on input elements.",
);
console.error(
  "  Use disabled={disabled} or omit the attribute; never disabled={... || pending}.",
);
console.error(
  "  The pending flag is for UI status indicators (saving… caption),",
);
console.error(
  "  not for blocking the input. Blocking input mid-save drops focus.",
);
console.error("");
console.error("  Buttons may still use disabled={pending} for double-click");
console.error("  protection — carve-out per Pattern 47.");
console.error("");
console.error("Violations:");
for (const v of all) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.fragment}`);
}
process.exit(1);
