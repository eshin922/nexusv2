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
//
// Known limitation (INFO-1 per Architect Step 11 review): the
// `[^}]*` inside the `disabled={...}` segment cannot cross a `}`
// boundary, so a `disabled` expression containing a JSX object
// literal (e.g., `disabled={cond({a:1}) && pending}`) would not
// match and could false-negative. Not realistic in the current
// codebase; if a future bypass shape surfaces, extend the regex
// per the "Coverage gap signaling" framing in CLAUDE.md Pattern 47.
// Native AST-level eslint rule would be the robust escalation.
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

/**
 * Blank every comment, in place.
 *
 * WHY THE VERIFIER READS PAST COMMENTS
 *
 * A component that follows rule (e) tends to explain WHY beside the input, and
 * the clearest explanation names the thing it is not doing — "never
 * `disabled={pending}` on an input". Sat between `<input` and its `>`, that
 * prose is inside the matched region, so the check fired on a file that was
 * obeying it, and the fix would have been to stop writing the sentence.
 *
 * A check that cannot tell code from a description of code is the same
 * instrument error as a grep that could not match a numeric difference: it
 * reports on the wrong text. Blanking is the fix, not rewording — this is the
 * fifth time this shape has come up in this codebase.
 *
 * Characters are replaced with spaces rather than removed so every offset, and
 * therefore every reported line number, is unchanged.
 *
 * String and template literals are tracked so a `//` inside one — a URL in a
 * placeholder, say — is not mistaken for a comment and blanked, which could
 * hide a real violation written after it on the same line.
 */
const NEWLINE = String.fromCharCode(10);

function blankComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== NEWLINE) { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== NEWLINE) out[i] = " ";
        i++;
      }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    i++;
  }
  return out.join("");
}

function findViolations(file: string): Violation[] {
  const raw = readFileSync(file, "utf8");
  const content = blankComments(raw);
  const found: Violation[] = [];
  for (const match of content.matchAll(VIOLATION_RE)) {
    const idx = match.index ?? 0;
    const line = content.slice(0, idx).split("\n").length;
    // Reported from the RAW source: the operator of this check needs to see
    // what is actually in the file, not the blanked version it matched on.
    const fragment = raw.slice(idx, idx + match[0].length).replace(/\s+/g, " ").trim();
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
