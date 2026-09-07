/**
 * DOES THE DEPLOYED RECEIPT SHOW THE ORDER THAT WILL BE SENT?
 *
 * The receipt and the push now read the same producer, so agreement is
 * structural rather than coincidental. This checks it anyway, because
 * "structural" is a claim about code and the operator reads a rendered page.
 *
 * ── HOW IT AVOIDS BEING A TAUTOLOGY ─────────────────────────────────────
 *
 * The RENDERED side is a literal transcription, taken from the deployed page's
 * accessibility tree at nexus.thedps.co. It is not read back from the code
 * under test. The EXPECTED side is computed from `loadSalesOrderPreview` and
 * formatted with the receipt's own two formatting rules -- `toLocaleString` for
 * quantities, and its `usd` helper for money.
 *
 * So a renderer that drifted would fail here even though both halves would
 * still be internally consistent -- which is the exact failure mode the flat
 * 1,200 receipt had, and the reason eyeballing a screenshot is not evidence.
 *
 * READ-ONLY, and it pushes nothing.
 *
 * Usage:  o3-receipt-agreement.ts <quoteNumber>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { loadSalesOrderPreview } from "@/lib/netsuite/planned-sales-order-preview";

/** The receipt's own formatters, reproduced exactly. */
const usd = (n: number, dec = 0) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const qty = (n: number) => n.toLocaleString();

/**
 * WHAT THE DEPLOYED PAGE RENDERED — transcribed from the live accessibility
 * tree on 2026-09-07, at
 * /projects/ae48d673.../quotes/4ec5db82.../quote?tab=tier
 *
 * Order matters: this is the sequence the page presented, so a reordering is a
 * failure even when every row is individually right.
 */
const RENDERED: Array<[string, string, string, string]> = [
  // item, qty, unit, extended
  ["Group · TRN-GIFTSET-DUO", "1,200", "—", "—"],
  ["TRN-PP-BOTTLE-30 · 2 per set", "2,400", "$1.91", "$4,580"],
  ["TRN-PP-PUMP · 2 per set", "2,400", "$0.90", "$2,151"],
  ["TRN-SP-LABEL · 2 per set", "2,400", "$0.29", "$706"],
  ["TRN-SP-SLEEVE · 1 per set", "1,200", "$2.78", "$3,334"],
  ["TRN-SP-GIFTBOX · 1 per set", "1,200", "$5.17", "$6,207"],
  ["EndGroup", "—", "—", "—"],
  ["Tooling", "1", "$7,680.00", "$7,680"],
  ["Print plates · TRAINING · Label Set", "1", "$1,488.00", "$1,488"],
];

const RENDERED_EXTERNAL_ID =
  "nxs-grp-fca02789a23b1750453a0c2438b75e30c0009d4ae2b923d7baff465a0a670ce3";
const RENDERED_TOTALS = { subtotal: "$16,978", oneTime: "$9,168", order: "$26,146" };
const RENDERED_UNITS_TOTAL = "9,600";

const quoteNumber = process.argv[2] ?? "DPS-1074";

const [quote] = (await db.execute(sql`
  SELECT id FROM quotes WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<{ id: string }>;
if (!quote) {
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

const preview = await loadSalesOrderPreview(quote.id);
if (preview.status !== "ok") {
  // Not a pass and not a fail: readiness refused, so there is no plan to
  // compare against and this control cannot express an answer.
  console.log(`INDETERMINATE · readiness did not clear: ${preview.reason}`);
  process.exit(2);
}

const fails: string[] = [];

/** The receipt's row rendering, derived from the plan. */
const expected: Array<[string, string, string, string]> = [];
for (const r of preview.planned.rows) {
  if (r.role === "group") {
    expected.push([`Group · ${r.sku}`, qty(r.quantity), "—", "—"]);
  } else if (r.role === "member") {
    expected.push([
      `${r.sku} · ${r.qtyPerParent} per set`,
      qty(r.quantity),
      usd(r.rate, 2),
      usd(r.amount),
    ]);
  } else if (r.role === "end_group") {
    expected.push(["EndGroup", "—", "—", "—"]);
  } else {
    const l = r.line;
    expected.push([l.description, qty(l.quantity), usd(l.rate, 2), usd(l.quantity * l.rate)]);
  }
}

console.log(`QUOTE ${quoteNumber}`);
console.log("");
console.log("ROW-BY-ROW · rendered vs planned");
const n = Math.max(RENDERED.length, expected.length);
for (let i = 0; i < n; i++) {
  const got = RENDERED[i];
  const want = expected[i];
  const ok = got && want && got.every((v, k) => v === want[k]);
  if (!ok) fails.push(`row ${i + 1}`);
  console.log(
    `  ${ok ? "OK  " : "FAIL"} ${(got?.[0] ?? "(missing)").slice(0, 38).padEnd(38)} ${(got?.[1] ?? "-").padStart(7)} ${(got?.[2] ?? "-").padStart(10)} ${(got?.[3] ?? "-").padStart(9)}`,
  );
  if (!ok) console.log(`       planned: ${JSON.stringify(want ?? null)}`);
}

console.log("");
const check = (label: string, got: string, want: string) => {
  const ok = got === want;
  if (!ok) fails.push(label);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(34)} rendered ${got.padStart(10)} · planned ${want.padStart(10)}`);
};

const group = preview.planned.rows.find((r) => r.role === "group");
check(
  "Group identity",
  RENDERED_EXTERNAL_ID,
  group && group.role === "group" ? (group.externalId ?? "(none)") : "(no group)",
);

const goods = preview.planned.rows.filter((r) => r.role === "member" || r.role === "direct");
const sub = goods.reduce(
  (a, r) => a + (r.role === "member" ? r.amount : r.line.quantity * r.line.rate),
  0,
);
const one = preview.planned.rows.reduce(
  (a, r) => (r.role === "accounting" ? a + r.line.quantity * r.line.rate : a),
  0,
);
const units = goods.reduce(
  (a, r) => a + (r.role === "member" ? r.quantity : r.line.quantity),
  0,
);

check("Product subtotal", RENDERED_TOTALS.subtotal, usd(sub));
check("One-time charges", RENDERED_TOTALS.oneTime, usd(one));
check("Order total", RENDERED_TOTALS.order, usd(sub + one));
check("Units total", RENDERED_UNITS_TOTAL, qty(units));

console.log("");
console.log(fails.length === 0 ? "PASS · the receipt shows the order that will be sent" : `FAIL · ${fails.join(", ")}`);
process.exit(fails.length === 0 ? 0 : 1);
