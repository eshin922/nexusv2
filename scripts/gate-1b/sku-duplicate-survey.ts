/**
 * READ-ONLY survey: does the catalog already contain duplicate SKUs?
 *
 * ── WHY THIS IS NOT A MIGRATION ───────────────────────────────────────────
 *
 * The structural guarantee for SKU uniqueness is a unique partial index on
 * `leaves.sku`. That is a TIGHTENING migration against a shared production
 * database: it fails to build if duplicates exist, and it binds every writer
 * at once. Neither is a thing to discover by attempting it.
 *
 * This answers the question the migration would need answered first, and
 * answers it without changing anything. It issues SELECTs only. There is no
 * INSERT, UPDATE, DELETE or DDL anywhere in this file, and adding one would
 * make it a different kind of artifact requiring a different authorisation.
 *
 * ── WHAT IT CAN AND CANNOT ESTABLISH ──────────────────────────────────────
 *
 * It reports the state of the Nexus `leaves` table at the moment it runs. It
 * does NOT establish that HubSpot's catalog is free of duplicates -- HubSpot
 * enforces uniqueness on `hs_sku` itself, but products Nexus has never pulled
 * are outside what this can see. And it cannot establish that no duplicate
 * will arise tomorrow: uniqueness is only as good as its weakest writer, and
 * the writers are enumerated below rather than assumed.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, unknown>;

function n(v: unknown): number {
  return Number(v ?? 0);
}

async function main() {
  const [{ database }] = (await db.execute(
    sql`select current_database() as database`,
  )) as unknown as Row[];
  console.log(`[survey] database = ${String(database)}`);
  console.log("[survey] READ-ONLY. No repair, no migration, no DDL.\n");

  // 1 · How many products carry a SKU at all.
  const [totals] = (await db.execute(sql`
    select
      count(*) as total,
      count(*) filter (where sku is not null and btrim(sku) <> '') as with_sku,
      count(*) filter (where sku is null or btrim(sku) = '') as without_sku,
      count(*) filter (where (sku is null or btrim(sku) = '') and archived = false) as without_sku_active
    from leaves
  `)) as unknown as Row[];

  console.log("PRODUCTS");
  console.log(`  total                     ${n(totals.total)}`);
  console.log(`  carrying a SKU            ${n(totals.with_sku)}`);
  console.log(`  without one               ${n(totals.without_sku)}`);
  console.log(`  without one, not archived ${n(totals.without_sku_active)}`);

  // 2 · Duplicates on the NORMALIZED value -- which is what the application
  // enforces. A constraint on the raw column would permit "dps-1" beside
  // "DPS-1", so the raw count is reported alongside to show the difference.
  const exact = (await db.execute(sql`
    select btrim(sku) as value, count(*) as n
      from leaves
     where sku is not null and btrim(sku) <> ''
     group by btrim(sku)
    having count(*) > 1
     order by count(*) desc, btrim(sku)
  `)) as unknown as Row[];

  const normalized = (await db.execute(sql`
    select upper(btrim(sku)) as value, count(*) as n,
           count(*) filter (where archived = false) as active_n
      from leaves
     where sku is not null and btrim(sku) <> ''
     group by upper(btrim(sku))
    having count(*) > 1
     order by count(*) desc, upper(btrim(sku))
  `)) as unknown as Row[];

  console.log("\nDUPLICATE SKUs");
  console.log(`  exact-match groups        ${exact.length}`);
  console.log(`  normalized-match groups   ${normalized.length}`);

  if (normalized.length > 0) {
    console.log("\n  (a unique index on the raw column would NOT catch the");
    console.log("   normalized-only collisions; the application check does)");
    for (const g of normalized.slice(0, 25)) {
      console.log(
        `    ${String(g.value).padEnd(28)} ${n(g.n)} products (${n(g.active_n)} active)`,
      );
      const members = (await db.execute(sql`
        select id, name, sku, archived, hubspot_product_id
          from leaves
         where upper(btrim(sku)) = ${String(g.value)}
         order by created_at
      `)) as unknown as Row[];
      for (const m of members) {
        console.log(
          `      · ${String(m.id).slice(0, 8)} "${String(m.name).slice(0, 44)}" ` +
            `sku=${JSON.stringify(m.sku)} archived=${m.archived} hs=${m.hubspot_product_id ?? "-"}`,
        );
      }
    }
    if (normalized.length > 25) {
      console.log(`    ... and ${normalized.length - 25} more groups not listed`);
    }
  }

  // 3 · The writers. Uniqueness is only as good as the weakest one, so they
  // are enumerated rather than assumed.
  console.log("\nWRITERS OF leaves.sku");
  console.log("  createLeaf            src/app/actions/leaves.ts   — NO uniqueness check");
  console.log("  updateLeaf            src/app/actions/leaves.ts   — checks, under a SKU lock");
  console.log("  pullProductsBatch     src/lib/hubspot-pull.ts     — NO uniqueness check (writes HubSpot's value verbatim)");
  console.log("  (index)               leaves_sku_idx              — NOT unique");

  console.log("\nVERDICT");
  if (normalized.length === 0) {
    console.log("  No duplicate SKUs today. A unique partial index WOULD build.");
    console.log("  It is still not proposed here: two of the three writers do not");
    console.log("  enforce uniqueness, so the index would start refusing writes");
    console.log("  those paths currently make, and that is a change to their");
    console.log("  behaviour rather than a constraint on data. Catalog-wide");
    console.log("  uniqueness stays OPEN until every writer enforces it.");
  } else {
    console.log(`  ${normalized.length} duplicate group(s) exist. A unique index would FAIL to`);
    console.log("  build until they are resolved, and resolving them is a production");
    console.log("  data decision that is not authorized here.");
  }
}

await main();
process.exit(0);
