/**
 * Is `quote_leaves > 0` the right minimal SEND predicate? READ ONLY.
 *
 * The disposition asks this before implementing: does every `quote_leaves` row
 * represent a sendable commercial Product or Service? If yes, the count is the
 * predicate. If not, it must be filtered to the governed commercial population.
 *
 * The decisive edge is the OTHER direction, and it is the one a naive swap
 * would break: an Item Group carrying NO members has `assemblies > 0` but
 * `quote_leaves = 0`. Under today's gate it sends; under a bare leaf count it
 * would not. The disposition requires "Item Group only -> ALLOW", so whether
 * such a quote can exist decides whether the predicate needs a second term.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { assemblies, quoteLeaves, quotes } from "@/db/schema";

// ── 1 · what kinds of row does quote_leaves actually hold? ───────────────
console.log("── quote_leaves by commercial kind ───────────────────");
const byKind = await db
  .select({ kind: quoteLeaves.commercialKind, n: sql<number>`count(*)::int` })
  .from(quoteLeaves)
  .groupBy(quoteLeaves.commercialKind);
console.table(byKind);
console.log(
  "Both `product` and `service` are sendable commercial lines. If a third kind\n" +
    "ever appears above, the predicate needs filtering rather than counting.",
);

console.log("\n── grouped vs top-level ──────────────────────────────");
const byPlacement = await db
  .select({
    grouped: sql<boolean>`${quoteLeaves.assemblyId} IS NOT NULL`,
    n: sql<number>`count(*)::int`,
  })
  .from(quoteLeaves)
  .groupBy(sql`${quoteLeaves.assemblyId} IS NOT NULL`);
console.table(byPlacement);

// ── 2 · THE EDGE · can an Item Group exist with no members? ──────────────
console.log("\n── EDGE · Item Groups carrying zero members ──────────");
const memberCounts = await db
  .select({ assemblyId: quoteLeaves.assemblyId, n: sql<number>`count(*)::int` })
  .from(quoteLeaves)
  .groupBy(quoteLeaves.assemblyId);
const membersByAssembly = new Map(
  memberCounts.filter((r) => r.assemblyId !== null).map((r) => [r.assemblyId!, r.n] as const),
);
const allAssemblies = await db
  .select({ id: assemblies.id, sku: assemblies.sku, quoteId: assemblies.quoteId })
  .from(assemblies);
const empty = allAssemblies.filter((a) => (membersByAssembly.get(a.id) ?? 0) === 0);
console.log(`Item Groups total: ${allAssemblies.length} · carrying zero members: ${empty.length}`);
if (empty.length > 0) {
  console.table(empty.slice(0, 10).map((a) => ({ sku: a.sku, quote: a.quoteId.slice(0, 8) })));
  console.log(
    "-> An empty Item Group EXISTS. A bare `quote_leaves > 0` predicate would\n" +
      "   refuse such a quote, which the disposition requires to be ALLOWED.\n" +
      "   The predicate needs a second term, or empty groups need their own rule.",
  );
} else {
  console.log(
    "-> none. Every Item Group carries at least one member, so a quote with an\n" +
      "   Item Group necessarily has quote_leaves > 0 and the leaf count alone\n" +
      "   covers the 'Item Group only' case.",
  );
}

// ── 3 · would the swap change any EXISTING quote's verdict? ──────────────
console.log("\n── verdict change across every quote ─────────────────");
const allQuotes = await db
  .select({ id: quotes.id, label: quotes.scenarioLabel, status: quotes.status })
  .from(quotes);
const asmCounts = await db
  .select({ quoteId: assemblies.quoteId, n: sql<number>`count(*)::int` })
  .from(assemblies)
  .groupBy(assemblies.quoteId);
const asmBy = new Map(asmCounts.map((r) => [r.quoteId, r.n] as const));
const leafCounts = await db
  .select({ quoteId: quoteLeaves.quoteId, n: sql<number>`count(*)::int` })
  .from(quoteLeaves)
  .groupBy(quoteLeaves.quoteId);
const leafBy = new Map(leafCounts.map((r) => [r.quoteId, r.n] as const));

const changed = allQuotes
  .map((q) => ({
    q,
    old: (asmBy.get(q.id) ?? 0) > 0,
    next: (leafBy.get(q.id) ?? 0) > 0,
  }))
  .filter((r) => r.old !== r.next);

if (changed.length === 0) console.log("no quote's sendability changes");
else
  console.table(
    changed.map((r) => ({
      label: (r.q.label ?? "").slice(0, 30),
      status: r.q.status,
      wasSendable: r.old,
      becomesSendable: r.next,
      leaves: leafBy.get(r.q.id) ?? 0,
      assemblies: asmBy.get(r.q.id) ?? 0,
    })),
  );
console.log(
  "\nOnly `false -> true` rows are intended: shapes that were wrongly refused.\n" +
    "A `true -> false` row would be a REGRESSION — a quote that could be sent\n" +
    "and no longer can.",
);

process.exit(0);
