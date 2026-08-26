/**
 * Customer presentation is NOT an input to the NetSuite Sales Order projection.
 *
 * ── WHY THIS IS A BUILD GATE AND NOT A TEST RUN ─────────────────────────
 *
 * Between #400 and #427 the customer document's structure and vocabulary, the
 * Pricing surface's result semantics, the recovery election lifecycle and the
 * costing node graph all changed. Each was argued to be presentation or
 * read-model only.
 *
 * A behavioural regression run can only prove that ONE quote's numbers still
 * match. It cannot prove the architecture: a presentation construct could
 * become an input to the projection and the numbers still agree on the quote
 * that happened to be tested. That is an architectural regression whether or
 * not it surfaces as a wrong figure, because the NEXT presentation change would
 * then silently move a NetSuite transmission.
 *
 * So the claim is asserted structurally, over the import graph:
 *
 *     No module reachable from the Sales Order projection may import a
 *     customer-presentation or operator-display construct.
 *
 * ── WHAT IS AND IS NOT FORBIDDEN ────────────────────────────────────────
 *
 * PERSISTED COMMERCIAL FACTS may legitimately reach costing and therefore the
 * projection. A recovery election is a governed input to what a quote costs,
 * and `quote_charge_recovery` is a table, not a surface. What may not reach it
 * is any construct whose purpose is to DISPLAY those facts: the projected
 * `CustomerView`, the renderers, the document's labels and layout axes, the
 * presentation profile, the operator-facing Unit-price sell, the Pricing trace
 * nodes, Card 1's display state.
 *
 * That distinction is the whole point. A recovery election changing what
 * NetSuite receives is CORRECT, because the underlying commercial state
 * changed. A relabelled row changing it is not.
 *
 * Sibling of `verify:boundaries`, which guards the customer render tree against
 * importing costing. This guards the opposite direction.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** The projection's entry points. Everything reachable from these is in scope. */
const ENTRIES = [
  "src/lib/netsuite/mark-complete.ts",
  "src/lib/netsuite/sales-orders.ts",
  "src/lib/netsuite/frozen-sales-order.ts",
  "src/lib/order-packet/reader.ts",
];

/**
 * Presentation constructs. A match is an architectural regression.
 *
 * Matched on MODULE PATH, never on a name that could appear in prose — a check
 * that flags its own rationale forbids the wrong thing, which has already
 * happened four times in this workstream.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^src\/components\//,
    why: "a React component is a display, never an input to a transmission",
  },
  {
    pattern: /customer-view-resolver/,
    why: "the projected CustomerView is the customer's document, not a commercial fact",
  },
  {
    pattern: /customer-view-to-cpdf|quote-pdf-document|customer-pdf/,
    why: "a renderer",
  },
  {
    pattern: /commercial-projection/,
    why: "the customer document's line projection",
  },
  {
    pattern: /presentation-profile|customer-tier-visibility/,
    why: "presentation axes — which tiers and which layout the customer is shown",
  },
  {
    pattern: /pricing-surface|detail-zone|cell-drawer/,
    why: "the operator's Pricing display",
  },
  {
    pattern: /commercial-recovery\/workspace-view/,
    why: "Card 1's display state",
  },
  { pattern: /types\/quote/, why: "the CustomerView shape" },
];

const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function resolveImport(fromFile: string, spec: string): string | null {
  let rel: string;
  if (spec.startsWith("@/")) rel = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) rel = path.posix.join(path.posix.dirname(fromFile), spec);
  else return null; // a package, not ours
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const cand = rel + ext;
    if (existsSync(path.join(ROOT, cand))) return cand;
  }
  return null;
}

/**
 * VALUE imports only.
 *
 * `import type` is erased at compile time and carries nothing at runtime, so a
 * type-only reference cannot be an input to anything — it is a shape, not a
 * value. The first version of this check did not make the distinction and
 * reported an architectural regression that does not exist: `costing-store`
 * imports `OtherServiceSelection` as a TYPE from `commercial-projection`, and
 * `costing.ts` imports `HydrateSnapshot` as a TYPE from `costing-store`.
 * Neither moves a value into the projection.
 *
 * A mixed import (`import { type A, b }`) is kept — it does carry a value.
 */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g;

const seen = new Set<string>();
const violations: { file: string; imports: string; why: string; via: string[] }[] = [];

function walk(file: string, via: string[]) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = read(file);
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[1]!);
    if (!target) continue;
    const hit = FORBIDDEN.find((f) => f.pattern.test(target));
    if (hit) {
      violations.push({ file, imports: target, why: hit.why, via: [...via, file] });
      continue;
    }
    walk(target, [...via, file]);
  }
}

for (const e of ENTRIES) walk(e, []);

console.log(
  `[netsuite-presentation-isolation] ${seen.size} module(s) reachable from the Sales Order projection`,
);

/**
 * The operator-facing read-model nodes introduced in #423/#424 must not be
 * READ by the projection either.
 *
 * An import guard alone would miss this: these are graph node KEYS, reachable
 * through `costing.graph` without importing anything new. `unit-price-sell`
 * exists to state what a unit price is for an operator; it is explicitly not
 * the governed revenue, and the projection must continue to read the frozen
 * amount and `contributionCostPerUnit` as it always has.
 */
const FORBIDDEN_NODE_KEYS = ["unit-price-sell", "separate-charges", "unbillable-recovery"];

/**
 * The engine that DEFINES these nodes is not a consumer of them.
 *
 * `costing.ts` emits every node in the graph, so scanning it for these keys
 * flags the producer and reports a regression that does not exist — the same
 * shape as counting a type-only import as a dependency. The question this check
 * asks is whether anything BETWEEN the engine and the provider payload reads a
 * display node, so the definer is excluded and every consumer is not.
 */
const NODE_DEFINERS = new Set(["src/lib/costing.ts"]);

const keyHits: { file: string; key: string }[] = [];
for (const file of seen) {
  if (NODE_DEFINERS.has(file)) continue;
  const src = read(file);
  for (const key of FORBIDDEN_NODE_KEYS) {
    // Over CODE: a comment naming the node is documentation, not a read.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (code.includes(key)) keyHits.push({ file, key });
  }
}
if (keyHits.length > 0) {
  console.error("\n[netsuite-presentation-isolation] READ-MODEL NODE REACHED THE PROJECTION\n");
  for (const h of keyHits) console.error(`  ${h.file} reads "${h.key}"`);
  console.error(
    "\nThese state what an OPERATOR is shown. The projection reads the frozen\n" +
      "amount and contributionCostPerUnit; a display node must never displace them.\n",
  );
  process.exit(1);
}

if (violations.length === 0) {
  console.log(
    "[netsuite-presentation-isolation] OK - no customer-presentation or operator-display construct is an input.",
  );
  process.exit(0);
}

console.error("\n[netsuite-presentation-isolation] ARCHITECTURAL REGRESSION\n");
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    imports ${v.imports}`);
  console.error(`    which is ${v.why}`);
  console.error(`    reached via: ${v.via.join(" -> ")}\n`);
}
console.error(
  "Presentation must not be an input to a NetSuite transmission. A quote's\n" +
    "DISPLAY changing what the provider receives is a regression even when the\n" +
    "numbers happen to match on the quote under test.\n",
);
process.exit(1);
