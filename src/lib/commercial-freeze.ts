import { and, eq, isNull } from "drizzle-orm";

import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { verifyProjectionTotals } from "@/lib/commercial-projection";
import type { CommercialProjection } from "@/lib/commercial-projection";
import type { db as Db } from "@/db";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * Freeze the commercial line set for a send, inside the send transaction.
 *
 * Takes the projection the customer document was rendered FROM — not a
 * quote id to recompute from. Recomputing here would make "the frozen
 * matrix matches the PDF" a claim about two computations agreeing, which is
 * exactly the property that failed between the PDF and the Sales Order.
 */
export async function freezeCommercialLineSet(
  tx: Tx,
  quoteSnapshotId: string,
  projection: CommercialProjection,
): Promise<void> {
  // Self-consistency before persistence. A matrix whose stated totals do not
  // equal the sum of its own cells is not a record of anything, and it is
  // cheaper to refuse the send than to discover it at Sales Order time.
  const bad = verifyProjectionTotals(projection);
  if (bad.length > 0) {
    throw new Error(
      `Commercial freeze aborted — ${bad.length} tier total(s) disagree with the sum of their lines: ` +
        bad
          .map((b) => `${b.tierId} stated ${b.stated.toFixed(2)} vs summed ${b.summed.toFixed(2)}`)
          .join("; "),
    );
  }

  for (const t of projection.tiers) {
    await tx.insert(quoteSnapshotTierTotals).values({
      quoteSnapshotId,
      tierId: t.tierId,
      tierLabel: t.tierLabel,
      quantity: t.quantity,
      unitSubtotal: t.unitSubtotal.toFixed(2),
      otcSubtotal: t.otcSubtotal.toFixed(2),
      tierCommercialTotal: t.tierCommercialTotal.toFixed(2),
      totalIsProvisional: t.isProvisional,
    });
  }

  for (const [position, line] of projection.lines.entries()) {
    const [row] = await tx
      .insert(quoteSnapshotLines)
      .values({
        quoteSnapshotId,
        lineKind: line.kind,
        owningAssemblyId: line.owningAssemblyId,
        quoteLeafId: line.quoteLeafId,
        displayName: line.displayName,
        displaySku: line.displaySku,
        serviceIdentity: line.serviceIdentity,
        // Persisted so the frozen row is self-describing. Re-deriving it at
        // push time would mean string-matching `displayName`, and a copy
        // change would then silently repoint an accounting destination.
        bv011Destination: line.bv011Destination,
        legacyUnresolved: line.legacyUnresolved,
        // The per-line choice is frozen because for this destination the
        // operator's choice IS the governance — a commercial decision about
        // this quote, not firm configuration that can be corrected later.
        selectedNetsuiteItemId: line.selectedNetsuiteItem?.internalId ?? null,
        selectedNetsuiteItemCode: line.selectedNetsuiteItem?.code ?? null,
        // Left NULL here. Destination identity is resolved by the projection
        // slice that owns NetSuite mapping; inventing one at freeze time
        // would record a guess as a governed fact.
        netsuiteItemId: null,
        position,
      })
      .returning({ id: quoteSnapshotLines.id });

    for (const [i, cell] of line.cells.entries()) {
      const tier = projection.tiers[i];
      await tx.insert(quoteSnapshotLineTiers).values({
        quoteSnapshotLineId: row.id,
        tierId: tier.tierId,
        tierLabel: tier.tierLabel,
        // The LINE's quantity, not the tier's. Storing the tier's put a
        // one-time $140 charge on record as 1,000 units — the amount was
        // right, but anything multiplying the row got 1000x the fee.
        quantity: cell.state === "priced" ? cell.quantity : tier.quantity,
        pricingState: cell.state === "priced" ? "priced" : "quote_on_request",
        unitRate: cell.state === "priced" ? cell.unitRate.toFixed(4) : null,
        lineAmount: cell.state === "priced" ? cell.lineAmount.toFixed(2) : null,
        allocationState: line.allocationByTier[i],
      });
    }
  }
}

/**
 * The accepted commercial total — READ, never recomputed.
 *
 * A selection from the frozen matrix at the accepted tier's column. There is
 * one number and it is read twice, so the accepted figure cannot drift from
 * the offered one.
 *
 * Returns null when the quote has no current snapshot (a legacy send that
 * predates the freeze) or no accepted tier. Null means "not available from
 * the record" and must not be substituted with a live recomputation — that
 * substitution is what made the previous behaviour a convention.
 */
export async function readAcceptedCommercialTotal(
  tx: Tx,
  quoteId: string,
): Promise<{
  total: number;
  tierId: string;
  isProvisional: boolean;
} | null> {
  const [quote] = await tx
    .select({ acceptedTierId: quotes.customerAcceptedTierId })
    .from(quotes)
    .where(eq(quotes.id, quoteId));
  if (!quote?.acceptedTierId) return null;

  const [snapshot] = await tx
    .select({ id: quoteSnapshots.id })
    .from(quoteSnapshots)
    // `IS NULL`, not `= NULL`. The current version is the one that has not
    // been superseded, and an equality test against NULL is never true — it
    // would have returned no snapshot for every quote, always.
    .where(
      and(
        eq(quoteSnapshots.quoteId, quoteId),
        isNull(quoteSnapshots.supersededAt),
      ),
    );
  if (!snapshot) return null;

  const [row] = await tx
    .select({
      total: quoteSnapshotTierTotals.tierCommercialTotal,
      provisional: quoteSnapshotTierTotals.totalIsProvisional,
    })
    .from(quoteSnapshotTierTotals)
    .where(
      and(
        eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshot.id),
        eq(quoteSnapshotTierTotals.tierId, quote.acceptedTierId),
      ),
    );
  if (!row) return null;

  return {
    total: Number(row.total),
    tierId: quote.acceptedTierId,
    isProvisional: row.provisional,
  };
}
