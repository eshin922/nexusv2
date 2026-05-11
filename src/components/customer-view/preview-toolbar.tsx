"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerViewPdfLayout } from "@/types/customer-view";
import { sendQuote } from "@/app/actions/quotes";

export type CustomerViewSubState = "pure" | "passThrough" | "partial";

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  // ISO YYYY-MM-DD → "Apr 28"
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Slice RI.7 DEV STUB — wired to sendQuote so PMs can exercise the
// snapshot pipeline end-to-end without waiting for Slice 11's PDF
// flow. Gated by `devSendEnabled` prop (NODE_ENV !== 'production'
// AND admin role; computed server-side in the page). Slice 11
// replaces this entire affordance with the real PDF + email flow
// on the existing "Download" buttons; the dev stub then goes away.
//
// Future-CC: if you're seeing this in 2026+, Slice 11 hasn't shipped
// yet. The button itself labels "(dev — Slice 11 replaces)" so you
// can grep for it easily and remove when the time comes.
function DevSendButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !confirm(
        "DEV STUB: this will transition the quote to status='sent', " +
          "assign a customer-facing quote_number from the sequence, " +
          "and snapshot all firm_settings commercial defaults + " +
          "PreparedBy contact onto the quote row. No PDF generation " +
          "(Slice 11). Continue?",
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await sendQuote(fd);
      if (!r.ok) {
        alert(`Send failed: ${r.error.message}`);
        return;
      }
      alert(`Sent · ${r.data.quoteNumber}`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="btn sm"
      onClick={onClick}
      disabled={pending}
      title="Dev-only — transitions draft → sent and snapshots commercial defaults + PreparedBy. Slice 11 replaces with real PDF + email flow."
      style={{
        background: "var(--paper-2)",
        border: "1px dashed var(--warn, #c97a3e)",
        color: "var(--warn, #c97a3e)",
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {pending ? "sending…" : "↗ Mark sent (dev — Slice 11 replaces)"}
    </button>
  );
}

export function PreviewToolbar({
  quoteId,
  quoteStatus,
  quoteNumber,
  sentDate,
  pdfLayout,
  onPdfLayoutChange,
  subState,
  onSubStateChange,
  showStateSwitcher,
  devSendEnabled,
}: {
  quoteId: string;
  quoteStatus: string;
  quoteNumber: string | null;
  sentDate: string | null;
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
  subState: CustomerViewSubState;
  onSubStateChange: (next: CustomerViewSubState) => void;
  showStateSwitcher: boolean;
  /** Dev-only send affordance. Hidden in production + only renders
   * when quote is a draft. Slice 11 replaces with PDF flow. */
  devSendEnabled: boolean;
}) {
  return (
    <div className="preview-toolbar">
      <div className="left">
        <span className="ribbon">PM-internal preview · this becomes the PDF</span>
        <span className="meta">
          <strong>{quoteNumber ?? "draft (no number yet)"}</strong>
          {sentDate ? ` · sent ${formatShortDate(sentDate)}` : ""}
        </span>
        <span className="meta" style={{ color: "var(--ink-4)" }}>·</span>
        <span className="meta send-as">
          Send as:{" "}
          <button
            type="button"
            className={pdfLayout === "tier_table" ? "active" : ""}
            onClick={() => onPdfLayoutChange("tier_table")}
          >
            tier table
          </button>
          <span className="sep">|</span>
          <button
            type="button"
            className={pdfLayout === "single_tier" ? "active" : ""}
            onClick={() => onPdfLayoutChange("single_tier")}
          >
            single tier
          </button>
        </span>
      </div>
      <div className="right">
        {showStateSwitcher && (
          <div
            className="state-sub"
            title="Prototype navigation only — production renders whichever state the data is in."
          >
            <button
              className={subState === "pure" ? "active" : ""}
              onClick={() => onSubStateChange("pure")}
            >
              ① Pure
            </button>
            <button
              className={subState === "passThrough" ? "active" : ""}
              onClick={() => onSubStateChange("passThrough")}
            >
              ② Pass-through
            </button>
            <button
              className={subState === "partial" ? "active" : ""}
              onClick={() => onSubStateChange("partial")}
            >
              ③ Partial
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn sm"
          title="Generates the PDF and saves to your Downloads. You attach it to your usual email."
          onClick={() => alert("Stub — Slice 11 wires PDF render + download.")}
        >
          ⤓ Download PDF
        </button>
        <button
          type="button"
          className="btn sm primary"
          title="Generates the PDF, saves to Downloads, and opens a new email draft in your default mail client (mailto:) addressed to the customer with the quote attached. No SMTP integration — your email, your client."
          onClick={() => alert("Stub — Slice 11 wires PDF + mailto draft.")}
        >
          ↳ Download + open mail draft
        </button>
        {devSendEnabled && quoteStatus === "draft" && (
          <DevSendButton quoteId={quoteId} />
        )}
      </div>
    </div>
  );
}
