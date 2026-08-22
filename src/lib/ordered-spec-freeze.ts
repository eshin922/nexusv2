import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { leafSpecs, quoteLeaves, quoteSnapshotLeafSpecs } from "@/db/schema";
import { orderedSpecContentHash } from "@/lib/ordered-spec-hash";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Freeze the ordered-item specifications for ONE sent offer.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 *
 * `leaf_specs` answers "what is this product's spec". After a send, the order
 * needs a different question answered — "what was ordered" — and nothing in the
 * live model keeps them the same. There is one quote-owned authority per
 * (quote, leaf), nothing freezes it, and the PDF addendum reads current values
 * at render time.
 *
 * ── THE LIVE ROW IS NOT LOCKED ───────────────────────────────────────────
 *
 * Deliberately. The working spec stays revisable for FUTURE orders; this table
 * is what makes that safe, by taking history out of its keeping. Freezing here
 * rather than locking there is what lets both be true at once.
 *
 * ── ONE ROW PER ORDERED LEAF, ALWAYS ─────────────────────────────────────
 *
 * Including leaves with no applicable specification. An omitted row would make
 * "this item had no spec" and "we failed to capture one" the same observation,
 * and only one of those is acceptable in a historical record. `disposition`
 * states which.
 */

export type FrozenSpecDisposition =
  | "specified"
  | "no_schema"
  | "unmapped"
  | "no_type";

export type OrderedSpecFreezeResult = {
  frozen: number;
  byDisposition: Record<FrozenSpecDisposition, number>;
};

/**
 * Classify what a live authority says about itself.
 *
 * Reads the PINNED schema, never the live Product Type. The pin exists so a
 * later reclassification cannot reinterpret values already authored, and
 * consulting the live type here would defeat it at exactly the moment it
 * matters most.
 */
function dispositionOf(specSchema: string | null, productTypeId: string | null): FrozenSpecDisposition {
  if (specSchema === "no_schema") return "no_schema";
  if (specSchema === "unmapped") return "unmapped";
  if (specSchema === "no_type") return "no_type";
  if (specSchema === null) return productTypeId ? "unmapped" : "no_type";
  return "specified";
}

/**
 * Freeze one specification per ordered leaf on `quoteId` into `snapshotId`.
 *
 * MUST run inside the send transaction, after the snapshot row exists and
 * before the send is finalized. A failure here fails the send: an offer whose
 * ordered specifications were not recorded is not an offer anyone can honour
 * later, and finalizing it would trade a hard failure now for an unanswerable
 * question forever.
 *
 * `ensureQuoteSpecAuthority` must already have run for every ordered leaf — see
 * the caller. This function does NOT materialize, because materializing inside
 * the freeze would let it invent an authority the customer document never saw.
 */
export async function freezeOrderedSpecs(
  tx: Tx,
  args: { quoteId: string; snapshotId: string },
): Promise<OrderedSpecFreezeResult> {
  // Every ordered leaf on the quote, with its pinned authority.
  //
  // LEFT-joined on purpose. An inner join would silently drop a leaf whose
  // authority is missing, and a dropped leaf is precisely the accidental
  // omission the disposition column exists to prevent — it would look like the
  // item was never ordered.
  const rows = await tx
    .select({
      quoteLeafId: quoteLeaves.id,
      specId: leafSpecs.id,
      specValues: leafSpecs.specValues,
      productTypeId: leafSpecs.productTypeId,
      specSchema: leafSpecs.specSchema,
      schemaDerivedFromType: leafSpecs.schemaDerivedFromType,
      sourceUpdatedAt: leafSpecs.updatedAt,
    })
    .from(quoteLeaves)
    .leftJoin(
      leafSpecs,
      and(
        eq(leafSpecs.leafId, quoteLeaves.leafId),
        eq(leafSpecs.quoteId, quoteLeaves.quoteId),
      ),
    )
    .where(eq(quoteLeaves.quoteId, args.quoteId));

  if (rows.length === 0) {
    return { frozen: 0, byDisposition: emptyTally() };
  }

  const tally = emptyTally();
  const values = rows.map((r) => {
    const disposition = r.specId
      ? dispositionOf(r.specSchema, r.productTypeId)
      : // No authority at all. Not "no spec" — nobody decided anything, which
        // is what `unmapped` means and `no_schema` does not.
        "unmapped";
    tally[disposition] += 1;
    const specValues = (r.specValues ?? {}) as Record<string, unknown>;
    return {
      quoteSnapshotId: args.snapshotId,
      quoteLeafId: r.quoteLeafId,
      sourceLeafSpecId: r.specId ?? null,
      sourceUpdatedAt: r.sourceUpdatedAt ?? null,
      specValues,
      productTypeId: r.productTypeId ?? null,
      specSchema: r.specSchema ?? null,
      schemaDerivedFromType: r.schemaDerivedFromType ?? null,
      contentHash: orderedSpecContentHash({
        specValues,
        productTypeId: r.productTypeId ?? null,
        specSchema: r.specSchema ?? null,
      }),
      disposition,
    };
  });

  // No onConflictDoNothing. A second freeze against the same snapshot means a
  // send is running twice over one offer, and the unique constraint refusing is
  // the correct outcome — swallowing it would let the second run believe it
  // froze something.
  await tx.insert(quoteSnapshotLeafSpecs).values(values);

  return { frozen: values.length, byDisposition: tally };
}

function emptyTally(): Record<FrozenSpecDisposition, number> {
  return { specified: 0, no_schema: 0, unmapped: 0, no_type: 0 };
}

/**
 * The ordered specifications for a sent offer.
 *
 * The ONLY read the downstream NetSuite packet may use. Reading `leaf_specs`
 * there would answer "what is the spec now", which is the question the freeze
 * exists to stop anyone accidentally asking of an order.
 */
export async function readFrozenOrderedSpecs(snapshotId: string) {
  return db
    .select()
    .from(quoteSnapshotLeafSpecs)
    .where(eq(quoteSnapshotLeafSpecs.quoteSnapshotId, snapshotId))
    .orderBy(quoteSnapshotLeafSpecs.quoteLeafId);
}

/** Ordered leaves on a quote, for the caller that must materialize first. */
export async function orderedLeafIdsForQuote(
  tx: Tx,
  quoteId: string,
): Promise<Array<{ quoteLeafId: string; leafId: string }>> {
  const rows = await tx
    .select({ quoteLeafId: quoteLeaves.id, leafId: quoteLeaves.leafId })
    .from(quoteLeaves)
    .where(eq(quoteLeaves.quoteId, quoteId));
  return rows;
}
