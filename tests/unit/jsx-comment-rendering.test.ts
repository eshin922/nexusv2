/**
 * A block comment in JSX children position is PAGE TEXT.
 *
 * ── THE DEFECT, 2026-09-08 ──────────────────────────────────────────────
 *
 * Retiring the `presentationRestored` gate removed a `{cond ? ( … ) : ( … )}`
 * wrapper. The restored branch opened with a `/* … *\/` comment that had been
 * legal inside the expression container and became a bare text node the moment
 * the container went away. It rendered — a paragraph of engineering prose at
 * the top of the customer-facing quote surface, in production.
 *
 * ── WHY EVERY EXISTING TEST PASSED ──────────────────────────────────────
 *
 * TypeScript compiles it: text is valid JSX. The structural tests assert which
 * components mount and which props they receive, and all of that was correct.
 * `verify:ci` was green. 3049 unit tests were green. Nothing in the suite reads
 * what the page SAYS, so nothing could see a paragraph appear on it.
 *
 * ── THE HEURISTIC, AND ITS LIMIT ────────────────────────────────────────
 *
 * A comment is flagged when the previous non-blank line ends with `>` — a
 * closed JSX tag, so the comment sits among children rather than in a prop
 * list or a type. Measured across every .tsx in the tree: zero hits when
 * correct, exactly one when the defect is present.
 *
 * It is a heuristic and does not replace looking at the page. It catches this
 * shape, which is the shape that shipped.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("no block comment sits in JSX children position", () => {
  const offenders: string[] = [];

  for (const file of tsxFiles("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*\/\*/.test(line)) return;
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      // A previous line ending in `>` means the last thing parsed was a closed
      // JSX tag, so this comment is a CHILD. In a prop list the previous line
      // ends in a value; in a type it ends in `;` or `{`.
      if (j >= 0 && lines[j].trimEnd().endsWith(">")) {
        offenders.push(`${file}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `block comment(s) in JSX children position — these render as page text:\n  ${offenders.join("\n  ")}`,
  );
});
