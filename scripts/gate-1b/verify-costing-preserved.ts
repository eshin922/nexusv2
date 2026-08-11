/**
 * Gate 1B · S-7 — the preservation invariant. READ ONLY.
 *
 * THE INVARIANT
 *
 *   Every commercial scalar returned by `computeQuoteCosting` is byte-identical
 *   to the value captured before the node graph existed.
 *
 * This is the boundary Amendment A-1 draws: exposing computation structure is
 * permitted; changing an existing commercial number is not. The invariant is
 * what makes that boundary checkable instead of stated.
 *
 * ZERO DRIFT. Not "within tolerance". A tolerance would be a decision about how
 * much a customer-facing price may quietly move during a refactor, and the
 * answer to that is none. Values are compared at 17 significant digits, which is
 * full float precision — if a value changes at all, this fails.
 *
 * WHEN IT RUNS. Before and after rollups begin deriving from nodes (§11.2 of the
 * specification). Failing here means the graph changed the arithmetic, which is
 * the one thing the gate forbids.
 *
 * WHAT IT CANNOT PROVE. The baseline covers what production data can reach. Two
 * of the ten node kinds — `override` and `flagged-out` — have ZERO rows in the
 * entire database, so no captured quote exercises them. They need unit coverage
 * built against `QuoteCostingInput` directly, since the engine is a pure
 * function and needs no database to test. Stated here rather than left to be
 * discovered: a green run does not mean those paths are preserved.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";
import { baselineEntryInBasket, basketPredicate, VALIDATION_NAMESPACE } from "./basket.ts";
import { projectOntoBaseline } from "./projection.ts";

type Entry = { quote_id: string; status: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline.json", "utf8"),
) as { globalDigest: string; capturedOver: number; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' + readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8").trim() + "}",
)._ as Record<string, unknown>;


/** Report WHERE a value moved, not merely that the digest changed. */
function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? null : `${path}: ${a} -> ${b}`;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return canonical(a) === canonical(b) ? null : `${path}: ${canonical(a)} -> ${canonical(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: shape changed`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} -> ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    const d = firstDifference(ao[k], bo[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q
   where ${basketPredicate()}
   order by q.id
`)) as unknown as { quote_id: string }[];

/**
 * Both sides of the comparison, restricted to the basket.
 *
 * The exclusion has to be symmetric. Dropping the validation namespace from the
 * live selection alone would leave its captured entry unmatched, and the
 * verifier would report it as "in baseline, absent now — coverage silently
 * shrank": the same red under a different heading.
 */
const inBasket = baseline.entries.filter((e) => baselineEntryInBasket(e.label));
const excluded = baseline.entries.filter((e) => !baselineEntryInBasket(e.label));

console.log("\nGate 1B S-7 — preservation check\n");

let failed = false;
const now: { quote_id: string; digest: string }[] = [];
const baseByQuote = new Map(inBasket.map((e) => [e.quote_id, e]));
const additions: string[] = [];

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    failed = true;
    console.error(`  FAIL  ${q.quote_id} — bundle error ${res.error.code}`);
    continue;
  }
  const c = res.data.costing;
  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  const base = baseByQuote.get(q.quote_id);
  if (!base) {
    console.log(`  --    ${q.quote_id} — new since baseline, not covered`);
    continue;
  }

  // Compared against what the baseline captured, never against more than that.
  const addedHere: string[] = [];
  const projected = projectOntoBaseline(baselineDetail[q.quote_id], payload, addedHere);
  for (const a of addedHere) additions.push(a);

  const digest = createHash("sha256").update(canonical(projected)).digest("hex").slice(0, 32);
  now.push({ quote_id: q.quote_id, digest });

  if (base.digest !== digest) {
    failed = true;
    const where = firstDifference(baselineDetail[q.quote_id], projected);
    console.error(`  FAIL  ${q.quote_id}  ${base.label}`);
    console.error(`          ${where ?? "digest differs; no scalar difference located"}`);
  }
}

const missing = inBasket.filter((e) => !quotes.some((q) => q.quote_id === e.quote_id));
for (const m of missing) {
  failed = true;
  console.error(`  FAIL  ${m.quote_id} — in baseline, absent now. Coverage silently shrank.`);
}

now.sort((a, b) => a.quote_id.localeCompare(b.quote_id));
const globalDigest = createHash("sha256")
  .update(now.map((e) => `${e.quote_id}|${e.digest}`).join("\n"))
  .digest("hex");

/**
 * The expected global, over the RETAINED baseline entries.
 *
 * `baseline.globalDigest` was computed over the whole captured set, so it cannot
 * remain the reference once a namespace is out of scope. This re-aggregates the
 * SAME RECORDED per-quote digests over the subset that remains — baseline values
 * only, no current value anywhere in it. It is AM-005's remainder-digest method,
 * promoted from a one-off isolation script into the standing check.
 */
const expectedGlobal = createHash("sha256")
  .update(
    [...inBasket]
      .sort((a, b) => a.quote_id.localeCompare(b.quote_id))
      .map((e) => `${e.quote_id}|${e.digest}`)
      .join("\n"),
  )
  .digest("hex");
if (!failed && globalDigest !== expectedGlobal) {
  failed = true;
  console.error(
    "  FAIL  the retained population's global digest does not match its captured state.",
  );
}

if (excluded.length > 0) {
  console.log(
    `  --    ${excluded.length} quote(s) excluded — ${VALIDATION_NAMESPACE}* is a namespace of mutable`,
  );
  console.log(
    "        instruments and cannot serve as a preservation reference. AM-005.",
  );
  for (const e of excluded) console.log(`          ${e.quote_id}  ${e.label}`);
}
if (additions.length > 0) {
  // Grouped by SHAPE, not by instance. One line per new field across the whole
  // basket, rather than 2214 lines that differ only in an array index — a
  // report nobody reads is the same as no report, and this one has to be read.
  const byShape = new Map<string, number>();
  for (const a of additions) {
    const shape = a.replace(/\[\d+\]/g, "[]");
    byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
  }
  console.log(
    `  --    ${additions.length} field instance(s) present now and absent at capture — ADDITIONS,`,
  );
  console.log(
    "        permitted under A-1. Set aside from the comparison, and named so they are",
  );
  console.log("        never silent:");
  for (const [shape, n] of [...byShape].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`          ${String(n).padStart(5)} x  ${shape}`);
  }
}

if (!failed) {
  console.log(`  ok    ${now.length} quotes — every captured commercial scalar identical`);
  console.log(`  ok    global digest ${globalDigest}`);
  console.log(
    "\n  NOT COVERED: `override` and `flagged-out` node kinds have zero rows in\n" +
      "  the database and cannot be exercised by any quote. Unit coverage against\n" +
      "  QuoteCostingInput is required; a green run here does not include them.\n",
  );
} else {
  console.error(
    `\n  expected global ${expectedGlobal}\n  current  global ${globalDigest}\n`,
  );
  console.error(
    "  A commercial number moved. Under Amendment A-1 that is out of bounds:\n" +
      "  exposing computation structure is permitted, changing existing numbers is not.\n",
  );
}
process.exit(failed ? 1 : 0);
