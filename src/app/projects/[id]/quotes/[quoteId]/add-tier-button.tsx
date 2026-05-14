"use client";

import { useState, useTransition } from "react";
import { addTier } from "@/app/actions/quotes";

// §6.b path-B migration commit 4 — renders canonical
// .r7b-tier-footer .add-tier button per 7bsetup.jsx line 305
// + 7bstyles.css .r7b-tier-footer .add-tier rules.
//
// Canonical CSS gives this:
// - flex: 1 (full-width inside .r7b-tier-footer)
// - transparent bg, dashed --rule-2 border
// - --ink-3 color, mono 11px tracking 0.06em uppercase
// - 6px border-radius (rectangle, not pill)
// - hover: --ink color + --ink-4 border
//
// JSX literal "+ Add tier" (mixed case); canonical CSS does
// text-transform: uppercase. Renders as "+ ADD TIER" visually.
//
// Parent <div className="r7b-tier-footer"> in page.tsx is the
// flex container; this component renders just the button + an
// optional error sibling.

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
    <>
      <button
        type="button"
        className="add-tier"
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? "Adding…" : "+ Add tier"}
      </button>
      {error && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--bad)",
            marginLeft: 8,
          }}
          role="alert"
        >
          {error}
        </span>
      )}
    </>
  );
}
