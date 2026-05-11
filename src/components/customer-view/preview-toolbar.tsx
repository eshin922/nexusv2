"use client";

import type { CustomerViewPdfLayout } from "@/types/customer-view";

export type CustomerViewSubState = "pure" | "passThrough" | "partial";

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  // ISO YYYY-MM-DD → "Apr 28"
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PreviewToolbar({
  quoteNumber,
  sentDate,
  pdfLayout,
  onPdfLayoutChange,
  subState,
  onSubStateChange,
  showStateSwitcher,
}: {
  quoteNumber: string;
  sentDate: string | null;
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
  subState: CustomerViewSubState;
  onSubStateChange: (next: CustomerViewSubState) => void;
  showStateSwitcher: boolean;
}) {
  return (
    <div className="preview-toolbar">
      <div className="left">
        <span className="ribbon">PM-internal preview · this becomes the PDF</span>
        <span className="meta">
          <strong>{quoteNumber}</strong>
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
      </div>
    </div>
  );
}
