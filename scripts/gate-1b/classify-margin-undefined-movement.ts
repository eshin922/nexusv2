/**
 * S-7 movement classification — quote-wide margin undefined at zero revenue.
 * READ ONLY. Run BEFORE any re-baseline.
 *
 * This correction is the first in Gate 1B that MOVES a commercial scalar on
 * purpose. The standing rule is that a preservation check re-baselined whenever
 * it fails is not a preservation check, so the movement has to be classified
 * rather than accepted — and classification means proving the change is exactly
 * the one that was authorised and nothing else came with it.
 *
 * FOUR CLAIMS, each provable independently:
 *
 *   1. Every revenue-bearing quote is byte-identical to the prior baseline.
 *      Not "close" — the same 32-hex digest.
 *   2. Exactly the eight zero-revenue quotes move, and they are the eight
 *      named below, pinned as literals rather than discovered at runtime so
 *      this cannot agree with itself.
 *   3. On those eight, the ONLY fields that differ are
 *      `quoteSummary.blendedMarginPct` (0 → null) and
 *      `quoteSummary.blendedMarginStatus` (BELOW_FLOOR → UNAVAILABLE).
 *      A third differing field would mean the correction reached past its
 *      stated scope.
 *   4. Re-imposing the OLD semantics — null margin back to 0, UNAVAILABLE back
 *      to the band `computeStatus` would have chosen — reproduces the prior
 *      global digest 150d9f5a… exactly. That is the strongest available
 *      statement that nothing else changed: the old baseline is recoverable
 *      from the new engine by undoing precisely this one thing.
 *
 * The prior digest is pinned as a literal, not read from the baseline file, so
 * this stays a true and meaningful statement after the re-baseline it
 * authorises.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

/** The digest recorded before this correction. */
const PRIOR_GLOBAL_DIGEST =
  "150d9f5ab0e8261da2ea3d6b292dbe5c835265f55e8a076af5fb0a65110717e0";

/** The quotes authorised to move, by 8-char prefix. Pinned, not discovered. */
const AUTHORISED_MOVERS = [
  "180e6410",
  "2de1dd81",
  "600dd15c",
  "9de0a19d",
  "bfc6eebe",
  "e33d0f54",
  "f84334bd",
  "f9c23c2f",
];

/** The only field paths permitted to differ, on those quotes only. */
const AUTHORISED_FIELDS = new Set([
  "quoteSummary.blendedMarginPct",
  "quoteSummary.blendedMarginStatus",
]);

type Entry = { quote_id: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/preserved/costing-baseline-150d9f5a.json", "utf8"),
) as { globalDigest: string; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' +
    readFileSync(
      "docs/gate-1b/preserved/costing-baseline-detail-150d9f5a.json",
      "utf8",
    ).trim() +
    "}",
)._ as Record<string, unknown>;

if (baseline.globalDigest !== PRIOR_GLOBAL_DIGEST) {
  console.error(
    `\n  The preserved baseline is not the one this classifies.\n` +
      `    expected ${PRIOR_GLOBAL_DIGEST}\n    found    ${baseline.globalDigest}\n`,
  );
  process.exit(1);
}

/** EVERY differing path, not merely the first. */
function differences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (canonical(a) === canonical(b)) return out;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
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

  // Claim 4 — undo exactly this correction and re-digest.
  const s = c.quoteSummary;
  const asOld = {
    ...payload,
    quoteSummary:
      s.blendedMarginPct === null
        ? {
            ...s,
            blendedMarginPct: 0,
            blendedMarginStatus: oldStatusForZero(
              s.effectiveTargetMarginPct,
              c.firmSettings.floorMarginPct,
            ),
          }
        : s,
  };
  asIfOld.push({
    quote_id: q.quote_id,
    digest: createHash("sha256")
      .update(canonical(asOld))
      .digest("hex")
      .slice(0, 32),
  });

  const base = baseline.entries.find((e) => e.quote_id === q.quote_id);
  if (!base) {
    failures.push(`${where}: not in the preserved baseline`);
    continue;
  }
  if (base.digest === digest) {
    unchanged += 1;
    // Claim 2, the other direction: an authorised mover that did NOT move
    // means the correction did not reach it.
    if (AUTHORISED_MOVERS.includes(where)) {
      failures.push(`${where}: authorised to move but is unchanged`);
    }
    continue;
  }

  moved.push(where);
  const diffs = differences(baselineDetail[q.quote_id], payload);
  fieldChanges.set(where, diffs);

  if (!AUTHORISED_MOVERS.includes(where)) {
    failures.push(`${where}: moved but is NOT one of the eight authorised`);
  }
  for (const d of diffs) {
    const field = d.split(":")[0];
    if (!AUTHORISED_FIELDS.has(field)) {
      failures.push(`${where}: unauthorised field moved — ${d}`);
    }
  }
}

// ---------------------------------------------------------------- report

console.log(`\n  quotes                        ${quotes.length}`);
console.log(`  byte-identical                ${unchanged}`);
console.log(`  moved                         ${moved.length}`);

console.log(`\n  Fields that changed, per moved quote:\n`);
for (const [where, diffs] of fieldChanges) {
  console.log(`    ${where}`);
  for (const d of diffs) console.log(`      ${d}`);
}

// Claim 4 — the prior global digest, reconstructed.
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
    "reverting the margin/status pair does NOT reproduce the prior baseline — " +
      "something beyond this correction moved",
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
  `\n  ok    ${unchanged} revenue-bearing quotes byte-identical\n` +
    `  ok    exactly the ${moved.length} authorised quotes moved\n` +
    `  ok    only blendedMarginPct + blendedMarginStatus differ on them\n` +
    `  ok    undoing the correction reproduces ${PRIOR_GLOBAL_DIGEST.slice(0, 8)}…\n` +
    `\n  Movement classified. Re-baseline authorised.\n`,
);
process.exit(0);
