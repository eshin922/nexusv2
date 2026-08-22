/**
 * Does `loadUnresolvedQuoteCosts()` expose a trustworthy structural freight
 * discriminator?  READ-ONLY.
 *
 * The question is not "can I tell freight rows apart today" — a null-pattern
 * might happen to be unique on current data.  It is whether the payload
 * DECLARES origin, or whether a reader has to INFER it.  So this resolves each
 * row's TRUE origin from the database (does `assemblyLeafId` name a
 * `freight_subcategories` row or an `assembly_leaves` row?) and tabulates that
 * against the null-pattern a reader would have to use.
 */
import { db } from "@/db";
import { quotes, projects, freightSubcategories, assemblyLeaves } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { loadUnresolvedQuoteCosts } from "@/lib/quote-cost-completeness";

const rows = await db
  .select({ id: quotes.id, label: quotes.scenarioLabel, project: projects.dealName })
  .from(quotes)
  .innerJoin(projects, eq(projects.id, quotes.projectId));

const fs = new Set((await db.select({ id: freightSubcategories.id }).from(freightSubcategories)).map((r) => r.id));
const al = new Set((await db.select({ id: assemblyLeaves.id }).from(assemblyLeaves)).map((r) => r.id));

// null-pattern a reader would use  ->  true origin  ->  count
const table = new Map<string, number>();
let scanned = 0, withRows = 0;

for (const q of rows) {
  let unresolved;
  try { unresolved = await loadUnresolvedQuoteCosts(q.id); }
  catch (e) { console.log(`READ_FAILED ${q.id} ${(e as Error).message.slice(0, 80)}`); continue; }
  scanned++;
  if (unresolved.length) withRows++;
  for (const r of unresolved) {
    const pattern = `qL=${r.quoteLeafId === null ? "null" : "set"} aL=${r.assemblyLeafId === null ? "null" : "set"}`;
    const origin =
      r.assemblyLeafId === null
        ? (r.quoteLeafId === null ? "configuration" : "packaging(direct-component)")
        : fs.has(r.assemblyLeafId) ? "FREIGHT"
        : al.has(r.assemblyLeafId) ? "packaging(legacy-assembly)"
        : "UNRESOLVABLE-ID";
    // The declared field vs the DB-resolved truth. Any disagreement is a
    // producer bug and must show up here, not as silently misrouted work.
    const declaredFreight = r.source === "freight";
    const trulyFreight = origin === "FREIGHT";
    if (declaredFreight !== trulyFreight) {
      console.log(`MISMATCH source=${r.source} true=${origin} row=${r.lineGroupId}`);
      process.exitCode = 1;
    }
    const key = `${pattern}  ->  ${origin}  [source=${r.source}]`;
    table.set(key, (table.get(key) ?? 0) + 1);
  }
}

console.log(`\nQUOTES_SCANNED ${scanned}   WITH_UNRESOLVED_ROWS ${withRows}`);
console.log("\nPATTERN A READER MUST INFER FROM   ->   TRUE ORIGIN (resolved against the DB)");
for (const [k, v] of [...table].sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);

// Does the payload carry ANY declared origin field?
const sample = (await loadUnresolvedQuoteCosts(rows[0]!.id))[0];
console.log("\nPAYLOAD KEYS:", sample ? Object.keys(sample).join(", ") : "(no row to sample)");
process.exit(0);
