"use client";

// Pricing Reframe v1 — top-band shell wrapper.
//
// Renders the six new components under a single ReframeStateProvider so
// they share applying/last-apply state. Sits ABOVE the preserved
// ROOM 0/1/2/3 components per Edward's interim (b) disposition.
//
// page.tsx (server component) renders <PricingReframeShell> with the
// tier-list props it can't get from the client store (recommended
// flag, ★ tier id).

import { ApplyToast } from "@/components/pricing-reframe/apply-toast";
import { BlendedHeadline } from "@/components/pricing-reframe/blended-headline";
import { EmptyState } from "@/components/pricing-reframe/empty-state";
import { FloorBlock } from "@/components/pricing-reframe/floor-block";
import { ReframeStateProvider } from "@/components/pricing-reframe/reframe-state-context";
import { SuggestionEngine } from "@/components/pricing-reframe/suggestion-engine";
import { TierComplianceBlock } from "@/components/pricing-reframe/tier-compliance-block";

type TierWithRecommended = {
  id: string;
  label: string;
  recommended: boolean;
};

type Props = {
  tiersForReframe: TierWithRecommended[];
  recommendedTierId: string | null;
};

export function PricingReframeShell({
  tiersForReframe,
  recommendedTierId,
}: Props) {
  return (
    <ReframeStateProvider>
      <ApplyToast tiers={tiersForReframe} />
      <BlendedHeadline />
      <FloorBlock />
      <EmptyState />
      <TierComplianceBlock tiers={tiersForReframe} />
      <SuggestionEngine recommendedTierId={recommendedTierId} />
    </ReframeStateProvider>
  );
}
