import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
} from "@/db/schema";
import { centsFromFrozen, decimalFromCents } from "@/lib/netsuite/frozen-cents";
import { emitAccountingLines } from "@/lib/netsuite/accounting-line-emitter";
import { assessProjectionReadiness } from "@/lib/netsuite/projection-readiness";
import { checkLinkA, checkLinkB } from "@/lib/netsuite/reg4";
import type { Reg4Failure, Reg4Line } from "@/lib/netsuite/reg4";
import type { ProjectionBlocker } from "@/lib/netsuite/projection-readiness";
import type { ResolveResult } from "@/lib/netsuite/item-resolver-types";
import type { Bv011Destination } from "@/lib/netsuite/bv011-destinations";

/**
 * Build a complete Sales Order from the frozen accepted column, or refuse.
 *
 * ── EVERY COMMERCIAL LINE COMES FROM THE FROZEN MATRIX ───────────────────
 *
 * Products included. There is no second source and no parameter through which
 * a caller could supply one — an `additionalLines` escape hatch existed here
 * briefly and was removed, because a reconciliation is only as exact as its
 * least-controlled half. An order assembled from the frozen column for its
 * service lines and live costing for its product lines would reconcile against
 * whichever half the check happened to cover, which is precisely the shape
 * that let the OTC gap survive.
 *
 * ── EACH LINE KIND HAS EXACTLY ONE RESOLVER ──────────────────────────────
 *
 *   item_group_member, direct_product   SKU-match, the existing push authority
 *   direct_service                      governed destination / service mapping
 *   otc                                 governed BV-011 destination mapping
 *   otc · OTC - Other Service           its FROZEN per-line selection
 *
 * The first is resolved here because it needs a NetSuite round trip; the rest
 * are DB-decidable and come back from `assessProjectionReadiness` already
 * resolved. The sets are disjoint, so each line is resolved once, in one place.
 * Two resolvers for one kind would be two answers to "which item is this"
 * (Pattern 58) — and would let readiness certify a line the emitter then sends
 * somewhere else.
 *
 * ── ORDER OF REFUSAL ─────────────────────────────────────────────────────
 *
 *   1  readiness — provisional tier, unmapped destination, unresolved per-line
 *      selection, legacy combined charge, missing matrix
 *   2  REG-4 link A — the frozen record agrees with itself
 *   3  product SKU resolution
 *   4  emit
 *   5  REG-4 link B — the COMPLETE emitted order sums to the frozen total, and
 *      every line's quantity × rate reproduces its frozen amount
 *
 * This function performs no NetSuite WRITE. It resolves items and returns lines
 * for a caller to post, so a refusal cannot arrive after something was sent.
 */

type Exec = Pick<typeof db, "select">;

/** Resolve a Nexus SKU to a NetSuite item. The existing push-time authority. */
export type SkuResolver = (sku: string) => Promise<ResolveResult>;

export type FrozenSalesOrderLine = Reg4Line & {
  kind: "item_group_member" | "direct_product" | "direct_service" | "otc";
  netsuiteItemId: string;
  /** The Nexus SKU, for the round-trip breadcrumb. Null on a fee line. */
  sku: string | null;
  /** The governed commercial identity. Null on a fee line, which owns no leaf. */
  quoteLeafId: string | null;
  /** OD-006 — the owning Item Group, or null for a top-level line. */
  owningAssemblyId: string | null;
  /**
   * The frozen BV-011 destination. Null on a product line, which resolves by
   * SKU and has no destination at all.
   *
   * Carried so a caller can resolve the line's LIVE cost source without
   * re-deriving which fee produced it. It is a frozen attribute — the column
   * is on the snapshot row — so carrying it here mixes nothing.
   */
  destination: Bv011Destination | null;
};

export type FrozenSalesOrder =
  | {
      ok: true;
      acceptedTierId: string;
      /** The COMPLETE order. Products, services and fees alike. */
      lines: FrozenSalesOrderLine[];
      totalCents: number;
      /** Every frozen line id posted, for the provenance write after POST. */
      postedSourceLineIds: string[];
    }
  | { ok: false; blockers: ProjectionBlocker[]; reg4: Reg4Failure[] };

