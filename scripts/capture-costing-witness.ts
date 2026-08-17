/**
 * Costing witness — a before/after economics digest for migrations.
 *
 * NOT S-7. That gate compares against a governed baseline captured months ago
 * over live quotes, and is red on untouched main for unrelated data drift. This
 * captures the CURRENT state to a file and is compared only against another
 * capture from this same script, so the only thing it can report is movement
 * caused by the change under test.
 *
 * Usage:
 *   node --env-file-if-exists=.env.local --experimental-strip-types \
 *     --conditions=react-server \
 *     --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/capture-costing-witness.ts <out.json> [--compare <before.json>]
 *
 * Captures every quote, not only those carrying the economics under test: a
 * migration that moves a number on a quote nobody predicted is exactly the
 * result worth having, and restricting the population to the expected one
 * would hide it.
 *
 * The payload is the whole computed result — quote, firmSettings, tiers,
 * skuRollups, quoteRollup, quoteSummary — deliberately rather than a chosen
 * subset. A subset is a prediction about which numbers matter.
 *
 * `policySource` is captured alongside the digest because a migration can hold
 * every number still while changing WHERE the policy came from, and that
 * transition is itself the thing being proven in the pin backfill.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./gate-1b/canonical-digest.ts";
import { resolveQuoteCommercialSettings } from "@/lib/commercial-settings";

type Entry = { digest: string; policySource: string; status: string; label: string };

const out = process.argv[2];
if (!out || out.startsWith("--")) {
  throw new Error("usage: capture-costing-witness.ts <out.json> [--compare <before.json>]");
}
const cmpIdx = process.argv.indexOf("--compare");
const comparePath = cmpIdx > -1 ? process.argv[cmpIdx + 1] : null;

const quotes = (await db.execute(sql`
  select q.id::text id, q.status, q.scenario_label lbl, p.deal_name dn
    from quotes q join projects p on p.id = q.project_id
   order by q.id::text
`)) as unknown as { id: string; status: string; lbl: string; dn: string }[];

const entries: Record<string, Entry> = {};
let failed = 0;
for (const q of quotes) {
  const label = `${q.dn} / ${q.lbl}`;
  let policySource = "unknown";
  try {
    policySource = (await resolveQuoteCommercialSettings(q.id)).source;
  } catch (e) {
    policySource = `ERROR:${e instanceof Error ? e.message.slice(0, 60) : "?"}`;
  }
  const res = await getCostingBundle(q.id);
  if (!res.ok) {
    failed += 1;
    entries[q.id] = { digest: `ERROR:${res.error.code}`, policySource, status: q.status, label };
    continue;
  }
  const c = res.data.costing as Record<string, unknown>;
  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  entries[q.id] = {
    digest: createHash("sha256").update(canonical(payload)).digest("hex"),
    policySource,
    status: q.status,
    label,
  };
}

const global = createHash("sha256")
  .update(Object.keys(entries).sort().map((k) => `${k}|${entries[k].digest}`).join("\n"))
  .digest("hex");

writeFileSync(out, JSON.stringify({ count: quotes.length, failed, global, entries }, null, 2) + "\n");
console.log(`WITNESS quotes=${quotes.length} failed=${failed}`);
console.log(`WITNESS global ${global}`);

const bySource: Record<string, number> = {};
for (const e of Object.values(entries)) bySource[e.policySource] = (bySource[e.policySource] ?? 0) + 1;
for (const [s, n] of Object.entries(bySource).sort()) console.log(`WITNESS source ${s}: ${n}`);

if (comparePath) {
  const before = JSON.parse(readFileSync(comparePath, "utf8")) as typeof entries extends never
    ? never
    : { global: string; entries: Record<string, Entry> };
  const moved: string[] = [];
  const sourceChanged: string[] = [];
  for (const [id, now] of Object.entries(entries)) {
    const was = before.entries[id];
    if (!was) { moved.push(`${id} ADDED`); continue; }
    if (was.digest !== now.digest) moved.push(`${now.label} [${now.status}]`);
    if (was.policySource !== now.policySource) {
      sourceChanged.push(`${now.label}: ${was.policySource} -> ${now.policySource}`);
    }
  }
  for (const id of Object.keys(before.entries)) if (!entries[id]) moved.push(`${id} REMOVED`);
  console.log("");
  console.log(`COMPARE global before ${before.global}`);
  console.log(`COMPARE global after  ${global}`);
  console.log(`COMPARE economics moved: ${moved.length}`);
  for (const m of moved.slice(0, 20)) console.log(`   MOVED ${m}`);
  console.log(`COMPARE policy source changed: ${sourceChanged.length}`);
  for (const s of sourceChanged.slice(0, 20)) console.log(`   SOURCE ${s}`);
}
process.exit(0);
