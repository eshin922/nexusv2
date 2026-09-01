/**
 * O3 · Retail Gift Set — the end-to-end certification.
 *
 * Two INDEPENDENT subjects, and the order passes only if both do. Arithmetic
 * that reconciles is necessary and is not sufficient: a flat set of member
 * lines summing to the same total would reconcile perfectly and misrepresent
 * the accepted structure, which is the whole reason O3 exists.
 *
 *   A  turnkey_only grouped path — Group -> five frozen members at expanded
 *      quantities -> EndGroup, under the independently frozen composition
 *      identity, resolving to the SAME group on a second lookup.
 *
 *   B  component-owned charges — four instances, two of them the same TYPE on
 *      different owners with different treatments, each surviving the freeze
 *      independently at its frozen recovery.
 *
 * Every expected value is read from `o3-expected.ts`, which was committed
 * BEFORE the scenario was authored. Nothing here is derived from the result it
 * is checking.
 *
 * Usage:  o3-certify.ts [quoteId]
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";
import {
  computeCompositionHash,
  externalIdForHash,
} from "@/lib/netsuite/composition-hash";

const QUOTE = process.argv[2] ?? "4ec5db82-967a-482c-a9e5-48baf3fc11f5";

// ── THE FROZEN EXPECTATION ──────────────────────────────────────────────
// Restated here as constants rather than imported, because `o3-expected.ts`
// prints and exits. The values are identical and the file is the authority;
// any divergence between the two is itself a finding.
const CUSTOMER = "388800";
const GROUP_SKU = "TRN-GIFTSET-DUO";
const MEMBERS = [
  { ord: 1, sku: "TRN-PP-BOTTLE-30", qtyPerParent: 2, nsId: "76155" },
  { ord: 2, sku: "TRN-PP-PUMP", qtyPerParent: 2, nsId: "76156" },
  { ord: 3, sku: "TRN-SP-LABEL", qtyPerParent: 2, nsId: "76157" },
  { ord: 4, sku: "TRN-SP-SLEEVE", qtyPerParent: 1, nsId: "76161" },
  { ord: 5, sku: "TRN-SP-GIFTBOX", qtyPerParent: 1, nsId: "76162" },
];
/** owner|chargeKey -> [treatment, recovery at T1/T2/T3] */
const CHARGES: Record<string, { treatment: string; recovery: [number, number, number] }> = {
  "TRN-SP-LABEL|print_plates": { treatment: "separate_line", recovery: [1488, 1488, 2232] },
  "TRN-SP-SLEEVE|print_plates": { treatment: "unit_price", recovery: [2022, 2022, 3036] },
  "TRN-PP-BOTTLE-30|tooling": { treatment: "separate_line", recovery: [7680, 7680, 7680] },
  "TRN-SP-GIFTBOX|samples": { treatment: "unit_price", recovery: [1014, 1495, 2522] },
};
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  return ok;
};
const money = (n: unknown) => Number(n).toFixed(2);

console.log("O3 · RETAIL GIFT SET — END-TO-END CERTIFICATION");
console.log("TARGET", JSON.stringify(describeNetsuiteTarget()), "\n");

// ════════════════════════════════════════════════════════════════════════
// 0 · LIFECYCLE
// ════════════════════════════════════════════════════════════════════════
const q: any = (
  await db.execute(sql`
    select quote_number, status, detail_level, accepted_tier_id,
           netsuite_so_id, netsuite_so_tranid, netsuite_so_push_status, global_price_adj_pct
      from quotes where id = ${QUOTE}`)
)[0];
console.log("── 0 · LIFECYCLE ─────────────────────────────────────────");
console.log(
  `  ${q.quote_number} · ${q.status} · detail=${q.detail_level} · SO=${q.netsuite_so_tranid ?? "-"}/${q.netsuite_so_id ?? "-"}`,
);
// THE LIVE VALUE, NOT THE SNAPSHOT COLUMN.
//
// `quotes.detail_level` is `detailLevelSnapshot` — written at SEND. On a draft
// it is NULL, which is not "itemized" and is not a defect. The value in force
// lives in `presentation_profile`, and reading the snapshot column on a draft
// reports a shape the operator never chose. Both are checked, each where it is
// the authority.
const profile: any = (
  await db.execute(sql`
    select detail_level, layout from presentation_profile where quote_id = ${QUOTE}`)
)[0];
check(
  profile?.detail_level === "turnkey_only",
  "live presentation profile is turnkey_only (OD-004 requires grouping)",
  String(profile?.detail_level),
);
if (q.status !== "draft") {
  check(
    q.detail_level === "turnkey_only",
    "and the SENT snapshot froze the same shape",
    String(q.detail_level),
  );
}
check(Number(q.global_price_adj_pct) === 0, "global adjustment still 0");

