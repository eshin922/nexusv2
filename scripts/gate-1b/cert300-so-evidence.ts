/**
 * F1/F4 certification evidence — reads the REAL Sales Order back and checks it
 * against the frozen accepted column. READ ONLY; nothing is written anywhere.
 *
 * The point is to verify against PROVIDER STATE rather than against what Nexus
 * believes it sent. Every figure below comes from either NetSuite or the frozen
 * snapshot; none is recomputed from live costing, which is the whole claim
 * under test.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  auditLog,
  netsuiteSoPushes,
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { readSalesOrderHeader, readSalesOrderLines } from "@/lib/netsuite/item-groups";
import { centsFromFrozen, decimalFromCents } from "@/lib/netsuite/frozen-cents";

const QUOTE_ID = process.argv[2] ?? "97d25286-2c42-4a72-8979-89f1a5c2cf26";

const [q] = await db
  .select({
    status: quotes.status,
    acceptedTierId: quotes.acceptedTierId,
    soId: quotes.netsuiteSoId,
    tranid: quotes.netsuiteSoTranid,
    pushStatus: quotes.netsuiteSoPushStatus,
  })
  .from(quotes)
  .where(eq(quotes.id, QUOTE_ID));

console.log("── quote ─────────────────────────────────────────────");
console.log(q);
if (!q?.soId) {
  console.log("no Sales Order id on the quote — nothing to verify");
  process.exit(1);
}

const [snapshot] = await db
  .select({ id: quoteSnapshots.id, detailLevel: quoteSnapshots.detailLevel })
  .from(quoteSnapshots)
  .where(and(eq(quoteSnapshots.quoteId, QUOTE_ID), isNull(quoteSnapshots.supersededAt)));

const [tierTotal] = await db
  .select({ total: quoteSnapshotTierTotals.tierCommercialTotal })
  .from(quoteSnapshotTierTotals)
  .where(
    and(
      eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshot.id),
      eq(quoteSnapshotTierTotals.tierId, q.acceptedTierId as string),
    ),
  );

const frozen = await db
  .select({
    id: quoteSnapshotLines.id,
    kind: quoteSnapshotLines.lineKind,
    name: quoteSnapshotLines.displayName,
    sku: quoteSnapshotLines.displaySku,
    destination: quoteSnapshotLines.bv011Destination,
    postedItemId: quoteSnapshotLines.netsuiteItemId,
    selectedItemId: quoteSnapshotLines.selectedNetsuiteItemId,
    owningAssemblyId: quoteSnapshotLines.owningAssemblyId,
    quantity: quoteSnapshotLineTiers.quantity,
    rate: quoteSnapshotLineTiers.unitRate,
    amount: quoteSnapshotLineTiers.lineAmount,
  })
  .from(quoteSnapshotLines)
  .innerJoin(
    quoteSnapshotLineTiers,
    eq(quoteSnapshotLineTiers.quoteSnapshotLineId, quoteSnapshotLines.id),
  )
  .where(
    and(
      eq(quoteSnapshotLines.quoteSnapshotId, snapshot.id),
      eq(quoteSnapshotLineTiers.tierId, q.acceptedTierId as string),
      eq(quoteSnapshotLineTiers.pricingState, "priced"),
    ),
  )
  .orderBy(quoteSnapshotLines.position);

console.log("\n── FROZEN accepted column ────────────────────────────");
console.log("detail level:", snapshot.detailLevel, "· tier total:", tierTotal?.total);
console.table(
  frozen.map((f) => ({
    kind: f.kind,
    name: f.name.slice(0, 24),
    destination: f.destination,
    qty: f.quantity,
    rate: f.rate,
    amount: f.amount,
    postedItemId: f.postedItemId,
  })),
);

// ── the provider's own view ────────────────────────────────────────────────
console.log("\n── NETSUITE Sales Order (read back) ──────────────────");
const header = await readSalesOrderHeader(q.soId);
console.log("header:", header);

const lines = await readSalesOrderLines(q.soId);
console.table(
  lines.map((l) => ({
    addr: l.line,
    itemId: l.itemId,
    type: l.itemType,
    qty: l.quantity,
    rate: l.rate,
    amount: l.amount,
  })),
);

// ── proof 1 · structure preserved, not flattened ───────────────────────────
const groups = lines.filter((l) => l.itemType === "Group");
const endGroups = lines.filter((l) => l.itemType === "EndGroup");
const SYSTEM = new Set(["TaxGroup", "ShipItem", "Discount", "Subtotal", "Markup"]);
const commercial = lines.filter(
  (l) => l.itemType !== "Group" && l.itemType !== "EndGroup" && !SYSTEM.has(l.itemType ?? ""),
);
console.log("\n── PROOF 1 · Item Group structure ────────────────────");
console.log(`Group headers: ${groups.length} · EndGroup markers: ${endGroups.length}`);
console.log(
  groups.length > 0
    ? "PASS — the order carries Item Group structure; members were expanded by NetSuite, not flattened by Nexus."
    : "FAIL — no Group line on the order; the turnkey structure did not survive.",
);

// ── proof 2/6 · every commercial line reproduces its frozen amount ─────────
console.log("\n── PROOF 2 + 6 · amounts vs the frozen column ────────");
let soCommercialCents = 0;
for (const l of commercial) soCommercialCents += Math.round((l.amount ?? 0) * 100);
const frozenTotalCents = centsFromFrozen(tierTotal?.total ?? "0");
console.log(
  `Σ NetSuite commercial line amounts = ${decimalFromCents(soCommercialCents)}`,
);
console.log(`frozen tier_commercial_total   = ${decimalFromCents(frozenTotalCents)}`);
console.log(
  soCommercialCents === frozenTotalCents
    ? "PASS — exact to the cent."
    : `FAIL — difference ${decimalFromCents(soCommercialCents - frozenTotalCents)}`,
);

// per-line, matched by posted item id
console.log("\nper-line reconciliation (matched on posted netsuite_item_id):");
const rows = frozen.map((f) => {
  const match = commercial.filter((l) => String(l.itemId) === String(f.postedItemId));
  const soAmountCents = match.reduce((s, l) => s + Math.round((l.amount ?? 0) * 100), 0);
  const frozenCents = centsFromFrozen(f.amount);
  return {
    name: f.name.slice(0, 22),
    kind: f.kind,
    postedItem: f.postedItemId,
    soLines: match.length,
    soQty: match.map((m) => m.quantity).join("|"),
    soRate: match.map((m) => m.rate).join("|"),
    soAmount: decimalFromCents(soAmountCents),
    frozenAmount: f.amount,
    exact: soAmountCents === frozenCents ? "YES" : "NO",
  };
});
console.table(rows);

// ── proof 3/4 · quantity-1 accounting lines ───────────────────────────────
console.log("\n── PROOF 3 + 4 · quantity-1 accounting lines ─────────");
for (const f of frozen.filter((x) => x.kind === "direct_service" || x.kind === "otc")) {
  const match = commercial.filter((l) => String(l.itemId) === String(f.postedItemId));
  for (const m of match) {
    console.log(
      `${f.kind.padEnd(15)} "${f.name}" -> item ${m.itemId} · qty ${m.quantity} · rate ${m.rate} · amount ${m.amount} · destination ${f.destination}`,
    );
    console.log(
      Number(m.quantity) === 1
        ? "   PASS — posted at quantity 1."
        : `   FAIL — posted at quantity ${m.quantity}, not 1.`,
    );
  }
  if (match.length === 0) console.log(`${f.kind} "${f.name}" — ABSENT from the order.`);
}

// ── proof 5 · provenance ───────────────────────────────────────────────────
console.log("\n── PROOF 5 · posting provenance ──────────────────────");
console.table(
  frozen.map((f) => ({
    name: f.name.slice(0, 24),
    selected_intent: f.selectedItemId,
    posted_actual: f.postedItemId,
    onOrder: commercial.some((l) => String(l.itemId) === String(f.postedItemId))
      ? "yes"
      : "NO",
  })),
);

// ── the attempt ledger + audit row ─────────────────────────────────────────
const [push] = await db
  .select({
    status: netsuiteSoPushes.status,
    soId: netsuiteSoPushes.netsuiteSoId,
    tranid: netsuiteSoPushes.netsuiteSoTranid,
    amount: netsuiteSoPushes.amountPushed,
  })
  .from(netsuiteSoPushes)
  .where(eq(netsuiteSoPushes.quoteId, QUOTE_ID))
  .orderBy(desc(netsuiteSoPushes.createdAt));
console.log("\n── attempt ledger ────────────────────────────────────");
console.log(push);

const [completed] = await db
  .select({ diff: auditLog.diffJson, at: auditLog.createdAt })
  .from(auditLog)
  .where(and(eq(auditLog.entityId, QUOTE_ID), eq(auditLog.action, "quote_completed")))
  .orderBy(desc(auditLog.createdAt))
  .limit(1);
console.log("\n── quote_completed audit diff_json ───────────────────");
console.log(JSON.stringify(completed?.diff, null, 2));

process.exit(0);
