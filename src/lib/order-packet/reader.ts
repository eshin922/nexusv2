import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  quoteSnapshotLeafSpecs,
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshotTierTotals,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import {
  isSpecBearingLineKind,
  type FrozenSpecDisposition,
} from "@/lib/ordered-spec-disposition";
import { redactWithheldSpecValues } from "@/lib/ordered-spec-projection";
import {
  packetDispositionOf,
  type SpecDisposition,
} from "@/lib/order-packet/disposition";

/**
 * The Nexus Order Packet — everything Accounting needs about ONE sent offer.
 *
 * ── FROZEN STATE ONLY ────────────────────────────────────────────────────
 *
 * Every field is read from the snapshot that was frozen at SEND:
 * `quote_snapshots`, `quote_snapshot_lines`, `quote_snapshot_tier_totals`,
 * `quote_snapshot_leaf_specs`.
 *
 * `leaf_specs` is NOT read, and a boundary test asserts this module cannot
 * import it. The live spec answers "what is this product's spec now", which is
 * a different question from "what was ordered" and the wrong one to answer on
 * an order — deliberately so, since the live row stays revisable for future
 * orders.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 *
 * Item-level specifications. No invoice guidance, no presentation/recovery
 * integration: those are rendered from operator choices that are not yet frozen
 * at send, and deriving them from what IS frozen — `detail_level`, the unit/OTC
 * split, `line_kind` — would present an inference to Accounting as an
 * instruction. Adding a guidance field later is additive by construction; it
 * changes neither the snapshot identity nor the item/spec model below, which is
 * why nothing is scaffolded for it now.
 *
 * ── ARTIFACT IDENTITY ────────────────────────────────────────────────────
 *
 * The PDF is identified by `pdf_storage_path` + `pdf_storage_bucket`, which do
 * not expire. `quotes.pdf_url` is a 30-day signed URL and is never returned:
 * the packet re-signs from the durable path on demand instead. Two historical
 * snapshots have no durable identity; they report `unresolved` rather than
 * falling back to a guess about which artifact belonged to them.
 */

export type PacketArtifact =
  | { state: "resolved"; bucket: string; path: string }
  | { state: "unresolved"; reason: string };

/**
 * Why a frozen line does or does not carry an ordered specification.
 *
 * Four distinct states, and collapsing any two of them loses a real answer:
 *
 *   specified          a schema applies and the frozen values are present
 *   governed_no_spec   the frozen spec says none applies (`no_schema`) — an
 *                      ANSWER, not an absence
 *   not_spec_bearing   the line has no `quote_leaf_id` at all: a service or
 *                      one-time charge, which is not a specifiable item.
 *                      Structurally different from an item whose spec says none
 *                      applies, and reporting them alike would invent a missing
 *                      specification for a setup fee.
 *   not_governed       a frozen spec exists but records that NO governed answer
 *                      was available at send — `schema_pending`, `unmapped` or
 *                      `no_type`. These were previously reported as
 *                      `governed_no_spec`, which told Accounting "no
 *                      specification applies" about products nobody had
 *                      classified. `spec.frozenDisposition` names which.
 *   unresolved         the line IS spec-bearing but no frozen spec exists —
 *                      a send that predates the freeze. Genuinely unknown, and
 *                      said so.
 *
 * ── WITHHELD VALUES ──────────────────────────────────────────────────────
 *
 * This packet is linked from the NetSuite Sales Order, so it is a NetSuite-
 * audience surface. Values pass through `redactWithheldSpecValues` HERE, in the
 * reader, so no consumer of this module can render `fm_actives`. The withheld
 * value stays in Nexus's own spec surfaces; the packet says only that it was
 * withheld (`spec.redactedKeys`).
 */
export type { SpecDisposition } from "@/lib/order-packet/disposition";

export type PacketItem = {
  snapshotLineId: string;
  quoteLeafId: string | null;
  displaySku: string | null;
  displayName: string;
  lineKind: string;
  netsuiteItemId: string | null;
  selectedNetsuiteItemCode: string | null;
  disposition: SpecDisposition;
  /** Present whenever a frozen spec row exists for the line. */
  spec: {
    frozenSpecId: string;
    /** The frozen row's disposition, verbatim. */
    frozenDisposition: FrozenSpecDisposition;
    /** Source hash of the FULL frozen row; identifies it without its withheld values. */
    contentHash: string;
    productTypeId: string | null;
    specSchema: string | null;
    schemaDerivedFromType: string | null;
    /** Frozen values with every withheld key removed. */
    values: Record<string, unknown>;
    /** Withheld keys that carried a value. Names only. */
    redactedKeys: string[];
    sourceLeafSpecId: string | null;
  } | null;
};

export type OrderPacket = {
  snapshotId: string;
  quoteId: string;
  quoteNumber: string | null;
  versionNumber: number;
  sentAt: Date | null;
  presentation: { pdfLayout: string | null; detailLevel: string | null };
  acceptedTier: {
    tierId: string;
    tierLabel: string;
    quantity: number | null;
    unitSubtotal: string | null;
    otcSubtotal: string | null;
    tierCommercialTotal: string | null;
    totalIsProvisional: boolean;
  } | null;
  artifact: PacketArtifact;
  items: PacketItem[];
};

