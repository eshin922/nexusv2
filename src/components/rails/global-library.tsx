"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { fetchLibraryIndex, type LibraryIndexResult } from "@/app/actions/library-index";

const OPEN_LIBRARY_EVENT = "nexus:open-product-library";

export function GlobalLibrary() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LibraryIndexResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_LIBRARY_EVENT, show);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, show);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("openLibrary") === "1") {
      setOpen(true);
      url.searchParams.delete("openLibrary");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetchLibraryIndex(query, page).then((next) => {
      if (current === requestId.current) setResult(next);
    }).catch(() => {
      if (current === requestId.current) setError("The Product Library could not be loaded. Try again.");
    }).finally(() => {
      if (current === requestId.current) setLoading(false);
    });
    return () => { requestId.current++; };
  }, [open, query, page]);

  const close = () => setOpen(false);

  return <>
    <button
      type="button"
      title="Product Library"
      aria-label="Product Library"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 2.5h4v11h-4zM6.5 3.5h3.5v10H6.5zM10 2.5h3.5v11H10z" />
        <path d="M3.5 10.5h2M7.25 10.5h2M10.75 10.5h2" />
      </svg>
    </button>
    {open && createPortal(
      <div className="a1v2-modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
        <div className="a1v2-modal lib-modal lib-index-modal" role="dialog" aria-modal="true" aria-labelledby="global-library-title">
          <div className="lib-head">
            <div className="title-wrap">
              <h2 id="global-library-title">Library <em>· products</em></h2>
              <span className="sub">Search the reusable catalogue · read only</span>
            </div>
            <div className="head-actions">
              <button type="button" className="lib-close" aria-label="Close Product Library" onClick={close}>×</button>
            </div>
          </div>
          <form className="lib-index-search" onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}>
            <label htmlFor="global-library-search">Search by product name or SKU</label>
            <div>
              <input ref={searchRef} id="global-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product name or SKU" />
              <button type="submit">Search</button>
            </div>
          </form>
          <div className="lib-index-results" aria-live="polite">
            {error && <p role="alert" className="lib-index-message">{error}</p>}
            {!error && loading && <p className="lib-index-message">Loading products…</p>}
            {!error && !loading && result && <>
              <p className="lib-index-count">{result.total.toLocaleString()} {result.total === 1 ? "product" : "products"}{result.query ? ` matching “${result.query}”` : ""}</p>
              {result.products.length === 0 ? <p className="lib-index-message">No products match this search.</p> :
                <div className="lib-index-table-wrap"><table className="lib-index-table">
                  <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Used by</th><th>Status</th></tr></thead>
                  <tbody>{result.products.map((product) => <tr key={product.id}>
                    <td><Link href={`/library/leaves/${product.id}/defaults`} onClick={close}>{product.name}</Link></td>
                    <td className="lib-index-mono">{product.sku ?? "—"}</td>
                    <td>{product.type ?? "Unclassified"}</td>
                    <td>{product.quoteCount ? <>{product.quoteCount} {product.quoteCount === 1 ? "quote" : "quotes"}{product.customers.length > 0 && <small title={product.customers.join(", ")}>{product.customers.slice(0, 3).join(", ")}{product.customers.length > 3 ? ` +${product.customers.length - 3} more` : ""}</small>}</> : "No Nexus quotes"}</td>
                    <td>{product.status}</td>
                  </tr>)}</tbody>
                </table></div>}
            </>}
          </div>
          {result && !error && <div className="lib-index-footer">
            <button type="button" onClick={() => setPage((current) => current - 1)} disabled={loading || result.page <= 1}>← Previous</button>
            <span>Page {result.page} of {result.totalPages}</span>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={loading || result.page >= result.totalPages}>Next →</button>
          </div>}
        </div>
      </div>, document.body)}
  </>;
}
