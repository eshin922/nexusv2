/**
 * S-7 movement classification — per-CELL margin undefined at zero revenue.
 * READ ONLY. Run BEFORE any re-baseline.
 *
 * The third and last sibling — quote-wide, per-tier, and now per-cell. A
 * separate script again, for the reason the last one gave: each digest
 * transition must be attributable to the change that caused it, and one shared
 * script would leave three corrections indistinguishable in the record.
 *
 * This is the widest of the three. A cell is per (SKU x tier), so 143 of 381
 * production cells move, across 9 quotes — and that set is NOT the per-tier
 * set. `52bd0077` moved at tier scope and does not move here: its empty tier
 * has zero QUANTITY, so tier revenue was zero while the cells inside it still
 * carry a per-unit price. Measured, not assumed.
 *
 * FOUR CLAIMS:
 *
 *   1. Every quote with no zero-revenue cell is byte-identical to `a7e887ba`.
 *   2. Exactly the nine quotes named below move, checked in both directions.
 *   3. The only fields that differ are `skuRollups[].perTier[].marginPct`
 *      (0 -> null) and `.marginStatus` (BELOW_FLOOR -> UNAVAILABLE). No
 *      `quoteRollup` or `quoteSummary` field moves — the two earlier
 *      corrections must still stand on their own records.
 *   4. Re-imposing the old semantics reproduces `a7e887ba` exactly.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

/** The digest recorded before THIS correction — after the quote-wide one. */
const PRIOR_GLOBAL_DIGEST =
  "a7e887ba62a3d06d157c24655d4473d0716ac9a8b2d55d33d097f2b96081e644";

/** The digest before the PER-TIER correction, for orientation only. */
const QUOTE_WIDE_PRIOR =
  "c85e555c1352c02928eaf30ec05686614294d8b3bc826dfa4e6e41e0b1eebfcb";

/**
 * The nine quotes authorised to move — measured, then pinned.
 *
 * Note what is ABSENT: `52bd0077`, which moved in the per-tier correction. Its
 * empty tier has zero quantity, so tier revenue was zero while every cell in
 * it still carries a per-unit price. Cell scope and tier scope have genuinely
 * different populations, and carrying the previous list forward would have
 * produced a proof that failed for a correct reason while looking like a
 * regression.
 */
const AUTHORISED_MOVERS = [
  "180e6410",
  "2de1dd81",
  "600dd15c",
  "93a5d4bb",
  "9de0a19d",
  "bfc6eebe",
  "e33d0f54",
  "f84334bd",
  "f9c23c2f",
];

/** Only these field NAMES may differ, and only inside `skuRollups`. */
const AUTHORISED_FIELDS = new Set(["marginPct", "marginStatus"]);

type Entry = { quote_id: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/preserved/costing-baseline-a7e887ba.json", "utf8"),
) as { globalDigest: string; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' +
    readFileSync(
      "docs/gate-1b/preserved/costing-baseline-detail-a7e887ba.json",
      "utf8",
    ).trim() +
    "}",
)._ as Record<string, unknown>;

if (baseline.globalDigest !== PRIOR_GLOBAL_DIGEST) {
  console.error(
    `\n  The preserved baseline is not the one this classifies.\n` +
      `    expected ${PRIOR_GLOBAL_DIGEST}\n    found    ${baseline.globalDigest}\n` +
      `  (the pre-quote-wide baseline is ${QUOTE_WIDE_PRIOR.slice(0, 8)}…, a different file)\n`,
  );
  process.exit(1);
}

/** EVERY differing path, not merely the first. */
function differences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (canonical(a) === canonical(b)) return out;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    out.push(`${path}: ${canonical(a)} -> ${canonical(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: shape changed`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: length ${a.length} -> ${b.length}`);
      return out;
    }
    for (let i = 0; i < a.length; i++) differences(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    differences(ao[k], bo[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

/** The band `computeStatus` would have chosen for a synthetic 0% margin. */
function oldStatusForZero(target: number, floor: number): string {
  if (0 >= target) return "GOOD";
  if (0 >= floor) return "BELOW_TARGET";
  return "BELOW_FLOOR";
}

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q
   where exists (select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id where a.quote_id = q.id)
   order by q.id
`)) as unknown as { quote_id: string }[];

