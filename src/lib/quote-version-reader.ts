import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { quoteSnapshotArtifacts, quoteSnapshots, quotes } from "@/db/schema";
import {
  readStoredRepresentation,
  type QuoteSnapshotRepresentation,
} from "@/lib/quote-snapshot-representation";

/**
 * OD-023 · read ONE version of a quote, addressed explicitly.
 *
 * WHY THIS EXISTS
 *
 * Every historical read in the codebase resolved its snapshot with
 * `superseded_at IS NULL` — "the current sent version". That is not an
 * address, it is an assumption, and it has two consequences:
 *
 *   1. A SUPERSEDED version could not be read at all. Not "read wrongly" —
 *      unreachable, including for the freight that was already being
 *      snapshotted. Revise closed the door behind itself.
 *   2. Nothing distinguished "the current version" from "the version I asked
 *      for". A caller wanting v1 after a Revise got v2 and no error.
 *
 * So a version is now something a caller NAMES. `currentSent()` still exists,
 * because "what is live with the customer right now" is a real question — it is
 * just no longer the only one that can be asked.
 */

export type QuoteVersionAddress =
  /** The version currently in the customer's hands. */
  | { kind: "current" }
  /** A specific snapshot row, superseded or not. */
  | { kind: "snapshotId"; snapshotId: string }
  /** A version number on this quote. Superseded versions included. */
  | { kind: "versionNumber"; versionNumber: number };

export type QuoteVersionSummary = {
  snapshotId: string;
  versionNumber: number;
  sentAt: Date;
  supersededAt: Date | null;
  quoteNumber: string | null;
  pdfUrl: string | null;
  /** False for versions sent before the representation was captured. */
  hasStoredRepresentation: boolean;
};

export type QuoteVersionRead =
  /**
   * The quote has never been sent, or the caller addressed a version that does
   * not exist. Draft content is resolved live by the caller — that is correct
   * for a working copy and is NOT what this module governs.
   */
  | { kind: "no_such_version" }
  | {
      kind: "sent";
      summary: QuoteVersionSummary;
      representation: QuoteSnapshotRepresentation;
    }
  /**
   * Sent before the representation was captured.
   *
   * LEGACY IS A TERMINAL ANSWER, NOT A FALLBACK. The caller must not resolve
   * this version live: reconstructing it from today's rows would present
   * current state as historical fact, which is the defect OD-023 exists to
   * close, and it would do so most convincingly on the oldest quotes — the ones
   * whose live rows have drifted furthest.
   *
   * `pdfUrl` is retained where present. That file IS the historical record of
   * what the customer received; it is simply not queryable.
   */
  | {
      kind: "legacy";
      summary: QuoteVersionSummary;
      reason: string;
    }
  /** Written by a newer deployment than this reader understands. */
  | {
      kind: "unsupported";
      summary: QuoteVersionSummary;
      schemaVersion: number;
    };

const selection = {
  snapshotId: quoteSnapshots.id,
  versionNumber: quoteSnapshots.versionNumber,
  sentAt: quoteSnapshots.sentAt,
  supersededAt: quoteSnapshots.supersededAt,
  quoteNumber: quoteSnapshots.quoteNumber,
  pdfUrl: quoteSnapshots.pdfUrl,
  pdfLayout: quoteSnapshots.pdfLayout,
  detailLevel: quoteSnapshots.detailLevel,
  includeSpecAddendum: quoteSnapshots.includeSpecAddendum,
  artifactSchemaVersion: quoteSnapshotArtifacts.schemaVersion,
  cpdfData: quoteSnapshotArtifacts.cpdfData,
  addendumData: quoteSnapshotArtifacts.addendumData,
  structure: quoteSnapshotArtifacts.structure,
};

/** Every sent version of a quote, newest first. Superseded ones included. */
export async function listQuoteVersions(
  quoteId: string,
): Promise<QuoteVersionSummary[]> {
  const rows = await db
    .select(selection)
    .from(quoteSnapshots)
    .leftJoin(
      quoteSnapshotArtifacts,
      eq(quoteSnapshotArtifacts.quoteSnapshotId, quoteSnapshots.id),
    )
    .where(eq(quoteSnapshots.quoteId, quoteId))
    .orderBy(desc(quoteSnapshots.versionNumber), desc(quoteSnapshots.sentAt));
  return rows.map((r) => ({
    snapshotId: r.snapshotId,
    versionNumber: r.versionNumber,
    sentAt: r.sentAt,
    supersededAt: r.supersededAt,
    quoteNumber: r.quoteNumber,
    pdfUrl: r.pdfUrl,
    hasStoredRepresentation: r.artifactSchemaVersion !== null,
  }));
}

export async function readQuoteVersion(
  quoteId: string,
  address: QuoteVersionAddress = { kind: "current" },
): Promise<QuoteVersionRead> {
  const where =
    address.kind === "snapshotId"
      ? and(
          eq(quoteSnapshots.quoteId, quoteId),
          eq(quoteSnapshots.id, address.snapshotId),
        )
      : address.kind === "versionNumber"
        ? and(
            eq(quoteSnapshots.quoteId, quoteId),
            eq(quoteSnapshots.versionNumber, address.versionNumber),
          )
        : // The ONLY place `superseded_at IS NULL` is still correct: it is the
          // definition of "current", not a stand-in for "the one I want".
          and(
            eq(quoteSnapshots.quoteId, quoteId),
            isNull(quoteSnapshots.supersededAt),
          );

  const [row] = await db
    .select(selection)
    .from(quoteSnapshots)
    .leftJoin(
      quoteSnapshotArtifacts,
      eq(quoteSnapshotArtifacts.quoteSnapshotId, quoteSnapshots.id),
    )
    .where(where)
    // A version number can repeat across rows only if something upstream
    // broke; taking the newest is the safe read, and the ordering makes the
    // choice explicit rather than incidental.
    .orderBy(desc(quoteSnapshots.sentAt))
    .limit(1);

  if (!row) return { kind: "no_such_version" };

  const summary: QuoteVersionSummary = {
    snapshotId: row.snapshotId,
    versionNumber: row.versionNumber,
    sentAt: row.sentAt,
    supersededAt: row.supersededAt,
    quoteNumber: row.quoteNumber,
    pdfUrl: row.pdfUrl,
    hasStoredRepresentation: row.artifactSchemaVersion !== null,
  };

  const stored = readStoredRepresentation(
    row.artifactSchemaVersion === null
      ? null
      : {
          schemaVersion: row.artifactSchemaVersion,
          cpdfData: row.cpdfData,
          addendumData: row.addendumData,
          structure: row.structure,
        },
    {
      pdfLayout: row.pdfLayout ?? "tier_table",
      detailLevel: row.detailLevel ?? "itemized",
      includeSpecAddendum: row.includeSpecAddendum ?? false,
    },
  );

  if (stored.kind === "unavailable")
    return { kind: "legacy", summary, reason: stored.reason };
  if (stored.kind === "unsupported")
    return { kind: "unsupported", summary, schemaVersion: stored.schemaVersion };
  return { kind: "sent", summary, representation: stored.representation };
}

/**
 * Should this quote's customer output come from a frozen version?
 *
 * Status decides, and only status. A draft is a working copy and resolves live;
 * anything else has been sent and must read what was sent — recomputing it from
 * today's inputs is exactly the substitution this slice removes.
 */
export async function quoteIsDraft(quoteId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ status: quotes.status })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row ? row.status === "draft" : null;
}
