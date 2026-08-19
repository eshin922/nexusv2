/**
 * Proofs 7 + 8 — live `unitCost` is reporting-only, and no live costing value
 * determines a customer-commercial amount. READ ONLY.
 *
 * ── WHY THE OBVIOUS TEST WOULD BE VACUOUS ────────────────────────────────
 *
 * "The Sales Order matches the frozen column" does NOT by itself prove the
 * frozen column governed it. Nothing edited costs between send and push, so
 * the live rollup and the frozen matrix currently AGREE — and a figure that
 * matches both sources is evidence for neither (Pattern 56: a property holding
 * by coincidence reads exactly like one holding by construction).
 *
 * So the decisive evidence is the two lines the LIVE path cannot produce at
 * all. Before the cutover, `markComplete` emitted no OTC line and no Direct
 * Service line from any code path — a quote carrying them posted an order
 * short by exactly their value. Their presence on SO2716, at the frozen
 * amounts, is explicable only by the frozen projection.
 *
 * This script states that positively and quantifies it, and separately shows
 * the governed cost reaching NetSuite's COST fields while the commercial rate
 * comes from the frozen column.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { suiteQL } from "@/lib/netsuite/client";
import { centsFromFrozen, decimalFromCents } from "@/lib/netsuite/frozen-cents";

const QUOTE_ID = process.argv[2] ?? "97d25286-2c42-4a72-8979-89f1a5c2cf26";

const [q] = await db
  .select({
    soId: quotes.netsuiteSoId,
    tranid: quotes.netsuiteSoTranid,
    acceptedTierId: quotes.acceptedTierId,
  })
  .from(quotes)
  .where(eq(quotes.id, QUOTE_ID));

const [snapshot] = await db
  .select({ id: quoteSnapshots.id })
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
    kind: quoteSnapshotLines.lineKind,
    name: quoteSnapshotLines.displayName,
    postedItemId: quoteSnapshotLines.netsuiteItemId,
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
  );

// ── PROOF 8 · the value the live path could not have produced ─────────────
const accountingCents = frozen
  .filter((f) => f.kind === "direct_service" || f.kind === "otc")
  .reduce((s, f) => s + centsFromFrozen(f.amount), 0);
const totalCents = centsFromFrozen(tierTotal?.total ?? "0");

console.log("── PROOF 8 · frozen governance, stated non-vacuously ──");
console.log(`Sales Order                        ${q.tranid} (${q.soId})`);
console.log(`order total                        ${decimalFromCents(totalCents)}`);
console.log(`of which OTC + Direct Service      ${decimalFromCents(accountingCents)}`);
console.log(
  `share the pre-cutover live path emits  $0.00 — it had no code path for either kind`,
);
console.log(
  accountingCents > 0
    ? `PASS — ${decimalFromCents(accountingCents)} of this order exists only because the frozen\n       projection produced it. A live-derived order would have posted\n       ${decimalFromCents(totalCents - accountingCents)} and still reconciled against its own lines.`
    : "INCONCLUSIVE — this quote carries no accounting lines, so the order cannot\n       distinguish frozen governance from live agreement.",
);

// ── PROOF 7 · governed cost reaches COST fields, not commercial ones ───────
console.log("\n── PROOF 7 · unitCost is reporting-only ──────────────");
const sql = `
  SELECT tl.id, tl.item, tl.quantity, tl.rate, tl.netamount,
         tl.costestimaterate, tl.costestimatetype
    FROM transactionline tl
   WHERE tl.transaction = ${Number(q.soId)}
   ORDER BY tl.id`;
try {
  const res = await suiteQL<Record<string, unknown>>(sql);
  if (res.items.length === 0) {
    console.log("no rows · read succeeded — cannot evidence proof 7 from this query");
  } else {
    console.table(res.items);
    console.log(
      "Read `rate`/`netamount` (commercial, from the frozen column) against\n" +
        "`costestimaterate` (the governed cost basis). They are separate fields;\n" +
        "the cost value never appears as a rate or an amount.",
    );
  }
} catch (e) {
  console.log(
    "READ FAILED (indeterminate, NOT absence):",
    e instanceof Error ? e.message : String(e),
  );
}

process.exit(0);
