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
    <div>
      {/* §6.b Step 5 polish-amendment — full-width dashed pill per
          R7b screenshot 225751. Visual weight: spans most of card,
          centered "+ Add tier" text in mono caps register. */}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="r6b-add-pill"
      >
        {pending ? "ADDING…" : "+ ADD TIER"}
      </button>
      {error && (
        <span
          className="mt-1 block text-xs"
          style={{ color: "var(--bad)" }}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
