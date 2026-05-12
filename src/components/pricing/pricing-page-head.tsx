"use client";

import Link from "next/link";
import {
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { CustomerAcceptToggle } from "./customer-accept-toggle";

// Slice RI.5 — Pricing page chrome per R2 source
// (`docs/design-prototypes/dist/source/round-2/app/r2/costing.jsx:124-165`).
//
// Composition: eyebrow + italic-display H1 + sub copy + button cluster.
// H1: "Tune <em>price</em> & review." — italic-em word per R2 grammar.
// Sub copy: keyed off blendedMarginStatus.
// Buttons (post-F-6 + cluster grouping, Slice RI.8 step 7):
//   - Preview customer quote (sideways look-at affordance, distinct
//     visual register from the workflow cluster)
//   - Workflow cluster (sequenced): customer-response chip → Mark
//     accepted. Visually grouped via shared treatment + proximity
//     since Mark Accepted is gated on customer-response being
//     recorded (CR-SM DEC-1+DEC-2).
//   - Back-to-Costs moved INTO the eyebrow as a breadcrumb (F-6:
//     R2 grammar — breadcrumb position, not action cluster).
//
// Brief amendment §11 step 7. Cluster grammar pending CD R7 (e)
// for cross-surface standardization; RI.8 ships the visible-
// hierarchy treatment within existing grammar to fix the
// felt-friction now.

export function PricingPageHead({
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
        {/* F-6: Back-to-Costs absorbed into the eyebrow breadcrumb.
            R2 grammar — mono caption register, separator dots, the
            arrow + link reads as "where I came from" not as an
            action button. */}
        <p className="r2-eyebrow">
          <Link
            href={`/projects/${projectId}/quotes/${quoteId}/costs`}
            style={{ color: "var(--ink-3)" }}
          >
            ← Costs
          </Link>
          {" · "}
          Pricing · {project.clientName ?? project.dealName} / Quote v
          {quote.versionNumber}
        </p>
        <h1 className="r2-page-title">
          Tune <em>price</em> & review.
        </h1>
        <p className="r2-page-sub">{subCopy}</p>
      </div>

      {/* Action cluster — sideways affordance + workflow cluster.
          Preview sits alone (look-at, not workflow forward); the
          customer-response chip + Mark Accepted bundle as a single
          visual unit since they are sequenced steps in one workflow. */}
      <div className="r2-row r2-gap-2" style={{ flexWrap: "wrap" }}>
        <Link
          href={`/projects/${projectId}/quotes/${quoteId}/quote`}
          className="r2-btn ghost"
        >
          Preview customer quote
        </Link>
        <div
          className="r2-workflow-cluster"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
          }}
        >
          {/* Slice RI.7 — customer-acceptance toggle. Renders inert
              placeholder on drafts (so the workflow sequence reads
              correctly even pre-send), live affordance on sent.
              Mark Accepted is the gated terminal step; visual
              grouping with the customer-response chip signals the
              prereq relationship per Edward's step 7 disposition. */}
          {quote.status === "sent" ? (
            <CustomerAcceptToggle
              quoteId={quoteId}
              customerAcceptedAt={quote.customerAcceptedAt}
              customerAcceptedTierId={quote.customerAcceptedTierId}
              tiers={tiers}
            />
          ) : (
            <span
              title="Customer response is recorded after the quote is sent"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: "0.04em",
                padding: "4px 8px",
              }}
            >
              ① customer response · pending send
            </span>
          )}
          <span style={{ color: "var(--ink-4)", fontSize: 10 }}>→</span>
          <MarkAcceptedCluster
            projectId={projectId}
            quoteId={quoteId}
            status={status}
            editable={quote.status === "draft"}
          />
        </div>
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
