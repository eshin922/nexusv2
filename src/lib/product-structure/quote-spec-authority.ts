import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { leafSpecs, leaves } from "@/db/schema";

/**
 * Quote-owned product specification authority. B-3.
 *
 * A Library product is reusable master data. Its Product Type and default specs
 * are a TEMPLATE for future attachments, never live authority over products
 * already attached to a quote. From the moment of attachment the quote owns its
 * specification: editing it changes nothing else, and later Library changes
 * reach future attachments only.
 *
 * WHY THE TEMPLATE IS COPIED RATHER THAN POINTED AT. Sharing one mutable row
 * between quotes is the defect, not an optimisation of it. Two quotes pointing
 * at the Library-current row would be correct until the first edit and wrong
 * from then on, and "wrong from then on" is invisible — the second quote simply
 * shows values nobody chose for it.
 *
 * WHY NO REFERENCE COUNTING. `leaf_specs_quote_owned_idx` makes exclusivity
 * structural: one authority per (quote_id, leaf_id), so a quote-side write
 * cannot reach a row another quote can observe. Copy-on-write would be checking
 * for a condition the database already forbids.
 *
 * WHY THE PRODUCT TYPE TRAVELS WITH IT. The type IS the schema `spec_values`
 * are validated against. Freezing values while inheriting a mutable Library
 * type reproduces the same defect one level down: a Library type change would
 * silently invalidate or empty every quote's specification, with no record of
 * the schema those values were authored under.
 */

type SpecTx = {
  select: (...args: never[]) => never;
} & Record<string, unknown>;

/** Minimal transaction shape — accepts `db` or a drizzle transaction. */
type Executor = {
  select: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  insert: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type QuoteSpecAuthority = {
  id: string;
  quoteId: string;
  leafId: string;
  specValues: Record<string, unknown>;
  productTypeId: string | null;
  templatedFromSpecId: string | null;
};

/**
 * Ensure this quote owns a specification for this leaf, and return it.
 *
 * Idempotent by design. Called on every attach, including the second and third
 * attachment of the same product to the same quote — those must resolve to the
 * SAME authority rather than each minting one, or two appearances of one SKU
 * could silently diverge.
 */
export async function ensureQuoteSpecAuthority(
  tx: Executor,
  args: {
    quoteId: string;
    leafId: string;
    createdBy: string;
    /**
     * Copy Quote. Template from THAT quote's authority instead of the Library
     * default.
     *
     * A copy duplicates the commercial configuration being copied. Re-resolving
     * the Library default would silently discard whatever the source quote had
     * configured — the copy would look like the source in every respect except
     * the one the operator was working on.
     *
     * The source's VALUES are copied; its authority row is never shared, so the
     * two quotes stay isolated in both directions from the first moment.
     */
    templateFromQuoteId?: string;
  },
): Promise<QuoteSpecAuthority> {
  const existing = await tx
    .select()
    .from(leafSpecs)
    .where(
      and(
        eq(leafSpecs.quoteId, args.quoteId),
        eq(leafSpecs.leafId, args.leafId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return toAuthority(existing[0]);

  // The template. A copy takes the SOURCE QUOTE's configuration; a fresh
  // attachment takes the Library default. Both are read-only here — a template
  // is copied, never pointed at.
  const [template] = await tx
    .select()
    .from(leafSpecs)
    .where(
      args.templateFromQuoteId
        ? and(
            eq(leafSpecs.leafId, args.leafId),
            eq(leafSpecs.quoteId, args.templateFromQuoteId),
          )
        : and(
            eq(leafSpecs.leafId, args.leafId),
            isNull(leafSpecs.quoteId),
            eq(leafSpecs.isCurrent, true),
          ),
    )
    .limit(1);
  // A copy whose source held no authority falls back to the Library default,
  // because "no configuration to duplicate" is the same situation as a fresh
  // attachment — not a reason to leave the destination without authority.
  const [libraryDefault] = template
    ? [template]
    : await tx
        .select()
        .from(leafSpecs)
        .where(
          and(
            eq(leafSpecs.leafId, args.leafId),
            isNull(leafSpecs.quoteId),
            eq(leafSpecs.isCurrent, true),
          ),
        )
        .limit(1);

  const [leaf] = await tx
    .select({ productTypeId: leaves.productTypeId })
    .from(leaves)
    .where(eq(leaves.id, args.leafId))
    .limit(1);

  const [row] = await tx
    .insert(leafSpecs)
    .values({
      leafId: args.leafId,
      quoteId: args.quoteId,
      specValues: libraryDefault?.specValues ?? {},
      // The Library type in force at attach time. Where the Library default
      // carried its own type that wins, since it is the schema the copied
      // values were authored under.
      productTypeId: libraryDefault?.productTypeId ?? leaf?.productTypeId ?? null,
      // For a fresh attachment this is the Library default it copied. For a
      // copy it is the source quote's own provenance, carried forward, so a
      // clone still records which Library version its values originate from
      // rather than pointing at another quote's row.
      templatedFromSpecId: args.templateFromQuoteId
        ? (libraryDefault?.templatedFromSpecId ?? null)
        : (libraryDefault?.id ?? null),
      versionNumber: 1,
      // `is_current` is a LIBRARY-scope concept and quote rows opt out of it.
      // Authority here is established by quote_leaves.leaf_spec_version_id, not
      // by a flag — and keeping it false means a Library-scope reader can never
      // accidentally resolve one quote's specification for another.
      isCurrent: false,
      createdBy: args.createdBy,
    })
    .returning();

  return toAuthority(row);
}

function toAuthority(row: typeof leafSpecs.$inferSelect): QuoteSpecAuthority {
  return {
    id: row.id,
    quoteId: row.quoteId as string,
    leafId: row.leafId,
    specValues: (row.specValues as Record<string, unknown>) ?? {},
    productTypeId: row.productTypeId,
    templatedFromSpecId: row.templatedFromSpecId,
  };
}

/**
 * The SQL predicate a quote-context reader uses.
 *
 * Exported so every reader resolves identically. There is deliberately NO
 * `is_current` fallback: after B-3 an attached leaf always owns a row, so a
 * fallback could only ever mask a bug by silently serving Library state to a
 * quote — which is the defect this work removes.
 */
export function quoteScopedSpecPredicate(quoteId: string) {
  return and(eq(leafSpecs.quoteId, quoteId));
}

/** Library-scope resolution. Master/template contexts only — never a quote. */
export function librarySpecPredicate() {
  return and(isNull(leafSpecs.quoteId), eq(leafSpecs.isCurrent, true));
}

/** Next revision number within a quote's own authority. */
export const nextQuoteRevision = sql`version_number + 1`;

export type { SpecTx };
