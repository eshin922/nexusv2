// Slice 11 Step 7 — react-pdf inverse import sweep (SCOPED_LIBRARIES).
//
// Forbids `@react-pdf/renderer` imports outside the scoped render
// paths. Complements the forward Pattern-45 boundary sweep
// (`customer-view-boundary.ts`): forward = "render tree imports zero
// costing"; inverse = "renderer library imports live only in the
// render path."
//
// **Why the containment matters.** `@react-pdf/renderer` is ~1.4MB
// + ~1.5MB vendored fonts. If it leaks into unrelated bundles
// (pricing UI, setup flow, admin surfaces) the bundle-size hit is
// nontrivial and hard to claw back once dependencies form. A cheap
// prebuild guard is the durable answer.
//
// **Allowlist** (module paths that may import from
// `@react-pdf/renderer`):
//   - `src/components/pdf/**` — the react-pdf component tree
//   - `src/lib/pdf-fonts.ts` — Font.register calls
//   - `src/lib/quote-pdf-document.tsx` — buildQuoteDocument factory
//     (DocumentProps type import)
//   - `src/app/api/quotes/[quoteId]/customer-pdf/route.tsx` —
//     renderToStream on the preview + download route
//   - `src/app/actions/quotes.ts` — renderToBuffer inside sendQuote
//     for the persist-at-send flow
//
// Any other file importing `@react-pdf/renderer` fails the build.
//
// **Enforcement disposition.** The pattern check is a grep over
// TS/TSX under `src/`, not a full parse. False positives limited to
// comments / strings — those are considered legitimate exceptions
// (e.g. a comment mentioning the library in a design doc). The regex
// matches the exact import statement shape, which does not appear in
// prose or strings by accident.
//
// Failure mode: process.exit(1) with the offending file + line.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const LIBRARY_ID = "@react-pdf/renderer";

// Allowlist entries are matched by exact relative path (from ROOT)
// after normalization to forward slashes. Glob-style `**` in a path
// means "matches this path or any descendant."
//
// **Two entry classes** to preserve when reading the list:
//
// - **Render-path modules** (`src/components/pdf/**`,
//   `src/lib/pdf-fonts.ts`, `src/lib/quote-pdf-document.tsx`) — these
//   are also inside the FORWARD Pattern-45 boundary sweep
//   (`customer-view-boundary.ts`). They can't import costing surfaces
//   either. Boundary in both directions.
//
// - **Adapter callers** (`src/app/api/quotes/[quoteId]/customer-pdf/route.tsx`,
//   `src/app/actions/quotes.ts` `sendQuote`) — these live OUTSIDE the
//   forward boundary sweep by design (see the header on
//   `customer-view-boundary.ts` for the adapter-exclusion rationale).
//   They compose the projected `CustomerView` and then call
//   `renderToStream` / `renderToBuffer`. The FORWARD sweep can't
//   include them without breaking their legitimate costing reads;
//   this INVERSE sweep includes them because they legitimately need
//   `@react-pdf/renderer` for the render call.
//
// The adapter-exclusion asymmetry is intentional — it's the durable
// shape of "boundary enforced at the render tree, not at the
// composition seam." Do not read the send path's absence from the
// forward sweep as a coverage gap.
const ALLOWLIST: readonly string[] = [
  "src/components/pdf/**",
  "src/lib/pdf-fonts.ts",
  "src/lib/quote-pdf-document.tsx",
  "src/app/api/quotes/[quoteId]/customer-pdf/route.tsx",
  "src/app/actions/quotes.ts",
];

function normalize(p: string): string {
  return relative(ROOT, p).split("\\").join("/");
}

function isAllowed(relPath: string): boolean {
  for (const entry of ALLOWLIST) {
    if (entry.endsWith("/**")) {
      const prefix = entry.slice(0, -3);
      if (relPath === prefix || relPath.startsWith(prefix + "/")) return true;
    } else if (relPath === entry) {
      return true;
    }
  }
  return false;
}

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listFiles(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Match any import or re-export from the library. `import X from ...`,
// `import { A, B } from ...`, `import type { ... } from ...`,
// `export { X } from ...`, `import "..."` — all covered.
const IMPORT_RE = new RegExp(
  String.raw`^(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]` +
    LIBRARY_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    String.raw`['"]`,
  "gm",
);

const violations: { file: string; line: number; text: string }[] = [];

const files = listFiles(SRC);
for (const file of files) {
  const rel = normalize(file);
  const content = readFileSync(file, "utf-8");
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    if (isAllowed(rel)) continue;
    // Compute 1-indexed line number from the match position.
    const line =
      content.slice(0, m.index).split(/\r?\n/).length;
    // Grab the offending line for the error report.
    const lines = content.split(/\r?\n/);
    violations.push({
      file: rel,
      line,
      text: (lines[line - 1] ?? m[0]).trim(),
    });
  }
}

if (violations.length > 0) {
  console.error(
    `\n[react-pdf-containment] SCOPED-LIBRARY VIOLATION — \`${LIBRARY_ID}\` imported outside the allowlist.\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
    console.error();
  }
  console.error("Allowlist:");
  for (const entry of ALLOWLIST) console.error(`  - ${entry}`);
  console.error();
  console.error(
    "Fix: move the offending import into the render path, OR add the file\n" +
      "to the allowlist DELIBERATELY (with a comment) in\n" +
      "scripts/verify/react-pdf-containment.ts.",
  );
  process.exit(1);
}

console.log(
  `[react-pdf-containment] OK — \`${LIBRARY_ID}\` imports contained to ${ALLOWLIST.length} allowlist entries.`,
);
