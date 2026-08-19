/**
 * UAT trace — TAX and PRICE LEVEL on a real sandbox Sales Order. READ ONLY.
 *
 * Reads the RAW record rather than a projected shape, because the question is
 * which fields NetSuite actually holds — a typed reader would hide exactly the
 * fields being looked for.
 *
 * Answers, per Accounting's findings:
 *   TAX   — is the order taxable because the CUSTOMER/ship-to is configured
 *           taxable, or because the ITEM MASTERS force it? Which tax model is
 *           in play (legacy taxCode vs SuiteTax taxDetails) decides what the
 *           enforcement field even is.
 *   PRICE — what price level does each line carry, and did Nexus set it or did
 *           NetSuite default it?
 */
import { nsRequest, suiteQL } from "@/lib/netsuite/client";

const SO_ID = process.argv[2] ?? null;
if (!SO_ID) { console.log("usage: so-tax-price-trace <salesOrderInternalId>"); process.exit(1); }

const so = await nsRequest<Record<string, any>>({
  method: "GET",
  path: `/record/v1/salesOrder/${encodeURIComponent(SO_ID)}?expandSubResources=true`,
});

console.log("── header · tax-relevant fields present on the record ──");
const taxish = Object.keys(so).filter((k) => /tax|shipTo|shipAddress|nexus|subsidiary|entity/i.test(k)).sort();
for (const k of taxish) {
  const v = (so as Record<string, unknown>)[k];
  console.log(`  ${k.padEnd(34)} ${typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v)}`);
}
console.log(`\n  tranId=${so.tranId}  total=${so.total}  subtotal=${so.subtotal}  taxTotal=${so.taxTotal}`);

console.log("\n── lines ──");
const items = so.item?.items ?? [];
console.log(`line count: ${items.length}`);
for (const [i, ln] of items.entries()) {
  const keys = Object.keys(ln).filter((k) => /tax|price|rate|amount|quantity|item|cost/i.test(k)).sort();
  console.log(`\n  [${i}] ${ln.item?.refName ?? ln.item?.id ?? "?"}`);
  for (const k of keys) {
    const v = ln[k];
    console.log(`      ${k.padEnd(26)} ${typeof v === "object" ? JSON.stringify(v).slice(0, 110) : String(v)}`);
  }
}

console.log("\n── is the CUSTOMER configured taxable? ──");
const custId = so.entity?.id;
if (custId) {
  const c = await nsRequest<Record<string, any>>({
    method: "GET", path: `/record/v1/customer/${encodeURIComponent(String(custId))}`,
  });
  for (const k of Object.keys(c).filter((k) => /tax|nexus|shipComplete|defaultAddress/i.test(k)).sort()) {
    const v = c[k];
    console.log(`  ${k.padEnd(30)} ${typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v)}`);
  }
}

console.log("\n── do the ITEM masters force taxable treatment? ──");
const itemIds = [...new Set(items.map((l: Record<string, any>) => l.item?.id).filter(Boolean))];
for (const id of itemIds) {
  try {
    const r = await suiteQL<Record<string, unknown>>(
      `SELECT id, itemid, itemtype, istaxable, taxschedule FROM item WHERE id = ${Number(id)}`,
    );
    console.log(`  item ${id}: ${JSON.stringify(r.items?.[0] ?? r)}`);
  } catch (e) { console.log(`  item ${id}: READ FAILED (indeterminate) — ${String(e).slice(0, 110)}`); }
}

console.log("\n── which tax model? ──");
console.log(`  header has 'taxDetails'      : ${Object.prototype.hasOwnProperty.call(so, "taxDetails")}  (SuiteTax marker)`);
console.log(`  header has 'taxItem'         : ${Object.prototype.hasOwnProperty.call(so, "taxItem")}   (legacy marker)`);
console.log(`  header has 'isTaxable'       : ${Object.prototype.hasOwnProperty.call(so, "isTaxable")}`);
console.log(`  first line has 'taxCode'     : ${items[0] ? Object.prototype.hasOwnProperty.call(items[0], "taxCode") : "n/a"}`);
console.log(`  first line has 'taxDetails'  : ${items[0] ? Object.prototype.hasOwnProperty.call(items[0], "taxDetails") : "n/a"}`);
process.exit(0);
