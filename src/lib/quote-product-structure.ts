import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, leaves, quoteLeaves } from "@/db/schema";

/**
 * OD-023 · the quote's product set, enumerated CANONICALLY.
 *
 * ONE enumeration, two consumers: the specification addendum and the sent
 * version's frozen `structure` payload. They were going to need the same
 * ordered product list, and two queries that must agree is two queries that
 * eventually will not — the addendum's own drift from `quote_leaves` to the
 * legacy junction is exactly how the Direct Component blind spot arose.
 *
 * WHY `quote_leaves` AND NOT `assembly_leaves`
 *
 * `quote_leaves.quote_id` is the FK that says which quote a product belongs to,
 * for BOTH shapes. `assembly_leaves` is the legacy junction, and a Direct
 * Component has no row in it — so an enumeration through the junction silently
 * omits every Direct product rather than failing. The customer-facing addendum
 * was the last consumer still keyed that way after OD-017 retired it elsewhere.
 *
 * Group membership still comes from the group. Nothing about Item Group
 * rendering changes; what changes is that products with no group are no longer
 * invisible.
 */

export type QuoteProductRow = {
  /** Canonical attachment identity — `quote_leaves.id`. */
  quoteLeafId: string;
  /** Library product identity. */
  leafId: string;
  /** Nullable — a library row may carry no code. */
  sku: string | null;
  name: string;
  quantity: string;
  /** True when this product is sold on its own, with no Item Group. */
  isDirect: boolean;
  /** Null for a Direct Component. */
  groupId: string | null;
  groupSku: string | null;
  groupName: string | null;
  /**
   * Position WITHIN the returned order, assigned here rather than copied from
   * `position`.
   *
   * `quote_leaves.position` is not unique — OD-028 — so it cannot serve as the
   * printed ordinal on its own. This is the order the artifact actually used,
   * recorded explicitly so a later reader does not have to re-derive it from a
   * column whose ties a rebuild may break differently.
   */
  ordinal: number;
};

/**
 * Ordered exactly as the artifact prints: groups first by group position, then
 * Direct products; within a group, by product position. `id` breaks position
 * ties so the order is total and a rebuild cannot silently reshuffle it.
 *
 * Directs sort last because `assemblies.position` is NULL for them and Postgres
 * sorts NULLs last on ASC — restated in the partition below so the guarantee
 * does not rest on a default a later ORDER BY edit could change.
 */
export async function loadQuoteProductStructure(
  quoteId: string,
): Promise<QuoteProductRow[]> {
  const rows = await db
    .select({
      quoteLeafId: quoteLeaves.id,
      leafId: quoteLeaves.leafId,
      quantity: quoteLeaves.quantity,
      sku: leaves.sku,
      name: leaves.name,
      groupId: assemblies.id,
      groupSku: assemblies.sku,
      groupName: assemblies.name,
    })
    .from(quoteLeaves)
    .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
    .leftJoin(assemblies, eq(assemblies.id, quoteLeaves.assemblyId))
    .where(eq(quoteLeaves.quoteId, quoteId))
    .orderBy(
      asc(assemblies.position),
      asc(quoteLeaves.position),
      asc(quoteLeaves.createdAt),
      asc(quoteLeaves.id),
    );

  const grouped = rows.filter((r) => r.groupId !== null);
  const direct = rows.filter((r) => r.groupId === null);

  return [...grouped, ...direct].map((r, ordinal) => ({
    quoteLeafId: r.quoteLeafId,
    leafId: r.leafId,
    sku: r.sku,
    name: r.name,
    quantity: r.quantity,
    isDirect: r.groupId === null,
    groupId: r.groupId,
    groupSku: r.groupSku,
    groupName: r.groupName,
    ordinal,
  }));
}
