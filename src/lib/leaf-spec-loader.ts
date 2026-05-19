import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leafSpecs,
  leaves,
  productTypes,
  quotes,
} from "@/db/schema";
import { productTypeOrderExpression } from "@/lib/product-type-order";

// Phase A.1 v2 impl-3 — Spec entry surface data loader.
//
// One server-side function loads everything the SpecEntry surface
// needs to render scenarios ⑤-⑩. Sized to a small handful of
// queries; no N+1.
//
// Origin quote context (`originQuoteId`) is preserved for back-nav
// + cascade-warning context (referencing ASYs in this quote vs
// elsewhere). The leaf itself is library-scoped (no quote_id);
// only the originating quote's URL needs the context.

export type LeafSpecField =
  | { key: string; label: string; wide?: boolean; type?: "text" | "textarea" | "number" }
  | { key: string; label: string; wide?: boolean; type: "select"; options: string[] };

export type LeafSpecFieldSchema = {
  fields: LeafSpecField[];
};

export type LeafSpecEntryProductType = {
  id: string;
  name: string;
  scope: "assembly" | "leaf";
  placeholder: boolean;
  fieldSchema: LeafSpecFieldSchema | null;
};

export type LeafSpecReference = {
  assemblyId: string;
  assemblySku: string;
  assemblyName: string;
  quoteId: string;
  quoteStatus: string; // 'draft' | 'sent' | 'accepted' | 'superseded' | 'lost'
  scenarioLabel: string | null;
};

export type LeafSpecEntryData = {
  leaf: {
    id: string;
    name: string;
    sku: string | null;
    productTypeId: string | null;
    unitCost: string | null;
    fscClaim: boolean | null;
    fscStatus: string | null;
    archived: boolean;
  };
  productType: LeafSpecEntryProductType | null;
  // Current leaf_spec row (is_current=true). Null when no spec
  // values yet (TypePicker empty state OR a typed leaf that hasn't
  // had any field filled).
  currentSpec: {
    id: string;
    versionNumber: number;
    specValues: Record<string, unknown>;
    effectiveFrom: Date;
  } | null;
  // List of all leaf-scope product types available in the picker.
  // Used by TypePicker (scenario ⑨) — filtered to non-hidden.
  availableLeafTypes: LeafSpecEntryProductType[];
  // References — every assembly_leaves row pointing at this leaf,
  // dereferenced with parent ASY identity + parent quote identity.
  // Drives the header reference count + cascade-warning modal.
  references: LeafSpecReference[];
};

/**
 * Loads everything a SpecEntry render needs. Throws if the leaf
 * doesn't exist; returns archived leaves (render handles archived
 * state separately).
 */
export async function loadLeafForSpecEntry(
  leafId: string,
): Promise<LeafSpecEntryData | null> {
  const leafRows = await db
    .select()
    .from(leaves)
    .where(eq(leaves.id, leafId))
    .limit(1);
  if (leafRows.length === 0) return null;
  const leaf = leafRows[0];

  // Wave 2: spec row + product types + references in parallel.
  const [specRows, typeRows, junctionRows] = await Promise.all([
    db
      .select()
      .from(leafSpecs)
      .where(and(eq(leafSpecs.leafId, leafId), eq(leafSpecs.isCurrent, true)))
      .limit(1),
    db
      .select()
      .from(productTypes)
      .orderBy(productTypeOrderExpression, asc(productTypes.name)),
    db
      .select({
        junctionId: assemblyLeaves.id,
        assemblyId: assemblies.id,
        assemblySku: assemblies.sku,
        assemblyName: assemblies.name,
        quoteId: quotes.id,
        quoteStatus: quotes.status,
        scenarioLabel: quotes.scenarioLabel,
      })
      .from(assemblyLeaves)
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
      .where(eq(assemblyLeaves.leafId, leafId)),
  ]);

  const typeMap = new Map(
    typeRows.map(
      (t) =>
        [
          t.id,
          {
            id: t.id,
            name: t.name,
            scope: t.scope as "assembly" | "leaf",
            placeholder: t.placeholder,
            fieldSchema: (t.fieldSchema as LeafSpecFieldSchema | null) ?? null,
          },
        ] as const,
    ),
  );

  const productType = leaf.productTypeId
    ? typeMap.get(leaf.productTypeId) ?? null
    : null;

  const availableLeafTypes: LeafSpecEntryProductType[] = typeRows
    .filter((t) => t.scope === "leaf" && !t.hidden)
    .map((t) => ({
      id: t.id,
      name: t.name,
      scope: "leaf",
      placeholder: t.placeholder,
      fieldSchema: (t.fieldSchema as LeafSpecFieldSchema | null) ?? null,
    }));

  const currentSpec = specRows[0]
    ? {
        id: specRows[0].id,
        versionNumber: specRows[0].versionNumber,
        specValues:
          (specRows[0].specValues as Record<string, unknown> | null) ?? {},
        effectiveFrom: specRows[0].effectiveFrom,
      }
    : null;

  const references: LeafSpecReference[] = junctionRows.map((r) => ({
    assemblyId: r.assemblyId,
    assemblySku: r.assemblySku,
    assemblyName: r.assemblyName,
    quoteId: r.quoteId,
    quoteStatus: r.quoteStatus,
    scenarioLabel: r.scenarioLabel,
  }));

  return {
    leaf: {
      id: leaf.id,
      name: leaf.name,
      sku: leaf.sku,
      productTypeId: leaf.productTypeId,
      unitCost: leaf.unitCost,
      fscClaim: leaf.fscClaim,
      fscStatus: leaf.fscStatus,
      archived: leaf.archived,
    },
    productType,
    currentSpec,
    availableLeafTypes,
    references,
  };
}

/**
 * Lightweight existence check used by route page (404 path).
 * Doesn't load the full loader payload; cheaper.
 */
export async function leafExists(leafId: string): Promise<boolean> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leaves)
    .where(eq(leaves.id, leafId));
  return (rows[0]?.n ?? 0) > 0;
}
