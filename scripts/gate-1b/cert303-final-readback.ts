/**
 * CERT-303 replacement witness — frozen vs posted, read from the provider.
 * READ ONLY. Nothing is written anywhere.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes, quoteSnapshots, quoteSnapshotLines, quoteSnapshotLineTiers, quoteSnapshotTierTotals,
} from "@/db/schema";
import { nsRequest } from "@/lib/netsuite/client";

const Q = process.argv[2] ?? "1812bd65-dc01-4043-9e18-5d6885233c0a";
const [q] = await db.select().from(quotes).where(eq(quotes.id, Q));
console.log(`quote ${q.quoteNumber} · ${q.status} · ${q.netsuiteSoTranid} (${q.netsuiteSoId})`);

const snaps = await db.select().from(quoteSnapshots).where(eq(quoteSnapshots.quoteId, Q));
const cur = snaps.find((s) => s.supersededAt === null)!;
const lines = await db.select().from(quoteSnapshotLines).where(eq(quoteSnapshotLines.quoteSnapshotId, cur.id));

console.log("\n── FROZEN ──");
const frozen: Array<Record<string, unknown>> = [];
for (const l of lines) {
  const lt = await db.select().from(quoteSnapshotLineTiers).where(eq(quoteSnapshotLineTiers.quoteSnapshotLineId, l.id));
  const t = lt.find((x) => x.tierId === q.acceptedTierId)!;
  frozen.push({ sku: l.displaySku, kind: l.lineKind, dest: l.bv011Destination,
    qty: t.quantity, unitRate: t.unitRate, amount: t.lineAmount,
    selected: l.selectedNetsuiteItemId, posted: l.netsuiteItemId });
}
console.table(frozen);
const tot = await db.select().from(quoteSnapshotTierTotals).where(eq(quoteSnapshotTierTotals.quoteSnapshotId, cur.id));
const at = tot.find((t) => t.tierId === q.acceptedTierId)!;
console.log(`frozen tier commercial total = ${at.tierCommercialTotal}`);

console.log("\n── POSTED (provider) ──");
const so = await nsRequest<Record<string, any>>({
  method: "GET", path: `/record/v1/salesOrder/${q.netsuiteSoId}?expandSubResources=true`,
});
const posted: Array<Record<string, unknown>> = [];
for (const ln of so.item?.items ?? []) {
  const pl = ln.price;
  posted.push({ item: ln.item?.refName, id: ln.item?.id, qty: ln.quantity, rate: ln.rate,
    amount: ln.amount, taxCode: ln.taxCode?.refName, costType: ln.costEstimateType?.id,
    costRate: ln.costEstimateRate, unitCostCol: ln.custcol_dps_unit_cost,
    priceLevel: pl?.id ?? pl?.links?.[0]?.href?.split("/").pop() ?? null });
}
console.table(posted);
console.log(`header subtotal=${so.subtotal} total=${so.total} taxTotal=${so.taxTotal}`);

console.log("\n── VERDICT ──");
const f = frozen[0], p = posted[0];
const check = (label: string, ok: boolean, got: unknown) =>
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${String(got)}`);
check("quantity = 2,000", p.qty === 2000, p.qty);
check("rate = 2.24", Number(p.rate) === 2.24, p.rate);
check("amount = 4,480.00", Number(p.amount) === 4480, p.amount);
check("CUSTOM cost type", p.costType === "CUSTOM", p.costType);
check("cost rate = 1.60", Number(p.costRate) === 1.6, p.costRate);
check("tax code = -8 (-Not Taxable-)", p.taxCode === "-Not Taxable-", p.taxCode);
check("tax total = 0", Number(so.taxTotal) === 0, so.taxTotal);
check("item = OTC-0016 / 15323", String(p.id) === "15323", `${p.item} / ${p.id}`);
check("selected intent = posted provenance",
  f.selected === f.posted && String(f.posted) === String(p.id), `${f.selected} -> ${f.posted} -> ${p.id}`);
const fc = Math.round(Number(at.tierCommercialTotal) * 100), pc = Math.round(Number(so.subtotal) * 100);
check("REG-4 exact", fc === pc, `${fc}c vs ${pc}c`);
check("price level = -1 (Custom)", String(p.priceLevel) === "-1", p.priceLevel);
check("subtotal = total = 4,480.00", Number(so.subtotal) === 4480 && Number(so.total) === 4480, `${so.subtotal} / ${so.total}`);
check("posted qty/rate match FROZEN shape",
  p.qty === f.qty && Number(p.rate) === Number(f.unitRate),
  `frozen ${f.qty} x ${f.unitRate}  posted ${p.qty} x ${p.rate}`);
process.exit(0);
