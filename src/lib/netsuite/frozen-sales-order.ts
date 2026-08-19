import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { centsFromFrozen } from "@/lib/netsuite/frozen-cents";
import { emitAccountingLines } from "@/lib/netsuite/accounting-line-emitter";
import { assessProjectionReadiness } from "@/lib/netsuite/projection-readiness";
import { checkLinkA, checkLinkB } from "@/lib/netsuite/reg4";
import type { Reg4Failure, Reg4Line } from "@/lib/netsuite/reg4";
import type { ProjectionBlocker } from "@/lib/netsuite/projection-readiness";

/**
 * Build a Sales Order from the frozen accepted column, or refuse and say why.
 *
 * ── THE ORDER OF THESE STEPS IS THE POINT ────────────────────────────────
 *
 * Every refusal happens BEFORE anything could be written to NetSuite. That is
 * not a comment about intent: this function performs no NetSuite call at all.
 * It returns lines for a caller to post, so a refusal cannot be "too late" —
 * there is nothing to unwind, because nothing has been sent.
 *
 *   1  readiness — provisional tier, unmapped destination, unresolved
 *      per-line selection, legacy combined charge, missing matrix
 *   2  REG-4 link A — the frozen record agrees with itself
 *   3  emit — quantity-1 accounting lines, amounts carried
 *   4  REG-4 link B — the emitted set sums to the frozen total, and each
 *      line's quantity × rate reproduces its frozen amount
 *
 * A provisional tier is refused first among the commercial checks because it is
 * the one that is not an error at all: the quote was deliberately sent with a
 * line priced "on request", and its total was printed as "from $X". There is
 * nothing to fix in the record — you cannot post an order for a number the
 * customer was told was a floor.
 *
 * ── WHAT THIS DOES NOT YET DO ────────────────────────────────────────────
 *
 * Product lines. An `item_group_member` or `direct_product` resolves by SKU
 * through the existing resolver on the existing per-leaf path, and is supplied
 * by the caller via `additionalLines`. This assembles the quantity-1 half and
 * reconciles the UNION, so link B covers the whole order rather than the half
 * this module happens to produce.
 */

type Exec = Pick<typeof db, "select">;

export type FrozenSalesOrder =
  | {
      ok: true;
      acceptedTierId: string;
      /** Every line to post, quantity-1 and product alike. */
      lines: Reg4Line[];
      /** The frozen accepted total, in integer cents. */
      totalCents: number;
      /** For the provenance write after a successful POST. */
      accountingLineIds: string[];
    }
  | { ok: false; blockers: ProjectionBlocker[]; reg4: Reg4Failure[] };

export async function buildFrozenSalesOrder(
  quoteId: string,
  opts: { exec?: Exec; additionalLines?: ReadonlyArray<Reg4Line> } = {},
): Promise<FrozenSalesOrder> {
  const exec = opts.exec ?? db;

  // ── 1 · readiness, including the provisional refusal ───────────────────
  const readiness = await assessProjectionReadiness(quoteId, exec);
  if (!readiness.ready) {
    return { ok: false, blockers: readiness.blockers, reg4: [] };
  }

  // ── 2 · link A, against the frozen record as it stands right now ───────
  //
  // The freeze already guaranteed this at send, twice. Re-checking here asks a
  // different question: not "was the record consistent when written" but "is it
  // consistent at the moment an order is being built from it".
  const [snapshot] = await exec
    .select({ id: quoteSnapshots.id })
    .from(quoteSnapshots)
    .where(
      and(eq(quoteSnapshots.quoteId, quoteId), isNull(quoteSnapshots.supersededAt)),
    );
  if (!snapshot) {
    return {
      ok: false,
      blockers: [
        {
          kind: "no_frozen_matrix",
          remediation:
            "This quote has no current frozen matrix. Revise and re-send before pushing.",
        },
      ],
      reg4: [],
    };
  }

  const [tierTotal] = await exec
    .select({ total: quoteSnapshotTierTotals.tierCommercialTotal })
    .from(quoteSnapshotTierTotals)
    .where(
      and(
        eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshot.id),
        eq(quoteSnapshotTierTotals.tierId, readiness.acceptedTierId),
      ),
    );

  const frozenPriced = await exec
    .select({
      sourceLineId: quoteSnapshotLines.id,
      description: quoteSnapshotLines.displayName,
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
        eq(quoteSnapshotLineTiers.tierId, readiness.acceptedTierId),
        eq(quoteSnapshotLineTiers.pricingState, "priced"),
      ),
    );

  const frozenLines: Reg4Line[] = frozenPriced.map((r) => ({
    sourceLineId: r.sourceLineId,
    description: r.description,
    quantity: r.quantity ?? 1,
    rate: r.rate ?? "0",
    amount: r.amount ?? "0",
  }));

  const linkA = checkLinkA(frozenLines, tierTotal?.total ?? "0");
  if (linkA.length > 0) return { ok: false, blockers: [], reg4: linkA };

  const frozenSumCents = centsFromFrozen(tierTotal?.total ?? "0");

  // ── 3 · emit ───────────────────────────────────────────────────────────
  const accounting = emitAccountingLines(readiness.lines);
  const accountingAsReg4: Reg4Line[] = accounting.map((l) => ({
    sourceLineId: l.sourceLineId,
    description: l.description,
    quantity: l.quantity,
    // Quantity is 1, so the rate IS the amount. Rendered from the same integer
    // cents both come from, never re-derived from the other.
    rate: centsToDecimal(l.rateCents),
    amount: centsToDecimal(l.amountCents),
  }));

  const all = [...accountingAsReg4, ...(opts.additionalLines ?? [])];

  // ── 4 · link B, over the whole order ───────────────────────────────────
  const linkB = checkLinkB(all, frozenSumCents);
  if (linkB.length > 0) return { ok: false, blockers: [], reg4: linkB };

  return {
    ok: true,
    acceptedTierId: readiness.acceptedTierId,
    lines: all,
    totalCents: frozenSumCents,
    accountingLineIds: accounting.map((l) => l.sourceLineId),
  };
}

/** Integer cents as a 2-decimal string. String formatting, not arithmetic. */
function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
