import Link from "next/link";
import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { leaves, projects, quoteLeaves, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import "./library-index.css";

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function pageHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/library?${suffix}` : "/library";
}

/** Read-only catalogue search. No deal or quote is required. */
export default async function LibraryIndex({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  await ensureUser();
  const params = await searchParams;
  const query = first(params.q).trim().slice(0, 120);
  const requestedPage = Number(first(params.page));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const search = query ? or(ilike(leaves.name, `%${query}%`), ilike(leaves.sku, `%${query}%`)) : undefined;
  const where = and(eq(leaves.commercialKind, "product"), search);

  const [totalRow] = await db.select({ count: count() }).from(leaves).where(where);
  const total = totalRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const products = await db
    .select({
      id: leaves.id,
      name: leaves.name,
      sku: leaves.sku,
      type: leaves.hubspotProductType,
      archived: leaves.archived,
      hubspotProductId: leaves.hubspotProductId,
    })
    .from(leaves)
    .where(where)
    .orderBy(asc(leaves.name), asc(leaves.id))
    .limit(PAGE_SIZE)
    .offset((currentPage - 1) * PAGE_SIZE);

  // One batched lookup for the visible page. A product can occur in several
  // versions of one customer's quote; count distinct quotes, not joined rows.
  const usageRows = products.length === 0 ? [] : await db
    .select({ leafId: quoteLeaves.leafId, quoteId: quotes.id, clientName: projects.clientName })
    .from(quoteLeaves)
    .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(inArray(quoteLeaves.leafId, products.map((product) => product.id)));
  const usage = new Map<string, { quotes: Set<string>; customers: Set<string> }>();
  for (const row of usageRows) {
    const entry = usage.get(row.leafId) ?? { quotes: new Set<string>(), customers: new Set<string>() };
    entry.quotes.add(row.quoteId);
    if (row.clientName) entry.customers.add(row.clientName);
    usage.set(row.leafId, entry);
  }

  return (
    <main className="library-index">
      <header className="library-index-header">
        <div>
          <Link href="/" className="library-index-back">← Deal organizer</Link>
          <p className="library-index-eyebrow">Reusable catalogue</p>
          <h1>Product Library</h1>
          <p>Find a product or SKU before starting a quote. Usage reflects quotes currently in Nexus.</p>
        </div>
      </header>

      <form method="get" action="/library" className="library-index-search">
        <label htmlFor="library-search">Search name or SKU</label>
        <div>
          <input id="library-search" name="q" type="search" defaultValue={query} placeholder="Product name or SKU" />
          <button type="submit">Search</button>
        </div>
      </form>

      <div className="library-index-result-count">{total.toLocaleString()} {total === 1 ? "product" : "products"}{query ? ` matching “${query}”` : ""}</div>
      {products.length === 0 ? (
        <p className="library-index-empty">No products match this search.</p>
      ) : (
        <div className="library-index-table-wrap">
          <table className="library-index-table">
            <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Used by</th><th>Status</th></tr></thead>
            <tbody>
              {products.map((product) => {
                const used = usage.get(product.id);
                const customers = [...(used?.customers ?? [])];
                return (
                  <tr key={product.id}>
                    <td><Link href={`/library/leaves/${product.id}/defaults`}>{product.name}</Link></td>
                    <td className="library-index-mono">{product.sku ?? "—"}</td>
                    <td>{product.type ?? "Unclassified"}</td>
                    <td>{used ? <><span>{used.quotes.size} {used.quotes.size === 1 ? "quote" : "quotes"}</span>{customers.length > 0 ? <small title={customers.join(", ")}>{customers.slice(0, 3).join(", ")}{customers.length > 3 ? ` +${customers.length - 3} more` : ""}</small> : null}</> : "No Nexus quotes"}</td>
                    <td>{product.archived ? "Archived" : product.hubspotProductId ? "HubSpot" : "Nexus"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && <nav className="library-index-pages" aria-label="Library pages">
        {currentPage > 1 ? <Link href={pageHref(query, currentPage - 1)}>← Previous</Link> : <span />}
        <span>Page {currentPage} of {totalPages}</span>
        {currentPage < totalPages ? <Link href={pageHref(query, currentPage + 1)}>Next →</Link> : <span />}
      </nav>}
    </main>
  );
}
