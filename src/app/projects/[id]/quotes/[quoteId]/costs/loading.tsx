// Slice RI.4 — loading state for /costs. Fires while the
// server component's data fetches are in flight. Without this,
// dev mode shows a blank screen during slow loads (8-16s observed
// during smoke setup). Surfaces "page is loading" so PMs know the
// nav landed.

export default function CostBuildLoading() {
  return (
    <main className="p-6">
      <div className="mb-6 border-b border-rule pb-4">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
          Costs · loading
        </div>
        <div className="mt-1 h-8 w-2/3 animate-pulse rounded bg-paper-3" />
        <div className="mt-2 flex gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-paper-3" />
          <div className="h-4 w-32 animate-pulse rounded bg-paper-3" />
          <div className="h-4 w-16 animate-pulse rounded bg-paper-3" />
        </div>
      </div>
      <div className="mb-6 h-48 animate-pulse rounded border border-rule bg-paper-2" />
      <div className="flex flex-col gap-3">
        <div className="h-14 animate-pulse rounded border border-rule bg-paper-2" />
        <div className="h-14 animate-pulse rounded border border-rule bg-paper-2" />
        <div className="h-14 animate-pulse rounded border border-rule bg-paper-2" />
        <div className="h-14 animate-pulse rounded border border-rule bg-paper-2" />
      </div>
      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wide text-ink-4">
        Loading Costs data… first load can take a few seconds in dev
      </p>
    </main>
  );
}
