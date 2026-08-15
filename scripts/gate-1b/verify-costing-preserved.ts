/**
 * Gate 1B · S-7 — the preservation invariant. READ ONLY.
 *
 * THE INVARIANT
 *
 *   Every commercial scalar returned by `computeQuoteCosting` is byte-identical
 *   to the value captured before the node graph existed — EXCEPT that a freight
 *   contribution may be attributed to a different product, provided every
 *   aggregate it feeds is conserved.
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
 * ── THE PATTERN 58 EXCEPTION, AND WHY IT IS NARROW ───────────────────────────
 *
 * Pattern 58 governs: *membership may determine attribution, but must never
 * determine commercial arithmetic.* Which leaf a shipment anchors to is an
 * attribution choice — on `2f29af72` three members share `position 0`, so the
 * "lowest-position" anchor is a tie broken by physical row order (OD-028).
 *
 * A verifier that fails on BOTH halves of that rule cannot certify EITHER. It
 * reported the same red for a repair that made the arithmetic owner-invariant
 * as it would for a repair that broke it, and the one-line-per-quote report
 * then hid a 5,880 revenue movement behind a 1.7e-16 margin difference on an
 * earlier tier.
 *
 * So the payload is split and each half is held to the rule that is true of it:
 *
 *   STRICT      quote, firm settings, tiers, tier rollups, quote summary, SKU
 *               identity and membership, and every per-SKU scalar that carries
 *               no freight. ZERO DRIFT, unchanged from before.
 *
 *   ATTRIBUTION the per-SKU scalars a freight contribution reaches. Permitted
 *               to REDISTRIBUTE between products, and nothing more:
 *                 · the freight multiset per tier is unchanged — the same
 *                   amounts, possibly held by different products;
 *                 · each row's movement equals THAT ROW'S freight movement, so
 *                   a packaging edit hiding inside a reattributed row fails;
 *                 · the sums over leaves and over top-level rows are conserved;
 *                 · each row's margin still equals its own sell and cost.
 *
 * A row with no freight movement is therefore still strict, because its
 * permitted delta is zero. This is more discriminating than the digest it
 * replaces, not less: the digest could say only that something moved.
 *
 * Same reasoning as the Scenario Copy acceptance, which separates economic
 * equality from permissible attribution for the same reason.
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
import {
  ATTRIBUTION_FIELDS,
  allDifferences,
  attributionViolations,
  strictHalf,
  type Diff,
} from "./preservation-compare.ts";

type Entry = { quote_id: string; status: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline.json", "utf8"),
) as { globalDigest: string; capturedOver: number; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' + readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8").trim() + "}",
)._ as Record<string, unknown>;


/**
 * Grouped by SHAPE, ordered by the LARGEST movement in each group.
 *
 * `firstDifference` used to return ONE line per quote, and the walk order chose
 * which. On `2f29af72` it chose `quoteRollup[0].blendedMarginPct` moving by
 * 1.7e-16 — behind which sat `quoteRollup[1].totalRevenue` moving by 5,880. The
 * report named the harmless one and the material one stayed invisible until it
 * was looked for by other means. A gate whose output can do that is not
 * reporting.
 *
 * Ordering by magnitude is the half that matters: it is what stops a float-noise
 * difference from being printed where a commercial one should be.
 */
