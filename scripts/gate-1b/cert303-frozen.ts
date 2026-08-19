/** CERT-303 frozen commercial line set after SEND. READ ONLY. */
import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import {
  quotes, quoteSnapshots, quoteSnapshotLines, quoteSnapshotLineTiers,
  quoteSnapshotTierTotals, quoteOtherServiceItems,
} from "@/db/schema";

const QUOTE = "430b5ce4-975b-4262-8247-aee668f287a8";

const [q] = await db.select().from(quotes).where(eq(quotes.id, QUOTE)).limit(1);
console.log(`quote  status=${q.status}  number=${q.quoteNumber}  sent_at=${q.sentAt?.toISOString() ?? "(null)"}  pdf=${q.pdfUrl ? "present" : "(null)"}`);

const snaps = await db.select().from(quoteSnapshots).where(eq(quoteSnapshots.quoteId, QUOTE));
console.log(`snapshots: ${snaps.length}`);
const cur = snaps.find((s) => s.supersededAt === null);
if (!cur) { console.log("NO CURRENT SNAPSHOT — indeterminate"); process.exit(1); }
console.log(`current snapshot v${cur.versionNumber}  number=${cur.quoteNumber}  sent=${cur.sentAt.toISOString()}`);

const lines = await db.select().from(quoteSnapshotLines)
  .where(eq(quoteSnapshotLines.quoteSnapshotId, cur.id));
console.log(`\n── frozen lines: ${lines.length} ──`);
console.table(lines.map((l) => ({
  kind: l.lineKind,
  sku: l.displaySku,
  name: l.displayName.slice(0, 24),
  svcIdentity: l.serviceIdentity,
  dest: l.bv011Destination,
  legacyUnresolved: l.legacyUnresolved,
  selectedItemId: l.selectedNetsuiteItemId,
  selectedItemCode: l.selectedNetsuiteItemCode,
  postedItemId: l.netsuiteItemId,
  owningAsm: l.owningAssemblyId ? l.owningAssemblyId.slice(0, 8) : "(top-level)",
})));

for (const l of lines) {
  const lt = await db.select().from(quoteSnapshotLineTiers)
    .where(eq(quoteSnapshotLineTiers.quoteSnapshotLineId, l.id));
  console.log(`\nline "${l.displaySku ?? l.displayName}" per-tier:`);
  console.table(lt.map((r) => ({
    tier: r.tierLabel, state: r.pricingState, qty: r.quantity,
    unitRate: r.unitRate, lineAmount: r.lineAmount,
    check: r.unitRate && r.lineAmount && r.quantity != null
      ? (Number(r.unitRate) * r.quantity).toFixed(2) === Number(r.lineAmount).toFixed(2) ? "rate x qty = amount OK" : "MISMATCH"
      : "(unpriced)",
  })));
}

const tot = await db.select().from(quoteSnapshotTierTotals)
  .where(eq(quoteSnapshotTierTotals.quoteSnapshotId, cur.id));
console.log("\n── frozen tier totals ──");
console.table(tot.map((t) => ({
  tier: t.tierLabel, qty: t.quantity, unitSubtotal: t.unitSubtotal,
  otcSubtotal: t.otcSubtotal, commercialTotal: t.tierCommercialTotal,
})));

console.log("\n── live per-line NetSuite selection ──");
const sel = await db.select().from(quoteOtherServiceItems)
  .where(eq(quoteOtherServiceItems.quoteId, QUOTE));
console.table(sel.map((s) => ({
  owner: s.quoteLeafId?.slice(0, 8) ?? "(none)",
  internalId: s.netsuiteInternalId, code: s.netsuiteItemCode,
})));
process.exit(0);
