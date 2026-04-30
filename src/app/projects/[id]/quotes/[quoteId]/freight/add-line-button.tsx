"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addFreightLine } from "@/app/actions/freight";

export function AddFreightLineButton({
  quoteSkuId,
  disabled = false,
  tooltip,
}: {
  quoteSkuId: string;
  disabled?: boolean;
  tooltip?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    if (disabled || pending) return;
    setError(null);
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    startTransition(async () => {
      const r = await addFreightLine(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        // Server action's revalidatePath alone is unreliable for
        // pushing RSC updates to the open tab in Next 15.5 — the route
        // segment cache can hold the pre-action render. router.refresh()
        // forces a fresh RSC fetch so the new line renders without
        // requiring a manual reload. (Caught Slice 7 smoke testing —
        // first click wrote to DB but UI didn't reflect.)
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        title={tooltip}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Adding…" : "+ Add freight line"}
      </button>
    </span>
  );
}
