import "server-only";
import { and, asc, eq, isNull, inArray, sql } from "drizzle-orm";
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
import {
  decodePinnedSchema,
  resolveSpecSchema,
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
} from "@/lib/product-structure/spec-schema-mapping";

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
    /** AUTHORITATIVE Product Type — HubSpot's, read live. Step 4.5. */
    hubspotProductType: string | null;
    unitCost: string | null;
    fscClaim: boolean | null;
    fscStatus: string | null;
    archived: boolean;
  };
  productType: LeafSpecEntryProductType | null;
  /**
   * Step 8 · WHY there is no field set, when there is none.
   *
   * `productType === null` alone cannot say whether the product is
   * unclassified or classified into a category specifications do not apply to.
   * Those need different copy and different operator action, so the surface is
   * told which it is rather than inferring it from an absence.
   */
  specSchemaState: "schema" | "no_schema" | "unmapped" | "no_type";
  // Current leaf_spec row (is_current=true). Null when no spec
  // values yet (TypePicker empty state OR a typed leaf that hasn't
  // had any field filled).
  currentSpec: {
    id: string;
    versionNumber: number;
    specValues: Record<string, unknown>;
    effectiveFrom: Date;
  } | null;
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
  /**
   * B-3 — which authority to read.
   *
   * A quote id resolves that quote's own specification. `null` resolves the
   * LIBRARY default, and is only legitimate for a master/template context.
   * The route already carried the quote in its URL and discarded it; that is
   * what let a quote-context surface edit Library master data.
   */
  scope: { quoteId: string } | { library: true },
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
      // No `is_current` fallback in the quote branch: after B-3 an attached
      // leaf always owns a row, so a fallback could only serve Library state
      // to a quote.
      .where(
        and(
          eq(leafSpecs.leafId, leafId),
          "quoteId" in scope
            ? eq(leafSpecs.quoteId, scope.quoteId)
            : and(isNull(leafSpecs.quoteId), eq(leafSpecs.isCurrent, true)),
        ),
      )
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

  // Step 4.4 · the schema these values are validated against is the one PINNED
  // on the authority being read, not a live lookup on the leaf.
  //
  // In quote scope that pin is the quote's own, frozen at attachment, so a
  // later HubSpot reclassification cannot make fields appear or disappear
  // underneath values an operator already entered. In Library scope there is
  // no pin — the Library row is a TEMPLATE — so the schema is resolved live
  // from authoritative classification, which is what a future attachment will
  // inherit.
  //
  // `leaves.product_type_id` is deliberately not consulted in either branch.
  const pinned = decodePinnedSchema(
    specRows[0]?.specSchema,
    specRows[0]?.schemaDerivedFromType,
  );
  const resolution =
    "quoteId" in scope ? pinned : resolveSpecSchema(leaf.hubspotProductType);
  const schemaTypeId =
    resolution?.kind === "schema"
      ? SPEC_SCHEMA_PRODUCT_TYPE_ID[resolution.schemaId]
      : null;
  const productType = schemaTypeId ? typeMap.get(schemaTypeId) ?? null : null;
  const specSchemaState: LeafSpecEntryData["specSchemaState"] =
    resolution === null ? "no_type" : resolution.kind;

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
      hubspotProductType: leaf.hubspotProductType,
      unitCost: leaf.unitCost,
      fscClaim: leaf.fscClaim,
      fscStatus: leaf.fscStatus,
      archived: leaf.archived,
    },
    productType,
    specSchemaState,
    currentSpec,
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
