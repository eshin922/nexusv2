/**
 * O5 · TRAINING — FULL SPEC REFERENCE · end-to-end certification.
 *
 * ── THE PRECONDITION THAT COMES FIRST ───────────────────────────────────
 *
 * An external ERP readback is admissible ONLY after the Nexus push that
 * produced it has reached a terminal status. Banked from a real error on O4,
 * where an intermediate `awaiting_rates` row and a mid-push TaxItem were both
 * read accurately and reported as outcomes. No ERP query is issued below until
 * the gate passes.
 *
 * ── TWO AUTHORITIES, PROVEN SEPARATE ────────────────────────────────────
 *
 * O5's whole subject is that a quote carries TWO things that must not become
 * one thing:
 *
 *   the SPECIFICATION   authored -> pinned -> frozen -> addendum -> accepted
 *                       -> historical readback, and stopping there
 *   the ECONOMICS       accepted consideration -> NetSuite, independently
 *
 * The certification is not "both arrived". It is that each arrived intact AND
 * that neither became the other's authority. So the ERP side is checked for
 * the economics being exactly right, and separately for the specifications
 * being entirely absent — the second is a negative, which is why it carries
 * its own controls.
 *
 * ── THE EXPECTATION COMES FROM THE FREEZE ───────────────────────────────
 *
 * Every commercial figure compared against NetSuite is read from
 * `quote_snapshot_*`, never recomputed by the emitter. Every specification
 * figure is read from `o5-expected.ts`, frozen before the quote existed. An
 * emitter checked against itself agrees with itself.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";
import { O5_EXPECTED_ALL } from "./o5-spec-verify.ts";
import { O5_LEAVES, O5_NUMERIC_FIELD, O5_TP_SPEC } from "./o5-expected.ts";

const QUOTE = "081532d7-89c0-4708-bbd2-160130680009";
const EXPECT_SO_ID = "364141";
const EXPECT_TRANID = "SO2736";

const fails: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(60)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log("O5 · TRAINING — FULL SPEC REFERENCE · CERTIFICATION");
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
  SELECT status, completed_at, quote_snapshot_id
    FROM netsuite_so_pushes WHERE quote_id = ${QUOTE} ORDER BY created_at DESC LIMIT 1
`)) as unknown as Array<Record<string, string | null>>;

console.log(`  push status        ${q?.netsuite_so_push_status}`);
console.log(`  completed_at       ${push?.completed_at ?? "NULL"}`);
console.log(`  so id / tranid     ${q?.netsuite_so_id} / ${q?.netsuite_so_tranid}`);
console.log(`  quote status       ${q?.status}`);

const terminal =
  q?.netsuite_so_push_status === "succeeded" &&
  push?.completed_at !== null &&
  q?.netsuite_so_id === EXPECT_SO_ID &&
  q?.netsuite_so_tranid === EXPECT_TRANID &&
  q?.status === "complete";
if (!terminal) {
  console.log("\nINCOMPLETE · the push has not reached a terminal status.");
  console.log("No ERP readback is admissible. Nothing below was run.");
  process.exit(2);
}
console.log("  ok   terminal — ERP readback is admissible\n");

// ══════════════════════════════════════════════════════════════════════
// THE FROZEN SIDE — the accepted consideration, from the snapshot
// ══════════════════════════════════════════════════════════════════════
const S = push.quote_snapshot_id as string;
const frozen = (await db.execute(sql`
  SELECT l.line_kind::text k, l.display_sku sku, l.display_name dn,
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

console.log("── FROZEN · DPS-1076 v1 @ Tier 2 ─────────────────────────");
for (const f of frozen) {
  console.log(`  ${f.k.padEnd(20)} ${String(f.sku).padEnd(20)} qty=${String(f.q).padStart(7)} amt=${String(f.amt).padStart(11)}`);
}
console.log(`  unit_subtotal ${tot.u} · otc_subtotal ${tot.o} · tier_commercial_total ${tot.t}\n`);

// ══════════════════════════════════════════════════════════════════════
// THE ERP SIDE — read once, after terminality
// ══════════════════════════════════════════════════════════════════════
const res: { items: Array<Record<string, string | null>> } = (await suiteQL(
  `select tl.linesequencenumber seq, tl.itemtype, tl.taxline, tl.mainline, tl.taxcode,
          tl.quantity, tl.rate, tl.netamount, i.itemid, i.id itemid_internal
     from transactionline tl left join item i on i.id = tl.item
    where tl.transaction = ${EXPECT_SO_ID} order by tl.linesequencenumber`,
)) as never;
const lines = res.items ?? [];
const abs = (v: unknown) => Math.abs(Number(v ?? 0));
const money = (n: number) => n.toFixed(2);

console.log(`── ERP · ${EXPECT_TRANID} (internal ${EXPECT_SO_ID}) ──────────────────`);
for (const l of lines) {
  console.log(
    `  seq ${String(l.seq).padStart(2)} ${String(l.itemtype ?? "-").padEnd(12)} ${String(l.itemid ?? "-").padEnd(20)} tax=${String(l.taxcode ?? "-").padEnd(4)} main=${l.mainline} taxline=${l.taxline} qty=${String(l.quantity ?? "-").padStart(8)} amt=${String(l.netamount ?? "-").padStart(11)}`,
  );
}
console.log("");

const mainline = lines.find((l) => l.mainline === "T");
const governed = lines.filter((l) => l.mainline === "F" && l.taxline === "F");

// ══════════════════════════════════════════════════════════════════════
// A · STRUCTURE — exactly the three accepted itemized products
// ══════════════════════════════════════════════════════════════════════
console.log("── A · ITEMIZED STRUCTURE ────────────────────────────────");

check("NO Group line", !lines.some((l) => l.itemtype === "Group"), `${lines.filter((l) => l.itemtype === "Group").length} found`);
check("NO EndGroup line", !lines.some((l) => l.itemtype === "EndGroup"), `${lines.filter((l) => l.itemtype === "EndGroup").length} found`);
check("exactly three governed lines", governed.length === 3, `${governed.length}`);

const EXPECTED = [
  { sku: O5_LEAVES.PP.sku, item: O5_LEAVES.PP.netsuiteInternalId, qty: 6000, amt: 3393.0 },
  { sku: O5_LEAVES.SP.sku, item: O5_LEAVES.SP.netsuiteInternalId, qty: 6000, amt: 2340.0 },
  { sku: O5_LEAVES.TP.sku, item: O5_LEAVES.TP.netsuiteInternalId, qty: 6000, amt: 495.0 },
];
for (const e of EXPECTED) {
  const l = governed.find((g) => g.itemid === e.sku);
  const ok =
    !!l &&
    String(l.itemid_internal) === e.item &&
    abs(l.quantity) === e.qty &&
    money(abs(l.netamount)) === money(e.amt);
  check(
    `${e.sku} · item ${e.item} · qty ${e.qty} · ${money(e.amt)}`,
    ok,
    l ? `item=${l.itemid_internal} qty=${abs(l.quantity)} amt=${money(abs(l.netamount))}` : "LINE ABSENT",
  );
}

// Every governed line must be one of the three; nothing else may be governed.
const unexpected = governed.filter((g) => !EXPECTED.some((e) => e.sku === g.itemid));
check("no service / OTC / freight / other governed line", unexpected.length === 0, unexpected.map((u) => `${u.itemtype}:${u.itemid}`).join(",") || "none");

// The only permitted non-governed, non-mainline line is NetSuite's own
// zero-value tax representation. Anything else is an unexpected line.
const taxRep = lines.filter((l) => l.mainline === "F" && l.taxline === "T");
const taxRepNonZero = taxRep.filter((l) => abs(l.netamount) !== 0);
check("tax representation carries zero value", taxRepNonZero.length === 0, `${taxRep.length} tax line(s), ${taxRepNonZero.length} non-zero`);
check(
  "no unexpected transaction line",
  lines.length === governed.length + taxRep.length + (mainline ? 1 : 0),
  `${lines.length} total = ${governed.length} governed + ${taxRep.length} tax + ${mainline ? 1 : 0} mainline`,
);

// ══════════════════════════════════════════════════════════════════════
// B · ARITHMETIC — against the FREEZE, not the emitter
// ══════════════════════════════════════════════════════════════════════
console.log("\n── B · ARITHMETIC ────────────────────────────────────────");
const erpSubtotal = governed.reduce((a, l) => a + abs(l.netamount), 0);
const frozenSum = frozen.reduce((a, f) => a + Number(f.amt), 0);

check("ERP subtotal = frozen line sum", money(erpSubtotal) === money(frozenSum), `${money(erpSubtotal)} vs frozen ${money(frozenSum)}`);
check("ERP subtotal = frozen unit_subtotal", money(erpSubtotal) === Number(tot.u).toFixed(2), `${money(erpSubtotal)} vs ${Number(tot.u).toFixed(2)}`);
check("frozen otc_subtotal is zero", Number(tot.o) === 0, String(tot.o));
check("ERP subtotal = 6228.00", money(erpSubtotal) === "6228.00", money(erpSubtotal));
check("order total = frozen accepted consideration", money(abs(mainline?.netamount)) === Number(tot.t).toFixed(2), `${money(abs(mainline?.netamount))} vs ${Number(tot.t).toFixed(2)}`);
check("order total = 6228.00", money(abs(mainline?.netamount)) === "6228.00", money(abs(mainline?.netamount)));

const taxTotal = taxRep.reduce((a, l) => a + abs(l.netamount), 0);
check("taxTotal = 0.00", money(taxTotal) === "0.00", money(taxTotal));
check("every governed line non-taxable (taxcode -8)", governed.every((l) => String(l.taxcode) === "-8"), governed.map((l) => l.taxcode).join(","));

// ══════════════════════════════════════════════════════════════════════
// C · SPECIFICATION NEGATIVE BOUNDARY — against the SETTLED order
// ══════════════════════════════════════════════════════════════════════
console.log("\n── C · SPECIFICATIONS ARE NOT AN ERP AUTHORITY ───────────");

const erpText = JSON.stringify(lines);

/** Whole-token match, so a two-character value cannot hit a UUID interior. */
function boundedMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
  return new RegExp("(^|[^A-Za-z0-9])" + escaped + "([^A-Za-z0-9]|$)").test(haystack);
}

