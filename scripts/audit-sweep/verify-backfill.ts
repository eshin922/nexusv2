/**
 * Gate 1A — post-backfill proof. READ ONLY.
 *
 * Asserts the seven things the backfill claims:
 *
 *   1. every row with a human actor carries actor_user_id, equal to user_id
 *   2. every such row carries a non-empty actor_display_name
 *   3. user_id values and the FK delete rules on audit_log are untouched
 *   4. the 98 (action, entity_type) pairs are unchanged
 *   5. all 98 structural digests are unchanged
 *   6. the ORIGINAL global semantic digest — computed over the pre-existing
 *      columns only, excluding the two new snapshot columns — is unchanged
 *   7. no commercial or entity audit content changed, which 5 and 6 together
 *      are what establish
 *
 * Point 6 is the load-bearing one. A digest that included the new columns
 * would necessarily change and would prove nothing; excluding them is what
 * makes "the backfill added identity and altered no record" a testable claim
 * rather than an assurance.
 *
 * Also checks that every backfilled display name AGREES with what
 * writeAuditEntry would produce for that actor today. The SQL in the migration
 * mirrors displayNameFor(); if the two ever drift, historical terminals and
 * runtime terminals would render differently for the same person.
 */

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveActorDisplayName } from "@/lib/audit";

// Pre-backfill facts, captured by capture-prebackfill.ts before the write.
const PRE = {
  globalSemanticDigest: "fa0056de3b25c5758213cdf57a4bddb0",
  userIdDigest: "9465c838fbd6e95ec229e82ab19caa4d",
  rows: "2701",
  withUserId: "2701",
  // 'n' = ON DELETE SET NULL. actor_user_id deliberately carries no FK.
  foreignKeys: [
    { conname: "audit_log_caused_by_audit_id_audit_log_id_fk", confdeltype: "n", column_name: "caused_by_audit_id" },
    { conname: "audit_log_user_id_users_id_fk", confdeltype: "n", column_name: "user_id" },
  ],
};

let failed = false;
const fail = (m: string) => {
  failed = true;
  console.error(`  FAIL  ${m}`);
};
const pass = (m: string) => console.log(`  ok    ${m}`);

const all = async <T>(q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];
const one = async <T>(q: ReturnType<typeof sql>): Promise<T> => (await all<T>(q))[0];

console.log("\nGate 1A — post-backfill proof\n");

// ------------------------------------------------ 1 & 2 · actor population
const cover = await one<{
  rows: string;
  human: string;
  actor_id: string;
  actor_id_matches: string;
  named: string;
  machine_rows: string;
}>(sql`
  select count(*)::text                                                         as rows,
         count(*) filter (where user_id is not null)::text                       as human,
         count(*) filter (where user_id is not null and actor_user_id is not null)::text as actor_id,
         count(*) filter (where user_id is not null and actor_user_id = user_id)::text   as actor_id_matches,
         count(*) filter (where user_id is not null
                            and actor_display_name is not null
                            and btrim(actor_display_name) <> '')::text           as named,
         count(*) filter (where user_id is null)::text                           as machine_rows
    from audit_log
`);

if (cover.rows === PRE.rows) pass(`${cover.rows} rows — count unchanged`);
else fail(`row count ${PRE.rows} -> ${cover.rows}`);

if (cover.actor_id === cover.human && cover.human === PRE.withUserId)
  pass(`${cover.actor_id}/${cover.human} actor_user_id populated where a human actor exists`);
else fail(`actor_user_id populated on ${cover.actor_id} of ${cover.human} human-actor rows`);

if (cover.actor_id_matches === cover.human)
  pass("actor_user_id equals user_id on every one — snapshot, not re-derivation");
else fail(`${cover.actor_id_matches} of ${cover.human} have actor_user_id = user_id`);

if (cover.named === cover.human)
  pass(`${cover.named}/${cover.human} actor_display_name non-empty`);
else fail(`actor_display_name empty or null on ${Number(cover.human) - Number(cover.named)} row(s)`);

if (cover.machine_rows === "0") pass("no machine-authored rows present");
else
  console.log(
    `  --    ${cover.machine_rows} row(s) with no user_id — machine-authored, left for the system-actor contract`,
  );

// ------------------------------------------------------ display-name agreement
const names = await all<{ user_id: string; actor_display_name: string; rows: string }>(sql`
  select distinct user_id::text as user_id, actor_display_name, count(*)::text as rows
    from audit_log
   where user_id is not null
   group by 1, 2
   order by 1
`);
let nameDrift = 0;
for (const n of names) {
  const live = await resolveActorDisplayName(n.user_id);
  if (live !== n.actor_display_name) {
    nameDrift += 1;
    fail(`actor ${n.user_id.slice(0, 8)}: backfilled "${n.actor_display_name}", writer would produce "${live}"`);
  }
}
if (nameDrift === 0)
  pass(
    `${names.length} distinct actor identit${names.length === 1 ? "y" : "ies"} — backfilled names match what the writer produces`,
  );

