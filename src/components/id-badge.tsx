"use client";

import { useState } from "react";

/**
 * Short UUID badge for dev/admin ergonomics — shows the first 8 chars
 * inline, click-to-copy the full ID. Used on quote builder, packaging
 * page header, project detail quote list. Revisit at Slice 13.5 polish
 * whether to keep visible to all users or gate behind admin role.
 */
export function IdBadge({ id, label = "Copy full quote ID" }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const short = id.slice(0, 8);

  function handleCopy() {
    navigator.clipboard.writeText(id).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {
        // ignore — clipboard API can fail in non-secure contexts
      },
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : label}
      className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 hover:bg-gray-200"
    >
      #{short}
      {copied && <span className="ml-1 text-[10px] text-green-700">✓</span>}
    </button>
  );
}
