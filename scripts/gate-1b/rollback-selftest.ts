/** Verifies the rolled-back-transaction mechanism the lifecycle proof relies
 *  on ACTUALLY rolls back, before that proof runs destructive statements
 *  against the shared database. An unverified rollback is not a safety
 *  measure, it is an assumption with a blast radius. */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const quoteId = process.argv[2];
const rows = <T,>(r: unknown) => r as unknown as T[];
const read = async (x: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) =>
  rows<{ v: string | null }>(await x.execute(
    sql`select target_margin_pct::text as v from quotes where id=${quoteId}::uuid`))[0].v;

const before = await read(db);
let inside: string | null = null;
const SENT = "__rollback__";
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`update quotes set target_margin_pct = 0.7777 where id=${quoteId}::uuid`);
    inside = await read(tx as never);
    throw new Error(SENT);
  });
} catch (e) {
  if (!(e instanceof Error) || e.message !== SENT) throw e;
}
const after = await read(db);
console.log(`\n  before ${before}\n  inside ${inside}   <- the write is visible in-transaction`);
console.log(`  after  ${after}   <- and gone afterwards`);
const ok = inside === "0.7777" && after === before;
console.log(ok
  ? "\n  ROLLBACK MECHANISM VERIFIED — writes land inside, vanish outside.\n"
  : "\n  ROLLBACK MECHANISM UNSAFE — do not run the lifecycle proof.\n");
process.exit(ok ? 0 : 1);
