/**
 * Gate 1B · S-7 — preservation baseline. READ ONLY.
 *
 * Captures the current output of `computeQuoteCosting` for EVERY quote that has
 * commercial structure, so that when rollups begin deriving from canonical
 * nodes, "no commercial number changed" is a checkable claim rather than an
 * assurance.
 *
 * WHY EVERY QUOTE RATHER THAN A SAMPLE. A hand-picked fixture set encodes the
 * author's belief about where divergence is likely, and that belief is exactly
 * what a preservation proof is not entitled to assume. Capturing everything
 * removes selection bias; the run is cheap because the engine is a pure function
 * over an already-loaded bundle.
 *
 * WHAT IT DIGESTS. Every numeric scalar on `SkuPerTierRollup`, plus per-leg
 * freight breakdowns, plus the quote-level rollups and breakdown. Values are
 * captured UNROUNDED — rounding here would hide exactly the small drifts a
 * refactor introduces, which are the ones nobody notices until a customer does.
 *
 * The digest is per-quote as well as global. A global-only digest tells you
 * something changed; per-quote tells you where.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id, q.status, q.scenario_label, p.deal_name
    from quotes q
    join projects p on p.id = q.project_id
   where exists (
     select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id
     where a.quote_id = q.id
   )
   order by q.id
`)) as unknown as { quote_id: string; status: string; scenario_label: string; deal_name: string }[];

console.log(`\nGate 1B S-7 — capturing baseline over ${quotes.length} quotes with structure\n`);


type Entry = {
  quote_id: string;
  status: string;
  label: string;
  digest: string;
  skus: number;
  tiers: number;
  error?: string;
};

const entries: Entry[] = [];
const detail: Record<string, unknown> = {};
let failed = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    failed += 1;
    entries.push({
      quote_id: q.quote_id,
      status: q.status,
      label: `${q.deal_name} / ${q.scenario_label}`,
      digest: "ERROR",
      skus: 0,
      tiers: 0,
      error: res.error.code,
    });
    console.log(`  ERROR  ${q.quote_id}  ${res.error.code}`);
    continue;
  }

  const costing = res.data.costing;
  // Everything the engine asserts about commercial value. Deliberately the
  // whole result rather than a chosen subset: a subset is a prediction about
  // which numbers matter, and the point of the baseline is to not predict.
  const payload = {
    quote: costing.quote,
    firmSettings: costing.firmSettings,
    tiers: costing.tiers,
    skuRollups: costing.skuRollups,
    quoteRollup: costing.quoteRollup,
    quoteSummary: costing.quoteSummary,
  };
  const digest = createHash("sha256").update(canonical(payload)).digest("hex").slice(0, 32);

  entries.push({
    quote_id: q.quote_id,
    status: q.status,
    label: `${q.deal_name} / ${q.scenario_label}`,
    digest,
    skus: costing.skuRollups.length,
    tiers: costing.quoteRollup.length,
  });
  detail[q.quote_id] = payload;
}

entries.sort((a, b) => a.quote_id.localeCompare(b.quote_id));
const globalDigest = createHash("sha256")
  .update(entries.map((e) => `${e.quote_id}|${e.digest}`).join("\n"))
  .digest("hex");

writeFileSync(
  "docs/gate-1b/costing-baseline.json",
  JSON.stringify({ capturedOver: quotes.length, failed, globalDigest, entries }, null, 2) + "\n",
);
writeFileSync("docs/gate-1b/costing-baseline-detail.json", canonical(detail) + "\n");

console.log(`\n  quotes captured   ${entries.length - failed}`);
console.log(`  failed            ${failed}`);
console.log(`  global digest     ${globalDigest}`);
console.log(`\n  docs/gate-1b/costing-baseline.json         per-quote digests`);
console.log(`  docs/gate-1b/costing-baseline-detail.json  full values, for locating a drift\n`);
process.exit(0);
