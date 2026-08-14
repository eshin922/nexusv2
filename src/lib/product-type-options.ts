import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { itemGroupCategories, productTypes } from "@/db/schema";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { productTypeOrderExpression } from "@/lib/product-type-order";

// Phase A.1 v2 impl-4 — Product-type options loader for the Add
// Product modal.
//
// Returns:
//   - itemGroupCategories: id + name, non-hidden (Step 7 · own registry)
//   - leafTypes: full LeafSpecEntryProductType shape (id + name +
//     scope + placeholder + fieldSchema), non-hidden, scope=leaf
//
// The shape mismatch (ASY just needs id+name; LEAF needs full
// fieldSchema for the "Next step" preview card) is intentional —
// ASY mode doesn't need spec schema context; LEAF mode does.

export async function loadProductTypeOptions(): Promise<{
  /**
   * Step 7 · Item Group Categories, from their OWN registry.
   *
   * Named for what they are. They are not product types, they never had a
   * field schema, and reading them out of `product_types` is what let an Item
   * Group be presented as carrying a competing leaf Product Type.
   */
  itemGroupCategories: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
}> {
  const categoryRows = await db
    .select()
    .from(itemGroupCategories)
    .where(eq(itemGroupCategories.hidden, false))
    .orderBy(asc(itemGroupCategories.position), asc(itemGroupCategories.name));
  // Canonical ordering per Edward §15.1 + §15.2 (Bug #L fix).
  const rows = await db
    .select()
    .from(productTypes)
    .orderBy(productTypeOrderExpression, asc(productTypes.name));

  const leafTypes: LeafSpecEntryProductType[] = rows
    .filter((t) => t.scope === "leaf" && !t.hidden)
    .map((t) => ({
      id: t.id,
      name: t.name,
      scope: "leaf",
      placeholder: t.placeholder,
      fieldSchema:
        (t.fieldSchema as LeafSpecEntryProductType["fieldSchema"]) ?? null,
    }));

  return {
    itemGroupCategories: categoryRows.map((c) => ({ id: c.id, name: c.name })),
    leafTypes,
  };
}
