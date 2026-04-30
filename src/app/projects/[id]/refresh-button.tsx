"use client";

import { useState, useTransition } from "react";
import { refreshFromHubspot } from "@/app/actions/projects";
import { Toast, type ToastState } from "@/components/toast";

export function RefreshProjectButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<ToastState>(null);

  function handleClick() {
    if (pending) return;
    setToast(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    startTransition(async () => {
      try {
        const r = await refreshFromHubspot(fd);
        const n = r.fieldsChanged;
        setToast({
          kind: "success",
          message:
            n > 0
              ? `Refreshed from HubSpot — ${n} field${n === 1 ? "" : "s"} updated`
              : "Already up to date",
        });
      } catch (err) {
        setToast({
          kind: "error",
          message: err instanceof Error ? err.message : "Refresh failed",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "Refresh from HubSpot"}
      </button>
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
