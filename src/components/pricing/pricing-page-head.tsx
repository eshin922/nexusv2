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
// not a peer affordance on Pricing.
//
// CB Patch round 2 — sub-copy bound to classifier `state.mode` via
// `usePricingClassifier()` (eliminated parallel predicate chain).
//
// CB Patch round 3 BUG-D — YOUR NEXT MOVE banner label + href ALSO
// derive from classifier output (was: static SURFACE_META label
// only). Banner now surfaces the PRIMARY action's label per
// classifier ranking:
//
//   sendable        → preview_pdf primary       → "Preview quote PDF →"
//   suggestion_led  → apply_surgical / global   → "Apply Surgical · …"
//                                                 / "Apply Global · …"
//   blocked         → apply_surgical primary    → "Apply Surgical · …"
//                     / suggestion_infeasible   → "Suggestion unavailable …"
//                     / override-only path      → recommended action's
//                                                 label drives the
//                                                 register
//
// Banner href:
//   - sendable + accepted (terminal): no href, banner silent
//   - sendable: customer_view route (Preview PDF surface)
//   - suggestion_led: in-page anchor #psr-suggestion-card
//   - blocked: in-page anchor #psr-actions
// helpText:
//   - blocked: "Below floor — admin override required before quote
//     can be sent." (gated register; preserved from prior patch)
//
// Pattern 22 catch #14 disposition: eliminate banner's parallel
// derivation surface; classifier output is the only source of truth
// for what action surfaces here.

const PSR_SUGGESTION_ANCHOR = "psr-suggestion-card";
const PSR_ACTION_ANCHOR = "psr-actions";

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

  // CB final-stretch ANOMALY-1 (2026-06-16) — sub-copy denominator
  // is TIER count (matches state-line lead), not cell/line count.
  // Sub-copy previously read `state.below_target.length` which is
  // the per-cell array (e.g., 1 tier × 3 SKUs = 3 cells). PMs read
  // state-line "1 tier below target" + sub-copy "3 lines below
  // target" and perceived disagreement. Both were truthful but
  // counted different objects. Classifier's `state.tiers[].status`
  // rollup is the canonical tier-level verdict; filter on
  // `below_target` for the suggestion_led count.
  const tiersBelowTarget = state.tiers.filter(
    (t) => t.status === "below_target",
  ).length;

  const subCopy =
    mode === "sendable"
      ? "All margins above floor — review and send."
      : mode === "suggestion_led"
        ? `${tiersBelowTarget > 0 ? tiersBelowTarget : "Some"} tier${tiersBelowTarget === 1 ? "" : "s"} below target — soft warning, sendable.`
        : "Below floor — admin override required to send.";

  // Banner state derivation now via classifier mode.
  const bannerState: "default" | "gated" | "terminal" =
    quote.status === "accepted"
      ? "terminal"
      : mode === "blocked"
        ? "gated"
        : "default";

  // CB Patch round 3 BUG-D — banner label sourced from classifier's
  // recommended/primary action.
  //
  // - suggestion_led + blocked: recommended action is always present
  //   (invariant 2). Its label drives the banner.
  // - sendable: no `recommended` action; primary is preview_pdf.
  // - When state.actions is somehow empty (shouldn't happen but
  //   defensive), fall back to SURFACE_META.
  const recommendedOrPrimary =
    state.actions.find((a) => a.recommended) ??
    state.actions.find((a) => a.primary) ??
    null;

  const bannerLabel =
    bannerState === "terminal"
      ? ""
      : recommendedOrPrimary
        ? // CD prototype style: trailing arrow on banner CTA. Action
          // labels already carry contextual qualifiers ("lift T1 to
          // target" etc.); we append " →" to match the R9 banner
          // chrome convention.
          `${recommendedOrPrimary.label} →`
        : bannerState === "gated"
          ? SURFACE_META.costing.nextMove?.gatedLabel ??
            SURFACE_META.costing.nextMove?.label ??
            ""
          : SURFACE_META.costing.nextMove?.label ?? "";

  // Banner href:
  //   - suggestion_led: in-page anchor → SuggestionCard
  //   - blocked: in-page anchor → action zone
  //   - sendable / terminal: customer_view route (preview PDF)
  const bannerHref =
    bannerState === "terminal"
      ? "" // banner silent in terminal; href unused
      : mode === "suggestion_led"
        ? `#${PSR_SUGGESTION_ANCHOR}`
        : mode === "blocked"
          ? `#${PSR_ACTION_ANCHOR}`
          : resolveSurfaceHref("customer_view", projectId, quoteId);

  return (
    <>
      {/* Sweep Step 3.2/5 — Pricing page chrome migrated from
          legacy .r2-page-head to canonical .r7b-head (chrome canon
          per dual-canon discipline). */}
      <div className="r7b-head">
        <div className="lhs">
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
            left column. */}
        <div className="actions" />
      </div>

      {/* CB Patch round 3 BUG-D — banner label now reflects the
          classifier's recommended/primary action; href routes to
          the in-page surface that owns that action. */}
      {/* Post-Step-6 fix batch §3 — banner helpText carries the
          infeasible-state recovery hint. Was: only 'gated' mode had
          helpText. Now suggestion_infeasible ALSO gets a hint
          because the SuggestionCard's infeasible branch is now
          suppressed (empty-slot-no-card) — the banner becomes the
          single "unavailable" message; helpText adds the "why" +
          recovery path. */}
      <YourNextMoveBanner
        state={bannerState}
        label={bannerLabel}
        href={bannerHref}
        helpText={
          bannerState === "gated"
            ? "Below floor — admin override required before quote can be sent."
            : recommendedOrPrimary?.kind === "suggestion_infeasible"
              ? recommendedOrPrimary.sublabel ??
                "Engine couldn't compute a viable lift path. Enter pricing on the Costs surface to recover, or use admin override."
              : recommendedOrPrimary?.kind === "suggestion_manual_only"
                ? recommendedOrPrimary.sublabel ??
                  "Tier is above target overall — one SKU is dragging margin. Adjust cost inputs on the Costs surface, or send below-target acknowledging the risk."
                : undefined
        }
      />

    </>
  );
}
