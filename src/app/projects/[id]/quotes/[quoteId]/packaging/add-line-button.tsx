"use client";

import { useState, useTransition } from "react";
import { addAssemblyLeafInput } from "@/app/actions/assembly-leaf-inputs";

export function AddLineButton({
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

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation(); // don't toggle parent <details>
    setError(null);
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    startTransition(async () => {
      const result = await addAssemblyLeafInput(fd);
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
        disabled={disabled || pending}
        title={tooltip}
        className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Adding…" : "Add line"}
      </button>
    </div>
  );
}
