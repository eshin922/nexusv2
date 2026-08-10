/**
 * AM-005 — one investigation. READ ONLY.
 *
 * The question, and only this question: does the S-7 delta originate SOLELY
 * from the validation quote?
 *
 * Answering "one quote failed" is not the same answer. The verifier reports a
 * per-quote digest mismatch, but the global digest is a hash over every quote's
 * digest in order, so a second quote drifting in a way that produced no visible
 * FAIL line — or the set itself changing size — would move the global hash just
 * the same. This recomputes the global digest with the suspect quote REMOVED
 * from both sides and asks whether the remainder is byte-identical.
 *
 * If it is, every other quote is preserved and the delta is attributable to one
 * row. If it is not, the finding is larger than one quote and AM-005 has been
 * mis-scoped.
 *
 * Temporary. Delete once AM-005 is dispositioned — the scope it assumes is the
 * scope under question.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";

type Entry = { quote_id: string; status: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline.json", "utf8"),
) as { globalDigest: string; capturedOver: number; entries: Entry[] };

const SUSPECT = "52bd0077-20af-4345-8856-45003bfca8b3";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q
   where exists (select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id where a.quote_id = q.id)
   order by q.id
`)) as unknown as { quote_id: string }[];

const now: { quote_id: string; digest: string }[] = [];
for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    console.error(`  bundle error ${q.quote_id} ${res.error.code}`);
    continue;
  }
  const c = res.data.costing;
  const digest = createHash("sha256")
    .update(
      canonical({
        quote: c.quote,
        firmSettings: c.firmSettings,
        tiers: c.tiers,
        skuRollups: c.skuRollups,
        quoteRollup: c.quoteRollup,
        quoteSummary: c.quoteSummary,
      }),
    )
    .digest("hex")
    .slice(0, 32);
  now.push({ quote_id: q.quote_id, digest });
}

const global = (entries: { quote_id: string; digest: string }[]) =>
  createHash("sha256")
    .update(
      [...entries]
        .sort((a, b) => a.quote_id.localeCompare(b.quote_id))
        .map((e) => `${e.quote_id}|${e.digest}`)
        .join("\n"),
    )
    .digest("hex");

const baseById = new Map(baseline.entries.map((e) => [e.quote_id, e.digest]));
const nowById = new Map(now.map((e) => [e.quote_id, e.digest]));

// 1 · The membership question. A quote added or dropped moves the hash without
//     any number changing, and reads identically in the digest.
const added = now.filter((e) => !baseById.has(e.quote_id)).map((e) => e.quote_id);
const dropped = baseline.entries.filter((e) => !nowById.has(e.quote_id)).map((e) => e.quote_id);

// 2 · Every per-quote difference, not the first one.
const differing = baseline.entries
  .filter((e) => nowById.has(e.quote_id) && nowById.get(e.quote_id) !== e.digest)
  .map((e) => ({ quote_id: e.quote_id, label: e.label, from: e.digest, to: nowById.get(e.quote_id) }));

// 3 · The decisive test — the remainder, with the suspect removed from both.
const remainderBaseline = global(
  baseline.entries.filter((e) => e.quote_id !== SUSPECT).map((e) => ({ quote_id: e.quote_id, digest: e.digest })),
);
const remainderNow = global(now.filter((e) => e.quote_id !== SUSPECT));

console.log(
  JSON.stringify(
    {
      counts: { baseline: baseline.entries.length, now: now.length },
      membership: { added, dropped },
      differingQuotes: differing,
      fullGlobal: { baseline: baseline.globalDigest, now: global(now) },
      remainderExcludingSuspect: {
        suspect: SUSPECT,
        baseline: remainderBaseline,
        now: remainderNow,
        identical: remainderBaseline === remainderNow,
      },
    },
    null,
    2,
  ),
);