export async function buildFrozenSalesOrder(
  quoteId: string,
  opts: { exec?: Exec; resolveSku: SkuResolver },
): Promise<FrozenSalesOrder> {
  const exec = opts.exec ?? db;

  // ── 1 · readiness, provisional refusal first ───────────────────────────
  const readiness = await assessProjectionReadiness(quoteId, exec);
  if (!readiness.ready) {
    return { ok: false, blockers: readiness.blockers, reg4: [] };
  }

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

  const frozen = await exec
    .select({
      sourceLineId: quoteSnapshotLines.id,
      kind: quoteSnapshotLines.lineKind,
      quoteLeafId: quoteSnapshotLines.quoteLeafId,
      description: quoteSnapshotLines.displayName,
      sku: quoteSnapshotLines.displaySku,
      owningAssemblyId: quoteSnapshotLines.owningAssemblyId,
      destination: quoteSnapshotLines.bv011Destination,
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
    )
    .orderBy(quoteSnapshotLines.position);

  // ── 2 · link A ─────────────────────────────────────────────────────────
  const linkA = checkLinkA(
    frozen.map((r) => ({
      sourceLineId: r.sourceLineId,
      description: r.description,
      quantity: r.quantity ?? 1,
      rate: r.rate ?? "0",
      amount: r.amount ?? "0",
    })),
    tierTotal?.total ?? "0",
  );
  if (linkA.length > 0) return { ok: false, blockers: [], reg4: linkA };
  const frozenSumCents = centsFromFrozen(tierTotal?.total ?? "0");

  // ── 3 · product lines, resolved by SKU ─────────────────────────────────
  const blockers: ProjectionBlocker[] = [];
  const productLines: FrozenSalesOrderLine[] = [];

  for (const row of frozen) {
    if (row.kind !== "item_group_member" && row.kind !== "direct_product") continue;

    const sku = (row.sku ?? "").trim();
    if (sku === "") {
      blockers.push({
        kind: "product_sku_missing",
        lineId: row.sourceLineId,
        displayName: row.description,
        remediation: `"${row.description}" was frozen without a SKU, so its NetSuite item cannot be matched. Give the product a SKU, then revise and re-send.`,
      });
      continue;
    }

    const resolution = await opts.resolveSku(sku);
    if (resolution.status !== "found") {
      blockers.push({
        kind: "product_item_unresolved",
        lineId: row.sourceLineId,
        displayName: row.description,
        sku,
        remediation:
          resolution.status === "ambiguous"
            ? `"${sku}" matches more than one NetSuite item. Ambiguity is a catalog problem — settle it in NetSuite rather than letting the push pick one.`
            : `No active NetSuite item has the code "${sku}". Nothing was posted.`,
      });
      continue;
    }

    productLines.push({
      sourceLineId: row.sourceLineId,
      kind: row.kind,
      description: row.description,
      sku,
      quoteLeafId: row.quoteLeafId,
      owningAssemblyId: row.owningAssemblyId,
      // A product has no destination by construction — it resolves by SKU.
      destination: null,
      netsuiteItemId: resolution.netsuiteItemId,
      // Frozen, all three. The quantity and rate are what NetSuite multiplies;
      // the amount is what that product must reproduce.
      quantity: row.quantity ?? 1,
      rate: row.rate ?? "0",
      amount: row.amount ?? "0",
    });
  }

  if (blockers.length > 0) return { ok: false, blockers, reg4: [] };

  // ── 4 · emit the quantity-1 half ───────────────────────────────────────
  const byId = new Map(frozen.map((r) => [r.sourceLineId, r] as const));
  const accounting: FrozenSalesOrderLine[] = emitAccountingLines(readiness.lines).map(
    (l) => ({
      sourceLineId: l.sourceLineId,
      kind: (byId.get(l.sourceLineId)?.kind === "direct_service"
        ? "direct_service"
        : "otc") as "direct_service" | "otc",
      description: l.description,
      sku: byId.get(l.sourceLineId)?.sku ?? null,
      quoteLeafId: byId.get(l.sourceLineId)?.quoteLeafId ?? null,
      owningAssemblyId: l.owningAssemblyId,
      destination: byId.get(l.sourceLineId)?.destination ?? null,
      netsuiteItemId: l.netsuiteItemId,
      quantity: l.quantity,
      // Quantity is 1, so rate and amount are the same integer cents rendered
      // twice — neither derived from the other.
      rate: decimalFromCents(l.rateCents),
      amount: decimalFromCents(l.amountCents),
    }),
  );

  // Frozen `position` order, so the order reads like the document the customer
  // received rather than grouped by how Nexus happens to resolve each kind.
  const position = new Map(frozen.map((r, i) => [r.sourceLineId, i] as const));
  const all = [...productLines, ...accounting].sort(
    (a, b) =>
      (position.get(a.sourceLineId) ?? 0) - (position.get(b.sourceLineId) ?? 0),
  );

  // ── 5 · link B over the COMPLETE order ─────────────────────────────────
  const linkB = checkLinkB(all, frozenSumCents);
  if (linkB.length > 0) return { ok: false, blockers: [], reg4: linkB };

  return {
    ok: true,
    acceptedTierId: readiness.acceptedTierId,
    lines: all,
    totalCents: frozenSumCents,
    postedSourceLineIds: all.map((l) => l.sourceLineId),
  };
}
