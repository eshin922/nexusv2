import { and, eq, isNull } from "drizzle-orm";
import { ensureQuoteSpecAuthority } from "./quote-spec-authority";
import type { db } from "../../db/index.ts";
import { assemblyLeaves, quoteLeaves } from "../../db/schema.ts";

/**
 * Direct Product attachment — `quote_leaves` with `assembly_id = NULL`.
 *
 * PEER to `attachGroupedMembership`, not a variant of it. The grouped path
 * writes TWO rows (canonical `quote_leaves` + legacy `assembly_leaves`); this
 * path writes ONE and creates no assembly of any kind.
 *
 * That asymmetry is the design, not an omission. The Design Authority holds
 * Add Product and Add Item Group as independent operator choices, and SO2704
 * shows the choice survives into the customer document — a one-product Item
 * Group prints as a named container with a nested line, a Direct Product prints
 * as a single line. So a Direct Product must never acquire an assembly on its
 * way through the system, however convenient a synthetic one would be for
 * downstream code.
 *
 * There is deliberately no `assembly_leaves` row: the legacy junction is what
 * makes something a group member, and writing one "for compatibility" would
 * make a Direct Product indistinguishable from a member of a one-product group.
 */

export type DirectAttachmentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export class DirectAttachmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectAttachmentConflictError";
  }
}

export type DirectAttachmentEvidence = {
  quoteLeafId: string;
  quoteId: string;
  leafId: string;
  quantity: string;
  position: number;
};

export async function attachDirectProduct(
  tx: DirectAttachmentTransaction,
  args: {
    quoteId: string;
    leafId: string;
    quantity: string;
    position: number;
    /** B-3 — attribution for the quote-owned spec instantiated here. */
    createdBy: string;
    /**
     * Copy Quote. Template the quote-owned spec from THAT quote's authority
     * rather than the Library default — peer to the grouped path's argument of
     * the same name. Without it a copied Direct Product would silently revert
     * to the Library default while its grouped siblings kept the source's
     * configuration, so the copy would differ from the source in exactly the
     * place the operator had been working.
     */
    specTemplateFromQuoteId?: string;
  },
): Promise<DirectAttachmentEvidence> {
  // Duplicate check is scoped to DIRECT attachments only. The same library
  // product may legitimately be attached directly AND be a member of an Item
  // Group on the same quote — those are different commercial lines, and
  // treating one as a duplicate of the other would silently forbid a valid
  // structure.
  const existing = await tx
    .select({ id: quoteLeaves.id })
    .from(quoteLeaves)
    .where(
      and(
        eq(quoteLeaves.quoteId, args.quoteId),
        eq(quoteLeaves.leafId, args.leafId),
        isNull(quoteLeaves.assemblyId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new DirectAttachmentConflictError(
      "This product is already attached to this quote.",
    );
  }

  // B-3 — the quote owns its specification from the moment of attachment. The
  // Library default is a template; the quote never points at the mutable row.
  const authority = await ensureQuoteSpecAuthority(tx as never, {
    quoteId: args.quoteId,
    leafId: args.leafId,
    createdBy: args.createdBy,
    templateFromQuoteId: args.specTemplateFromQuoteId,
  });

  const [row] = await tx
    .insert(quoteLeaves)
    .values({
      quoteId: args.quoteId,
      assemblyId: null,
      leafId: args.leafId,
      leafSpecVersionId: authority.id,
      pinnedAt: new Date(),
      quantity: args.quantity,
      position: args.position,
    })
    .returning();

  return {
    quoteLeafId: row.id,
    quoteId: row.quoteId,
    leafId: row.leafId,
    quantity: row.quantity,
    position: row.position,
  };
}

export async function detachDirectProduct(
  tx: DirectAttachmentTransaction,
  args: { quoteId: string; quoteLeafId: string },
): Promise<DirectAttachmentEvidence | null> {
  const [row] = await tx
    .select()
    .from(quoteLeaves)
    .where(
      and(
        eq(quoteLeaves.id, args.quoteLeafId),
        eq(quoteLeaves.quoteId, args.quoteId),
        isNull(quoteLeaves.assemblyId),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Refuse to detach anything carrying a legacy junction. Such a row is a group
  // member whose assembly_id is unexpectedly NULL — a corrupted state — and
  // deleting it here would drop the junction's cascade behaviour on the floor.
  const junction = await tx
    .select({ id: assemblyLeaves.id })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.quoteLeafId, row.id))
    .limit(1);
  if (junction.length > 0) {
    throw new DirectAttachmentConflictError(
      `Quote leaf ${row.id} has no assembly but carries a grouped-membership junction. ` +
        `Refusing to detach it as a Direct Product.`,
    );
  }

  // Cost, override, target, freight and lift rows all cascade from
  // `quote_leaves` (verified against the live catalogue, not inferred from the
  // grouped path, which disposes of them via its junction instead).
  //
  // `quote_commercial_markup_pins` is the one dependent that RESTRICTS, so a
  // product carrying a send-time pin refuses deletion at the database. That is
  // identical to the grouped path's exposure — it also deletes `quote_leaves`
  // directly — and is deliberately not special-cased here: a pin is send-time
  // commercial state, and inventing a disposal for it in a detach helper would
  // be deciding a freeze-semantics question in the wrong place.
  await tx.delete(quoteLeaves).where(eq(quoteLeaves.id, row.id));

  return {
    quoteLeafId: row.id,
    quoteId: row.quoteId,
    leafId: row.leafId,
    quantity: row.quantity,
    position: row.position,
  };
}
