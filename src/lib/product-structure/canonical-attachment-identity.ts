import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  assemblies,
  assemblyLeaves,
  leaves,
  quoteLeaves,
  quotes,
} from "../../db/schema.ts";

declare const canonicalQuoteLeafIdBrand: unique symbol;
declare const legacyAssemblyLeafIdBrand: unique symbol;

/** Quote-scoped commercial attachment identity. Never construct this from leaf_id. */
export type CanonicalQuoteLeafId = string & {
  readonly [canonicalQuoteLeafIdBrand]: true;
};

/** Temporary grouped-membership compatibility identity. */
export type LegacyAssemblyLeafId = string & {
  readonly [legacyAssemblyLeafIdBrand]: true;
};

export type CanonicalAttachmentIdentity = {
  quoteLeafId: CanonicalQuoteLeafId;
  assemblyLeafId: LegacyAssemblyLeafId | null;
  quoteId: string;
  leafId: string;
  assemblyId: string | null;
  quantity: string;
  position: number;
};

export class CanonicalAttachmentResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalAttachmentResolutionError";
  }
}

export function canonicalQuoteLeafId(value: string): CanonicalQuoteLeafId {
  if (!value.trim()) {
    throw new CanonicalAttachmentResolutionError("quote_leaf_id is required.");
  }
  return value as CanonicalQuoteLeafId;
}

export function legacyAssemblyLeafId(value: string): LegacyAssemblyLeafId {
  if (!value.trim()) {
    throw new CanonicalAttachmentResolutionError("assembly_leaf_id is required.");
  }
  return value as LegacyAssemblyLeafId;
}

function assertValidMapping(row: {
  canonical: typeof quoteLeaves.$inferSelect;
  legacy: typeof assemblyLeaves.$inferSelect | null;
  assemblyQuoteId: string | null;
}): CanonicalAttachmentIdentity {
  const { canonical, legacy, assemblyQuoteId } = row;
  if (canonical.assemblyId === null) {
    if (legacy !== null) {
      throw new CanonicalAttachmentResolutionError(
        `Direct canonical attachment ${canonical.id} unexpectedly has legacy compatibility state.`,
      );
    }
  } else if (
    legacy === null ||
    legacy.quoteLeafId !== canonical.id ||
    legacy.assemblyId !== canonical.assemblyId ||
    legacy.leafId !== canonical.leafId ||
    assemblyQuoteId !== canonical.quoteId ||
    Number(legacy.quantity) !== Number(canonical.quantity) ||
    legacy.position !== canonical.position
  ) {
    throw new CanonicalAttachmentResolutionError(
      `Canonical attachment ${canonical.id} has invalid or drifting compatibility state.`,
    );
  }

  return {
    quoteLeafId: canonicalQuoteLeafId(canonical.id),
    assemblyLeafId: legacy ? legacyAssemblyLeafId(legacy.id) : null,
    quoteId: canonical.quoteId,
    leafId: canonical.leafId,
    assemblyId: canonical.assemblyId,
    quantity: canonical.quantity,
    position: canonical.position,
  };
}

/** Authoritative lookup. Direct-form rows are valid without a legacy mapping. */
export async function lookupCanonicalAttachment(
  quoteLeafId: CanonicalQuoteLeafId,
): Promise<CanonicalAttachmentIdentity> {
  const rows = await db
    .select({
      canonical: quoteLeaves,
      legacy: assemblyLeaves,
      assemblyQuoteId: assemblies.quoteId,
    })
    .from(quoteLeaves)
    .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
    .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
    .leftJoin(assemblyLeaves, eq(assemblyLeaves.quoteLeafId, quoteLeaves.id))
    .leftJoin(assemblies, eq(assemblies.id, quoteLeaves.assemblyId))
    .where(eq(quoteLeaves.id, quoteLeafId))
    .limit(2);
  if (rows.length !== 1) {
    throw new CanonicalAttachmentResolutionError(
      `quote_leaf_id ${quoteLeafId} did not resolve exactly once.`,
    );
  }
  return assertValidMapping(rows[0]);
}

/** Reverse compatibility lookup. Missing/null/drifting mappings fail closed. */
export async function lookupCanonicalAttachmentByLegacyId(
  assemblyLeafId: LegacyAssemblyLeafId,
): Promise<CanonicalAttachmentIdentity> {
  const rows = await db
    .select({
      canonical: quoteLeaves,
      legacy: assemblyLeaves,
      assemblyQuoteId: assemblies.quoteId,
    })
    .from(assemblyLeaves)
    .innerJoin(quoteLeaves, eq(quoteLeaves.id, assemblyLeaves.quoteLeafId))
    .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
    .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .where(eq(assemblyLeaves.id, assemblyLeafId))
    .limit(2);
  if (rows.length !== 1) {
    throw new CanonicalAttachmentResolutionError(
      `assembly_leaf_id ${assemblyLeafId} did not resolve exactly one canonical attachment.`,
    );
  }
  return assertValidMapping(rows[0]);
}
