import "server-only";
import type { CpdfData } from "@/components/pdf/customer-pdf-types";
import type { CustomerView } from "@/types/quote";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { QuoteProductRow } from "@/lib/quote-product-structure";
import { customerViewToCpdf } from "@/lib/customer-view-to-cpdf";

/**
 * OD-023 · the immutable representation of one sent version.
 *
 * THE HISTORICAL INVARIANT
 *
 *   A sent version must be reconstructable from immutable data, without
 *   depending on future costing, pricing, Library, firm-settings or live quote
 *   behaviour.
 *
 * This module is what makes that true. It builds ONE object that is both
 * persisted and rendered, so "the stored representation and the generated
 * artifact correspond to the same version" is guaranteed by construction rather
 * than by two call sites being kept in step.
 *
 * That coupling is the point. The previous arrangement resolved a view, handed
 * it to a document builder, and separately stored some columns — three things
 * that happened to agree. Here the PDF is rendered FROM the representation that
 * was stored, so they cannot disagree.
 */

/**
 * Payload shape version.
 *
 * A reader that meets a version it does not know must REFUSE, not guess: a
 * payload shape is a contract with every future reader, and silently
 * misreading an old sent quote is the failure this whole slice exists to
 * prevent. Bump on any change to the persisted shape.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * The governed product structure, frozen alongside the render payload.
 *
 * Held apart from `cpdfData` because it answers a different question. The
 * render payload says what the customer SAW; this says what the quote WAS —
 * canonical identity, Direct vs grouped, group membership, printed order. The
 * first is for reproducing a document, the second for querying history
 * (which products did we sell them, in what structure), and collapsing them
 * would make the second reachable only by parsing the first.
 */
export type SnapshotStructureEntry = {
  quoteLeafId: string;
  leafId: string;
  sku: string | null;
  name: string;
  quantity: string;
  isDirect: boolean;
  groupId: string | null;
  groupSku: string | null;
  groupName: string | null;
  ordinal: number;
};

/** Everything needed to re-render the sent artifact, and nothing else. */
export type QuoteSnapshotRepresentation = {
  schemaVersion: number;
  cpdfData: CpdfData;
  /**
   * NULL when the addendum was OFF at send. Distinct from an addendum that was
   * on and empty, which is a payload whose `hasMeaningfulContent` is false.
   */
  addendumData: QuoteAddendumData | null;
  structure: SnapshotStructureEntry[];
  /** Render axes. Mirrored on `quote_snapshots` for querying; carried here so
   *  the representation renders without consulting another row. */
  pdfLayout: CustomerView["pdfLayout"];
  detailLevel: CustomerView["detailLevel"];
  includeSpecAddendum: boolean;
};

/**
 * Project a live resolution into the immutable representation.
 *
 * Called ONCE per send, and its output is what both the database row and the
 * PDF come from.
 */
export function buildSnapshotRepresentation(args: {
  view: CustomerView;
  addendumData: QuoteAddendumData | null;
  structure: QuoteProductRow[];
  todayIso: string;
}): QuoteSnapshotRepresentation {
  const { view, addendumData, structure, todayIso } = args;
  const { data } = customerViewToCpdf(view, { todayIso });
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    cpdfData: data,
    // Stored only when it was actually part of the artifact. Persisting an
    // addendum the customer never received would make a later reader believe
    // specifications were sent when they were not.
    addendumData: view.includeSpecAddendum ? addendumData : null,
    structure: structure.map((r) => ({
      quoteLeafId: r.quoteLeafId,
      leafId: r.leafId,
      sku: r.sku,
      name: r.name,
      quantity: r.quantity,
      isDirect: r.isDirect,
      groupId: r.groupId,
      groupSku: r.groupSku,
      groupName: r.groupName,
      ordinal: r.ordinal,
    })),
    pdfLayout: view.pdfLayout,
    detailLevel: view.detailLevel,
    includeSpecAddendum: view.includeSpecAddendum,
  };
}

// Rendering deliberately does NOT live here. `renderRepresentation` is in
// `quote-pdf-document.tsx`, which is inside the react-pdf containment
// allowlist. This module stays pure data so that reading a stored
// representation — which several non-render callers want to do — cannot drag
// the PDF library into their bundle.

/** What a stored row is, once read. */
export type StoredRepresentation =
  | { kind: "ok"; representation: QuoteSnapshotRepresentation }
  /** A version sent before this table existed. NOT an error, and NOT a licence
   *  to recompute from live rows — see `readStoredRepresentation`. */
  | { kind: "unavailable"; reason: string }
  /** Written by a newer deployment than this reader understands. */
  | { kind: "unsupported"; schemaVersion: number };

/**
 * Interpret a persisted artifact row.
 *
 * FAILS CLOSED, twice over, and both are deliberate:
 *
 *   - An ABSENT row is `unavailable`, never a signal to fall back to the live
 *     tables. Recomputing a historical version from today's rows is precisely
 *     the defect OD-023 names, and a fallback would reintroduce it at the one
 *     place most likely to be reached — an old quote nobody has looked at in
 *     months.
 *   - An UNKNOWN `schema_version` is `unsupported`, never best-effort parsed.
 *     A reader that guesses at a shape it does not know will render something,
 *     and something is worse than nothing when the subject is what a customer
 *     was told.
 */
export function readStoredRepresentation(
  row:
    | {
        schemaVersion: number;
        cpdfData: unknown;
        addendumData: unknown;
        structure: unknown;
      }
    | null
    | undefined,
  axes: {
    pdfLayout: CustomerView["pdfLayout"];
    detailLevel: CustomerView["detailLevel"];
    includeSpecAddendum: boolean;
  },
): StoredRepresentation {
  if (!row) {
    return {
      kind: "unavailable",
      reason:
        "This version was sent before its content was captured, so its exact " +
        "content cannot be reconstructed. The PDF that was sent remains the " +
        "authoritative record of what the customer received.",
    };
  }
  if (row.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { kind: "unsupported", schemaVersion: row.schemaVersion };
  }
  return {
    kind: "ok",
    representation: {
      schemaVersion: row.schemaVersion,
      cpdfData: row.cpdfData as CpdfData,
      addendumData: (row.addendumData ?? null) as QuoteAddendumData | null,
      structure: (row.structure ?? []) as SnapshotStructureEntry[],
      pdfLayout: axes.pdfLayout,
      detailLevel: axes.detailLevel,
      includeSpecAddendum: axes.includeSpecAddendum,
    },
  };
}