// POSITIVE CONTROL — the scan must be able to see the ERP payload at all.
const posControl = boundedMatch(erpText, O5_LEAVES.TP.sku);
// NEGATIVE CONTROL — and it must still catch an injected value AND key, both
// as a JSON value and inside prose. A detector narrowed until it stops
// reporting is not a detector.
//
// The injections are CONSTRUCTED, not produced by a regex over the ERP text.
// A first version patterned on `"quantity":"6000` and injected nothing,
// because SuiteQL returns sales-order quantities negative (`"-6000"`) — so the
// control reported "not caught" for a detector that was fine. A control whose
// setup silently no-ops is worse than none, since it fails in the safe
// direction here but would pass in the unsafe direction elsewhere.
const shortVal = O5_TP_SPEC[O5_NUMERIC_FIELD];
const injectedValue = JSON.stringify([...lines, { quantity: shortVal }]);
const injectedProse = JSON.stringify([...lines, { itemid: `${shortVal} units per case` }]);
const injectedKey = JSON.stringify([...lines, { [O5_NUMERIC_FIELD]: "x" }]);
const negControl =
  boundedMatch(injectedValue, shortVal) &&
  boundedMatch(injectedProse, shortVal) &&
  injectedKey.includes(O5_NUMERIC_FIELD);
