/**
 * Gate 1A — capture the facts the post-backfill proof asserts against.
 * READ ONLY.
 *
 * The global semantic digest already covers action, entity, summary, label and
 * diff_json. What it does NOT cover is user_id and the FK behaviour on it, and
 * those are exactly what a backfill touching actor columns must be shown not to
 * have disturbed. Captured here, before the write, because afterwards there is
 * nothing to compare to.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const [ids] = (await db.execute(sql`
  select md5(string_agg(concat_ws('|', id::text, coalesce(user_id::text,'')), E'\n' order by id)) as user_id_digest,
         count(*)::text as rows,
         count(user_id)::text as with_user_id
    from audit_log
`)) as unknown as { user_id_digest: string; rows: string; with_user_id: string }[];

const fks = (await db.execute(sql`
  select con.conname, con.confdeltype, a.attname as column_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute a on a.attrelid = rel.oid and a.attnum = k.attnum
   where rel.relname = 'audit_log' and con.contype = 'f'
   order by con.conname
`)) as unknown as { conname: string; confdeltype: string; column_name: string }[];

console.log(JSON.stringify({ ...ids, foreign_keys: fks }, null, 2));
process.exit(0);