function reportDifferences(diffs: Diff[], indent: string): void {
  const byShape = new Map<string, Diff[]>();
  for (const d of diffs) {
    const shape = d.path.replace(/\[\d+\]/g, "[]");
    (byShape.get(shape) ?? byShape.set(shape, []).get(shape)!).push(d);
  }
  const ranked = [...byShape.entries()]
    .map(([shape, ds]) => ({
      shape,
      ds,
      worst: ds.reduce((m, d) => Math.max(m, d.delta ?? Infinity), 0),
    }))
    .sort((x, y) => y.worst - x.worst);
  for (const { shape, ds, worst } of ranked) {
    const e = ds[0];
    const mag = Number.isFinite(worst) ? `max|d|=${worst.toExponential(2)}` : "non-numeric";
    console.error(
      `${indent}${shape}  x${ds.length}  ${mag}  e.g. ${canonical(e.from)} -> ${canonical(e.to)}`,
    );
  }
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
/**
 * The expected global is aggregated from digests taken over the SAME strict
 * projection as the current side, computed here from the detail file rather
 * than read from `baseline.entries[].digest`.
 *
 * The recorded digests cover the WHOLE payload including the attribution half,
 * so they cannot be the reference once that half is compared by conservation
 * instead of by identity. The detail file's integrity is checked separately,
 * per quote, against those recorded digests — so nothing is taken on trust that
 * used to be verified.
 */
const expectedNow: { quote_id: string; digest: string }[] = [];
const reattributed: { quote_id: string; label: string; n: number }[] = [];
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

  // The DETAIL file is the reference for everything below, so it is checked
  // against the recorded digest first. Without this, editing the detail file
  // would "fix" a failure by moving the thing the failure is measured against —
  // and nothing would say so.
  const baselineFull = createHash("sha256")
    .update(canonical(baselineDetail[q.quote_id]))
    .digest("hex")
    .slice(0, 32);
  if (baselineFull !== base.digest) {
    failed = true;
    console.error(
      `  FAIL  ${q.quote_id} — the baseline DETAIL no longer matches its recorded digest.` +
        ` The reference has been edited; nothing below is trustworthy.`,
    );
    continue;
  }

  // ── the strict half ──────────────────────────────────────────────────────
  const baseStrict = strictHalf(baselineDetail[q.quote_id]);
  const curStrict = strictHalf(projected);
  const digest = createHash("sha256").update(canonical(curStrict)).digest("hex").slice(0, 32);
  const expected = createHash("sha256").update(canonical(baseStrict)).digest("hex").slice(0, 32);
  now.push({ quote_id: q.quote_id, digest });
  expectedNow.push({ quote_id: q.quote_id, digest: expected });

  if (expected !== digest) {
    failed = true;
    const diffs: Diff[] = [];
    allDifferences(baseStrict, curStrict, diffs);
    console.error(`  FAIL  ${q.quote_id}  ${base.label}  — ${diffs.length} governed scalar(s) moved`);
    reportDifferences(diffs, "          ");
  }

  // ── the attribution half ─────────────────────────────────────────────────
  const violations = attributionViolations(baselineDetail[q.quote_id], projected);
  if (violations.length > 0) {
    failed = true;
    console.error(`  FAIL  ${q.quote_id}  ${base.label}  — per-SKU movement is not reattribution`);
    for (const v of violations.slice(0, 12)) console.error(`          ${v}`);
    if (violations.length > 12)
      console.error(`          … and ${violations.length - 12} more`);
  } else {
    const moved: Diff[] = [];
    allDifferences(baselineDetail[q.quote_id], projected, moved);
    const attributionMoved = moved.filter((d) =>
      ATTRIBUTION_FIELDS.has(d.path.split(".").pop() ?? ""),
    );
    if (attributionMoved.length > 0)
      reattributed.push({ quote_id: q.quote_id, label: base.label, n: attributionMoved.length });
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
 * remain the reference once a namespace is out of scope. This re-aggregates over
 * the subset that remains — baseline values only, no current value anywhere in
 * it. It is AM-005's remainder-digest method, promoted from a one-off isolation
 * script into the standing check.
 *
 * The per-quote digests are now taken over the STRICT half, so they are computed
 * from the detail file rather than read from `entries[].digest` — which covers
 * the attribution half too and would therefore hold a product's freight share
 * fixed. Each detail entry has already been checked against its recorded digest
 * above, so this is a re-projection of verified baseline data, not a new one.
 */
const expectedGlobal = createHash("sha256")
  .update(
    [...expectedNow]
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

if (reattributed.length > 0) {
  // Reported on a GREEN run, deliberately. Attribution movement is permitted,
  // not invisible — a shipment changing hands is a real change to what an
  // operator sees on a product row, and a gate that permitted it silently would
  // be the broad exemption this narrow one exists to avoid.
  console.log(
    `  --    ${reattributed.length} quote(s) reattributed freight between products — permitted`,
  );
  console.log(
    "        under Pattern 58: the owner moved, every aggregate it feeds is conserved.",
  );
  console.log("        Underlying cause is OD-028 (duplicate member positions).");
  for (const r of reattributed)
    console.log(`          ${r.quote_id}  ${r.label} — ${r.n} per-SKU scalar(s)`);
}

if (!failed) {
  console.log(
    `  ok    ${now.length} quotes — every governed commercial scalar identical`,
  );
  console.log(
    "  ok    per-SKU freight attribution conserved: same amounts, same sums, same tier totals",
  );
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
