"use client";

import { useState } from "react";
import type { QuoteAttachmentRow } from "@/lib/quote-attachments-loader";
import { AttachmentListModal } from "./attachment-list-modal";

// canonical-scenario-create-flow Step 7 — Setup header attachment
// list trigger. Renders a 📎 N chip when attachments exist; clicking
// opens the list modal.

export function AttachmentListTrigger({
  quoteId,
  attachments,
}: {
  quoteId: string;
  attachments: QuoteAttachmentRow[];
}) {
  const [open, setOpen] = useState(false);
  const count = attachments.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="attachment-list-trigger"
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.06em",
          color: count > 0 ? "var(--ink-2)" : "var(--ink-3)",
          background: count > 0 ? "var(--paper-2)" : "transparent",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          padding: "3px 8px",
          cursor: "pointer",
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          count === 0
            ? "Add attachment — customer brief / RFQ / supporting docs"
            : `${count} attachment${count === 1 ? "" : "s"} — view + add more`
        }
      >
        📎{" "}
        {count > 0
          ? `${count} attachment${count === 1 ? "" : "s"}`
          : "Add attachment"}
      </button>
      <AttachmentListModal
        open={open}
        onClose={() => setOpen(false)}
        quoteId={quoteId}
        attachments={attachments}
      />
    </>
  );
}
