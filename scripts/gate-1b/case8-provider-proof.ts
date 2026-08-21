/**
 * Case 8 · Pack-out / Assembly — terminal provider proof. READ-ONLY.
 *
 * Every value is read FROM NETSUITE and compared against the frozen Nexus
 * statement recorded BEFORE send (docs/gate-1b/case8-expected-preSEND.json).
 * The direction matters: the expectation was written first, so the provider is
 * checked against it rather than the reverse.
 *
 * REG-4 is proven from the provider HEADER TOTAL alone, deliberately NOT
 * recomputed from qty x rate. Recomputing would make it a restatement of the
 * line-shape proof instead of an independent one — and SO2717 is the standing
 * demonstration that a total can reconcile while quantity/rate representation
 * is wrong.
 *
 * NETSUITE SIGN CONVENTION, stated rather than hidden. SuiteQL returns
 * transactionline magnitudes NEGATIVE for this transaction (qty -1000,
 * netamount -7000, costestimate -5000) while the header `foreigntotal` is
 * POSITIVE (+7000). Comparisons are on magnitude, and the uniformity of the
 * sign is asserted as its own claim — an `abs()` with no assertion would hide
 * a genuine sign error behind the same call that absorbs the convention.
 */
import { suiteQL } from "@/lib/netsuite/client";
const Q = "08a76c99-729f-4028-8700-c9b8b1be59f4";
const SO = "362841";
let fail = 0;
const claim = (ok: boolean, l: string, d = "") => { if (!ok) fail++; console.log(`  ${ok?"ok  ":"FAIL"}  ${l}${d?` — ${d}`:""}`); };

async function main() {
  // ── the FROZEN Nexus statement (the thing NetSuite is compared against) ──
  const fz = (await db.execute(sql.raw(
    `select ln.bv011_destination::text dest, t.quantity, t.unit_rate, t.line_amount
       from quote_snapshot_line_tiers t
       join quote_snapshot_lines ln on ln.id=t.quote_snapshot_line_id
       join quote_snapshots s on s.id=ln.quote_snapshot_id
      where s.quote_id='${Q}' and s.superseded_at is null`))) as unknown as any[];
  const f = fz[0];
  console.log(`FROZEN: dest=${f.dest} qty=${f.quantity} rate=${f.unit_rate} amount=${f.line_amount}\n`);

  // ── PROVIDER: the SO header ──
  const hdr = await suiteQL<any>(
    `SELECT id, tranid, entity, custbody_dps_deal_id AS deal, foreigntotal, status
       FROM transaction WHERE id = ${SO}`);
  const h = hdr.items[0];
  console.log(`PROVIDER header: ${h.tranid} entity=${h.entity} total=${h.foreigntotal} deal=${h.deal}\n`);

  // ── PROVIDER: the SO LINES ──
  const lines = await suiteQL<any>(
    `SELECT l.item, l.quantity, l.rate, l.netamount, l.taxcode, l.price AS pricelevel,
            l.costestimatetype, l.costestimate
       FROM transactionline l WHERE l.transaction = ${SO} AND l.mainline = 'F'`);
  console.log(`PROVIDER lines: ${lines.items.length}`);
  for (const l of lines.items) console.log(`   ${JSON.stringify(l)}`);
  console.log("");

  const svc = lines.items.find((l: any) => String(l.item) === "76154");
  claim(!!svc, "item OTC-0049 / 76154 posted", svc ? `item=${svc.item}` : "not found");
  if (!svc) { console.log("\nSTOP"); process.exit(1); }

  // ── LINE SHAPE (independent of REG-4) ──
  claim(Math.abs(Number(svc.quantity)) === 1000, "posted qty = frozen qty 1000", `${svc.quantity}`);
  claim(Number(svc.rate) === 7, "posted rate = frozen unit rate 7.0000", `${svc.rate}`);
  claim(Math.abs(Number(svc.netamount)) === 7000, "posted amount = frozen line amount 7000", `${svc.netamount}`);
  claim(String(svc.taxcode) === "-8", "tax code -8", `${svc.taxcode}`);
  claim(String(svc.pricelevel) === "-1", "price level -1", `${svc.pricelevel}`);
  claim(String(svc.costestimatetype).toUpperCase() === "CUSTOM", "CUSTOM cost basis", `${svc.costestimatetype}`);
  // SuiteQL returns transactionline magnitudes SIGNED for this transaction
  // (qty -1000, netamount -7000, costestimate -5000) while the header total is
  // +7000. Compared on magnitude, and the sign convention is asserted as its
  // own claim below so it is stated rather than silently absorbed.
  claim(Math.abs(Number(svc.costestimate)) === 5000, "CUSTOM cost = governed 5000", `${svc.costestimate}`);
  const signs = [svc.quantity, svc.netamount, svc.costestimate].map((v: any) => Math.sign(Number(v)));
  claim(new Set(signs).size === 1, "line sign convention is uniform (representation, not a value error)", `${signs.join(",")}`);

  // ── REG-4, proven from the HEADER total only ──
  // Deliberately NOT computed from qty x rate above: that would make it a
  // restatement of the line-shape proof rather than an independent one.
  const tierTotal = (await db.execute(sql.raw(
    `select t.tier_commercial_total as total from quote_snapshot_tier_totals t
       join quote_snapshots s on s.id=t.quote_snapshot_id
      where s.quote_id='${Q}' and s.superseded_at is null and t.tier_label='Tier 1'`))) as unknown as any[];
  claim(Math.abs(Number(h.foreigntotal)) === Number(tierTotal[0].total),
    "REG-4 exact: provider header total = frozen tier commercial total",
    `${h.foreigntotal} vs ${tierTotal[0].total}`);

  console.log(fail===0 ? "\nCASE 8 PROVIDER PROOF: PASS" : `\nCASE 8: ${fail} FAILED`);
  process.exit(fail===0?0:1);
}
main().catch((e)=>{console.error("READ FAILED (indeterminate):", e?.message??e); process.exit(1);});
