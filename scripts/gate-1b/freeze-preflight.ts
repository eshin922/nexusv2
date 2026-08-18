/**
 * Pre-flight for migration 0087 (frozen commercial line set) — READ-ONLY.
 *
 * 0087 is purely ADDITIVE: three new tables and three new enums, no ALTER of
 * anything existing. So the deployed-writer compatibility proof a tightening
 * migration needs does not apply — there is nothing existing code could
 * violate. What still needs checking is the pending set, because
 * `drizzle-kit migrate` applies EVERY pending migration, not the one being
 * discussed.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const applied = await db.execute(
  sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
);
console.log("journal rows applied :", (applied as unknown as Array<{ n: number }>)[0].n);

const present = await db.execute(sql`
  select table_name from information_schema.tables
   where table_name in ('quote_snapshot_lines','quote_snapshot_line_tiers',
                        'quote_snapshot_tier_totals')`);
console.log("target tables present:", (present as unknown as Array<{ table_name: string }>).map((r) => r.table_name));
process.exit(0);