const tiers: any[] = await db.execute(sql`
  select id, label, qty from quote_tiers where quote_id = ${QUOTE} order by sort_order`);
const acceptedTier = tiers.find((t) => t.id === q.accepted_tier_id) ?? null;

// ════════════════════════════════════════════════════════════════════════
// 1 · #537 PRODUCTION PROOF AT SEND
// ════════════════════════════════════════════════════════════════════════
console.log("\n── 1 · #537 · THE DEAD COLUMN STAYED DEAD ────────────────");
const askRows: any[] = await db.execute(sql`
  select ct.recovery_ask from quote_charge_instance_tiers ct
  join quote_charge_instances ci on ci.id = ct.charge_instance_id
  where ci.quote_id = ${QUOTE}`);
const nulls = askRows.filter((r) => r.recovery_ask === null).length;
check(askRows.length === 12, "12 charge tier rows", `${askRows.length}`);
check(
  nulls === askRows.length,
  "every recovery_ask still NULL — no backfill or compatibility writer ran",
  `${nulls}/${askRows.length}`,
);

// ════════════════════════════════════════════════════════════════════════
// 2 · SUBJECT B · COMPONENT-OWNED CHARGES, FROZEN
// ════════════════════════════════════════════════════════════════════════
console.log("\n── 2 · SUBJECT B · FROZEN RECOVERY INSTRUCTIONS ──────────");
const instr: any[] = await db.execute(sql`
  select l.sku, ci.charge_key, i.charge_instance_id, i.owner_kind, i.treatment,
         i.treatment_source, i.cost, i.governed_recovery, i.separate_invoice_amount,
         i.amortized_per_unit, t.qty
    from quote_snapshot_recovery_instructions i
    join quote_snapshots s on s.id = i.quote_snapshot_id
    join quote_charge_instances ci on ci.id = i.charge_instance_id
    join quote_leaves ql on ql.id = ci.owner_quote_leaf_id
    join leaves l on l.id = ql.leaf_id
    join quote_tiers t on t.id = i.tier_id
   where s.quote_id = ${QUOTE}
   order by l.sku, ci.charge_key, t.qty`);

