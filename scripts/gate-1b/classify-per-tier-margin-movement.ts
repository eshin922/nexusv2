/**
 * S-7 movement classification — per-TIER margin undefined at zero revenue.
 * READ ONLY. Run BEFORE any re-baseline.
 *
 * The sibling of `classify-margin-undefined-movement.ts`, and deliberately a
 * SECOND script rather than an extension of the first. The quote-wide
 * correction moved eight quotes off `150d9f5a…`; this one moves ten off
 * `c85e555c…`, two of which are revenue-bearing quotes the first proof
 * asserts did not move. Sharing one script would leave the two corrections
 * inseparable in the record — each digest transition has to be attributable to
 * the change that caused it, on its own.
 *
 * FOUR CLAIMS, same structure as the sibling:
 *
 *   1. Every quote with no zero-revenue tier is byte-identical to `c85e555c…`.
 *   2. Exactly the ten quotes named below move, checked in both directions.
 *   3. The only fields that differ are `quoteRollup[N].blendedMarginPct`
 *      (0 → null) and `quoteRollup[N].blendedMarginStatus`
 *      (BELOW_FLOOR → UNAVAILABLE). In particular `suggestedGlobalAdjPct` must
 *      NOT move: it was already null via the engine's own `revenue <= 0`
 *      guard, and a suggestion changing here would mean the correction had
 *      reached into the solver's output rather than only its input.
 *   4. Re-imposing the OLD semantics on those tiers reproduces `c85e555c…`
 *      exactly.
 *
 * Both digests are pinned as literals so this cannot agree with itself, and
 * stays a true statement after the re-baseline it authorises.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

/** The digest recorded before THIS correction — after the quote-wide one. */
const PRIOR_GLOBAL_DIGEST =
  "c85e555c1352c02928eaf30ec05686614294d8b3bc826dfa4e6e41e0b1eebfcb";

/** The digest before the QUOTE-WIDE correction, for orientation only. */
const QUOTE_WIDE_PRIOR =
  "150d9f5ab0e8261da2ea3d6b292dbe5c835265f55e8a076af5fb0a65110717e0";

/**
 * The ten quotes authorised to move. Eight are the zero-revenue quotes from
 * the quote-wide correction — every tier in them is empty. Two are
 * REVENUE-BEARING quotes carrying one empty tier each, and they are the whole
 * reason this is a separate package.
 */
const AUTHORISED_MOVERS = [
  "180e6410",
  "2de1dd81",
  "52bd0077", // revenue-bearing · "Tier 4"
  "600dd15c",
  "93a5d4bb", // revenue-bearing · "Tier 2"
  "9de0a19d",
  "bfc6eebe",
  "e33d0f54",
  "f84334bd",
  "f9c23c2f",
];

/** Only these field NAMES may differ, and only inside `quoteRollup`. */
const AUTHORISED_FIELDS = new Set(["blendedMarginPct", "blendedMarginStatus"]);

type Entry = { quote_id: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/preserved/costing-baseline-c85e555c.json", "utf8"),
) as { globalDigest: string; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' +
    readFileSync(
      "docs/gate-1b/preserved/costing-baseline-detail-c85e555c.json",
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
    quoteRollup: c.quoteRollup.map((t) =>
      t.blendedMarginPct === null
        ? {
            ...t,
            blendedMarginPct: 0,
            blendedMarginStatus: oldStatusForZero(target, floor),
          }
        : t,
    ),
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
  tiersCorrected += diffs.filter((d) => d.includes("blendedMarginPct")).length;

  if (!AUTHORISED_MOVERS.includes(where)) {
    failures.push(`${where}: moved but is NOT one of the ten authorised`);
  }
  for (const d of diffs) {
    const path = d.split(":")[0];
    // Every change must be a permitted field INSIDE quoteRollup. In
    // particular this rejects a `quoteSummary.*` move — the quote-wide
    // quantities are settled and must not shift again here — and rejects
    // `suggestedGlobalAdjPct` moving on a corrected tier.
    const insideRollup = path.startsWith("quoteRollup[");
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
console.log(`  tiers corrected               ${tiersCorrected}`);

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
  `\n  ok    ${unchanged} quotes with no empty tier byte-identical\n` +
    `  ok    exactly the ${moved.length} authorised quotes moved\n` +
    `  ok    only per-tier blendedMarginPct + blendedMarginStatus differ\n` +
    `  ok    no quoteSummary field moved — the quote-wide correction stands\n` +
    `  ok    undoing the correction reproduces ${PRIOR_GLOBAL_DIGEST.slice(0, 8)}…\n` +
    `\n  Movement classified. Re-baseline authorised.\n`,
);
process.exit(0);
