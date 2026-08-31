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
import { centsFromFrozen } from "@/lib/netsuite/frozen-cents";
import {
  SERVICE_IDENTITY_DESTINATION,
  bv011Label,
  isPerLineDestination,
} from "@/lib/netsuite/bv011-destinations";
import type { Bv011Destination } from "@/lib/netsuite/bv011-destinations";
import { resolvesBySku } from "@/lib/netsuite/line-kind-resolution";

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
      /**
       * A frozen product line with no SKU. Its NetSuite item is matched by SKU,
       * so there is nothing to match on — distinct from a SKU that simply does
       * not resolve, which is a catalog problem rather than a quote one.
       */
      kind: "product_sku_missing";
      lineId: string;
      displayName: string;
      remediation: string;
    }
  | {
      /** A frozen product SKU that does not resolve, or resolves ambiguously. */
      kind: "product_item_unresolved";
      lineId: string;
      displayName: string;
      sku: string;
      remediation: string;
    }
  | {
      /**
       * The accepted amount cannot be expressed as `quantity × rate` at the
       * posted scale, so NetSuite's own multiplication would land somewhere
       * else. A representational limit, NOT a pricing problem: the accepted
       * amount is correct and is left exactly as frozen.
       */
      kind: "product_rate_unrepresentable";
      lineId: string;
      displayName: string;
      remediation: string;
    }
  | {
      /** Frozen before destinations were recorded. Not a legacy combined charge. */
      kind: "destination_not_recorded";
      lineId: string;
      displayName: string;
      remediation: string;
    }
  | {
      /**
       * A component-owned charge, which has NO governed accounting destination
       * yet -- the projection records `null` for every one of them, by
       * construction rather than by omission.
       *
       * Distinct from `destination_not_recorded` because the remedies differ
       * and only one of them exists. That blocker tells the operator to revise
       * and re-send, which is correct for a line frozen before destinations
       * were captured. For a component charge a re-send would record `null`
       * again, so the same words would send the operator round a loop that
       * cannot terminate. An instruction that cannot succeed is worse than
       * none: it reads as a step they failed to perform.
       */
      kind: "component_destination_ungoverned";
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

/**
 * A quantity-1 accounting line, resolved from the frozen accepted column.
 *
 * No item TYPE here, on purpose. BV-011 governs what a destination SHOULD be
 * and the resolved NetSuite record IS what it is; an emitter carrying a third
 * opinion could disagree with both.
 */
export type ResolvedAccountingLine = {
  sourceLineId: string;
  kind: "direct_service" | "otc";
  /** OD-006 — the owning Item Group, or null for a top-level Direct Service. */
  owningAssemblyId: string | null;
  displayName: string;
  destination: Bv011Destination;
  netsuiteItemId: string;
  netsuiteItemCode: string | null;
  /** Integer cents, parsed from the frozen decimal without a float. */
  amountCents: number;
  /**
   * THIS LINE's frozen quantity and unit rate at the accepted tier.
   *
   * Carried because the two kinds no longer share a line shape: a unit-priced
   * Direct Service posts at its own quantity and rate, while a separately
   * billed OTC charge posts as 1 × its amount. See `accounting-line-emitter`.
   *
   * `unitRate` stays a DECIMAL STRING, not cents. The frozen column is
   * numeric(14,4) and a cent-based round trip would quietly truncate a
   * four-decimal rate — the amount is what REG-4 compares, and it stays in
   * integer cents above.
   */
  quantity: number | null;
  unitRate: string | null;
};

export type ProjectionReadiness =
  | {
      ready: true;
      acceptedTierId: string;
      tierCommercialTotal: string;
      /** Resolved in the same pass, so readiness and emission cannot disagree. */
      lines: ResolvedAccountingLine[];
    }
  | { ready: false; blockers: ProjectionBlocker[] };


/**
 * The executor to read through.
 *
 * Defaults to the global client, but the push path will call this INSIDE the
 * transaction that creates the Sales Order — a readiness answer taken outside
 * that transaction is an answer about a different moment, and the gap is
 * exactly where a concurrent edit would slip through.
 */
type Exec = Pick<typeof db, "select">;

export async function assessProjectionReadiness(
  quoteId: string,
  exec: Exec = db,
): Promise<ProjectionReadiness> {
  const [quote] = await exec
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

  const [snapshot] = await exec
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

  const [tierTotal] = await exec
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
  const lines = await exec
    .select({
      id: quoteSnapshotLines.id,
      kind: quoteSnapshotLines.lineKind,
      displayName: quoteSnapshotLines.displayName,
      destination: quoteSnapshotLines.bv011Destination,
      selectedItemId: quoteSnapshotLines.selectedNetsuiteItemId,
      selectedItemCode: quoteSnapshotLines.selectedNetsuiteItemCode,
      owningAssemblyId: quoteSnapshotLines.owningAssemblyId,
      // Carried for the component-charge discriminator below, which needs to
      // tell a component-owned OTC line from a legacy per-column one.
      quoteLeafId: quoteSnapshotLines.quoteLeafId,
      serviceIdentity: quoteSnapshotLines.serviceIdentity,
      legacyUnresolved: quoteSnapshotLines.legacyUnresolved,
      amount: quoteSnapshotLineTiers.lineAmount,
      quantity: quoteSnapshotLineTiers.quantity,
      unitRate: quoteSnapshotLineTiers.unitRate,
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

  const mappings = await exec
    .select({
      destination: netsuiteDestinationItemMap.destination,
      internalId: netsuiteDestinationItemMap.netsuiteInternalId,
      code: netsuiteDestinationItemMap.netsuiteItemCode,
    })
    .from(netsuiteDestinationItemMap);
  const mapped = new Map(
    mappings
      .filter((m) => (m.internalId ?? "").trim() !== "")
      .map((m) => [m.destination, m] as const),
  );

  // Resolved alongside the blockers, in the SAME pass.
  //
  // A separate resolver for the emitter would be a second answer to "which
  // item does this line post to" — the divergence Pattern 58 warns about, and
  // the one that lets readiness certify a line the emitter then sends
  // somewhere else.
  const resolved: ResolvedAccountingLine[] = [];

  for (const line of lines) {
    // Products resolve by SKU through the existing item resolver, not through
    // a destination. They are not this check's concern.
    //
    // FROM THE SHARED CLASSIFICATION, not a literal list. This was
    // `item_group_member || direct_product`, written when those were the only
    // product kinds. OD-028 added `item_group` and the literal did not grow
    // with it, so the Item Group header -- whose NULL destination is correct
    // and permanent -- was reported as "frozen before accounting destinations
    // were recorded", with a remediation that cannot be followed: a re-send
    // freezes NULL again, because NULL is the right value.
    if (resolvesBySku(line.kind)) {
      continue;
    }

    // The legacy combined charge says so on the row. Checked BEFORE the null
    // test, because a null destination alone describes two unrelated states.
    if (line.legacyUnresolved) {
      blockers.push({
        kind: "legacy_combined_otc",
        lineId: line.id,
        displayName: line.displayName,
        amount: line.amount ?? "—",
        remediation: `"${line.displayName}" is a legacy combined Tooling + Artwork charge. BV-011 governs those as separate destinations with different item types, and no rule can say which half this amount is. Resolve it into the Tooling and Artwork inputs on Costs, then revise and re-send.`,
      });
      continue;
    }

    // A Direct Service frozen before the destination column existed still
    // carries its governed IDENTITY, and BV-011 fixes the identity's
    // destination. Deriving it is reading the same governed map the freeze
    // would have used — not a guess, and not string-matching a display name.
    const destination =
      line.destination ??
      (line.serviceIdentity
        ? SERVICE_IDENTITY_DESTINATION[line.serviceIdentity]
        : null);

    // A component-owned charge. Checked BEFORE the generic null test, for the
    // same reason the legacy combined charge is: a null destination alone
    // describes several unrelated states, and only the narrowest true one
    // yields an instruction the operator can act on.
    //
    // The discriminator is structural, not inferred. There are exactly two
    // producers of an `otc` line: the legacy per-column loop sets
    // `owningAssemblyId` and leaves `quoteLeafId` null; the component loop does
    // the exact opposite. `component-otc-line-identity` asserts that they stay
    // opposite, so this cannot quietly start reading the wrong lines.
    if (line.kind === "otc" && line.quoteLeafId !== null) {
      blockers.push({
        kind: "component_destination_ungoverned",
        lineId: line.id,
        displayName: line.displayName,
        remediation: `"${line.displayName}" is a component-owned one-time charge, and that charge type does not yet have a governed accounting destination. It cannot be sent to NetSuite yet, and re-sending the quote will not change that. Remove the charge from the accepted tier if this order must be pushed now, or wait for the destination model.`,
      });
      continue;
    }

    if (destination === null) {
      // Frozen before destinations were recorded, with nothing on the row to
      // derive one from. Distinct from the legacy combined charge: this line's
      // accounting meaning is knowable, it simply was not captured, and a
      // re-send captures it.
      blockers.push({
        kind: "destination_not_recorded",
        lineId: line.id,
        displayName: line.displayName,
        remediation: `"${line.displayName}" was frozen before accounting destinations were recorded on quote lines. Revise and re-send so the line records its destination, then push.`,
      });
      continue;
    }

    if (isPerLineDestination(destination)) {
      // `OTC - Other Service` has no firm-level record by design; its item is
      // chosen per line and FROZEN at send, because for this destination the
      // operator's choice is the governance.
      //
      // A frozen selection satisfies the line. Its absence is reported as
      // its own state rather than as an unmapped destination — the latter
      // would send an admin to Settings to add a row the schema forbids.
      const selected = (line.selectedItemId ?? "").trim();
      if (selected === "") {
        blockers.push({
          kind: "per_line_destination_unresolved",
          destination,
          destinationLabel: bv011Label(destination),
          lineId: line.id,
          displayName: line.displayName,
          remediation: `"${line.displayName}" posts to ${bv011Label(destination)}, whose NetSuite item is chosen per line rather than firm-wide. Choose its item on Costs, then revise and re-send.`,
        });
        continue;
      }
      resolved.push({
        sourceLineId: line.id,
        kind: line.kind === "direct_service" ? "direct_service" : "otc",
        owningAssemblyId: line.owningAssemblyId,
        displayName: line.displayName,
        destination,
        // The FROZEN selection, not the current one. For this destination the
        // operator choice IS the governance, so it is read from the send.
        netsuiteItemId: selected,
        netsuiteItemCode: line.selectedItemCode ?? null,
        amountCents: centsFromFrozen(line.amount),
      quantity: line.quantity,
      unitRate: line.unitRate,
      });
      continue;
    }

    const mapping = mapped.get(destination);
    if (!mapping) {
      blockers.push({
        kind: "unmapped_destination",
        destination,
        destinationLabel: bv011Label(destination),
        lineId: line.id,
        displayName: line.displayName,
        remediation: `${bv011Label(destination)} has no NetSuite item mapped. Add it in Settings → NetSuite, then push again.`,
      });
      continue;
    }

    resolved.push({
      sourceLineId: line.id,
      kind: line.kind === "direct_service" ? "direct_service" : "otc",
      // OD-006 — an Item Group OTC line is emitted in association with its
      // group. A Direct Service is top-level and carries null.
      owningAssemblyId: line.owningAssemblyId,
      displayName: line.displayName,
      destination,
      netsuiteItemId: mapping.internalId!,
      netsuiteItemCode: mapping.code ?? null,
      amountCents: centsFromFrozen(line.amount),
      quantity: line.quantity,
      unitRate: line.unitRate,
    });
  }

  if (blockers.length > 0) return { ready: false, blockers };
  return {
    ready: true,
    acceptedTierId: quote.acceptedTierId,
    tierCommercialTotal: tierTotal.total,
    lines: resolved,
  };
}

/** One operator-facing sentence per blocker, deduplicated by remediation. */
export function describeBlockers(blockers: ProjectionBlocker[]): string[] {
  return [...new Set(blockers.map((b) => b.remediation))];
}