const failures: string[] = [];
const moved: string[] = [];
const fieldChanges = new Map<string, string[]>();
const asIfOld: { quote_id: string; digest: string }[] = [];
let unchanged = 0;
let tiersCorrected = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    failures.push(`${q.quote_id}: bundle error ${res.error.code}`);
    continue;
  }
  const c = res.data.costing;
  const where = q.quote_id.slice(0, 8);
  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  const digest = createHash("sha256")
    .update(canonical(payload))
    .digest("hex")
    .slice(0, 32);

  // Claim 4 — undo exactly this correction, per tier, and re-digest.
  const target = c.quoteSummary.effectiveTargetMarginPct;
  const floor = c.firmSettings.floorMarginPct;
  const asOld = {
    ...payload,
    skuRollups: c.skuRollups.map((sr) => ({
      ...sr,
      perTier: sr.perTier.map((pt) =>
        pt.marginPct === null
          ? { ...pt, marginPct: 0, marginStatus: oldStatusForZero(target, floor) }
          : pt,
      ),
    })),
  };
  asIfOld.push({
    quote_id: q.quote_id,
    digest: createHash("sha256").update(canonical(asOld)).digest("hex").slice(0, 32),
  });

  const base = baseline.entries.find((e) => e.quote_id === q.quote_id);
  if (!base) {
    failures.push(`${where}: not in the preserved baseline`);
    continue;
  }
  if (base.digest === digest) {
    unchanged += 1;
    if (AUTHORISED_MOVERS.includes(where)) {
      failures.push(`${where}: authorised to move but is unchanged`);
    }
    continue;
  }

  moved.push(where);
  const diffs = differences(baselineDetail[q.quote_id], payload);
  fieldChanges.set(where, diffs);
  tiersCorrected += diffs.filter((d) => d.includes(".marginPct")).length;

  if (!AUTHORISED_MOVERS.includes(where)) {
    failures.push(`${where}: moved but is NOT one of the nine authorised`);
  }
  for (const d of diffs) {
    const path = d.split(":")[0];
    // Every change must be a permitted field INSIDE quoteRollup. In
    // particular this rejects a `quoteSummary.*` move — the quote-wide
    // quantities are settled and must not shift again here — and rejects
    // `suggestedGlobalAdjPct` moving on a corrected tier.
    const insideRollup = path.startsWith("skuRollups[");
    const field = path.split(".").pop() ?? "";
    if (!insideRollup || !AUTHORISED_FIELDS.has(field)) {
      failures.push(`${where}: unauthorised field moved — ${d}`);
    }
  }
}

// ---------------------------------------------------------------- report

console.log(`\n  quotes                        ${quotes.length}`);
console.log(`  byte-identical                ${unchanged}`);
console.log(`  moved                         ${moved.length}`);
console.log(`  cells corrected               ${tiersCorrected}`);

console.log(`\n  Fields that changed, per moved quote:\n`);
for (const [where, diffs] of fieldChanges) {
  console.log(`    ${where}`);
  for (const d of diffs) console.log(`      ${d}`);
}

asIfOld.sort((a, b) => a.quote_id.localeCompare(b.quote_id));
const reconstructed = createHash("sha256")
  .update(asIfOld.map((e) => `${e.quote_id}|${e.digest}`).join("\n"))
  .digest("hex");

console.log(`\n  Undoing the correction reproduces:`);
console.log(`    ${reconstructed}`);
console.log(`  Prior baseline:`);
console.log(`    ${PRIOR_GLOBAL_DIGEST}`);

if (reconstructed !== PRIOR_GLOBAL_DIGEST) {
  failures.push(
    "reverting the per-tier margin/status pair does NOT reproduce the prior " +
      "baseline — something beyond this correction moved",
  );
}

const missed = AUTHORISED_MOVERS.filter((m) => !moved.includes(m));
if (missed.length) failures.push(`authorised movers that did not move: ${missed.join(", ")}`);

if (failures.length) {
  console.error(`\n  FAIL ${failures.length}:`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(`\n  Do NOT re-baseline.\n`);
  process.exit(1);
}

console.log(
  `\n  ok    ${unchanged} quotes with no zero-revenue cell byte-identical\n` +
    `  ok    exactly the ${moved.length} authorised quotes moved\n` +
    `  ok    only per-cell marginPct + marginStatus differ\n` +
    `  ok    no quoteRollup/quoteSummary movement — both earlier corrections stand\n` +
    `  ok    undoing the correction reproduces ${PRIOR_GLOBAL_DIGEST.slice(0, 8)}…\n` +
    `\n  Movement classified. Re-baseline authorised.\n`,
);
process.exit(0);
