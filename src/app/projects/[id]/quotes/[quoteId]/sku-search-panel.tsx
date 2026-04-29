"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  addSkuFromHubspotProduct,
  searchHubspotProductsAction,
} from "@/app/actions/quotes";

type Product = {
  id: string;
  name: string;
  sku: string | null;
};

const DEBOUNCE_MS = 300;

export function SkuSearchPanel({ quoteId }: { quoteId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(() => {
      setError(null);
      startTransition(async () => {
        try {
          const r = await searchHubspotProductsAction(query);
          setResults(r);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Search failed");
          setResults([]);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search HubSpot Products by name or SKU…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      )}

      {pending && results === null && (
        <p className="mt-2 text-xs text-gray-500">Searching…</p>
      )}

      {results !== null && results.length === 0 && !pending && (
        <p className="mt-2 text-sm text-gray-500">
          No products matched. Products are managed in HubSpot — add new
          products there first, then come back to import.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-2 max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 bg-white">
          {results.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-900">{p.name}</div>
                <div className="truncate text-xs text-gray-500">
                  {p.sku ?? <span className="italic">(no SKU)</span>}
                </div>
              </div>
              <form action={addSkuFromHubspotProduct}>
                <input type="hidden" name="quoteId" value={quoteId} />
                <input type="hidden" name="productId" value={p.id} />
                <button
                  type="submit"
                  className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
                >
                  Add
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