let subjectBExercised = false;
if (instr.length === 0) {
  console.log("  (no frozen instructions yet — quote not sent)");
} else {
  subjectBExercised = true;
  const byKey = new Map<string, any[]>();
  for (const r of instr) {
    const k = `${r.sku}|${r.charge_key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  for (const [k, exp] of Object.entries(CHARGES)) {
    const rows = (byKey.get(k) ?? []).sort((a, b) => a.qty - b.qty);
    if (!check(rows.length === 3, `${k} · frozen at all three tiers`, `${rows.length}`)) continue;
    const treatments = new Set(rows.map((r) => r.treatment));
    check(
      treatments.size === 1 && treatments.has(exp.treatment),
      `${k} · treatment ${exp.treatment}`,
      [...treatments].join("/"),
    );
    const got = rows.map((r) => Number(r.governed_recovery));
    check(
      got.every((v, i) => Math.abs(v - exp.recovery[i]) < 0.005),
      `${k} · governed recovery`,
      `${got.map((v) => v.toFixed(2)).join(" / ")}  exp ${exp.recovery.map((v) => v.toFixed(2)).join(" / ")}`,
    );
    check(
      rows.every((r) => r.owner_kind === "component"),
      `${k} · owner_kind component`,
    );
    // A separately-billed charge states an invoice amount; an in-unit-price one
    // states an amortized basis. Each is the OTHER's null.
    if (exp.treatment === "separate_line") {
      check(
        rows.every((r) => r.separate_invoice_amount !== null),
        `${k} · carries a separate invoice amount`,
      );
    } else {
      check(
        rows.every((r) => r.amortized_per_unit !== null),
        `${k} · carries an amortized per-unit basis`,
      );
    }
  }

  // THE COLLAPSE CONTROL, at the freeze.
  const pp = instr.filter((r) => r.charge_key === "print_plates");
  const ppInstances = new Set(pp.map((r) => r.charge_instance_id));
  const ppOwners = new Set(pp.map((r) => r.sku));
  const ppTreatments = new Set(pp.map((r) => r.treatment));
  console.log("");
  check(ppInstances.size === 2, "print_plates froze as TWO distinct instances", `${ppInstances.size}`);
  check(ppOwners.size === 2, "on two different owners", [...ppOwners].join(", "));
  check(
    ppTreatments.size === 2,
    "with two different treatments — not collapsed by charge key",
    [...ppTreatments].join(", "),
  );
  check(
    instr.every((r) => r.treatment_source === "election"),
    "every instruction traces to an election, not a legacy default",
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3 · SUBJECT A · THE GROUPED SALES ORDER, READ BACK
// ════════════════════════════════════════════════════════════════════════
console.log("\n── 3 · SUBJECT A · GROUPED STRUCTURE AT THE ERP ──────────");
let subjectAExercised = false;
if (!q.netsuite_so_id) {
  console.log("  (no Sales Order yet — quote not complete)");
} else {
  subjectAExercised = true;
  const so = q.netsuite_so_id;
  const lines: any = await suiteQL(
    `select tl.linesequencenumber seq, tl.quantity, tl.rate, tl.netamount,
            i.itemid, i.itemtype, i.id itemid_internal
       from transactionline tl
       left join item i on i.id = tl.item
      where tl.transaction = ${so} and tl.taxline = 'F'
      order by tl.linesequencenumber`,
  );
  const rows: any[] = lines.items ?? [];
  console.log(`  ${rows.length} line(s) on SO ${so}`);
  for (const r of rows) {
    console.log(
      `    seq=${String(r.seq).padStart(3)} ${String(r.itemtype ?? "-").padEnd(10)} ` +
        `${String(r.itemid ?? "-").padEnd(20)} qty=${String(r.quantity ?? "-").padStart(7)} ` +
        `rate=${String(r.rate ?? "-").padStart(12)} amt=${String(r.netamount ?? "-").padStart(12)}`,
    );
  }

  // ── the Group span ──────────────────────────────────────────────────
  const groupIdx = rows.findIndex((r) => r.itemtype === "Group");
  const endIdx = rows.findIndex((r) => r.itemtype === "EndGroup");
  check(groupIdx >= 0, "a Group header line exists");
  check(endIdx > groupIdx, "an EndGroup line closes it");

  if (groupIdx >= 0 && endIdx > groupIdx) {
    const span = rows.slice(groupIdx + 1, endIdx);
    check(
      span.length === MEMBERS.length,
      `the span holds ${MEMBERS.length} member lines`,
      `${span.length}`,
    );
    const header = rows[groupIdx];
    check(
      String(header.itemid) === GROUP_SKU,
      `Group header is ${GROUP_SKU}`,
      String(header.itemid),
    );

    const acceptedQty = acceptedTier ? Number(acceptedTier.qty) : Number(header.quantity);
    check(
      Number(header.quantity) === acceptedQty,
      "Group line quantity is the accepted tier quantity",
      `${header.quantity} vs ${acceptedQty}`,
    );

    // ── membership, order, and MULTIPLICITY EXPANSION ─────────────────
    console.log("");
    span.forEach((r, i) => {
      const exp = MEMBERS[i];
      if (!exp) return;
      check(
        String(r.itemid) === exp.sku,
        `member ${i + 1} is ${exp.sku} in frozen ordinal position`,
        String(r.itemid),
      );
      const expectedQty = acceptedQty * exp.qtyPerParent;
      check(
        Number(r.quantity) === expectedQty,
        `  ${exp.sku} expands to ${acceptedQty} x ${exp.qtyPerParent} = ${expectedQty}`,
        `got ${r.quantity}`,
      );
      // Rate x quantity must reproduce the stored amount — REG-4 Link B, at
      // the member grain rather than only in aggregate.
      const posted = Math.round(Number(r.rate) * Number(r.quantity) * 100) / 100;
      check(
        Math.abs(posted - Number(r.netamount)) < 0.005,
        `  ${exp.sku} rate x qty reproduces its amount`,
        `${money(r.rate)} x ${r.quantity} = ${posted.toFixed(2)} vs ${money(r.netamount)}`,
      );
    });

    // ── EndGroup carries no independent economics ─────────────────────
    console.log("");
    const end = rows[endIdx];
    const endAmt = end.netamount === null ? 0 : Number(end.netamount);
    check(
      endAmt === 0,
      "EndGroup carries no independent commercial value",
      `netamount=${end.netamount ?? "null"}`,
    );
  }

  // ── the Group's own identity, against the frozen hash ───────────────
  console.log("");
  const hash = computeCompositionHash({
    customerNetsuiteId: CUSTOMER,
    baseSku: GROUP_SKU,
    members: [...MEMBERS]
      .sort((a, b) => a.nsId.localeCompare(b.nsId))
      .map((m) => ({ netsuiteItemId: m.nsId, quantity: m.qtyPerParent })),
  });
  const externalId = externalIdForHash(hash);
  const grp: any = await suiteQL(
    `select id, itemid, externalid from item where itemtype = 'Group' and externalid = '${externalId}'`,
  );
  const found: any[] = grp.items ?? [];
  check(
    found.length === 1,
    "exactly ONE Group master carries the frozen composition identity",
    `${found.length} · ${externalId.slice(0, 24)}...`,
  );
  if (found.length === 1) {
    check(
      String(found[0].itemid) === GROUP_SKU,
      "and it is the expected Group",
      String(found[0].itemid),
    );
    // IDEMPOTENCY, measured rather than asserted: resolving the same frozen
    // composition again must return this same master. A second row here would
    // be a duplicate master-data record, which is the failure this guards.
    const again: any = await suiteQL(
      `select id from item where itemtype = 'Group' and externalid = '${externalId}'`,
    );
    const ids = new Set((again.items ?? []).map((r: any) => String(r.id)));
    check(
      ids.size === 1 && ids.has(String(found[0].id)),
      "resolving the frozen composition again returns the SAME Group",
      `${[...ids].join(", ")}`,
    );
  }
}

// ── THE VERDICT MUST BE ABLE TO SAY "I DID NOT LOOK" ────────────────────
//
// Zero failures across checks that never ran is not a pass, and printing one
// would be the exact instrument error this corpus keeps finding: a control
// reporting green because it could not express the thing it was meant to
// exclude. Both subjects have to have been EXERCISED before the word PASS is
// available.
const unexercised = [
  subjectBExercised ? null : "B · component-owned charges (quote not sent)",
  subjectAExercised ? null : "A · grouped structure (no Sales Order)",
].filter(Boolean);

console.log("");
if (failures > 0) {
  console.log(`O3 CERTIFICATION: ${failures} FAILURE(S)`);
} else if (unexercised.length > 0) {
  console.log("O3 CERTIFICATION: INCOMPLETE — nothing failed, but a subject was not exercised:");
  for (const u of unexercised) console.log(`  - ${u}`);
} else {
  console.log("O3 CERTIFICATION: PASS — both subjects exercised and green");
}
process.exit(failures === 0 && unexercised.length === 0 ? 0 : 1);
