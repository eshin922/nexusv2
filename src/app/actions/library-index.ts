"use server";

import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { leaves, projects, quoteLeaves, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";

const PAGE_SIZE = 50;

export type LibraryIndexResult = {
  query: string;
  page: number;
  total: number;
  totalPages: number;
  products: {
    id: string;
    name: string;
    sku: string | null;
    type: string | null;
    status: string;
    quoteCount: number;
    customers: string[];
  }[];
};

/** Read-only catalogue search shared by the global Library modal. */
export async function fetchLibraryIndex(queryInput: string, pageInput: number): Promise<LibraryIndexResult> {
  await ensureUser();
  const query = queryInput.trim().slice(0, 120);
  const requestedPage = Number.isSafeInteger(pageInput) && pageInput > 0 ? pageInput : 1;
  const search = query ? or(ilike(leaves.name, `%${query}%`), ilike(leaves.sku, `%${query}%`)) : undefined;
  const where = and(eq(leaves.commercialKind, "product"), search);

  const [totalRow] = await db.select({ count: count() }).from(leaves).where(where);
  const total = totalRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
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
    .offset((page - 1) * PAGE_SIZE);

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

  return {
    query,
    page,
    total,
    totalPages,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      type: product.type,
      status: product.archived ? "Archived" : product.hubspotProductId ? "HubSpot" : "Nexus",
      quoteCount: usage.get(product.id)?.quotes.size ?? 0,
      customers: [...(usage.get(product.id)?.customers ?? [])],
    })),
  };
}