export async function readOrderPacket(
  snapshotId: string,
): Promise<OrderPacket | null> {
  const [snap] = await db
    .select({
      id: quoteSnapshots.id,
      quoteId: quoteSnapshots.quoteId,
      quoteNumber: quoteSnapshots.quoteNumber,
      versionNumber: quoteSnapshots.versionNumber,
      sentAt: quoteSnapshots.sentAt,
      pdfLayout: quoteSnapshots.pdfLayout,
      detailLevel: quoteSnapshots.detailLevel,
      storagePath: quoteSnapshots.pdfStoragePath,
      storageBucket: quoteSnapshots.pdfStorageBucket,
      acceptedTierId: quotes.acceptedTierId,
    })
    .from(quoteSnapshots)
    .innerJoin(quotes, eq(quotes.id, quoteSnapshots.quoteId))
    .where(eq(quoteSnapshots.id, snapshotId))
    .limit(1);
  if (!snap) return null;

  // The accepted tier's frozen totals. Read from the snapshot, never recomputed
  // — the whole point of the freeze is that this number does not move.
  const tiers = await db
    .select()
    .from(quoteSnapshotTierTotals)
    .where(eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshotId));
  const accepted =
    tiers.find((t) => t.tierId === snap.acceptedTierId) ?? null;

  const lines = await db
    .select()
    .from(quoteSnapshotLines)
    .where(eq(quoteSnapshotLines.quoteSnapshotId, snapshotId))
    .orderBy(quoteSnapshotLines.position);

  const specs = await db
    .select()
    .from(quoteSnapshotLeafSpecs)
    .where(eq(quoteSnapshotLeafSpecs.quoteSnapshotId, snapshotId));
  const byLeaf = new Map(specs.map((s) => [s.quoteLeafId, s] as const));

  const items: PacketItem[] = lines.map((l) => {
    // Not a specifiable item: decided by the frozen LINE KIND. A service or an
    // OTC charge can carry a quote_leaf_id (an OTC charge carries the product
    // it was incurred for) and must still never be presented as an ordered
    // item with a specification. Same rule the NetSuite export uses.
    if (!l.quoteLeafId || !isSpecBearingLineKind(l.lineKind)) {
      return {
        snapshotLineId: l.id,
        quoteLeafId: l.quoteLeafId,
        displaySku: l.displaySku,
        displayName: l.displayName,
        lineKind: l.lineKind,
        netsuiteItemId: l.netsuiteItemId,
        selectedNetsuiteItemCode: l.selectedNetsuiteItemCode,
        disposition: "not_spec_bearing",
        spec: null,
      };
    }
    const s = byLeaf.get(l.quoteLeafId);
    if (!s) {
      return {
        snapshotLineId: l.id,
        quoteLeafId: l.quoteLeafId,
        displaySku: l.displaySku,
        displayName: l.displayName,
        lineKind: l.lineKind,
        netsuiteItemId: l.netsuiteItemId,
        selectedNetsuiteItemCode: l.selectedNetsuiteItemCode,
        disposition: "unresolved",
        spec: null,
      };
    }
    return {
      snapshotLineId: l.id,
      quoteLeafId: l.quoteLeafId,
      displaySku: l.displaySku,
      displayName: l.displayName,
      lineKind: l.lineKind,
      netsuiteItemId: l.netsuiteItemId,
      selectedNetsuiteItemCode: l.selectedNetsuiteItemCode,
      disposition: packetDispositionOf(s.disposition as FrozenSpecDisposition),
      spec: {
        frozenSpecId: s.id,
        frozenDisposition: s.disposition as FrozenSpecDisposition,
        contentHash: s.contentHash,
        productTypeId: s.productTypeId,
        specSchema: s.specSchema,
        schemaDerivedFromType: s.schemaDerivedFromType,
        ...redactWithheldSpecValues(s.specValues as Record<string, unknown> | null),
        sourceLeafSpecId: s.sourceLeafSpecId,
      },
    };
  });

  return {
    snapshotId: snap.id,
    quoteId: snap.quoteId,
    quoteNumber: snap.quoteNumber,
    versionNumber: snap.versionNumber,
    sentAt: snap.sentAt,
    presentation: { pdfLayout: snap.pdfLayout, detailLevel: snap.detailLevel },
    acceptedTier: accepted
      ? {
          tierId: accepted.tierId,
          tierLabel: accepted.tierLabel,
          quantity: accepted.quantity,
          unitSubtotal: accepted.unitSubtotal,
          otcSubtotal: accepted.otcSubtotal,
          tierCommercialTotal: accepted.tierCommercialTotal,
          totalIsProvisional: accepted.totalIsProvisional,
        }
      : null,
    artifact:
      snap.storagePath && snap.storageBucket
        ? { state: "resolved", bucket: snap.storageBucket, path: snap.storagePath }
        : {
            state: "unresolved",
            reason:
              "No durable artifact identity was recorded for this send. It predates " +
              "artifact persistence, and the expiring signed URL is not used as a " +
              "substitute.",
          },
    items,
  };
}
