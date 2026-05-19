import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { productTypes } from "@/db/schema";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { productTypeOrderExpression } from "@/lib/product-type-order";

// Phase A.1 v2 impl-4 — Product-type options loader for the Add
// Product modal.
//
// Returns:
//   - assemblyTypes: id + name only, non-hidden, scope=assembly
//   - leafTypes: full LeafSpecEntryProductType shape (id + name +
//     scope + placeholder + fieldSchema), non-hidden, scope=leaf
//
// The shape mismatch (ASY just needs id+name; LEAF needs full
// fieldSchema for the "Next step" preview card) is intentional —
// ASY mode doesn't need spec schema context; LEAF mode does.

export async function loadProductTypeOptions(): Promise<{
  assemblyTypes: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
}> {
  // Canonical ordering per Edward §15.1 + §15.2 (Bug #L fix).
  const rows = await db
    .select()
    .from(productTypes)
    .orderBy(productTypeOrderExpression, asc(productTypes.name));

  const assemblyTypes = rows
    .filter((t) => t.scope === "assembly" && !t.hidden)
    .map((t) => ({ id: t.id, name: t.name }));

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

  return { assemblyTypes, leafTypes };
}
