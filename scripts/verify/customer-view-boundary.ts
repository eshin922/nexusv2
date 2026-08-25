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
// Sources blocked from the render-tree scope:
//   - @/components/costs/*
//   - @/components/pricing/*
//   - @/components/internal-only-badge*
//   - @/lib/costing
//   - @/lib/costing-store
//   - @/db/schema
//   - @/db
//   - @/app/actions/* (server action surface — costing-adjacent)
//
// **Slice 11 Step 7 — coverage extension (2026-07-15).** Scope now
// covers every module in the customer-PDF render path, not just the
// `src/components/pdf/` tree:
//
//   - `src/components/pdf/**` (the react-pdf component tree — chrome
//     + pricing + addendum)
//   - `src/lib/pdf-fonts.ts` + `src/lib/pdf-palette.ts` (render-path
//     resources — fonts + OKLCH-precomputed palette)
//   - `src/lib/quote-pdf-document.tsx` (buildQuoteDocument factory —
//     entry point that composes the tree)
//   - `src/lib/customer-view-to-cpdf.ts` (pure CustomerView → CpdfData
//     translator; on the render-facing side of the projection)
//
// **Not in scope** (adapters, not render tree):
//   - `src/lib/customer-view-resolver.ts` — reads costing bundle to
//     PROJECT the CustomerView. Legitimately needs costing imports;
//     that's the boundary-crossing point where synthesis happens.
//     The projected `CustomerView` shape (see `@/types/quote`) is the
//     data contract the render tree consumes — verified by TypeScript.
//   - `src/app/api/quotes/[quoteId]/customer-pdf/route.tsx` — glue
//     between resolver + factory + renderToStream. Not a render
//     participant; a staging point.
//   - `src/app/actions/quotes.ts` (sendQuote) — same class as route.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const PDF_DIR = join(ROOT, "src", "components", "pdf");

// Additional individual files in the render path (outside the pdf/
// tree). Each is boundary-scoped: legitimate render-facing modules
// must not reach into costing / schema / action layers either.
const EXTRA_RENDER_PATH_FILES: readonly string[] = [
  join(ROOT, "src", "lib", "pdf-fonts.ts"),
  join(ROOT, "src", "lib", "pdf-palette.ts"),
  join(ROOT, "src", "lib", "quote-pdf-document.tsx"),
  join(ROOT, "src", "lib", "customer-view-to-cpdf.ts"),
];

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

/**
 * SYMBOLS the customer-facing tree must not mention, whatever route they took.
 *
 * The import sweep above catches a whole surface being pulled in. It cannot
 * catch a single FIELD arriving on the projected shape — and that is how an
 * internal figure actually reaches a customer document: not by importing the
 * Pricing surface, but by someone adding one more property to `CustomerView`
 * because it was convenient at the composition seam.
 *
 * Client Target is the first entry. It is what the customer said they wanted
 * to pay, recorded so the firm can decide what to quote. Printing it back to
 * them would hand over the firm's read of their own negotiating position, and
 * on a document nobody gets to apologise for afterwards (Pattern 45).
 *
 * Its absence today is a fact about the current code. This makes it a rule.
 */
const FORBIDDEN_SYMBOLS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /client[_-]?target/i,
    reason:
      "Client Target is internal — what the customer asked to pay, never quoted back",
  },
];

/**
 * ── THE ARITHMETIC BOUNDARY ──────────────────────────────────────────────
 *
 * A customer renderer may SELECT, FORMAT and ARRANGE. It may not construct
 * commercial amounts.
 *
 * This is a rule because it was once false. `customer-pdf-helpers.ts` computed
 * extended line totals, one-time fee totals, tier grand totals and the
 * displayed per-unit price — in the render layer, at render time — and it cost
 * a customer-facing defect: the T-1 repair found the per-unit divided by a ROW
 * CARDINALITY, printing $4.00 where $12.00 was owed, correct only at one
 * priced row, which is why it survived to reach customers.
 *
 * Those figures now live on `CustomerView`, composed once by
 * `src/lib/customer-money.ts`. This keeps them there.
 *
 * ── WHY THE PATTERNS LOOK THE WAY THEY DO ────────────────────────────────
 *
 * They match the SHAPES of commercial construction rather than arithmetic in
 * general, because a renderer legitimately does arithmetic on layout: column
 * widths, page counts, index offsets. A blanket ban on `*` would be unusable
 * and would be turned off within a week.
 *
 * So each pattern names a construction the projection already performs. If a
 * renderer needs one of these, the answer is a field on `CustomerView`, not an
 * exception here.
 *
 * Comments are stripped before matching (`codeOnly`). A prose mention is not a
 * use, and this estate has had guards report the opposite of the truth on the
 * sentence that stated it most clearly.
 */
const FORBIDDEN_ARITHMETIC: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    // price × quantity, in either order, however the operands are spelled.
    pattern: /\b\w*(?:price|rate|amount)\w*\s*\*\s*\w*(?:qty|quantity|units)\w*/i,
    reason: "extended amount — price × quantity is composed on CustomerView",
  },
  {
    pattern: /\b\w*(?:qty|quantity|units)\w*\s*\*\s*\w*(?:price|rate|amount)\w*/i,
    reason: "extended amount — quantity × price is composed on CustomerView",
  },
  {
    // total ÷ quantity — the displayed per-unit. The T-1 shape.
    pattern: /\b\w*total\w*\s*\/\s*\w*(?:qty|quantity|units|count)\w*/i,
    reason: "displayed per-unit — total ÷ quantity is composed on CustomerView",
  },
  {
    // Summing customer charges. `reduce` over anything fee/charge/amount-shaped.
    pattern: /\b\w*(?:fee|charge|amount|total|price)\w*\s*\.\s*reduce\s*\(/i,
    reason: "summing customer charges — totals are composed on CustomerView",
  },
  {
    // Rates and markup are resolved upstream, in governed code.
    pattern: /\b(markup|markupPct|recoverableSell|governedRate|rateFor)\b/,
    reason: "rate/markup resolution belongs to governed costing, not a renderer",
  },
];

