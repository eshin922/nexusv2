"use client";

// Slice RI.4 — error boundary for /cost-build. Surfaces runtime
// failures visibly during smoke instead of producing a blank screen
// (Next.js default behavior for unhandled errors in server components).

export default function CostBuildError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="p-6">
      <div
        role="alert"
        className="rounded border border-bad bg-bad-soft p-4 text-sm text-bad"
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[0.13em]">
          Cost build · runtime error
        </div>
        <h1 className="mt-1 font-display text-lg text-bad">
          {error.message || "Unknown error"}
        </h1>
        {error.digest && (
          <p className="mt-1 font-mono text-[10px] text-bad/70">
            digest: {error.digest}
          </p>
        )}
        <pre className="mt-3 max-h-64 overflow-auto rounded border border-bad/40 bg-paper p-2 font-mono text-[10px] text-ink-2">
          {error.stack ?? "(no stack)"}
        </pre>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-3 rounded border border-bad bg-paper px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad-soft"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
