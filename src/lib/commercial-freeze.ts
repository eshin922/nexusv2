import { and, eq, isNull } from "drizzle-orm";

import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { publishedCents, verifyProjectionTotals } from "@/lib/commercial-projection";
import { derivePostedRate } from "@/lib/commercial-rate";
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
  // EVERY AMOUNT ARRIVES ALREADY PUBLISHED.
  //
  // `projectCommercial` normalises the matrix to cents at its publication
  // boundary, which is what makes the `toFixed(2)` calls below an identity
  // rather than a second, independent rounding. Asserted rather than assumed:
  // an amount that is not already its own published value means something
  // reached this function without crossing that boundary, and the record it
  // would persist is the one whose totals cannot be trusted.
  for (const line of projection.lines) {
    for (const cell of line.cells) {
      if (cell.state !== "priced") continue;
      if (cell.lineAmount !== publishedCents(cell.lineAmount)) {
        throw new Error(
          `Commercial freeze aborted — "${line.displayName}" carries an ` +
            `unpublished amount ${cell.lineAmount}. Amounts must be governed ` +
            `cents before they are frozen. Nothing was frozen.`,
        );
      }
    }
  }

  // Self-consistency before persistence. A matrix whose stated totals do not
  // equal the sum of its own cells is not a record of anything, and it is
  // cheaper to refuse the send than to discover it at Sales Order time.
  //
  // Exact to the cent since the publication boundary; see
  // `verifyProjectionTotals` for why the tolerance it used to carry was the
  // thing that let DPS-1072 Tier 2 persist a stated total a cent away from
  // its own lines.
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

      // THE RATE IS DERIVED FROM THE AMOUNT, not rounded alongside it.
      //
      // `cell.lineAmount` is `rate × qty` at full precision, and rounding the
      // two independently is what let them disagree: the rate lost up to
      // 5e-5, the amount kept it, and `quantity × rate` then missed the
      // accepted figure by up to `5e-5 × quantity`. Deriving makes the amount
      // the authority and the rate its representation — which is what it is,
      // since NetSuite computes the amount from the rate rather than being
      // told it.
      //
      // Refusal, not repair: if scale 8 cannot represent the line, the send
      // stops here. Adjusting the accepted amount to fit the arithmetic is not
      // a decision this code is entitled to make.
      let unitRate: string | null = null;
      if (cell.state === "priced") {
        const amount = cell.lineAmount.toFixed(2);
        const derived = derivePostedRate(amount, cell.quantity);
        if (!derived.ok) {
          throw new Error(
            `Commercial freeze aborted — "${line.displayName}" at ${tier.tierLabel} ` +
              `cannot be posted at a representable rate: ${derived.reason} ` +
              `Nothing was frozen.`,
          );
        }
        unitRate = derived.rate;
      }

      await tx.insert(quoteSnapshotLineTiers).values({
        quoteSnapshotLineId: row.id,
        tierId: tier.tierId,
        tierLabel: tier.tierLabel,
        // The LINE's quantity, not the tier's. Storing the tier's put a
        // one-time $140 charge on record as 1,000 units — the amount was
        // right, but anything multiplying the row got 1000x the fee.
        quantity: cell.state === "priced" ? cell.quantity : tier.quantity,
        pricingState: cell.state === "priced" ? "priced" : "quote_on_request",
        unitRate,
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
