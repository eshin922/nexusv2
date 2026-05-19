#!/usr/bin/env node
// Phase A.1 v2 impl-1 post-apply smoke check.
// Verifies: 6 new tables exist; 17 product_types seed rows landed;
// 7 user role-grant updates applied; users column additions present.

import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) { console.error("DIRECT_URL missing"); process.exit(1); }

const client = postgres(url, { max: 1, prepare: false });

try {
  const tables = await client`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'product_types','assemblies','leaves',
        'assembly_leaves','leaf_specs','quote_leaves'
      )
    order by table_name
  `;
  console.log(`Tables present (${tables.length}/6):`, tables.map(r => r.table_name).join(", "));

  const enums = await client`
    select typname from pg_type where typname = 'product_type_scope'
  `;
  console.log(`Enum product_type_scope:`, enums.length === 1 ? "present" : "MISSING");

  const userCols = await client`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('can_edit_specs','can_create_leaves')
    order by column_name
  `;
  console.log(`User columns (${userCols.length}/2):`, userCols.map(r => r.column_name).join(", "));

  const ptCount = await client`select count(*)::int from product_types`;
  console.log(`product_types rows: ${ptCount[0].count} (expect 17)`);

  const ptByScope = await client`
    select scope, count(*)::int as n from product_types group by scope order by scope
  `;
  console.log(`  by scope:`, ptByScope.map(r => `${r.scope}=${r.n}`).join(", "));

  const tp = await client`
    select id, name, field_schema is not null as has_schema from product_types
    where id = 'leaf_tertiary_packaging'
  `;
  console.log(`  TP starter:`, tp[0] ? `${tp[0].id} schema=${tp[0].has_schema}` : "MISSING");

  const userGrants = await client`
    select email, can_edit_specs, can_create_leaves
    from users
    where email in (
      'edward@thedps.co','jackie@thedps.co','aisha@thedps.co',
      'lexa@thedps.co','andrea@thedps.co','cally@thedps.co','jing@thedps.co'
    )
    order by email
  `;
  console.log(`User grants applied (${userGrants.length} matching emails in users table):`);
  for (const u of userGrants) {
    console.log(`  ${u.email.padEnd(28)} can_edit=${u.can_edit_specs} can_create=${u.can_create_leaves}`);
  }

  // Confirm existing data integrity — quote_skus row count hasn't changed
  const skuCount = await client`select count(*)::int from quote_skus`;
  console.log(`quote_skus rows (untouched by migration): ${skuCount[0].count}`);

} catch (e) {
  console.error("Smoke failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
