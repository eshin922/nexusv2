"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectGraph,
  selectSetActiveTier,
} from "@/lib/costing-store";
import {
  buildCostsOverview,
  type CostsOverviewFacts,
} from "@/lib/costs/costs-overview-model";
import { readPackagingLineTiers } from "@/lib/costs/packaging-line-graph-read";
import { COSTS_PREVIEW_PARAM } from "@/lib/costs/m2-preview-switch";
import { CostsM2PreviewBody } from "./costs-m2-preview-body";

/**
 * The M2 read-only Costs preview — the store-connected half.
 *
 * ── ONE READ MODEL, THREE VIEWS ──────────────────────────────────────────
 *
 * All three views project `buildCostsOverview` over the SAME facts. They cannot
 * disagree about which owners exist or what a cell holds, because there is one
 * answer and none of them computes its own.
 *
 * What the milestone is, and why it is labelled rather than merely disabled,
 * is recorded on `CostsM2PreviewBody`.
 */
import type { FreightSummaryInput } from "@/lib/costs/freight-summary";

export type CostsM2PreviewProps = {
  freight: FreightSummaryInput;
  freightEditor: ReactNode;
  freightExcluded?: boolean;
  facts: CostsOverviewFacts;
  quoteId: string;
  /** Opt into the M3 existing-writer controls; M2 stays strictly read-only. */
  editMode?: boolean;
  /** Whether the underlying quote is editable, purely so the banner can say
   *  why nothing here is — a sent quote is read-only for its own reasons. */
  quoteEditable: boolean;
};

/**
 * The store-connected wrapper.
 *
 * THE GRAPH ENTERS HERE AND NOWHERE ELSE, and leaves as resolved data — the
 * same discipline the Cost Stack header records: "the columns render what they
 * are given and have no access to the graph, so there is one place where a
 * commercial value can enter this surface." It also means the body below is a
 * pure function of its props and can be driven by a test without a store.
 */
export function CostsM2Preview({ facts, quoteEditable, freight, freightEditor, freightExcluded = false, quoteId, editMode = false }: CostsM2PreviewProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const graph = useCostingStore(selectGraph);
  // THE SAME active tier the Cost Stack above shows, from the same store.
  // `ActiveTierUrlSync` owns URL -> store; this reads the result.
  const activeTierId = useCostingStore(selectActiveTierId);
  const setActiveTier = useCostingStore(selectSetActiveTier);

  const overview = useMemo(() => buildCostsOverview(facts), [facts]);

  // One traversal for the whole preview, through the same read the Packaging
  // drawer uses. Every line of every owner, against every tier.
  const reads = useMemo(() => {
    const lines = overview.owners
      .flatMap((o) => [o, ...o.members])
      .flatMap((o) =>
        o.recurringLines.map((l) => ({
          lineGroupId: l.lineGroupId,
          quoteLeafId: l.quoteLeafId,
        })),
      );
    return readPackagingLineTiers(graph, lines, overview.tiers);
  }, [graph, overview]);

  // Leaving the preview drops the switch and keeps everything else — the open
  // section and the selected tier both live in this query string, and dropping
  // them would make exiting look like it had reset the operator's place.
  const baseParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(COSTS_PREVIEW_PARAM);
    return next.toString();
  }, [searchParams]);

  /**
   * Selecting a tier in the preview is the SAME gesture as selecting one in the
   * Cost Stack: store first, then the canonical `?tier=` parameter.
   *
   * Copied in shape from `CostStackHeader.selectTier` deliberately — writing
   * only the store would leave the URL stale and `ActiveTierUrlSync` would pull
   * the selection back on the next render; writing only the URL would cost a
   * router round trip before subscribers saw it.
   *
   * This is NAVIGATION, not financial state: the all-SKU stack keeps its
   * whole-quote scope, and nothing is written to the quote.
   */
  const selectTier = (tierId: string) => {
    setActiveTier(tierId);
    const next = new URLSearchParams(searchParams);
    next.set("tier", tierId);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <CostsM2PreviewBody
      freightEditor={freightEditor}
      freightExcluded={freightExcluded}
      quoteId={quoteId}
      editMode={editMode}
      freight={freight}
      overview={overview}
      reads={reads}
      quoteEditable={quoteEditable}
      pathname={pathname}
      baseParams={baseParams}
      activeTierId={activeTierId}
      onSelectTier={selectTier}
    />
  );
}
