"use client";

import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { usePricingClassifier } from "@/components/pricing-surface/pricing-classifier-context";
import { usePricingProgression } from "@/components/pricing-surface/pricing-progression-context";

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
// Banner href (P-UX-1, 2026-08-17):
//   - sendable: customer_view route (Preview PDF surface)
//   - everything else: NO href. The banner states the move; the card below
//     performs it. See the note at `bannerHref`.
// helpText:
//   - blocked: "Below floor — admin override required before quote
//     can be sent." (gated register; preserved from prior patch)
//
// Pattern 22 catch #14 disposition: eliminate banner's parallel
// derivation surface; classifier output is the only source of truth
// for what action surfaces here.

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
  const progression = usePricingProgression();

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

  const subCopy = progression.allowed
    ? progression.authorizedTiers.length > 0
      ? `Below floor on ${progression.authorizedTiers.map((t) => t.label).join(", ")} — approved to proceed.`
      : tiersBelowTarget > 0
        ? `${tiersBelowTarget} tier${tiersBelowTarget === 1 ? "" : "s"} below target — soft warning, sendable.`
        : "All margins above floor — review and send."
    : progression.code === "DATA_INCOMPLETE"
      ? "Margins can't be checked yet — some cells have no margin."
      : "Below floor — approval required before this quote can go out.";

  // Banner state derivation now via classifier mode.
  // GATED means "the workflow will not let this through", which is now the
  // progression verdict rather than the classifier's mode. A below-TARGET
  // quote used to render gated chrome while being perfectly sendable.
  const bannerState: "default" | "gated" | "terminal" =
    quote.status === "accepted"
      ? "terminal"
      : progression.allowed
        ? "default"
        : "gated";

  // ── THE BANNER'S CTA IS PROGRESSION, NOT THE RANKED ACTION ─────────────
  //
  // It used to carry the recommended action's label — which in `blocked` and
  // `suggestion_led` was an in-page anchor to a card a few hundred pixels
  // below, carrying that card's own label. P-UX-1 removed the duplicate button
  // and kept the heading, correctly.
  //
  // What it left behind was a surface with NO forward affordance in either
  // mode: `preview_pdf` is filtered out of the action list in every mode, and
  // the banner suppressed its own href. A quote above floor but below target —
  // sendable by policy, and the copy said so — had no way to reach the Quote
  // surface except the rail.
  //
  // So the banner now states the workflow's next move: continue, or what stands
  // in the way. The recommended lift stays where P-UX-1 put it, on the one card
  // that performs it, and is not restated here.
  const recommendedOrPrimary =
    state.actions.find((a) => a.recommended) ??
    state.actions.find((a) => a.primary) ??
    null;

  const bannerLabel =
    bannerState === "terminal"
      ? ""
      : progression.allowed
        ? "Continue to Quote →"
        : progression.code === "DATA_INCOMPLETE"
          ? "Finish cost inputs on Costs →"
          : "Approval required before this quote can go out";

  // Slice 12 Step 9 — `?tab=preview` so the Send-lifecycle entry is explicit
  // rather than relying on the umbrella's default tab.
  //
  // The href appears ONLY when progression is allowed. A blocked banner states
  // the block and offers no button, per P-UX-1: the banner states the move, the
  // card performs it. Nothing here enforces anything — `sendQuote` re-decides
  // from the database, and must, because the rail links to `/quote`
  // unconditionally and always did.
  const bannerHref =
    bannerState === "terminal" || !progression.allowed
      ? undefined
      : `${resolveSurfaceHref("customer_view", projectId, quoteId)}?tab=preview`;

  // The qualifier, never a restatement of the label.
  const bannerHelp = !progression.allowed
    ? progression.message
    : progression.authorizedTiers.length > 0
      ? // The independence promise that used to close this sentence is gone
        // with the rule (policy 2026-08-22). What still binds the approval is
        // the economics it was granted against, so that is what it now says.
        `${progression.authorizedTiers
          .map((t) => t.label)
          .join(", ")} ${progression.authorizedTiers.length === 1 ? "is" : "are"} below the floor and ${progression.authorizedTiers.length === 1 ? "carries" : "carry"} an approval. It stays valid while the tier's economics are unchanged.`
      : recommendedOrPrimary?.kind === "suggestion_infeasible"
        ? recommendedOrPrimary.sublabel ??
          "Engine couldn't compute a viable lift path. Enter pricing on the Costs surface to recover, or request approval."
        : recommendedOrPrimary?.kind === "suggestion_manual_only"
          ? recommendedOrPrimary.sublabel ??
            "Tier is above target overall — one SKU is dragging margin. Adjust cost inputs on the Costs surface, or send below-target acknowledging the risk."
          : undefined;

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
        helpText={bannerHelp}
      />

    </>
  );
}
