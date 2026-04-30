import Link from "next/link";
import { after } from "next/server";
import { importDeal } from "@/app/actions/projects";
import { STAGE_LABEL_BY_ID } from "@/lib/hubspot";
import {
  getCacheStatus,
  isStale,
  readCacheCount,
  readCacheForQuery,
  syncDeals,
  type DealCacheRow,
} from "@/lib/hubspot-cache";

export async function DealList({
  query,
  page,
  pageSize,
}: {
  query: string;
  page: number;
  pageSize: number;
}) {
  const status = await getCacheStatus();

  if (status.count === 0) {
    // Cold start: must wait for sync before rendering.
    await syncDeals();
  } else if (isStale(status.lastSyncedAt)) {
    // Populated + stale: render existing rows now, refresh in background.
    after(async () => {
      try {
        await syncDeals();
      } catch (err) {
        console.error("[hubspot-cache] background sync failed:", err);
      }
    });
  }

  const offset = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    readCacheForQuery({ query, limit: pageSize, offset }),
    readCacheCount({ query }),
  ]);

  return (
    <ResultTable
      rows={rows}
      total={total}
      query={query}
      page={page}
      pageSize={pageSize}
    />
  );
}

function ResultTable({
  rows,
  total,
  query,
  page,
  pageSize,
}: {
  rows: DealCacheRow[];
  total: number;
  query: string;
  page: number;
  pageSize: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
        {query
          ? `No deals matched "${query}" in the active pipeline.`
          : "No deals in the active pipeline."}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromIdx = (page - 1) * pageSize + 1;
  const toIdx = Math.min(page * pageSize, total);

  return (
    <>
      <div className="mb-2 text-xs text-gray-500">
        Showing {fromIdx}–{toIdx} of {total.toLocaleString()} matching deals.
      </div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">Deal Name</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2">Deal ID</th>
              <th className="px-4 py-2">Last Modified</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map((d) => (
              <tr key={d.dealId}>
                <td className="px-4 py-2 font-medium">{d.dealName}</td>
                <td className="px-4 py-2 text-gray-700">
                  {d.associatedCompanyName ?? (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {d.salesRepName ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {STAGE_LABEL_BY_ID[d.dealStage ?? ""] ?? d.dealStage ?? "—"}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                  {d.dealId}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {d.updatedAtHubspot
                    ? d.updatedAtHubspot.toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={importDeal}>
                    <input type="hidden" name="dealId" value={d.dealId} />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50"
                    >
                      Import
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <PageLink
            label="← Prev"
            disabled={page <= 1}
            href={{
              pathname: "/import",
              query: {
                ...(query ? { q: query } : {}),
                ...(page > 2 ? { page: String(page - 1) } : {}),
              },
            }}
          />
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <PageLink
            label="Next →"
            disabled={page >= totalPages}
            href={{
              pathname: "/import",
              query: {
                ...(query ? { q: query } : {}),
                page: String(page + 1),
              },
            }}
          />
        </div>
      )}
    </>
  );
}

function PageLink({
  label,
  href,
  disabled,
}: {
  label: string;
  href: Parameters<typeof Link>[0]["href"];
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <span className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-400">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
    >
      {label}
    </Link>
  );
}
