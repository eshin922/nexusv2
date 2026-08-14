import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leafSpecs,
  leaves,
  productTypes,
} from "@/db/schema";
import { productTypeOrderExpression } from "@/lib/product-type-order";
import {
  decodePinnedSchema,
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
} from "@/lib/product-structure/spec-schema-mapping";

// Phase A.1 v2 impl-6 — PDF addendum data loader.
//
// Returns a Pattern-45-safe typed shape suitable for the
// customer-view PDF render tree. The loader lives outside the
// boundary; the data crosses via the `QuoteAddendumData` type
// imported by the addendum components in src/components/pdf/.
//
// Pattern 45 discipline — addendum data INTENTIONALLY OMITS:
// - leaf_specs.version_number (CLAUDE.md "Customer-view boundary
//   guard" excludes this as internal versioning; CD designer notes
//   Decision 3 renders version stamps in addendum but the boundary
//   disposition for nexus is omit-until-impl-7 + Edward + CA
//   disposition on the boundary update)
// - any audit / costing / supplier metadata
//
// What it DOES include:
// - assembly identity (sku + name) and display order
// - per-assembly leaf list (name + product_type identity)
// - per-leaf field schema + current spec values
// - hasAnyAddendum flag for empty-data suppression

export type AddendumLeafField = {
  key: string;
  label: string;
  wide?: boolean;
  value: string | null;
};

export type AddendumLeafVariant =
  | { kind: "untyped" }
  | { kind: "placeholder"; typeName: string }
  | {
      kind: "typed";
      typeName: string;
      fields: AddendumLeafField[];
      filledCount: number;
    };

export type AddendumLeaf = {
  leafKey: string; // junction id; stable React key
  name: string;
  variant: AddendumLeafVariant;
};

export type AddendumAssembly = {
  assemblyId: string;
  sku: string;
  name: string;
  leaves: AddendumLeaf[];
};

export type QuoteAddendumData = {
  // For the toggle's "{N} leaves across {M} ASYs" meta line.
  totalLeaves: number;
  totalAssemblies: number;
  // Empty-data suppression: false when every typed leaf has zero
  // filled fields AND no untyped / placeholder presence (which
  // ARE meaningful render content even when no spec values).
  // Per scenario ㉗ ("all empty → addendum doesn't render"),
  // hasMeaningfulContent=false suppresses the addendum even when
  // the toggle is on.
  hasMeaningfulContent: boolean;
  assemblies: AddendumAssembly[];
};

