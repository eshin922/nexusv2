"use client";

import Link from "next/link";
import {
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.5 — Costing Sheet page chrome per R2 source
// (`docs/design-prototypes/dist/source/round-2/app/r2/costing.jsx:124-165`).
//
// Composition: eyebrow + italic-display H1 + sub copy + button cluster.
// H1: "Tune <em>price</em> & review." — italic-em word per R2 grammar.
// Sub copy: keyed off blendedMarginStatus.
// Buttons: Back to Cost Build (ghost) + Preview customer quote
// (disabled placeholder for Slice 11) + Mark accepted (two-shape
// conditional based on BELOW_FLOOR — strikethrough + admin override
// CTA when blocked; primary when sendable).

export function CostingPageHead({
  projectId,
  quoteId,
  project,
  quote,
}: {
  projectId: string;
  quoteId: string;
  project: { dealName: string; clientName: string | null };
  quote: { scenarioLabel: string; versionNumber: number; status: string };
}) {
  const summary = useCostingStore(selectQuoteSummary);
  const skuRollups = useCostingStore(selectSkuRollups);

  const status = summary.blendedMarginStatus;
  let flaggedCount = 0;
  for (const sku of skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const t of sku.perTier) {
      if (t.marginStatus === "BELOW_FLOOR") flaggedCount++;
    }
  }

  const subCopy =
    status === "GOOD"
      ? "All margins above floor — review and send."
      : status === "BELOW_TARGET"
        ? `${flaggedCount > 0 ? flaggedCount : "Some"} line${flaggedCount === 1 ? "" : "s"} below target — soft warning, sendable.`
        : "Below floor — admin override required to send.";

  return (
    <div className="r2-page-head">
      <div>
        <p className="r2-eyebrow">
          Costing Sheet · {project.clientName ?? project.dealName} / Quote v
          {quote.versionNumber}
        </p>
        <h1 className="r2-page-title">
          Tune <em>price</em> & review.
        </h1>
        <p className="r2-page-sub">{subCopy}</p>
      </div>

      <div className="r2-row r2-gap-2">
        <Link
          href={`/projects/${projectId}/quotes/${quoteId}/cost-build`}
          className="r2-btn ghost sm"
        >
          ← Back to Cost Build
        </Link>
        <button
          type="button"
          className="r2-btn"
          disabled
          title="Customer preview ships in Slice 11"
        >
          Preview customer quote
        </button>
        <MarkAcceptedCluster
          status={status}
          editable={quote.status === "draft"}
        />
      </div>
    </div>
  );
}

function MarkAcceptedCluster({
  status,
  editable,
}: {
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  editable: boolean;
}) {
  if (status !== "BELOW_FLOOR") {
    return (
      <button
        type="button"
        className="r2-btn primary"
        disabled={!editable}
        title="Mark-Accepted writeback ships in Slice 12"
      >
        Mark accepted →
      </button>
    );
  }

  // BELOW_FLOOR: two-shape cluster — strikethrough disabled +
  // admin-override-request CTA
  return (
    <div className="r2-row r2-gap-2">
      <button
        type="button"
        disabled
        className="r2-btn"
        style={{
          opacity: 0.55,
          cursor: "not-allowed",
          textDecoration: "line-through",
          textDecorationColor: "var(--bad)",
          textDecorationThickness: "1px",
        }}
      >
        Mark accepted
      </button>
      <button
        type="button"
        className="r2-btn"
        style={{
          background: "var(--paper-2)",
          border: "1px dashed var(--bad)",
          color: "var(--bad)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
        title="Admin override routing wires up in Slice 12"
      >
        ⚿ Request admin override
      </button>
    </div>
  );
}