const arithmeticViolations: {
  file: string;
  line: number;
  text: string;
  reason: string;
}[] = [];

/**
 * The seam's OUTPUT, checked separately.
 *
 * Pattern 51: the boundary is enforced on the projected shape, not on the
 * composition seam's imports — the resolver legitimately reads costing and
 * schema in order to project. So the guarantee has to be asserted on the type
 * the seam produces, which is where a forbidden field would have to appear
 * before any renderer could read it.
 */
/**
 * The composition seam — exempt from the arithmetic rule BY DESIGN.
 *
 * Pattern 51: this is where the figures are supposed to be composed. Forbidding
 * arithmetic here would forbid the thing the file exists to do, and would push
 * the composition back into the renderers this rule is protecting.
 *
 * The exemption is narrow and named. It is not a general allowlist.
 */
const SEAM_FILES: readonly string[] = [
  join(ROOT, "src", "lib", "customer-money.ts"),
  join(ROOT, "src", "lib", "customer-view-resolver.ts"),
];

const PROJECTED_SHAPE_FILES: readonly string[] = [
  join(ROOT, "src", "types", "quote.ts"),
  join(ROOT, "src", "components", "pdf", "customer-pdf-types.ts"),
];

const violations: { file: string; importPath: string; reason: string }[] = [];
const symbolViolations: { file: string; line: number; text: string; reason: string }[] = [];

/** Comments stripped — this file explains the rule by naming what it forbids. */
const NEWLINE_RE = new RegExp("\r?\n");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");
}

let files: string[];
try {
  files = listFiles(PDF_DIR);
} catch {
  console.log("[customer-view-boundary] src/components/pdf/ does not exist yet — nothing to verify.");
  process.exit(0);
}

// Slice 11 Step 7 — fold in the extra render-path files so their
// imports get the same boundary sweep as the pdf/ tree.
for (const f of EXTRA_RENDER_PATH_FILES) {
  if (existsSync(f)) files.push(f);
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

// The symbol sweep: the render tree, plus the shape it renders from.
for (const file of [
  ...files,
  ...PROJECTED_SHAPE_FILES.filter((f) => existsSync(f)),
]) {
  const lines = codeOnly(readFileSync(file, "utf-8")).split(NEWLINE_RE);
  lines.forEach((text, i) => {
    for (const { pattern, reason } of FORBIDDEN_SYMBOLS) {
      if (pattern.test(text)) {
        symbolViolations.push({
          file: relative(ROOT, file),
          line: i + 1,
          text: text.trim().slice(0, 120),
          reason,
        });
      }
    }
    // Arithmetic is checked on RENDERERS ONLY.
    //
    // The projected-shape files are type declarations and the composition seam
    // is where composition is supposed to happen — Pattern 51. Scanning them
    // would forbid the thing they exist to do, which is the anti-pattern that
    // rule was written against.
    if (!PROJECTED_SHAPE_FILES.includes(file) && !SEAM_FILES.includes(file)) {
      for (const { pattern, reason } of FORBIDDEN_ARITHMETIC) {
        if (pattern.test(text)) {
          arithmeticViolations.push({
            file: relative(ROOT, file),
            line: i + 1,
            text: text.trim().slice(0, 120),
            reason,
          });
        }
      }
    }
  });
}

if (arithmeticViolations.length > 0) {
  console.error(
    "[customer-view-boundary] ARITHMETIC BOUNDARY VIOLATION — a customer renderer is constructing a commercial amount.",
  );
  for (const v of arithmeticViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
    console.error(`    reason:  ${v.reason}`);
    console.error();
  }
  console.error(
    "Fix: compose the figure once, on CustomerView, via src/lib/customer-money.ts, and have the renderer read it. A renderer may select, format and arrange; it may not construct amounts. This rule exists because the per-unit price was once divided by a row cardinality here, and printed $4.00 where $12.00 was owed.",
  );
  process.exit(1);
}

if (symbolViolations.length > 0) {
  console.error(
    "[customer-view-boundary] BOUNDARY GUARD VIOLATION — an internal-only value reached the customer-facing tree.",
  );
  for (const v of symbolViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
    console.error(`    reason:  ${v.reason}`);
    console.error();
  }
  console.error(
    "Fix: keep the value on the internal side of the projection. If the customer document genuinely needs a related figure, project a DIFFERENT field that is safe to publish — do not forward this one.",
  );
  process.exit(1);
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
  `[customer-view-boundary] OK — ${files.length} file(s) verified clean ` +
    `(src/components/pdf/ + ${EXTRA_RENDER_PATH_FILES.length} extra render-path files), ` +
    `and ${FORBIDDEN_SYMBOLS.length} internal-only symbol(s) absent from the render tree, ` +
    `${FORBIDDEN_ARITHMETIC.length} arithmetic shape(s) absent from renderers ` +
    `and the projected shape.`
);
