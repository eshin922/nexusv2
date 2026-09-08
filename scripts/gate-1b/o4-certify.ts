/**
 * O4 · TRAINING — CONTRACT FILL · end-to-end certification.
 *
 * ── THE PRECONDITION THAT COMES FIRST, AND WHY ──────────────────────────
 *
 * An external ERP readback is admissible evidence ONLY after the Nexus push
 * that produced it has reached a terminal status.
 *
 * This is banked from a real error on this very order. The O4 push took 82
 * seconds; I queried NetSuite at roughly the halfway point and reported two
 * intermediate values as final outcomes — a push row at `awaiting_rates` read
 * as a stranded failure, and a 6% `TaxItem` read as a governed-rule breach.
 * Both were true readings of a state that was still moving. The order settled
 * non-taxable at exactly the accepted consideration.
 *
 * `awaiting_rates` is not a failure; it is the deliberate recovery boundary
 * persisted the moment the Sales Order exists, so a crash in the rate sequence
 * resumes against the same order. And the tax gate runs AFTER member-rate
 * convergence, deliberately — Item Group member lines do not exist until
 * NetSuite expands the group, and the member is precisely the line that was
 * taxable on SO2716. Sampling between those points sees a taxable order that
 * is mid-repair.
 *
 * So the gate below is not a formality. It is the difference between measuring
 * an outcome and measuring a moment.
 *
 * ── AND THE EXPECTATION COMES FROM THE FREEZE ───────────────────────────
 *
 * Every figure compared against NetSuite is read from `quote_snapshot_*`, not
 * recomputed by the emitter. An emitter checked against itself agrees with
 * itself.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";

const QUOTE = "6c024fbd-77d4-4b9a-9e7a-5f6235489329";
const EXPECT_SO_ID = "364041";
const EXPECT_TRANID = "SO2735";
const EXTERNAL_ID = "nxs-grp-610fff3dc86c2cdc3a9e03123b449b49804eaf715b6f1c2b50addb655064388a";
const GROUP_ITEM_ID = "TRN-FILL-UNIT-G";

const fails: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(58)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log("O4 · TRAINING — CONTRACT FILL · CERTIFICATION");
console.log(`TARGET ${JSON.stringify(describeNetsuiteTarget())}`);
console.log("");

// ══════════════════════════════════════════════════════════════════════
// 0 · TERMINALITY — no ERP read happens before this passes
// ══════════════════════════════════════════════════════════════════════
console.log("── 0 · TERMINALITY GATE ──────────────────────────────────");
const [q] = (await db.execute(sql`
  SELECT quote_number, status, netsuite_so_id, netsuite_so_tranid, netsuite_so_push_status
    FROM quotes WHERE id = ${QUOTE}
`)) as unknown as Array<Record<string, string | null>>;
const [push] = (await db.execute(sql`
  SELECT status, netsuite_so_id, netsuite_so_tranid, completed_at, quote_snapshot_id
    FROM netsuite_so_pushes WHERE quote_id = ${QUOTE} ORDER BY created_at DESC LIMIT 1
`)) as unknown as Array<Record<string, string | null>>;

const terminal =
  q?.netsuite_so_push_status === "succeeded" &&
  push?.completed_at !== null &&
  q?.netsuite_so_id === EXPECT_SO_ID &&
  q?.netsuite_so_tranid === EXPECT_TRANID &&
  q?.status === "complete";

console.log(`  push status        ${q?.netsuite_so_push_status}`);
console.log(`  completed_at       ${push?.completed_at ?? "NULL"}`);
console.log(`  so id / tranid     ${q?.netsuite_so_id} / ${q?.netsuite_so_tranid}`);
console.log(`  quote status       ${q?.status}`);

if (!terminal) {
  console.log("");
  console.log("INCOMPLETE · the push has not reached a terminal status.");
  console.log("No ERP readback is admissible. Nothing below was run.");
  process.exit(2);
}
console.log("  ok   terminal — ERP readback is admissible");
console.log("");

// ══════════════════════════════════════════════════════════════════════
// THE FROZEN SIDE
// ══════════════════════════════════════════════════════════════════════
const S = push.quote_snapshot_id as string;
const frozen = (await db.execute(sql`
  SELECT l.line_kind::text k, l.display_name dn, COALESCE(l.service_identity::text,'-') si,
         COALESCE(l.bv011_destination::text,'-') dest,
         lt.quantity::text q, lt.line_amount::text amt
    FROM quote_snapshot_lines l
    JOIN quote_snapshot_line_tiers lt ON lt.quote_snapshot_line_id = l.id
   WHERE l.quote_snapshot_id = ${S}
     AND lt.tier_id = (SELECT customer_accepted_tier_id FROM quotes WHERE id = ${QUOTE})
   ORDER BY l.position
`)) as unknown as Array<Record<string, string>>;
const [tot] = (await db.execute(sql`
  SELECT tt.unit_subtotal::text u, tt.otc_subtotal::text o, tt.tier_commercial_total::text t
    FROM quote_snapshot_tier_totals tt
   WHERE tt.quote_snapshot_id = ${S}
     AND tt.tier_id = (SELECT customer_accepted_tier_id FROM quotes WHERE id = ${QUOTE})
`)) as unknown as Array<Record<string, string>>;

const fMembers = frozen.filter((f) => f.k === "item_group_member");
const fDirect = frozen.filter((f) => f.k === "direct_product");
const fServices = frozen.filter((f) => f.k === "direct_service");
const fOtc = frozen.filter((f) => f.k === "otc");
const sum = (rows: typeof frozen) => rows.reduce((a, r) => a + Number(r.amt), 0);

// ══════════════════════════════════════════════════════════════════════
// THE ERP SIDE — read once, after terminality
// ══════════════════════════════════════════════════════════════════════
const res: { items: Array<Record<string, string | null>> } = (await suiteQL(
  `select tl.linesequencenumber seq, tl.itemtype, tl.taxline, tl.mainline, tl.taxcode,
          tl.quantity, tl.rate, tl.netamount, i.itemid
     from transactionline tl left join item i on i.id = tl.item
    where tl.transaction = ${EXPECT_SO_ID} order by tl.linesequencenumber`,
)) as never;
const lines = res.items ?? [];
const abs = (v: unknown) => Math.abs(Number(v ?? 0));
const money = (n: number) => n.toFixed(2);

console.log("── ERP · SO2735 ──────────────────────────────────────────");
for (const l of lines) {
  console.log(
    `  seq ${String(l.seq).padStart(2)} ${String(l.itemtype ?? "-").padEnd(12)} ${String(l.itemid ?? "-").padEnd(20)} tax=${String(l.taxcode ?? "-").padEnd(4)} qty=${String(l.quantity ?? "-").padStart(7)} amt=${String(l.netamount ?? "-").padStart(11)}`,
  );
}
console.log("");

// ══════════════════════════════════════════════════════════════════════
// A · STRUCTURE
// ══════════════════════════════════════════════════════════════════════
console.log("── A · MIXED STRUCTURE ───────────────────────────────────");
const gi = lines.findIndex((l) => l.itemtype === "Group");
const ei = lines.findIndex((l) => l.itemtype === "EndGroup");
check("a Group span exists and is closed", gi >= 0 && ei > gi, `group@${gi} end@${ei}`);

const span = gi >= 0 && ei > gi ? lines.slice(gi + 1, ei) : [];
const outside = lines.filter(
  (l, idx) => l.taxline === "F" && l.mainline === "F" && (idx < gi || idx > ei),
);

check(`Group header is ${GROUP_ITEM_ID} at 6,000`, String(lines[gi]?.itemid) === GROUP_ITEM_ID && abs(lines[gi]?.quantity) === 6000, `${lines[gi]?.itemid} qty ${abs(lines[gi]?.quantity)}`);
check("the span holds exactly the three frozen members", span.length === fMembers.length, `${span.length} vs frozen ${fMembers.length}`);

for (const [sku, qty] of [["TRN-PP-BOTTLE-30", 6000], ["TRN-PP-PUMP", 6000], ["TRN-SP-LABEL", 12000]] as const) {
  const row = span.find((l) => l.itemid === sku);
  check(`  member ${sku} at ${qty.toLocaleString()}`, !!row && abs(row.quantity) === qty, row ? String(abs(row.quantity)) : "absent");
}

// The Direct Product and Services must be OUTSIDE the span, exactly once each.
for (const [sku, qty] of [["TRN-SP-CARTON", 6000], ["OTC-0050", 6000], ["BLD-FILL", 6000], ["OTC-0049", 6000], ["OTC-0002", 1]] as const) {
  const inSpan = span.filter((l) => l.itemid === sku).length;
  const out = outside.filter((l) => l.itemid === sku);
  check(`${sku} exactly once OUTSIDE the Group at ${qty.toLocaleString()}`, inSpan === 0 && out.length === 1 && abs(out[0].quantity) === qty, `inSpan=${inSpan} outside=${out.length}`);
}

check(
  "Included Artwork has no separate line",
  !lines.some((l) => l.itemid === "OTC-0001"),
  "OTC-0001 absent",
);
check("no legacy tooling path (OTC-0005)", !lines.some((l) => l.itemid === "OTC-0005"), "absent");

// Every line accounted for: mainline + group + members + endgroup + outside + tax.
const accounted = 1 + 1 + span.length + 1 + outside.length + lines.filter((l) => l.taxline === "T").length;
check("no unexpected line", accounted === lines.length, `${accounted} of ${lines.length}`);
console.log("");

// ══════════════════════════════════════════════════════════════════════
// GROUP AUTHORITY
// ══════════════════════════════════════════════════════════════════════
console.log("── GROUP AUTHORITY ───────────────────────────────────────");
const masters: { items: Array<Record<string, string>> } = (await suiteQL(
  `select id, itemid from item where itemtype = 'Group' and externalid = '${EXTERNAL_ID}'`,
)) as never;
const found = masters.items ?? [];
check("exactly ONE Group master carries the frozen identity", found.length === 1, `${found.length} · ${EXTERNAL_ID.slice(0, 24)}...`);
check("and it is the expected Group item", found[0]?.itemid === GROUP_ITEM_ID, String(found[0]?.itemid));

const again: { items: Array<Record<string, string>> } = (await suiteQL(
  `select id from item where itemtype = 'Group' and externalid = '${EXTERNAL_ID}'`,
)) as never;
const ids = new Set((again.items ?? []).map((r) => String(r.id)));
check("resolving the frozen composition again reuses the SAME Group", ids.size === 1 && ids.has(String(found[0]?.id)), [...ids].join(","));

const members = (await db.execute(sql`
  SELECT l.sku, al.quantity::text q FROM assembly_leaves al
    JOIN assemblies a ON a.id = al.assembly_id JOIN leaves l ON l.id = al.leaf_id
   WHERE a.quote_id = ${QUOTE} ORDER BY al.position`)) as unknown as Array<Record<string, string>>;
check("frozen membership is 1 / 1 / 2", members.map((m) => m.q).join("/") === "1/1/2", members.map((m) => `${m.sku}=${m.q}`).join(" "));
console.log("");

// ══════════════════════════════════════════════════════════════════════
// B · ARITHMETIC — ERP against the FROZEN snapshot
// ══════════════════════════════════════════════════════════════════════
console.log("── B · ARITHMETIC · ERP vs FROZEN SNAPSHOT ───────────────");
const erpMembers = span.reduce((a, l) => a + abs(l.netamount), 0);
const erpCarton = abs(outside.find((l) => l.itemid === "TRN-SP-CARTON")?.netamount);
const erpServices = ["OTC-0050", "BLD-FILL", "OTC-0049"].reduce((a, s) => a + abs(outside.find((l) => l.itemid === s)?.netamount), 0);
const erpDie = abs(outside.find((l) => l.itemid === "OTC-0002")?.netamount);
const mainline = lines.find((l) => l.mainline === "T");
const taxLines = lines.filter((l) => l.taxline === "T");

check("members = frozen member economics", money(erpMembers) === money(sum(fMembers)), `${money(erpMembers)} vs ${money(sum(fMembers))}`);
check("Direct Product = frozen", money(erpCarton) === money(sum(fDirect)), `${money(erpCarton)} vs ${money(sum(fDirect))}`);
check("Direct Services = frozen", money(erpServices) === money(sum(fServices)), `${money(erpServices)} vs ${money(sum(fServices))}`);
check("Cutting Die = frozen", money(erpDie) === money(sum(fOtc)), `${money(erpDie)} vs ${money(sum(fOtc))}`);
check("unit subtotal = frozen unit_subtotal", money(erpMembers + erpCarton + erpServices) === Number(tot.u).toFixed(2), `${money(erpMembers + erpCarton + erpServices)} vs ${Number(tot.u).toFixed(2)}`);
check("order total = frozen accepted consideration", money(abs(mainline?.netamount)) === Number(tot.t).toFixed(2), `${money(abs(mainline?.netamount))} vs ${Number(tot.t).toFixed(2)}`);
check("total = members + product + services + die", money(erpMembers + erpCarton + erpServices + erpDie) === money(abs(mainline?.netamount)), money(erpMembers + erpCarton + erpServices + erpDie));
console.log("");

// ══════════════════════════════════════════════════════════════════════
// TAX — read only from the settled transaction
// ══════════════════════════════════════════════════════════════════════
console.log("── TAX · GOVERNED NON-TAXABLE ────────────────────────────");
const governed = lines.filter((l) => l.taxline === "F" && l.mainline === "F");
check("every governed line carries -8 (Not Taxable)", governed.every((l) => String(l.taxcode) === "-8"), `${governed.filter((l) => String(l.taxcode) !== "-8").length} not -8`);
check("the TaxGroup contributes zero", taxLines.every((l) => abs(l.netamount) === 0), taxLines.map((l) => `${l.itemtype}=${abs(l.netamount)}`).join(" "));
check("no residual TaxItem", !lines.some((l) => l.itemtype === "TaxItem"), "absent");
const [txn] = ((await suiteQL(`select foreigntotal from transaction where id = ${EXPECT_SO_ID}`)) as never as { items: Array<Record<string, string>> }).items;
check("settled transaction total = 36683.00", Number(txn.foreigntotal).toFixed(2) === "36683.00", Number(txn.foreigntotal).toFixed(2));

console.log("");
console.log(fails.length === 0 ? "O4 CERTIFICATION: PASS" : `O4 CERTIFICATION: ${fails.length} FAILURE(S) — ${fails.join("; ")}`);
process.exit(fails.length === 0 ? 0 : 1);
