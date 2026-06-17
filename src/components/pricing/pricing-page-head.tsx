"use client";

import {
  selectFirmSettings,
  selectQuoteSummary,
  selectSkuRollups,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import {
  isBelowFloor,
  isBelowTarget,
} from "@/lib/pricing-predicates";

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
// CB Step 9 re-walk BUG-2 patch (2026-06-16): sub-copy + banner state
// were previously bound to `summary.blendedMarginStatus` (legacy 3-value
// GOOD / BELOW_TARGET / BELOW_FLOOR field). That field is computed from
// the QUOTE-BLENDED margin, not the classifier's per-cell-worst-case
// mode. On quotes without cost data entered, every cell margin is
// missing → classifier emits sendable+provisional; but blendedMarginStatus
// defaults to BELOW_FLOOR → sub-copy mis-rendered "Below floor — admin
// override required" while the PSR mode pill correctly read SENDABLE.
//
// Fix: derive a classifier-equivalent mode HERE from the same primitives
// the classifier reads (per-leaf per-tier marginPct + TARGET_TOLERANCE
// predicates from `pricing-predicates.ts`). Same predicates → same
// mode → sub-copy + banner always agree with the classifier's render.
// Avoids lifting the classifier into a React Context (single-source-
// of-truth at the predicate level is sufficient for these copy branches).

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
  const firmSettings = useCostingStore(selectFirmSettings);

  // Effective target follows the same `?? firmSettings.targetMarginPct`
  // pattern the classifier uses (per-quote override or firm default).
  // quoteSummary already exposes the resolved effective target.
  const effectiveTarget = summary.effectiveTargetMarginPct;
  const floor = firmSettings.floorMarginPct;

  // Mode derivation — identical algorithm to classifier §2 worst-case:
  //   blocked    = any known leaf-per-tier margin < floor
  //   suggestion = any known leaf-per-tier margin < target (and !blocked)
  //   sendable   = otherwise
  // `missing` cells are excluded — classifier never silently treats
  // unknown as fine; missing → sendable provisional (state-line modifier
  // only; mode stays sendable).
  let blocked = false;
  let suggestionLed = false;
  let flaggedCount = 0;
  for (const sku of skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const t of sku.perTier) {
      // Use the per-cell marginStatus the math layer already classified
      // (consistent with `t.marginStatus` produced by computeStatus in
      // costing.ts using effectiveTarget + floor). Equivalent to running
      // isBelowFloor / isBelowTarget against marginPct directly; keeps
      // this surface in lock-step with per-cell margin verdict bands.
      if (t.marginStatus === "BELOW_FLOOR") {
        blocked = true;
        flaggedCount += 1;
      } else if (t.marginStatus === "BELOW_TARGET") {
        suggestionLed = true;
      }
    }
  }
  // Belt-and-suspenders predicate evaluation against the quote-blended
  // margin as a secondary signal (catches the case where no leaves have
  // cost data but quoteRollup carries a blended-margin number anyway).
  if (
    !blocked &&
    !suggestionLed &&
    summary.blendedMarginPct != null &&
    isBelowFloor(summary.blendedMarginPct, floor)
  ) {
    blocked = true;
  }
  if (
    !blocked &&
    !suggestionLed &&
    summary.blendedMarginPct != null &&
    isBelowTarget(summary.blendedMarginPct, effectiveTarget)
  ) {
    suggestionLed = true;
  }

  const mode: "sendable" | "suggestion_led" | "blocked" = blocked
    ? "blocked"
    : suggestionLed
      ? "suggestion_led"
      : "sendable";

  const subCopy =
    mode === "sendable"
      ? "All margins above floor — review and send."
      : mode === "suggestion_led"
        ? `${flaggedCount > 0 ? flaggedCount : "Some"} line${flaggedCount === 1 ? "" : "s"} below target — soft warning, sendable.`
        : "Below floor — admin override required to send.";

  // Slice RI.9 § 3.3 — banner state derivation now keyed off
  // classifier-equivalent mode (was: `status === "BELOW_FLOOR"`
  // legacy field).
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
