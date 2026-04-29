"use client";

import { useState, useTransition } from "react";
import { addTier } from "@/app/actions/quotes";

export function AddTierButton({ quoteId }: { quoteId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const result = await addTier(fd);
      if (!result.ok) setError(result.error.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Adding…" : "Add Tier"}
      </button>
    </div>
  );
}