// ------------------------------------------------------- 3 · user_id and FKs
const [uid] = await all<{ user_id_digest: string }>(sql`
  select md5(string_agg(concat_ws('|', id::text, coalesce(user_id::text,'')), E'\n' order by id)) as user_id_digest
    from audit_log
`);
if (uid.user_id_digest === PRE.userIdDigest) pass(`user_id values unchanged (${uid.user_id_digest})`);
else fail(`user_id digest ${PRE.userIdDigest} -> ${uid.user_id_digest}`);

const fks = await all<{ conname: string; confdeltype: string; column_name: string }>(sql`
  select con.conname, con.confdeltype, a.attname as column_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute a on a.attrelid = rel.oid and a.attnum = k.attnum
   where rel.relname = 'audit_log' and con.contype = 'f'
   order by con.conname
`);
const fkNow = JSON.stringify(fks.map((f) => [f.conname, f.confdeltype, f.column_name]));
const fkPre = JSON.stringify(PRE.foreignKeys.map((f) => [f.conname, f.confdeltype, f.column_name]));
if (fkNow === fkPre) pass("foreign keys and delete rules unchanged; actor_user_id still carries none");
else fail(`foreign keys changed:\n        was ${fkPre}\n        now ${fkNow}`);

// --------------------------------------------- 4, 5, 6 · vocabulary and content
type VocabRow = { action: string; entity_type: string; rows: string; with_summary: string; with_label: string; with_diff: string };
type DigestRow = { action: string; entity_type: string; shape_digest: string; rows: string };
const key = (r: { action: string; entity_type: string }) => `${r.action} ${r.entity_type}`;

const vocabNow = await all<VocabRow>(sql`
  select action, entity_type,
         count(*)::text as rows,
         count(*) filter (where summary is not null)::text      as with_summary,
         count(*) filter (where entity_label is not null)::text as with_label,
         count(*) filter (where diff_json is not null)::text    as with_diff
    from audit_log group by 1, 2 order by 1, 2
`);
const digestsNow = await all<DigestRow>(sql`
  select action, entity_type,
         md5(string_agg(concat_ws('|', entity_id, coalesce(summary,''), coalesce(entity_label,''),
             coalesce((select string_agg(k,',' order by k) from jsonb_object_keys(diff_json) k),'')),
             E'\n' order by id)) as shape_digest,
         count(*)::text as rows
    from audit_log group by 1, 2 order by 1, 2
`);
// Deliberately EXCLUDES actor_user_id and actor_display_name. Including them
// would guarantee a change and prove nothing.
const [globalRow] = await all<{ digest: string }>(sql`
  select md5(string_agg(concat_ws('|', id::text, action, entity_type, entity_id,
           coalesce(summary,''), coalesce(entity_label,''), coalesce(diff_json::text,'')),
           E'\n' order by id)) as digest
    from audit_log
`);

const vocabBase = JSON.parse(readFileSync("docs/audit-sweep/baseline-vocabulary.json", "utf8")) as VocabRow[];
const digestBase = JSON.parse(readFileSync("docs/audit-sweep/baseline-shape-digests.json", "utf8")) as DigestRow[];

const baseKeys = new Set(vocabBase.map(key));
const nowKeys = new Set(vocabNow.map(key));
if (baseKeys.size === nowKeys.size && [...nowKeys].every((k) => baseKeys.has(k)))
  pass(`${vocabNow.length} (action, entity_type) pairs — identical set`);
else fail("action/entity vocabulary changed");

const nowByKey = new Map(vocabNow.map((r) => [key(r), r]));
let drift = 0;
for (const b of vocabBase) {
  const n = nowByKey.get(key(b));
  if (!n) continue;
  for (const f of ["rows", "with_summary", "with_label", "with_diff"] as const) {
    if (b[f] !== n[f]) {
      drift += 1;
      fail(`${b.action} / ${b.entity_type}: ${f} ${b[f]} -> ${n[f]}`);
    }
  }
}
if (drift === 0) pass("row counts and summary/label/diff presence unchanged on every pair");

const nowDigest = new Map(digestsNow.map((r) => [key(r), r.shape_digest]));
let digestDrift = 0;
for (const b of digestBase) {
  if (nowDigest.get(key(b)) !== b.shape_digest) {
    digestDrift += 1;
    fail(`${b.action} / ${b.entity_type}: structural digest changed`);
  }
}
if (digestDrift === 0) pass(`${digestBase.length} structural digests identical`);

if (globalRow.digest === PRE.globalSemanticDigest)
  pass(`global semantic digest ${globalRow.digest} — unchanged, excluding the two snapshot columns`);
else fail(`global semantic digest ${PRE.globalSemanticDigest} -> ${globalRow.digest}`);

console.log(
  failed
    ? "\nBACKFILL PROOF: FAILED\n"
    : "\nBACKFILL PROOF: identity was added to every historical row; no audit record was altered.\n",
);
process.exit(failed ? 1 : 0);
