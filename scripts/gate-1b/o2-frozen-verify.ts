import { sql } from "drizzle-orm";
import { db } from "@/db";
import { postedAmountCents, centsToDecimal, POSTED_RATE_SCALE } from "@/lib/netsuite/posted-amount";
const rows = <T,>(r: unknown) => r as unknown as T[];
const Q = "c555a868-dabe-416a-b853-13ef7c770469";

const q = rows<any>(await db.execute(sql`
  select quote_number, status, sent_at is not null sent, pdf_url is not null pdf
    from quotes where id = ${Q}::uuid`))[0];
console.log("QUOTE", JSON.stringify(q));

const lines = rows<any>(await db.execute(sql`
  select l.display_name, t.tier_label, t.quantity, t.unit_rate, t.line_amount, t.pricing_state
    from quote_snapshot_lines l
    join quote_snapshot_line_tiers t on t.quote_snapshot_line_id = l.id
   where l.quote_snapshot_id in (select id from quote_snapshots where quote_id = ${Q}::uuid)
   order by l.position, t.tier_label`));

console.log(`\nFROZEN LINES (${lines.length})`);
const scaled = (r: string) => { const [w,f=""] = r.split("."); return BigInt(w)*10n**BigInt(POSTED_RATE_SCALE)+BigInt((f+"0".repeat(POSTED_RATE_SCALE)).slice(0,POSTED_RATE_SCALE)); };
let bad = 0;
for (const l of lines) {
  if (l.pricing_state !== "priced") { console.log(`  ${l.display_name} ${l.tier_label}  ${l.pricing_state}`); continue; }
  const posted = postedAmountCents(scaled(l.unit_rate), BigInt(l.quantity));
  const ok = centsToDecimal(posted) === Number(l.line_amount).toFixed(2);
  if (!ok) bad++;
  console.log(`  ${ok?"OK ":"BAD"} ${String(l.display_name).slice(0,26).padEnd(28)} ${l.tier_label.padEnd(7)} qty ${String(l.quantity).padStart(6)} x ${l.unit_rate} -> ${centsToDecimal(posted)} vs frozen ${Number(l.line_amount).toFixed(2)}`);
}
console.log(`\n${bad===0?"PASS":"FAIL"} — ${bad} line(s) where the provider would not reproduce the frozen amount`);
process.exit(bad===0?0:1);
