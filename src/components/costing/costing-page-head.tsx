"use client";

import Link from "next/link";
import {
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { CustomerAcceptToggle } from "./customer-accept-toggle";

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
  tiers,
}: {
  projectId: string;
  quoteId: string;
  project: { dealName: string; clientName: string | null };
  quote: {
    scenarioLabel: string;
    versionNumber: number;
    status: string;
    customerAcceptedAt: Date | null;
    customerAcceptedTierId: string | null;
  };
  tiers: ReadonlyArray<{ id: string; label: string; qty: number | null }>;
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

      <div className="r2-row r2-gap-2" style={{ flexWrap: "wrap" }}>
        <Link
          href={`/projects/${projectId}/quotes/${quoteId}/cost-build`}
          className="r2-btn ghost sm"
        >
          ← Back to Cost Build
        </Link>
        <Link
          href={`/projects/${projectId}/quotes/${quoteId}/customer-view`}
          className="r2-btn"
        >
          Preview customer quote
        </Link>
        {/* Slice RI.7 — customer-acceptance toggle. Only renders on
            sent quotes (pre-send: no customer signal; post-accept: locked). */}
        {quote.status === "sent" && (
          <CustomerAcceptToggle
            quoteId={quoteId}
            customerAcceptedAt={quote.customerAcceptedAt}
            customerAcceptedTierId={quote.customerAcceptedTierId}
            tiers={tiers}
          />
        )}
        <MarkAcceptedCluster
          projectId={projectId}
          quoteId={quoteId}
          status={status}
          editable={quote.status === "draft"}
        />
      </div>
    </div>
  );
}

function MarkAcceptedCluster({
  projectId,
  quoteId,
  status,
  editable,
}: {
  projectId: string;
  quoteId: string;
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  editable: boolean;
}) {
  const href = `/projects/${projectId}/quotes/${quoteId}/mark-accepted`;

  if (status !== "BELOW_FLOOR") {
    if (!editable) {
      return (
        <button
          type="button"
          className="r2-btn primary"
          disabled
          title="Quote not editable"
        >
          Mark accepted →
        </button>
      );
    }
    return (
      <Link href={href} className="r2-btn primary">
        Mark accepted →
      </Link>
    );
  }

  // BELOW_FLOOR: two-shape cluster — strikethrough disabled +
  // admin-override-request CTA. Both route to Mark-Accepted page;
  // the page itself surfaces the bothGates state (visual shell of
  // the override flow).
  return (
    <div className="r2-row r2-gap-2">
      <Link
        href={href}
        className="r2-btn"
        style={{
          opacity: 0.7,
          textDecoration: "line-through",
          textDecorationColor: "var(--bad)",
          textDecorationThickness: "1px",
        }}
      >
        Mark accepted
      </Link>
      <Link
        href={href}
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
      >
        ⚿ Request admin override
      </Link>
    </div>
  );
}
