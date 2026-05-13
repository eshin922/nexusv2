"use client";

import Link from "next/link";
import {
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { CustomerAcceptToggle } from "./customer-accept-toggle";
import { Eyebrow } from "@/components/nav/eyebrow";
import { ActionCluster } from "@/components/nav/action-cluster";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";

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

  // Slice RI.9 § 3.3 — banner state derivation:
  //   - BELOW_FLOOR → gated (CTA reads "Resolve override before sending")
  //   - sent + accepted → terminal (already sent; banner shouldn't push to Quote)
  //   - default → "Preview quote PDF →" (forward to customer_view)
  const bannerState: "default" | "gated" | "terminal" =
    quote.status === "accepted"
      ? "terminal"
      : status === "BELOW_FLOOR"
        ? "gated"
        : "default";
  const bannerLabel =
    bannerState === "gated"
      ? SURFACE_META.costing.nextMove?.gatedLabel ??
        SURFACE_META.costing.nextMove?.label ??
        ""
      : SURFACE_META.costing.nextMove?.label ?? "";
  const bannerHref = resolveSurfaceHref("customer_view", projectId, quoteId);

  return (
    <>
      <div className="r2-page-head">
        <div>
          {/* Slice RI.9 § 3.1 — Eyebrow per R7a canon. F-6 inline
              backlink ("← Costs") removed — R7a's eyebrow is NEVER
              navigable. PMs use inner rail to navigate to Costs
              (rail.visible = true on Pricing). */}
          <Eyebrow
            segments={[
              project.clientName ?? project.dealName,
              quote.scenarioLabel,
              `v${quote.versionNumber}`,
            ]}
          />
          <h1 className="r2-page-title">
            Tune <em>price</em> & review.
          </h1>
          <p className="r2-page-sub">{subCopy}</p>
        </div>

        {/* Slice RI.9 § 3.4 — Action cluster. Primary "Mark accepted"
            (gated by BELOW_FLOOR); secondary slots carry the
            customer-response chip + Preview affordance. The R7a
            workflow-cluster grouping (response → mark accepted with
            visual divider) from RI.8 step 7 is preserved within the
            secondary+primary arrangement. */}
        <ActionCluster
          secondary={[
            // § 5.2 — "Customer accepted (manual)" affordance.
            // Renders as the existing CustomerAcceptToggle on sent
            // quotes (the live signal-recording UI). Inert placeholder
            // pre-send so the workflow sequence reads correctly.
            quote.status === "sent" ? (
              <CustomerAcceptToggle
                key="customer-accept"
                quoteId={quoteId}
                customerAcceptedAt={quote.customerAcceptedAt}
                customerAcceptedTierId={quote.customerAcceptedTierId}
                tiers={tiers}
              />
            ) : (
              <span
                key="customer-accept-pending"
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
            ),
            <Link
              key="preview"
              href={`/projects/${projectId}/quotes/${quoteId}/quote`}
              className="r2-btn ghost"
            >
              Preview
            </Link>,
          ]}
          primary={
            <MarkAcceptedCluster
              projectId={projectId}
              quoteId={quoteId}
              status={status}
              editable={quote.status === "draft"}
            />
          }
        />
      </div>

      {/* Slice RI.9 § 3.3 — YOUR NEXT MOVE banner.
          - default: "Preview quote PDF →" (forward to Quote)
          - gated: "Resolve override before sending →" (BELOW_FLOOR)
          - terminal: explicit silence post-acceptance */}
      <YourNextMoveBanner
        state={bannerState}
        label={bannerLabel}
        href={bannerHref}
        helpText={
          bannerState === "gated"
            ? "Below floor — admin override required before quote can be sent."
            : undefined
        }
      />
    </>
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
