import "server-only";
import { and, eq } from "drizzle-orm";
import { skuAllocations } from "@/db/schema";

/**
 * Bind a reservation to the product that now carries it.
 *
 * ── WHY THIS IS NOT A SEPARATE ROUND TRIP ────────────────────────────────
 *
 * Called with the SAME transaction handle the leaf was written in, so the
 * product and the binding commit together. A follow-up call could fail after
 * the product exists, leaving an identifier that is in the catalog and still
 * reads `allocated` -- so a later reconcile would see a free reservation whose
 * number is already in use, which is the one state this table exists to make
 * impossible.
 *
 * ── IT VERIFIES BEFORE IT BINDS ──────────────────────────────────────────
 *
 * The SKU actually saved must match the SKU reserved. An operator can generate
 * and then type over the field before saving, and binding on the allocation id
 * alone would record that the product carries an identifier it does not. When
 * they disagree the allocation is LEFT ALONE -- still reserved, still spent,
 * never recycled -- rather than quietly re-pointed at a different string.
 *
 * ── IT IS IDEMPOTENT ─────────────────────────────────────────────────────
 *
 * Conditional on `state = 'allocated'`. A retry that re-binds the same
 * allocation to the same leaf changes nothing, and a `conflicted` or
 * `abandoned` allocation is never silently revived by a late save.
 */
export type BindOutcome = "bound" | "already_bound" | "sku_mismatch" | "not_found";

export async function bindAllocationToLeaf(
  // The transaction handle from the caller. Typed loosely because Drizzle's
  // transaction type is not exported in a form usable across modules here;
  // the shape used is `select` / `update`, both present on tx and on db.
  tx: {
    select: typeof import("@/db").db.select;
    update: typeof import("@/db").db.update;
  },
  args: {
    allocationId: string;
    leafId: string;
    savedSku: string | null;
    hubspotProductId: string | null;
    /**
     * The state the caller expects to be binding FROM. `createLeaf` holds a
     * dispatch claim, so it binds from `conflicted`; every other caller binds
     * from an unclaimed `allocated`. Explicit because binding from the wrong
     * state would either skip a claim or silently resolve someone else's
     * unresolved reservation.
     */
    fromState?: "allocated" | "conflicted";
  },
): Promise<BindOutcome> {
  const [row] = await tx
    .select()
    .from(skuAllocations)
    .where(eq(skuAllocations.id, args.allocationId))
    .limit(1);
  if (!row) return "not_found";

  const saved = (args.savedSku ?? "").trim().toUpperCase();
  if (saved === "" || saved !== row.sku.trim().toUpperCase()) {
    // Typed over after generating. The reservation stays spent; it is simply
    // not claimed by this product.
    return "sku_mismatch";
  }

  const expected = args.fromState ?? "allocated";
  if (row.state !== expected) {
    // Already applied (a retry), or deliberately conflicted/abandoned. Either
    // way this save does not get to change it.
    return "already_bound";
  }

  await tx
    .update(skuAllocations)
    .set({
      state: "applied",
      leafId: args.leafId,
      hubspotProductId: args.hubspotProductId,
      settledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(skuAllocations.id, args.allocationId),
        eq(skuAllocations.state, expected),
      ),
    );
  return "bound";
}
