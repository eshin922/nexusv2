/**
 * S-7 digest movement classification — read-only.
 *
 * Surfacing `canonicalQuoteLeafId` on `SkuRollup` adds a field to the payload
 * S-7 hashes, so the digest moves. A moved digest normally means a commercial
 * regression, and the standing rule is that a preservation check which gets
 * re-baselined whenever it fails is not a preservation check.
 *
 * This classifies the movement BEFORE any re-baseline, by recomputing the
 * digest over the payload with the new field REMOVED. If the change is purely
 * additive, that reproduces the PRIOR baseline exactly — byte for byte, not
 * approximately. Any other result means something else changed too, and the
 * re-baseline is refused.
 *
 * The comparison target is the prior digest pinned as a literal below, not a
 * value read back from the baseline file, so this cannot agree with itself by
 * construction and stays meaningful after the re-baseline it authorised.
 *
 * It remains re-runnable, and remains a true statement: with the identity field
 * removed, the engine must still reproduce the pre-identity commercial
 * baseline. It stays valid through increment 7, whose nodes live on the graph
 * rather than in this payload. Any future change that legitimately moves a
 * commercial scalar will fail it — correctly, and that failure is the signal to
 * classify again rather than to edit the pin.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

/** The digest recorded before this change. */
const PRIOR_GLOBAL_DIGEST =
  "7e2c2f8330e4b54442bf49e4e85ef7dcf5d61f80e715b940d254e17b72777d76";

/** Remove ONLY the newly added identity field, at any depth. */
function stripIdentity(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIdentity);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === "canonicalQuoteLeafId") continue;
    out[k] = stripIdentity(val);
  }
  return out;
}

const quotes = (await db.execute(sql`
  select q.id::text as quote_id
    from quotes q
   where exists (
     select 1 from assemblies a
       join assembly_leaves al on al.assembly_id = a.id
      where a.quote_id = q.id
   )
   order by q.id
`)) as unknown as { quote_id: string }[];

const stripped: { quote_id: string; digest: string }[] = [];
let withIdentity = 0;
let leafRows = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) throw new Error(`${q.quote_id}: ${res.error.code}`);
  const c = res.data.costing;

  // Evidence that the field is actually populated. A digest that matches
  // because the new field is absent everywhere would prove nothing.
  for (const r of c.skuRollups) {
    if (r.skuRole !== "leaf") continue;
    leafRows += 1;
    if (r.canonicalQuoteLeafId !== null) withIdentity += 1;
  }

  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  const digest = createHash("sha256")
    .update(canonical(stripIdentity(payload)))
    .digest("hex")
    .slice(0, 32);
  stripped.push({ quote_id: q.quote_id, digest });
}

stripped.sort((a, b) => a.quote_id.localeCompare(b.quote_id));
const globalStripped = createHash("sha256")
  .update(stripped.map((e) => `${e.quote_id}|${e.digest}`).join("\n"))
  .digest("hex");

console.log(`\n  leaf rollups                 ${leafRows}`);
console.log(`  carrying canonical identity  ${withIdentity}`);
console.log(`\n  prior global digest          ${PRIOR_GLOBAL_DIGEST}`);
console.log(`  recomputed, field stripped   ${globalStripped}`);

if (globalStripped !== PRIOR_GLOBAL_DIGEST) {
  // The global digest is a hash over every per-quote digest, so a single
  // changed quote moves it. Per-quote values are printed to locate which.
  console.log(`\n  FAIL  a commercial scalar moved beyond the identity field.`);
  for (const e of stripped) console.log(`    ${e.quote_id}  ${e.digest}`);
  process.exit(1);
}
if (withIdentity === 0) {
  console.log(`\n  FAIL  no leaf carries the identity — the match proves nothing.`);
  process.exit(1);
}
console.log(
  `\n  ok    every commercial scalar is unchanged; the movement is the added` +
    `\n        identity field and nothing else. Re-baseline is authorised.\n`,
);
process.exit(0);
