import { eq, isNull, and } from "drizzle-orm";

import {
  netsuiteDestinationItemMap,
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { db } from "@/db";
import {
  bv011Label,
  isPerLineDestination,
} from "@/lib/netsuite/bv011-destinations";
import type { Bv011Destination } from "@/lib/netsuite/bv011-destinations";

/**
 * Can the accepted tier's frozen line set be projected to a Sales Order?
 *
 * Answered against the FROZEN record, never against live costing — the whole
 * point of the freeze is that the answer cannot drift after send.
 *
 * Every blocker names its own remediation. A projection that silently skipped
 * an unmappable line would emit a SHORT order that still reconciled to its own
 * short sum, which is exactly the failure mode REG-4 exists to catch and the
 * one that would be hardest to notice.
 */

export type ProjectionBlocker =
  | {
      kind: "legacy_combined_otc";
      /** The frozen line that cannot be assigned a destination. */
      lineId: string;
      displayName: string;
      amount: string;
      remediation: string;
    }
  | {
      kind: "unmapped_destination";
      destination: Bv011Destination;
      destinationLabel: string;
      lineId: string;
      displayName: string;
      remediation: string;
    }
  | {
      kind: "per_line_destination_unresolved";
      destination: Bv011Destination;
      destinationLabel: string;
      lineId: string;
      displayName: string;
      remediation: string;
    }
  | {
      kind: "provisional_tier";
      tierLabel: string;
      remediation: string;
    }
  | { kind: "no_frozen_matrix"; remediation: string }
  | { kind: "no_accepted_tier"; remediation: string };

export type ProjectionReadiness =
  | { ready: true; acceptedTierId: string; tierCommercialTotal: string }
  | { ready: false; blockers: ProjectionBlocker[] };

export async function assessProjectionReadiness(
  quoteId: string,
): Promise<ProjectionReadiness> {
  const [quote] = await db
    .select({ acceptedTierId: quotes.customerAcceptedTierId })
    .from(quotes)
    .where(eq(quotes.id, quoteId));

  if (!quote?.acceptedTierId) {
    return {
      ready: false,
      blockers: [
        {
          kind: "no_accepted_tier",
          remediation:
            "Record the customer's accepted tier before pushing a Sales Order.",
        },
      ],
    };
  }

  const [snapshot] = await db
    .select({ id: quoteSnapshots.id })
    .from(quoteSnapshots)
    .where(
      and(
        eq(quoteSnapshots.quoteId, quoteId),
        isNull(quoteSnapshots.supersededAt),
      ),
    );

  if (!snapshot) {
    return {
      ready: false,
      blockers: [
        {
          kind: "no_frozen_matrix",
          // A quote sent before the freeze shipped has no matrix and must not
          // acquire one retroactively — that would stamp today's arithmetic
          // onto a document the customer already received.
          remediation:
            "This quote was sent before the commercial line set was frozen. Revise and re-send to produce a frozen matrix, or complete it outside Nexus.",
        },
      ],
    };
  }

  const [tierTotal] = await db
    .select({
      tierLabel: quoteSnapshotTierTotals.tierLabel,
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

  if (!tierTotal) {
    return {
      ready: false,
      blockers: [
        {
          kind: "no_frozen_matrix",
          remediation:
            "The accepted tier has no frozen total. Revise and re-send before pushing.",
        },
      ],
    };
  }

  const blockers: ProjectionBlocker[] = [];

  // A provisional total was printed as "from $X". You cannot post an order for
  // a number the customer was told was a floor.
  if (tierTotal.provisional) {
    blockers.push({
      kind: "provisional_tier",
      tierLabel: tierTotal.tierLabel,
      remediation: `${tierTotal.tierLabel} was quoted as a provisional total — at least one line is still "quote on request". Price every line and re-send before pushing.`,
    });
  }

  // Only PRICED cells at the accepted tier can produce a Sales Order line. An
  // unpriced cell has no amount to post; an allocated OTC cell is already
  // inside the unit prices.
  const lines = await db
    .select({
      id: quoteSnapshotLines.id,
      kind: quoteSnapshotLines.lineKind,
      displayName: quoteSnapshotLines.displayName,
      destination: quoteSnapshotLines.bv011Destination,
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
        eq(quoteSnapshotLineTiers.tierId, quote.acceptedTierId),
        eq(quoteSnapshotLineTiers.pricingState, "priced"),
      ),
    );

  const mappings = await db
    .select({
      destination: netsuiteDestinationItemMap.destination,
      internalId: netsuiteDestinationItemMap.netsuiteInternalId,
    })
    .from(netsuiteDestinationItemMap);
  const mapped = new Map(
    mappings
      .filter((m) => (m.internalId ?? "").trim() !== "")
      .map((m) => [m.destination, m.internalId] as const),
  );

  for (const line of lines) {
    // Products resolve by SKU through the existing item resolver, not through
    // a destination. They are not this check's concern.
    if (line.kind === "item_group_member" || line.kind === "direct_product") {
      continue;
    }

    if (line.destination === null) {
      // The only way a priced non-product line carries no destination is the
      // legacy combined Tooling/Artwork charge. Named explicitly rather than
      // reported as a generic missing mapping, because the remediation is
      // completely different: no admin can fix this from Settings.
      blockers.push({
        kind: "legacy_combined_otc",
        lineId: line.id,
        displayName: line.displayName,
        amount: line.amount ?? "—",
        remediation: `"${line.displayName}" is a legacy combined Tooling + Artwork charge. BV-011 governs those as separate destinations with different item types, and no rule can say which half this amount is. Resolve it into the Tooling and Artwork inputs on Costs, then revise and re-send.`,
      });
      continue;
    }

    if (isPerLineDestination(line.destination)) {
      // `OTC - Other Service` has no firm-level record by design; its item is
      // chosen per line. Until that selection exists, say so — reporting it as
      // an unmapped destination would send an admin to Settings to add a row
      // the schema forbids.
      blockers.push({
        kind: "per_line_destination_unresolved",
        destination: line.destination,
        destinationLabel: bv011Label(line.destination),
        lineId: line.id,
        displayName: line.displayName,
        remediation: `"${line.displayName}" posts to ${bv011Label(line.destination)}, whose NetSuite item is chosen per line rather than firm-wide. That selection is not available yet.`,
      });
      continue;
    }

    if (!mapped.has(line.destination)) {
      blockers.push({
        kind: "unmapped_destination",
        destination: line.destination,
        destinationLabel: bv011Label(line.destination),
        lineId: line.id,
        displayName: line.displayName,
        remediation: `${bv011Label(line.destination)} has no NetSuite item mapped. Add it in Settings → NetSuite, then push again.`,
      });
    }
  }

  if (blockers.length > 0) return { ready: false, blockers };
  return {
    ready: true,
    acceptedTierId: quote.acceptedTierId,
    tierCommercialTotal: tierTotal.total,
  };
}

/** One operator-facing sentence per blocker, deduplicated by remediation. */
export function describeBlockers(blockers: ProjectionBlocker[]): string[] {
  return [...new Set(blockers.map((b) => b.remediation))];
}
