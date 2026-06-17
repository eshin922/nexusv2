"use client";

import {
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";

// slice-pricing-surface-redesign Step 8 — Mark Accepted CTA + the
// secondary customer-response chip removed from Pricing page header.
// Per R7a IA grammar + post-canon-revision (May 2026) Quote umbrella
// structure: Mark Accepted is a Quote sub-tab (Quote → Mark Accepted),
// not a peer affordance on Pricing. The header's "send" affordance
// flows through the YOUR NEXT MOVE banner → Preview Quote sub-tab,
// which is the canonical handoff into the execute phase.
//
// Slice RI.5 — Pricing page chrome per R2 source
// (`docs/design-prototypes/dist/source/round-2/app/r2/costing.jsx:124-165`).
//
// Composition: eyebrow + italic-display H1 + sub copy + YOUR NEXT
// MOVE banner.
// H1: "Tune <em>price</em> & review." — italic-em word per R2 grammar.
// Sub copy: keyed off blendedMarginStatus.
//
// Removed in slice-pricing-surface-redesign Step 8 tear-down:
//   - ActionCluster mount (Mark-accepted primary + customer-response
//     secondary)
//   - CustomerAcceptToggle import (orphan after the cluster removal)
//   - MarkAcceptedCluster helper
//   - `tiers` prop (only consumed by the deleted CustomerAcceptToggle)

export function PricingPageHead({
  projectId,
  quoteId,
  project,
  quote,
}: {
  projectId: string;
  quoteId: string;
  project: { dealName: string; clientName: string | null };
  quote: {
    scenarioLabel: string;
    versionNumber: number;
    status: string;
  };
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
      {/* Sweep Step 3.2/5 — Pricing page chrome migrated from
          legacy .r2-page-head to canonical .r7b-head (chrome canon
          per dual-canon discipline). Inner H1 + sub-paragraph
          retain R2 body register via .page-title / .page-sub (now
          resolved under the .r2-pricing parent scope per Step 3.1/5
          CSS adoption). RI.9 nav primitives (Eyebrow,
          YourNextMoveBanner) preserved — they ARE the chrome canon
          per RI.9 + R7a/R7b implementation, and the new .r7b-head
          structure wraps around them via .lhs / .actions slots. */}
      <div className="r7b-head">
        <div className="lhs">
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
          <h1 className="page-title">
            Tune <em>price</em> & review.
          </h1>
          <p className="page-sub">{subCopy}</p>
        </div>

        {/* `.actions` slot intentionally empty post-Step-8 tear-down.
            The R7b head grid keeps the slot reserved (right-aligned
            empty div) so the H1/H2 register stays anchored to the
            left column; if/when a non-Mark-Accepted action lands,
            it goes here. Banner below is the active surface for
            forward handoff. */}
        <div className="actions" />
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
