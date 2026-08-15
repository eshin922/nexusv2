import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leafSpecs, leaves, productTypes } from "@/db/schema";
import { productTypeOrderExpression } from "@/lib/product-type-order";
import { loadQuoteProductStructure } from "@/lib/quote-product-structure";
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
// - group identity (sku + name) and display order, PLUS Direct
//   Components as their own single-product groups (OD-023)
// - per-group product list (name + product_type identity)
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

/**
 * One addendum page's worth of products.
 *
 * OD-023 · CANONICAL ENUMERATION. This used to be "one Item Group", derived by
 * walking `assembly_leaves` — the legacy junction a Direct Component has no row
 * in. So a Direct printed in the pricing table and was absent from its own
 * specification pages: the customer received a priced product with no specs and
 * nothing said so.
 *
 * The product set now comes from `quote_leaves`, which is the FK that says which
 * quote a product belongs to regardless of structure. Grouped membership still
 * comes from the group — `quote_leaves.assembly_id` — so nothing about Item
 * Group rendering changes. A Direct Component is its own group of one, headed by
 * its own identity, because that is what it commercially is.
 *
 * `assemblyId` is null for a Direct. `kind` states which shape this is rather
 * than leaving a consumer to infer it from that null.
 */
export type AddendumAssembly = {
  kind: "item_group" | "direct";
  /** Null for a Direct Component — it has no group. */
  assemblyId: string | null;
  /** Stable render key. The group id, or the Direct's `quote_leaves.id`. */
  groupKey: string;
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
  // ── Wave 1 · the product set, canonically ────────────────────────────────
  //
  // Shared with the sent version's frozen `structure` payload. One enumeration
  // serving both is deliberate: two queries that must agree is two queries that
  // eventually will not, and this addendum's own drift onto the legacy junction
  // is how Direct Components came to be omitted from customer specifications.
  const attachmentRows = await loadQuoteProductStructure(quoteId);

  if (attachmentRows.length === 0) {
    return {
      totalLeaves: 0,
      totalAssemblies: 0,
      hasMeaningfulContent: false,
      assemblies: [],
    };
  }

  const leafIds = Array.from(new Set(attachmentRows.map((r) => r.leafId)));

  // ── Wave 2 · types, products, and this quote's own spec authority ────────
  const [allTypes, leafRows, specRows] = await Promise.all([
    db.select().from(productTypes).orderBy(productTypeOrderExpression),
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

  const typeMap = new Map(allTypes.map((t) => [t.id, t] as const));
  const leafMap = new Map(leafRows.map((r) => [r.id, r] as const));
  const specMap = new Map(specRows.map((r) => [r.leafId, r] as const));

  let totalLeaves = 0;
  let meaningfulCount = 0;

  /**
   * One product's spec block.
   *
   * Identical for a grouped product and a Direct one — which is the point. The
   * two shapes differ in how they are ENUMERATED, never in how they are
   * specified, and keeping one function for both is what stops the Direct path
   * from drifting into a second, less-tested rendering.
   *
   * Keyed by `quote_leaves.id`, the canonical attachment identity, rather than
   * by the junction id it used to carry.
   */
  function toAddendumLeaf(quoteLeafId: string, leafId: string): AddendumLeaf {
    const leaf = leafMap.get(leafId);
    if (!leaf) {
      // Shouldn't happen with FK in place; defensive only.
      return {
        leafKey: quoteLeafId,
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
      // Untyped is a meaningful render state per the mixed-types coverage —
      // count it as content.
      meaningfulCount++;
      return {
        leafKey: quoteLeafId,
        name: leaf.name,
        variant: { kind: "untyped" },
      };
    }
    if (type.placeholder) {
      meaningfulCount++;
      return {
        leafKey: quoteLeafId,
        name: leaf.name,
        variant: { kind: "placeholder", typeName: type.name },
      };
    }
    const schema = type.fieldSchema as
      | { fields: { key: string; label: string; wide?: boolean }[] }
      | null
      | undefined;
    if (!schema || !Array.isArray(schema.fields)) {
      // Type without schema (shouldn't happen post-impl-3-patch for PP/SP/TP)
      // — degrade to placeholder.
      meaningfulCount++;
      return {
        leafKey: quoteLeafId,
        name: leaf.name,
        variant: { kind: "placeholder", typeName: type.name },
      };
    }
    const values =
      (pinnedRow?.specValues as Record<string, unknown> | undefined) ?? {};
    let filledCount = 0;
    const fields: AddendumLeafField[] = schema.fields.map((f) => {
      const raw = values[f.key];
      let value: string | null = null;
      if (raw !== null && raw !== undefined) {
        const asText = typeof raw === "string" ? raw : String(raw);
        if (asText.trim() !== "") {
          value = asText;
          filledCount++;
        }
      }
      return { key: f.key, label: f.label, wide: f.wide, value };
    });
    if (filledCount > 0) meaningfulCount++;
    return {
      leafKey: quoteLeafId,
      name: leaf.name,
      variant: { kind: "typed", typeName: type.name, fields, filledCount },
    };
  }

  // ── Wave 3 · group, preserving the order the query established ───────────
  const groups: AddendumAssembly[] = [];
  const groupIndex = new Map<string, number>();

  for (const row of attachmentRows) {
    const entry = toAddendumLeaf(row.quoteLeafId, row.leafId);
    if (row.isDirect) {
      // A Direct Component is its own group of one, headed by its own
      // identity — which is what it commercially is. Not a redesign of the
      // addendum: the same page shape, enumerated from the identity that can
      // actually express it.
      groups.push({
        kind: "direct",
        assemblyId: null,
        groupKey: row.quoteLeafId,
        sku: row.sku ?? "",
        name: row.name,
        leaves: [entry],
      });
      continue;
    }
    const groupId = row.groupId!;
    const at = groupIndex.get(groupId);
    if (at === undefined) {
      groupIndex.set(groupId, groups.length);
      groups.push({
        kind: "item_group",
        assemblyId: groupId,
        groupKey: groupId,
        sku: row.groupSku ?? "",
        name: row.groupName ?? "",
        leaves: [entry],
      });
    } else {
      groups[at].leaves.push(entry);
    }
  }

  // Directs print after groups. `assemblies.position` is NULL for them and
  // Postgres sorts NULLs last on ASC by default, so the query already did this
  // — restated as an explicit partition so the guarantee does not rest on a
  // default that a later ORDER BY edit could quietly change.
  const ordered = [
    ...groups.filter((g) => g.kind === "item_group"),
    ...groups.filter((g) => g.kind === "direct"),
  ];

  // impl-6 patch round — toggle meta denominator fix.
  // Pre-fix counted every group in the quote; post-fix counts only groups with
  // at least one product, mirroring the addendum's actual render output (empty
  // groups are suppressed by the render guard). Operators see "3 ASYs" in the
  // toggle caption and 3 papers rendered — no off-by-N confusion.
  const renderedAssemblyCount = ordered.filter(
    (g) => g.leaves.length > 0,
  ).length;

  return {
    totalLeaves,
    totalAssemblies: renderedAssemblyCount,
    hasMeaningfulContent: meaningfulCount > 0,
    assemblies: ordered,
  };
}
