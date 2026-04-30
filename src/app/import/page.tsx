import Link from "next/link";
import { Suspense } from "react";
import { getCacheStatus, isStale } from "@/lib/hubspot-cache";
import { DealList } from "./deal-list";
import { RefreshHeader } from "./refresh-header";

const PAGE_SIZE = 50;

type SearchParams = Promise<{ q?: string; page?: string }>;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const status = await getCacheStatus();
  const pollOnMount = status.count === 0 || isStale(status.lastSyncedAt);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Home
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Import a deal</h1>
          <p className="text-sm text-gray-600">
            Search active-pipeline deals (New, Development &amp; Quoting,
            Formal Quoting, Project Setup).
          </p>
        </div>
        <RefreshHeader
          initialLastSyncedAt={status.lastSyncedAt?.toISOString() ?? null}
          pollOnMount={pollOnMount}
        />
      </div>

      <form method="GET" action="/import" className="mb-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search by deal name…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
        >
          Search
        </button>
        {(query || page > 1) && (
          <Link
            href="/import"
            className="flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      <Suspense fallback={<SyncingPlaceholder />}>
        <DealList query={query} page={page} pageSize={PAGE_SIZE} />
      </Suspense>
    </main>
  );
}

function SyncingPlaceholder() {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-600">
      <div className="inline-flex items-center gap-2">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        <span>Syncing from HubSpot…</span>
      </div>
    </div>
  );
}
