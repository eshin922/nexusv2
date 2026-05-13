// Slice RI.4 — Costs page header per R6 actual source
// (`docs/design-prototypes/dist/source/round-6/index.html` lines
// 2346-2365 + cost-build-page.jsx lines 81-98).
//
// R6 anchors page identity on FUNCTION ("Costs · Primary v3"
// italic display 30px) with the scenario as a desaturated em-tag.
// Project/client identity stays in rail/inbox surfaces, NOT on the
// cost-build header. Designer Pattern 1 audit Path A.
//
// Meta strip = sync state + HubSpot stage (TWO items, mono caption).
// NOT a navigation row. Per Designer audit S-16: stripping the
// breadcrumb links + status pill that drifted in earlier.
// Right-cluster: View as customer + Save draft buttons.
//
// Slice RI.7 fix — the non-editable "quote in sent status" alert
// previously rendered as a third flex item INSIDE the header's
// flex container, squeezing the title column to 1-2-word wraps
// once it appeared. Banner is now a sibling row, rendered by the
// page below the header (semantically a page-level state notice,
// not a header concern). Caller passes the alert separately.

import Link from "next/link";
import { Eyebrow } from "@/components/nav/eyebrow";
import { ActionCluster } from "@/components/nav/action-cluster";

export function CostsHeader({
  project,
  quote,
  tierCount,
  editable: _editable, // signature preserved for back-compat; banner now lives on the page
  children,
}: {
  project: { id: string; dealName: string; clientName: string | null };
  quote: {
    id: string;
    scenarioLabel: string;
    versionNumber: number;
    status: string;
    projectId: string;
  };
  tierCount: number;
  /** @deprecated banner moved out of this component; see SentStatusBanner below */
  editable?: boolean;
  children?: React.ReactNode;
}) {
  // Sub copy matches R6 verbatim (cost-build-page.jsx:84-86). R6
  // hardcodes "Three sections" because Bulk Raw is the conditional
  // peer per R6.1 addendum — primary IA is three sections feeding
  // the cost stack; Bulk Raw is the raws-mode-declaration zone.
  const tierWord = tierCount === 1 ? "tier" : "tiers";

  // HubSpot sync timestamp — UX_BACKLOG entry "Pulse-dot live HubSpot
  // sync indicator" tracks wiring real timestamp + stage. v1: stub.
  const syncLabel = "synced just now";

  // Suppress unused-param warning while we keep editable in the
  // signature for one slice (callers don't have to change all at once).
  void _editable;

  return (
    <header className="r6-page-head mb-[22px] flex items-end justify-between gap-6">
      <div className="min-w-0 flex-1">
        {/* Slice RI.9 § 3.1 — Eyebrow per R7a canon. R6 page-identity
            H1 ("Costs · {scenario} v{N}" italic) was anchoring scenario
            label inline; R7a moves project/scenario/version into the
            Eyebrow above, leaving H1 as pure surface identity. */}
        <Eyebrow
          segments={[
            project.clientName ?? project.dealName,
            quote.scenarioLabel,
            `v${quote.versionNumber}`,
          ]}
          style={{ marginBottom: 4 }}
        />
        <h1 className="m-0 font-display text-[30px] font-medium italic leading-tight tracking-[-0.012em] text-ink">
          Costs
        </h1>

        {/* Sub copy — R6 verbatim (cost-build-page.jsx:84-86) */}
        <p
          className="m-0 mt-1 text-[13px] text-ink-3"
          style={{ maxWidth: "64ch" }}
        >
          Three sections — Packaging, Production, Freight — feeding one cost
          stack across {tierCount} {tierWord}. Drill in to edit; the stack
          updates live.
        </p>

        {/* Meta strip: pulse + sync state + HubSpot stage. Two-item
            mono caption per R6 (NOT nav row). */}
        <div className="mt-2 flex items-center gap-3.5 font-mono text-[10.5px] tracking-[0.04em] text-ink-4">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: "var(--good)",
              boxShadow: "0 0 0 3px var(--good-soft)",
            }}
          />
          <span>Synced to HubSpot · {syncLabel}</span>
          <span>·</span>
          <span>{project.clientName ?? project.dealName}</span>
        </div>
      </div>

      <ActionCluster
        secondary={[
          // Slice RI.9 § 5.1 — "View as customer" is the canonical
          // sideways glance affordance on Cost build. Routes to
          // Customer view (Quote), bypassing Costing. Pre-send.
          <Link
            key="view-as-customer"
            href={`/projects/${quote.projectId}/quotes/${quote.id}/quote`}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-rule-2 bg-paper text-[13px] font-medium text-ink transition-all hover:bg-paper-2 hover:border-ink-4"
            style={{ padding: "7px 12px" }}
          >
            View as customer
          </Link>,
          // + New version — secondary slot per R7a surface-render
          // rules. Inert in v1; wiring lands with scenario versioning
          // workflow (UX_BACKLOG).
          <button
            key="new-version"
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-rule-2 bg-paper text-[13px] font-medium text-ink-3 transition-all hover:bg-paper-2 hover:border-ink-4 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ padding: "7px 12px" }}
            disabled
            title="+ New version — wiring lands with scenario versioning slice"
          >
            + New version
          </button>,
        ]}
        primary={
          <button
            type="button"
            title="Saved automatically"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border text-[13px] font-medium transition-all"
            style={{
              padding: "7px 12px",
              background: "var(--ink)",
              color: "var(--paper)",
              borderColor: "var(--ink)",
            }}
          >
            Save draft
          </button>
        }
      />
      {children}
    </header>
  );
}

// Slice RI.7 — page-level state notice for non-draft quotes. Renders
// as a full-width row below the header so the title + action cluster
// keep their original layout proportions.
export function SentStatusBanner({ status }: { status: string }) {
  return (
    <div
      role="alert"
      className="mb-[22px] rounded border border-warn/40 bg-warn-soft p-3 text-xs text-warn"
    >
      This quote is in <span className="font-mono">{status}</span> status.
      Editing is disabled. Create a new draft version from the project page
      to make changes.
    </div>
  );
}
