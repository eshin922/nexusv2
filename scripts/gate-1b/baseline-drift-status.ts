/** READ-ONLY. Status of the quotes whose economics differ from the committed
 *  gate-1b baseline, to tell benign draft edits from a real regression. */
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";

const ids = process.argv.slice(2);
const rows = await db
  .select({
    id: quotes.id,
    status: quotes.status,
    label: quotes.scenarioLabel,
    updatedAt: quotes.updatedAt,
  })
  .from(quotes)
  .where(inArray(quotes.id, ids));

console.log("\nstatus   last updated               scenario");
for (const r of rows) {
  console.log(
    `  ${String(r.status).padEnd(8)} ${String(r.updatedAt ?? "—").slice(0, 24).padEnd(26)} ${r.label ?? "—"}`,
  );
}
process.exit(0);
