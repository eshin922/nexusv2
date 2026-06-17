"use client";

import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { usePricingClassifier } from "@/components/pricing-surface/pricing-classifier-context";

// slice-pricing-surface-redesign Step 8 — Mark Accepted CTA + the
// secondary customer-response chip removed from Pricing page header.
// Per R7a IA grammar + post-canon-revision (May 2026) Quote umbrella
// structure: Mark Accepted is a Quote sub-tab (Quote → Mark Accepted),
// not a peer affordance on Pricing. The header's "send" affordance
// flows through the YOUR NEXT MOVE banner → Preview Quote sub-tab,
// which is the canonical handoff into the execute phase.
//
// CB Step 9 re-walk Patch round 2 (2026-06-16): sub-copy + banner
// state now consume `state.mode` directly from
// `usePricingClassifier()` — the single classifier output computed
// at the page-level provider. PATCH ROUND 1 introduced a parallel
// predicate chain here (isBelowFloor/isBelowTarget against per-leaf
// per-tier marginStatus + belt-and-suspenders fallback on
// summary.blendedMarginPct); that chain didn't survive the zero-SKU
// / zero-cost-data sendable edge case (Epicuren Alt 1 + Alt 4
// regression: classifier said sendable, head's parallel chain said
// blocked → mode pill / sub-copy / banner all disagreed).
//
// Pattern 22 catch #10 + brief §3 source-of-truth invariant:
// re-derivation surfaces drift. The structural fix is to eliminate
// the parallel chain entirely — head reads classifier output via
// hook; sub-copy + banner branch on `state.mode` (closed 3-value
// enum: sendable | suggestion_led | blocked). No alternative
// derivation possible.
//
// flaggedCount (counting BELOW_FLOOR cells) is preserved as part
// of the suggestion_led sub-copy ("N lines below target"); read
// from classifier's per-cell `below_floor.length` instead of
// re-iterating skuRollups.

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
  const { state } = usePricingClassifier();
  const mode = state.mode;

  // `below_floor` is the classifier's flattened cells-below-floor
  // array; length doubles as the "N lines below target" count for
  // the suggestion_led sub-copy. (In suggestion_led mode there are
  // no below_floor cells by definition — sub-copy below_target
  // count comes from state.below_target.length.)
  const belowTargetCount = state.below_target.length;

  const subCopy =
    mode === "sendable"
      ? "All margins above floor — review and send."
      : mode === "suggestion_led"
        ? `${belowTargetCount > 0 ? belowTargetCount : "Some"} line${belowTargetCount === 1 ? "" : "s"} below target — soft warning, sendable.`
        : "Below floor — admin override required to send.";

  // Slice RI.9 § 3.3 — banner state derivation now keyed off
  // classifier-derived mode directly.
  const bannerState: "default" | "gated" | "terminal" =
    quote.status === "accepted"
      ? "terminal"
      : mode === "blocked"
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