check("positive control — the scan can see the settled order", posControl, `"${O5_LEAVES.TP.sku}"`);
check("negative control — an injected spec value AND key are caught", negControl, "value+prose+key");
if (!posControl || !negControl) {
  console.log("\nINDETERMINATE · the detector cannot express the failure it excludes.");
  process.exit(2);
}

const valueHits: string[] = [];
const keyHits: string[] = [];
for (const [key, value] of Object.entries(O5_EXPECTED_ALL)) {
  if (erpText.includes(key)) keyHits.push(key);
  if (value === "") continue;
  if (value.length >= 8 ? erpText.includes(value) : boundedMatch(erpText, value)) valueHits.push(key);
}
check("no PP/SP/TP spec VALUE appears on the settled order", valueHits.length === 0, valueHits.join(",") || "none");
check("no PP/SP/TP spec KEY appears on the settled order", keyHits.length === 0, keyHits.join(",") || "none");

// The specific arithmetic that would betray the numeric spec as an authority.
const unitsPerCase = Number(shortVal);
const cases = 6000 / unitsPerCase;
check(
  `tp_units_per_case=${unitsPerCase} did NOT alter qty (no line at ${cases})`,
  governed.every((l) => abs(l.quantity) === 6000),
  governed.map((l) => abs(l.quantity)).join(","),
);
check(
  "no spec value appears as a rate, quantity or amount",
  !governed.some((l) => [abs(l.rate), abs(l.quantity), abs(l.netamount)].some((n) => n !== 0 && Object.values(O5_EXPECTED_ALL).some((v) => v !== "" && Number(v) === n))),
  "none",
);
check(
  "item ids resolve from the governed product mappings only",
  EXPECTED.every((e) => governed.find((g) => g.itemid === e.sku)?.itemid_internal === e.item),
  EXPECTED.map((e) => `${e.sku}=${e.item}`).join(" "),
);
check(
  "no grouping authority — the order is itemized",
  !lines.some((l) => l.itemtype === "Group" || l.itemtype === "EndGroup"),
  "no Group/EndGroup",
);

// And the negative is not vacuous: the specifications DO exist on this order.
const [specCount] = (await db.execute(sql`
  SELECT count(*)::text n FROM quote_snapshot_leaf_specs WHERE quote_snapshot_id = ${S}
`)) as unknown as Array<Record<string, string>>;
check("specifications ARE frozen on this order (absence is not vacuous)", Number(specCount.n) === 3, `${specCount.n} frozen spec rows`);

// ══════════════════════════════════════════════════════════════════════
console.log("");
if (fails.length === 0) {
  console.log("O5 CERTIFICATION: PASS");
  console.log("  the specification reached the customer document and stopped there;");
  console.log("  the accepted economics reached NetSuite independently and exactly.");
} else {
  console.log(`O5 CERTIFICATION: FAIL — ${fails.length}`);
  for (const f of fails) console.log(`  - ${f}`);
}
process.exit(fails.length === 0 ? 0 : 1);
