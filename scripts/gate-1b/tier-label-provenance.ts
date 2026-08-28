/** READ-ONLY. Provenance of the malformed quote_tiers.label.
 *
 *  Which row, when it changed, what the audit trail says the writer was, and
 *  whether any other label in the population is anomalous. Answers nothing
 *  about cause on its own — it supplies the evidence the trace reasons over.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = <T,>(r: unknown) => r as unknown as T[];
const NL = String.fromCharCode(10);

const hasControl = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

const shape = (s: string) => {
  let breaks = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13) breaks++;
    else if (c < 0x20 || c === 0x7f) other++;
  }
  return `len=${s.length} linebreaks=${breaks} otherControl=${other}`;
};

console.log("=".repeat(74));
console.log("A · POPULATION SWEEP — every quote_tiers.label on the shared database");
console.log("=".repeat(74));

const all = rows<{ id: string; qid: string; label: string; n: string }>(
  await db.execute(sql`select id::text, quote_id::text qid, label, length(label)::text n
                         from quote_tiers order by length(label) desc, label`),
);
console.log(`  ${all.length} tier rows total`);

const long = all.filter((r) => Number(r.n) > 24);
console.log(`  longer than 24 chars     : ${long.length}`);
for (const r of long) {
  console.log(`    ${r.id}  quote=${r.qid}`);
  console.log(`      ${shape(r.label)}  ${JSON.stringify(r.label.slice(0, 90))}`);
}

const ctrl = all.filter((r) => hasControl(r.label));
console.log(`  containing control chars : ${ctrl.length}`);
for (const r of ctrl) console.log(`    ${r.id}  ${shape(r.label)}`);

const distinct = [...new Set(all.map((r) => r.label))].sort();
console.log(`  distinct labels (${distinct.length}):`);
console.log(`    ${distinct.map((d) => JSON.stringify(d)).join("  ")}`);
console.log(`  longest label present    : ${Math.max(...all.map((r) => r.label.length))} chars`);

const QUOTE = process.argv[2];
if (!QUOTE) {
  console.log(NL + "  (no quote id passed; stopping after the sweep)");
  process.exit(0);
}

console.log();
console.log("=".repeat(74));
console.log(`B · TIER ROWS of ${QUOTE}`);
console.log("=".repeat(74));

const tiers = rows<{ id: string; label: string; qty: string; so: string; ua: string; ca: string }>(
  await db.execute(sql`select id::text, label, qty::text, sort_order::text so,
                              updated_at::text ua, created_at::text ca
                         from quote_tiers where quote_id=${QUOTE}::uuid order by sort_order`),
);
if (!tiers.length) {
  console.log("  NO TIER ROWS — wrong quote id");
  process.exit(1);
}
for (const t of tiers) {
  console.log(`  ${t.id}  sort=${t.so} qty=${t.qty}  ${JSON.stringify(t.label)}`);
  console.log(`      created=${t.ca}`);
  console.log(`      updated=${t.ua}`);
}

console.log();
console.log("=".repeat(74));
console.log("C · AUDIT TRAIL for those tier rows");
console.log("=".repeat(74));

const idList = sql.raw(tiers.map((t) => `'${t.id}'`).join(","));
const audits = rows<{
  id: string; action: string; ent: string; eid: string;
  at: string; uid: string | null; email: string | null; diff: unknown;
}>(
  await db.execute(sql`select a.id::text, a.action, a.entity_type ent, a.entity_id eid,
                              a.created_at::text at, a.user_id::text uid, u.email, a.diff_json diff
                         from audit_log a left join users u on u.id = a.user_id
                        where a.entity_id in (${idList})
                        order by a.created_at`),
);
console.log(`  ${audits.length} audit rows`);
for (const a of audits) {
  const d = JSON.stringify(a.diff ?? null);
  console.log(NL + `  [${a.at}] action=${a.action}  entity=${a.ent}:${a.eid.slice(0, 8)}`);
  console.log(`      actor : ${a.email ?? "(no user row)"}  user_id=${a.uid ?? "NULL"}`);
  console.log(`      diff  : ${d.length > 900 ? d.slice(0, 900) + ` ...[${d.length} chars total]` : d}`);
}

process.exit(0);
