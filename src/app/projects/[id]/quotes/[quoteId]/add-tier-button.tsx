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
      {/* §6.b Step 5 — dashed-border CTA pill per R7b designer notes
          §3.4 line 97 ("Same footer treatment — dashed-border CTA
          pill for `+ Add X`"). Matches the SKU footer affordance
          grammar; theme-token styling for dark-mode safety. */}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="r6b-add-pill"
      >
        {pending ? "Adding…" : "+ Add tier"}
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
