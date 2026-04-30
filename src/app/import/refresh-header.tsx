"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Toast, type ToastState } from "@/components/toast";
import { refreshDealsCache } from "./actions";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export function RefreshHeader({
  initialLastSyncedAt,
  pollOnMount,
}: {
  initialLastSyncedAt: string | null;
  pollOnMount: boolean;
}) {
  const initial = initialLastSyncedAt ? new Date(initialLastSyncedAt) : null;
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(initial);
  const [polling, setPolling] = useState(pollOnMount);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);
  const baselineRef = useRef<Date | null>(initial);

  useEffect(() => {
    if (!polling) return;
    const startedAt = Date.now();
    const baseline = baselineRef.current;
    let cancelled = false;

    async function pollOnce() {
      try {
        const r = await fetch("/api/import/cache-status", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!r.ok) {
          setPolling(false);
          return;
        }
        const j = (await r.json()) as { lastSyncedAt: string | null };
        if (cancelled) return;
        const fresh = j.lastSyncedAt ? new Date(j.lastSyncedAt) : null;
        const advanced =
          fresh && (!baseline || fresh.getTime() > baseline.getTime());
        if (advanced) {
          setLastSyncedAt(fresh);
          baselineRef.current = fresh;
          setPolling(false);
        } else if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setPolling(false);
        }
      } catch {
        if (!cancelled) setPolling(false);
      }
    }

    // Fire immediately on mount, then every POLL_INTERVAL_MS thereafter.
    void pollOnce();
    const handle = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [polling]);

  function handleClick() {
    if (pending) return;
    setPolling(false);
    setToast(null);
    startTransition(async () => {
      try {
        const r = await refreshDealsCache();
        if (r?.lastSyncedAt) {
          const fresh = new Date(r.lastSyncedAt);
          setLastSyncedAt(fresh);
          baselineRef.current = fresh;
        }
        const n = r?.syncedCount ?? 0;
        setToast({
          kind: "success",
          message: `Synced ${n} deal${n === 1 ? "" : "s"} from HubSpot`,
        });
      } catch (err) {
        setToast({
          kind: "error",
          message: err instanceof Error ? err.message : "Refresh failed",
        });
      }
    });
  }

  const isRefreshing = polling || pending;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Click to refresh from HubSpot"
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRefreshing ? (
          <>
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            <span>Refreshing…</span>
          </>
        ) : lastSyncedAt ? (
          <span>Last synced {formatRelative(lastSyncedAt)}</span>
        ) : (
          <span>Never synced</span>
        )}
      </button>
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
