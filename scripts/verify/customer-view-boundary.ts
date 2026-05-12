// Slice RI.6 — Customer-view boundary-guard verifier.
//
// Asserts the build-time invariant that `<PdfPage>` and all descendants
// in `src/components/pdf/` import zero modules from the costing /
// schema / internal-only-badge surfaces. Equivalent in shape to an
// ESLint no-restricted-paths zone — implemented as a script because
// the project doesn't have ESLint configured yet (UX_BACKLOG: migrate
// to ESLint when lint infra arrives; tracking entry below).
//
// Run via `node --experimental-strip-types scripts/verify/quote-boundary.ts`.
// Hooked into the prebuild step (next.config or npm script) so failures
// surface at `next build` time, not just smoke.
//
// Failure mode: process.exit(1) with the offending file + import.
//
// Sources blocked from `src/components/pdf/`:
//   - @/components/costs/*
//   - @/components/pricing/*
//   - @/components/internal-only-badge*
//   - @/lib/costing
//   - @/lib/costing-store
//   - @/db/schema
//   - @/db
//   - @/app/actions/* (server action surface — costing-adjacent)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const PDF_DIR = join(ROOT, "src", "components", "pdf");

// Slice RI.8 surface naming canon — path patterns updated:
//   @/components/cost-build → @/components/costs (Costs surface)
//   @/components/costing    → @/components/pricing (Pricing surface)
// `costing-store` + `lib/costing` remain concept-anchored data layer
// names; stay forbidden from the Quote (was Customer view) subtree.
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /^@\/components\/costs/, reason: "Costs surface (was cost-build)" },
  { pattern: /^@\/components\/pricing/, reason: "Pricing surface (was costing)" },
  {
    pattern: /^@\/components\/internal-only-badge/,
    reason: "internal-only-badge (customer-invisible signal)",
  },
  { pattern: /^@\/lib\/costing(-store)?$/, reason: "costing math/store" },
  { pattern: /^@\/db(\/schema)?$/, reason: "schema (full table shapes)" },
  { pattern: /^@\/app\/actions\//, reason: "server actions" },
];

const IMPORT_RE =
  /^(?:import|export)\s+(?:[\s\S]*?)from\s+['"]([^'"]+)['"]/gm;

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

const violations: { file: string; importPath: string; reason: string }[] = [];

let files: string[];
try {
  files = listFiles(PDF_DIR);
} catch {
  console.log("[customer-view-boundary] src/components/pdf/ does not exist yet — nothing to verify.");
  process.exit(0);
}

for (const file of files) {
  const content = readFileSync(file, "utf-8");
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const path = m[1];
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(path)) {
        violations.push({
          file: relative(ROOT, file),
          importPath: path,
          reason,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\n[customer-view-boundary] BOUNDARY GUARD VIOLATION — pdf/ subtree must not import from costing/schema/action surfaces.\n"
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports ${v.importPath}`);
    console.error(`    reason:  ${v.reason}`);
    console.error();
  }
  console.error(
    "Fix: extract the customer-visible piece into @/types/quote, or hoist the offending data fetch to the page-level RSC and pass typed props down."
  );
  process.exit(1);
}

console.log(
  `[customer-view-boundary] OK — ${files.length} file(s) under src/components/pdf/ verified clean.`
);
