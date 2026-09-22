"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { CostsOverview } from "@/lib/costs/costs-overview-model";
import type { PackagingLineTierRead } from "@/lib/costs/packaging-line-graph-read";
import { SpreadsheetView } from "./spreadsheet-view";
import { ByProductView } from "./by-product-view";
import { ByModuleView } from "./by-module-view";
import { Tag } from "./shared";

/**
 * The M2 read-only Costs preview, as a PURE FUNCTION OF ITS PROPS.
 *
 * ── WHAT THIS MILESTONE IS ───────────────────────────────────────────────
 *
 * A LABELLED MILESTONE PREVIEW of the approved Costs presentation, over the
 * quote's real records. It has no writers. It performs no arithmetic. It shows
 * fewer behaviours than the final design -- per-tier editing, the shared
 * one-time amount and Settings-driven fee suggestions are later milestones with
 * their own state models -- and it says so on the surface rather than implying
 * them with controls that do nothing.
 *
 * ── WHY IT IS LABELLED RATHER THAN MERELY DISABLED ───────────────────────
 *
 * A read-only surface that LOOKS editable is worse than one that looks
 * read-only: an operator types into it, loses the keystrokes, and learns not to
 * trust the surface that did save. So values render as dashed read-only fields,
 * never as disabled inputs, and the banner states the milestone.
 *
 * ── WHY THE BODY IS SEPARATED FROM THE STORE ─────────────────────────────
 *
 * The graph enters through `CostsM2Preview` and arrives here as RESOLVED DATA --
 * the discipline the Cost Stack header records: one place where a commercial
 * value can enter this surface. It also means a mounted test can drive all three
 * views without a store, a database, or the server actions a store provider
 * pulls in behind it.
 */
import { FreightSummary } from "./freight-summary";
import type { FreightSummaryInput } from "@/lib/costs/freight-summary";

type ViewKey = "spreadsheet" | "by-product" | "by-module";

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "spreadsheet", label: "Spreadsheet" },
  { key: "by-product", label: "By product" },
  { key: "by-module", label: "By module" },
];

export function CostsM2PreviewBody({
  overview,
  freight,
  freightEditor,
  freightExcluded = false,
  quoteId = "",
  editMode = false,
  reads,
  quoteEditable,
  pathname,
  baseParams,
  activeTierId,
  onSelectTier,
}: {
  overview: CostsOverview;
  freight?: FreightSummaryInput;
  freightEditor?: ReactNode;
  freightExcluded?: boolean;
  quoteId?: string;
  editMode?: boolean;
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  quoteEditable: boolean;
  pathname: string;
  /** The current query WITHOUT the preview switch. */
  baseParams: string;
  /**
   * The quote's active tier, from the store the Cost Stack reads. Null before
   * the tier list hydrates, or on a zero-tier quote.
   */
  activeTierId: string | null;
  /** Navigation only: store + `?tier=`, the gesture the Cost Stack already makes. */
  onSelectTier: (tierId: string) => void;
}) {
  const [view, setView] = useState<ViewKey>("spreadsheet");
  const freightParams = new URLSearchParams(baseParams);
  freightParams.set("section", "freight");

  return (
    <div className="cm2">
      {overview.gaps.length > 0 && (
        <div className="cm2-gaps" role="note">
          <strong>
            {overview.gaps.length} record{overview.gaps.length === 1 ? "" : "s"} this
            preview cannot place
          </strong>
          <ul>
            {overview.gaps.map((g) => (
              <li key={`${g.code}:${g.subjectId}`}>{g.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="cm2-costs-module" aria-label="Packaging, production and charges">
        <header className="cm2-costs-head">
          <div>
            <h2>Packaging, production and charges</h2>
            <div className="cm2-section-note">
              {overview.tiers.length} pricing tier{overview.tiers.length === 1 ? "" : "s"} · costs per tier
            </div>
          </div>
          <Tag tone="plain">Costs on this quote</Tag>
        </header>
        <div className="cm2-costs-body">
          <div className="cm2-views" role="group" aria-label="Costs view">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                className="cm2-ctl"
                aria-pressed={view === v.key}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* One active tier across all three views and the Cost Stack above.
              Each view highlights it; the two grid views also let an operator move
              it, which is the same navigation the stack offers. */}
          {view === "spreadsheet" && (
            <SpreadsheetView
              overview={overview}
              reads={reads}
              activeTierId={activeTierId}
              onSelectTier={onSelectTier}
              quoteId={quoteId}
              editMode={editMode && quoteEditable}
            />
          )}
          {view === "by-product" && (
            <ByProductView
              overview={overview}
              reads={reads}
              activeTierId={activeTierId}
              onSelectTier={onSelectTier}
              quoteId={quoteId}
              editMode={editMode && quoteEditable}
            />
          )}
          {view === "by-module" && (
            <ByModuleView
              overview={overview}
              reads={reads}
              costsPathname={pathname}
              baseParams={baseParams}
              activeTierId={activeTierId}
              onSelectTier={onSelectTier}
              quoteId={quoteId}
              editMode={editMode && quoteEditable}
            />
          )}
        </div>
      </section>
      {!freightExcluded && editMode && quoteEditable && freightEditor ? (
        <section className="cm2-freight cm2-freight-input" aria-label="Freight inputs">
          <header className="cm2-freight-panel-head cm2-freight-inline-head">
            <div>
              <div className="cm2-eyebrow">Freight on this quote</div>
              <h2>Shipments, destinations and costs</h2>
            </div>
          </header>
          <div className="cm2-freight-panel-body cm2-freight-inline-body">
            {freightEditor}
          </div>
        </section>
      ) : !freightExcluded ? (
        <FreightSummary
          input={freight}
          editor={freightEditor}
          tiers={overview.tiers}
          activeTierId={activeTierId}
          onSelectTier={onSelectTier}
          href={`${pathname}?${freightParams.toString()}`}
        />
      ) : null}
    </div>
  );
}
