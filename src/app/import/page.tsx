import Link from "next/link";
import { searchDeals, HubspotError, type DealSummary } from "@/lib/hubspot";
import { importDeal } from "@/app/actions/projects";

const PAGE_SIZE = 50;

type SearchParams = Promise<{ q?: string; after?: string }>;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const after = sp.after;

  let resultBlock: React.ReactNode;
  try {
    const { results, nextCursor, total } = await searchDeals({
      query: query || undefined,
      after,
      pageSize: PAGE_SIZE,
    });
    resultBlock = (
      <ResultTable
        deals={results}
        nextCursor={nextCursor}
        total={total}
        query={query}
      />
    );
  } catch (err) {
    const msg =
      err instanceof HubspotError
        ? err.message
        : "Unexpected error contacting HubSpot.";
    resultBlock = (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      >
        <p className="font-semibold">Could not load deals from HubSpot.</p>
        <p className="mt-1">{msg}</p>
        <p className="mt-2 text-xs text-red-700">
          Check that <span className="font-mono">HUBSPOT_ACCESS_TOKEN</span> is
          set and the sandbox is reachable, then refresh.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Home
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Import a deal</h1>
          <p className="text-sm text-gray-600">
            Search HubSpot for deals in active pipeline stages (New, Development &amp;
            Quoting, Formal Quoting, Project Setup).
          </p>
        </div>
      </div>

      <form method="GET" action="/import" className="mb-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search by deal name, client, or deal ID…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
        >
          Search
        </button>
        {(query || after) && (
          <Link
            href="/import"
            className="flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      {resultBlock}
    </main>
  );
}

function ResultTable({
  deals,
  nextCursor,
  total,
  query,
}: {
  deals: DealSummary[];
  nextCursor: string | null;
  total: number;
  query: string;
}) {
  if (deals.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
        {query
          ? `No deals matched "${query}" in the active pipeline stages.`
          : "No deals in the active pipeline stages."}
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 text-xs text-gray-500">
        Showing {deals.length} of {total.toLocaleString()} matching deals.
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
            {deals.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2 font-medium">{d.name}</td>
                <td className="px-4 py-2 text-gray-700">
                  {d.clientName ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {d.ownerName ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2 text-gray-700">{d.stageLabel}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                  {d.id}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {d.lastModified
                    ? new Date(d.lastModified).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <form action={importDeal}>
                    <input type="hidden" name="dealId" value={d.id} />
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

      {nextCursor && (
        <div className="mt-4 flex justify-end">
          <Link
            href={{
              pathname: "/import",
              query: { ...(query ? { q: query } : {}), after: nextCursor },
            }}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
          >
            Next page →
          </Link>
        </div>
      )}
    </>
  );
}
