/**
 * S-7 basket membership — the exclusion, checked against the estate. READ ONLY.
 *
 * `verify:s7-preserved` reports how many BASELINE entries it set aside. That is
 * a statement about a file. This is the statement about the database: of every
 * quote the basket predicate could reach, how many carry the validation
 * namespace, and is every one of them out?
 *
 * The distinction matters because the two can disagree in the direction that
 * costs something. A validation quote created after the baseline was captured
 * has no entry to exclude, so the file-side report says nothing about it — it
 * would simply appear in the live selection as "new since baseline, not
 * covered" and drift in silently the day someone re-captures.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { basketPredicate, isValidationInstrument, VALIDATION_NAMESPACE } from "./basket.ts";

const structural = (await db.execute(sql`
  select q.id::text as quote_id, coalesce(q.scenario_label, '(none)') as scenario_label
    from quotes q
   where exists (
     select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id
     where a.quote_id = q.id
   )
   order by q.scenario_label, q.id
`)) as unknown as { quote_id: string; scenario_label: string }[];

const basket = (await db.execute(sql`
  select q.id::text as quote_id from quotes q where ${basketPredicate()} order by q.id
`)) as unknown as { quote_id: string }[];

const inBasket = new Set(basket.map((q) => q.quote_id));
const instruments = structural.filter((q) => isValidationInstrument(q.scenario_label));
const leaked = instruments.filter((q) => inBasket.has(q.quote_id));
const wronglyDropped = structural.filter(
  (q) => !isValidationInstrument(q.scenario_label) && !inBasket.has(q.quote_id),
);

console.log("\nS-7 basket membership\n");
console.log(`  structure-bearing quotes      ${structural.length}`);
console.log(`  ${VALIDATION_NAMESPACE}* instruments${" ".repeat(9)}${instruments.length}`);
for (const q of instruments) console.log(`      ${q.quote_id}  ${q.scenario_label}`);
console.log(`  in the basket                 ${basket.length}`);
console.log("");

let failed = false;
if (leaked.length > 0) {
  failed = true;
  console.error(`  FAIL  ${leaked.length} validation instrument(s) entered the basket:`);
  for (const q of leaked) console.error(`          ${q.quote_id}  ${q.scenario_label}`);
}
if (wronglyDropped.length > 0) {
  failed = true;
  console.error(`  FAIL  ${wronglyDropped.length} non-validation quote(s) dropped from the basket:`);
  for (const q of wronglyDropped) console.error(`          ${q.quote_id}  ${q.scenario_label}`);
}
if (structural.length !== basket.length + instruments.length) {
  failed = true;
  console.error("  FAIL  the partition does not account for every structural quote.");
}

console.log(
  failed
    ? "  the exclusion is not behaving as specified.\n"
    : "  ok    every validation instrument is out, every other quote is in, and the\n" +
        "        two sets partition the estate exactly.\n",
);
process.exit(failed ? 1 : 0);