export async function loadQuoteAddendum(
  quoteId: string,
): Promise<QuoteAddendumData> {
  // Wave 1: assemblies in display order.
  const asmRows = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.quoteId, quoteId))
    .orderBy(asc(assemblies.position), asc(assemblies.createdAt));

  if (asmRows.length === 0) {
    return {
      totalLeaves: 0,
      totalAssemblies: 0,
      hasMeaningfulContent: false,
      assemblies: [],
    };
  }

  const asmIds = asmRows.map((r) => r.id);

  // Wave 2: junctions + types in parallel.
  const [junctionRows, allTypes] = await Promise.all([
    db
      .select()
      .from(assemblyLeaves)
      .where(inArray(assemblyLeaves.assemblyId, asmIds))
      .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt)),
    db
      .select()
      .from(productTypes)
      .orderBy(productTypeOrderExpression),
  ]);

  const typeMap = new Map(allTypes.map((t) => [t.id, t] as const));

  const leafIds = Array.from(new Set(junctionRows.map((r) => r.leafId)));
  if (leafIds.length === 0) {
    return {
      totalLeaves: 0,
      totalAssemblies: asmRows.length,
      hasMeaningfulContent: false,
      assemblies: asmRows.map((a) => ({
        assemblyId: a.id,
        sku: a.sku,
        name: a.name,
        leaves: [],
      })),
    };
  }

  // Wave 3: leaves + current specs.
  const [leafRows, specRows] = await Promise.all([
    db.select().from(leaves).where(inArray(leaves.id, leafIds)),
    db
      .select()
      .from(leafSpecs)
      // B-3 — QUOTE-SCOPED. Resolves this quote's own authority. There is no
      // `is_current` fallback: after B-3 an attached leaf always owns a row, so
      // a fallback could only serve Library state to a quote, which is the
      // defect this replaced.
      .where(
        and(inArray(leafSpecs.leafId, leafIds), eq(leafSpecs.quoteId, quoteId)),
      ),
  ]);

  const leafMap = new Map(leafRows.map((r) => [r.id, r] as const));
  const specMap = new Map(specRows.map((r) => [r.leafId, r] as const));

  // Group junctions by assembly (preserves per-assembly leaf order).
  const junctionsByAsm = new Map<string, typeof junctionRows>();
  for (const j of junctionRows) {
    const list = junctionsByAsm.get(j.assemblyId) ?? [];
    list.push(j);
    junctionsByAsm.set(j.assemblyId, list);
  }

  let totalLeaves = 0;
  let meaningfulCount = 0;

  const addendumAssemblies: AddendumAssembly[] = asmRows.map((asm) => {
    const junctions =
      junctionsByAsm.get(asm.id)?.filter((j) => j.parentAssemblyLeafId === null) ?? [];
    const leavesOut: AddendumLeaf[] = junctions.map((j) => {
      const leaf = leafMap.get(j.leafId);
      if (!leaf) {
        // Shouldn't happen with FK in place; defensive only.
        return {
          leafKey: j.id,
          name: "(missing leaf)",
          variant: { kind: "untyped" },
        };
      }
      totalLeaves++;
      // Step 4.4 · CUSTOMER-FACING. The schema shown to a customer is the one
      // PINNED on this quote's authority, so a HubSpot reclassification after
      // send cannot change which fields a re-render prints. Reading
      // `leaves.product_type_id` here would have made the customer document
      // depend on a taxonomy the operator no longer maintains.
      const pinnedRow = specMap.get(leaf.id);
      const pinned = decodePinnedSchema(
        pinnedRow?.specSchema,
        pinnedRow?.schemaDerivedFromType,
      );
      const type =
        pinned?.kind === "schema"
          ? typeMap.get(SPEC_SCHEMA_PRODUCT_TYPE_ID[pinned.schemaId])
          : null;
      if (!type) {
        // Untyped is a meaningful render state per scenario ㉔'s
        // mixed-types coverage — count it as content.
        meaningfulCount++;
        return {
          leafKey: j.id,
          name: leaf.name,
          variant: { kind: "untyped" },
        };
      }
      if (type.placeholder) {
        meaningfulCount++;
        return {
          leafKey: j.id,
          name: leaf.name,
          variant: { kind: "placeholder", typeName: type.name },
        };
      }
      // Typed-with-schema variant.
      const schema = type.fieldSchema as
        | { fields: { key: string; label: string; wide?: boolean }[] }
        | null
        | undefined;
      if (!schema || !Array.isArray(schema.fields)) {
        // Type without schema (shouldn't happen post-impl-3-patch
        // for PP/SP/TP) — degrade to placeholder.
        meaningfulCount++;
        return {
          leafKey: j.id,
          name: leaf.name,
          variant: { kind: "placeholder", typeName: type.name },
        };
      }
      const spec = specMap.get(leaf.id);
      const values =
        (spec?.specValues as Record<string, unknown> | undefined) ?? {};
      let filledCount = 0;
      const fields: AddendumLeafField[] = schema.fields.map((f) => {
        const raw = values[f.key];
        let value: string | null = null;
        if (raw !== null && raw !== undefined) {
          const s = typeof raw === "string" ? raw : String(raw);
          if (s.trim() !== "") {
            value = s;
            filledCount++;
          }
        }
        return { key: f.key, label: f.label, wide: f.wide, value };
      });
      if (filledCount > 0) meaningfulCount++;
      return {
        leafKey: j.id,
        name: leaf.name,
        variant: {
          kind: "typed",
          typeName: type.name,
          fields,
          filledCount,
        },
      };
    });

    return {
      assemblyId: asm.id,
      sku: asm.sku,
      name: asm.name,
      leaves: leavesOut,
    };
  });

  // impl-6 patch round — toggle meta denominator fix.
  // Pre-fix counted `asmRows.length` (every ASY in the quote);
  // post-fix counts only ASYs with at least one leaf, mirroring
  // the addendum's actual render output (zero-leaf ASYs are
  // suppressed by the `if (asy.leaves.length === 0) return null`
  // guard in PdfAddendumAssemblies). PMs see "3 ASYs" in the
  // toggle caption and 3 papers rendered — no off-by-N confusion.
  const renderedAssemblyCount = addendumAssemblies.filter(
    (a) => a.leaves.length > 0,
  ).length;

  return {
    totalLeaves,
    totalAssemblies: renderedAssemblyCount,
    hasMeaningfulContent: meaningfulCount > 0,
    assemblies: addendumAssemblies,
  };
}
