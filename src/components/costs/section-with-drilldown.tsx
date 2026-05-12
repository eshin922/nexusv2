"use client";

import {
  selectActiveTierId,
  selectQuoteRollup,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { useCostBuildAccordion } from "./costs-accordion";

// Slice RI.4 — Section row per R6 actual source (extracted from
// docs/design-prototypes/dist/source/round-6/index.html lines
// 2615-2709 + section-summary-row.jsx). Comprehensive sweep against
// R6 actual class register, May 2026.
//
// Structure:
//   .r6-section (paper bg + 1px rule + 12px radius + overflow hidden)
//     .r6-section-row — 6-track grid:
//       [chev 32px] [head 1fr] [status-chip auto] [owner auto] [mini-stack auto] [open-cta auto]
//     .r6-drawer (paper-2 bg + 18×22px padding) when open
//
// Tier mini-stack lives in its OWN auto track as a flex group of
// `.tier-mini` cells (vertical label-above-value, right-aligned).
// NOT shared geometry with the cost stack header — the audit-corrected
// pattern (May 2026): cost stack uses repeat(N, 1fr) full-bleed;
// section row mini-stack is content-sized flex inside an auto track.
//
// Active tier signal in mini-stack: value text shifts ink-3 → ink +
// font-medium. NO border, NO bg, NO pill — pill register reserved for
// the cost stack tier card.

// R6 status chip is driven STRICTLY by kind enum (R6 source
// section-summary-row.jsx:18-23). No custom labels — the chip text
// IS the kind value with underscore stripped. Per Designer audit C-3.
export type StatusChip = {
  kind: "empty" | "in_progress" | "complete";
};

export type DepositRow = {
  quoteId: string;
  sectionKind: "packaging" | "production" | "bulk_raw";
  depositPct: string | null;
  depositAmount: string | null;
  depositStatus: "none" | "due" | "invoiced" | "paid" | "reconciled";
  depositInvoiceId: string | null;
};

type SectionKind = "packaging" | "production" | "bulk_raw" | "freight";

function fmtPerUnit(n: number): string {
  // R6 mini-stack shows per-unit currency: $1.84, $1.62, etc.
  // toLocaleString gives comma formatting for the rare $1,234.56 case;
  // 2 decimals for per-unit precision PMs negotiate with.
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function valueFor(
  sectionKind: SectionKind,
  rollup: ReturnType<typeof selectQuoteRollup>[number],
): number {
  switch (sectionKind) {
    case "packaging":
      return rollup.costBreakdown.packaging;
    case "production":
      return rollup.costBreakdown.production;
    case "freight":
      // Section header sums both buckets — Freight section is the
      // single input surface for both container freight and D+T;
      // the section's tier-total should reflect everything PMs
      // entered there. D+T splits out only at the cost-stack-header
      // row level (Slice RI.8 Option B+). costBreakdown.freight is
      // already the derived sum (= freightContainer + dutyAndTariff)
      // so this stays correct.
      return rollup.costBreakdown.freight;
    case "bulk_raw":
      // Cost-rollup doesn't yet break out RAW (UX_BACKLOG: Cost rollup
      // component breakout for RAW row).
      return 0;
  }
}

export function SectionWithDrilldown({
  id,
  name,
  sublabel,
  statusChip,
  tiers,
  sectionKind,
  ownerInitials,
  ownerName,
  lineCount,
  deposit,
  indicatorChip,
  children,
}: {
  id: string;
  name: string;
  sublabel: string;
  statusChip: StatusChip;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sectionKind: SectionKind;
  ownerInitials?: string;
  ownerName?: string;
  lineCount?: number;
  deposit?: DepositRow;
  /**
   * Optional explanatory chip rendered inline with the sublabel.
   * Used to surface "why the mini-stack reads em-dash even though
   * data exists" — e.g. Production when fees are billed separately.
   * Slice RI.8 Option A hotfix.
   */
  indicatorChip?: { label: string; tone: "warn" | "neutral" | "accent" };
  children: React.ReactNode;
}) {
  const { openId, setOpenId } = useCostBuildAccordion();
  const isOpen = openId === id;
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const activeTierId = useCostingStore(selectActiveTierId);

  const handleToggle = () => {
    setOpenId(isOpen ? null : id);
  };

  return (
    <article
      className={`r6-section overflow-hidden rounded-xl transition-colors ${
        isOpen ? "[&_.r6-section-row]:bg-paper-2 [&_.r6-section-row]:border-b [&_.r6-section-row]:border-rule" : ""
      }`}
      style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        className="r6-section-row grid w-full cursor-pointer items-center text-left transition-colors hover:bg-paper-2"
        style={{
          gridTemplateColumns: "32px 1fr auto auto auto auto",
          gap: "16px",
          padding: "16px 22px",
        }}
        aria-expanded={isOpen}
        aria-controls={`section-${id}-drawer`}
      >
        {/* Chevron (own track) */}
        <span
          aria-hidden
          className={`grid h-full place-items-center font-mono text-[12px] text-ink-3 transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          ›
        </span>

        {/* Head — name + meta sublabel + (deposit chip when present).
            R6 source `index.html:2643-2653`: head is flex column,
            gap 3px between name/meta. Name inherits body line-height
            (1.5) for vertical breathing — NOT leading-tight. */}
        <div
          className="flex min-w-0 flex-col"
          style={{ gap: "3px" }}
        >
          <div
            className="font-display text-ink"
            style={{
              fontSize: "18px",
              fontWeight: 500,
              letterSpacing: "-0.005em",
            }}
          >
            {name}
          </div>
          <div
            className="truncate font-mono text-ink-3"
            style={{ fontSize: "11px", letterSpacing: "0.04em" }}
          >
            {sublabel}
          </div>
          {(indicatorChip || (deposit && deposit.depositStatus !== "none")) && (
            <div
              style={{
                marginTop: "4px",
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
              }}
            >
              {indicatorChip && <IndicatorChip chip={indicatorChip} />}
              {deposit && deposit.depositStatus !== "none" && (
                <DepositChip deposit={deposit} />
              )}
            </div>
          )}
        </div>

        {/* Status chip */}
        <StatusChipView chip={statusChip} />

        {/* Owner — placeholder when no data per Path A.
            UX_BACKLOG entry "Cost section ownership data model"
            tracks the schema + assignment surface. */}
        <Owner initials={ownerInitials} name={ownerName} lineCount={lineCount} />

        {/* Mini-stack — flex group of tier-mini cells. Values are
            PER-UNIT (R6 cost-build-page.jsx lines 53-77 — tier values
            are per-unit cost contribution because that's the metric
            PMs negotiate with). Per-unit = costBreakdown / tier.qty. */}
        <div className="mini-stack flex items-center gap-3 font-mono text-[10.5px]">
          {tiers.map((t) => {
            const rollup = quoteRollup.find((r) => r.tierId === t.id);
            const tierTotal = rollup ? valueFor(sectionKind, rollup) : 0;
            const tierQty = t.qty ?? 0;
            const perUnit = tierQty > 0 ? tierTotal / tierQty : 0;
            const isActive = activeTierId === t.id;
            const isEmpty = perUnit <= 0;
            return (
              <div
                key={t.id}
                className="tier-mini flex flex-col items-end gap-[2px]"
                title={`${t.label}${t.qty !== null ? ` · ${t.qty.toLocaleString()} units` : ""}`}
              >
                <span className="text-[9px] uppercase tracking-[0.08em] text-ink-4">
                  {t.label}
                </span>
                <span
                  className={
                    isEmpty
                      ? "italic text-[10.5px] text-ink-4"
                      : isActive
                        ? "text-[12px] font-medium text-ink"
                        : "text-[12px] text-ink-3"
                  }
                >
                  {isEmpty ? "—" : fmtPerUnit(perUnit)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Open/Close cta — accent-ink when open */}
        <span
          className={`font-mono text-[10.5px] uppercase tracking-[0.05em] ${
            isOpen ? "text-accent-ink" : "text-ink-3"
          }`}
        >
          {isOpen ? "Close ↑" : "Open ↓"}
        </span>
      </button>

      {/* Drawer — paper-2 bg + 18px×22px padding per R6 lines 2706-2709.
          Always mounted; CSS toggles visibility (RI.4 perf fix). */}
      <div
        id={`section-${id}-drawer`}
        className={
          isOpen
            ? "r6-drawer bg-paper-2 px-[22px] pt-[18px] pb-[22px]"
            : "hidden"
        }
        role="region"
      >
        {children}
      </div>
    </article>
  );
}

function StatusChipView({ chip }: { chip: StatusChip }) {
  // R6 status-chip lines 2655-2665 + section-summary-row.jsx:18-23.
  // Text rendered = kind enum with underscore replaced (so "in_progress"
  // → "in progress", uppercased via CSS). No custom labels.
  const cls = (() => {
    switch (chip.kind) {
      case "empty":
        return "border-rule bg-paper-3 text-ink-4";
      case "in_progress":
        return "border-transparent bg-warn-soft text-warn";
      case "complete":
        return "border-transparent bg-good-soft text-good";
    }
  })();
  const dot =
    chip.kind === "complete" ? "●" : chip.kind === "in_progress" ? "◐" : "○";
  return (
    <span
      className={`status-chip inline-flex items-center gap-[5px] rounded-full border font-mono uppercase ${cls}`}
      style={{
        padding: "3px 8px",
        fontSize: "10px",
        letterSpacing: "0.06em",
      }}
    >
      <span aria-hidden style={{ fontSize: "9px" }}>
        {dot}
      </span>
      {chip.kind.replace("_", " ")}
    </span>
  );
}

function Owner({
  initials,
  name,
  lineCount,
}: {
  initials?: string;
  name?: string;
  lineCount?: number;
}) {
  // R6 owner block lines 2667-2678. 22px paper-3 circle with rule
  // border. Inline-style bg/border to bypass Tailwind v4 @theme
  // utility resolution issue (same pattern as cost stack outer).
  const hasOwner = !!initials && !!name;
  return (
    <div
      className="owner flex items-center font-mono"
      style={{
        gap: "6px",
        fontSize: "10.5px",
        letterSpacing: "0.04em",
        color: "var(--ink-3)",
      }}
    >
      <span
        aria-hidden
        className="inline-grid place-items-center rounded-full font-mono"
        style={{
          width: "22px",
          height: "22px",
          flexShrink: 0,
          background: "var(--paper-3)",
          border: "1px solid var(--rule)",
          fontSize: "9.5px",
          fontWeight: 600,
          color: "var(--ink-2)",
        }}
      >
        {hasOwner ? initials : ""}
      </span>
      <span style={{ color: hasOwner ? "var(--ink-3)" : "var(--ink-4)" }}>
        {hasOwner ? name : "Unassigned"}
      </span>
      {lineCount !== undefined && (
        <span style={{ marginLeft: "6px", color: "var(--ink-4)" }}>
          · {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
      )}
    </div>
  );
}

// Slice RI.8 Option A hotfix — generic indicator chip for surfacing
// "why em-dash" semantic context next to the sublabel. Used by
// Production section when services are billed separately
// (allocate_service_fees_to_cost=false) — explains the otherwise-
// confusing zero in the cost-stack PROD column.
function IndicatorChip({
  chip,
}: {
  chip: { label: string; tone: "warn" | "neutral" | "accent" };
}) {
  const cls =
    chip.tone === "warn"
      ? "border-transparent bg-warn-soft text-warn"
      : chip.tone === "accent"
        ? "border-transparent bg-accent-soft text-accent-ink"
        : "border-rule bg-paper-3 text-ink-3";
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-full border font-mono uppercase ${cls}`}
      style={{
        padding: "3px 7px",
        fontSize: "9.5px",
        letterSpacing: "0.06em",
      }}
      title={chip.label}
    >
      {chip.label}
    </span>
  );
}

function DepositChip({ deposit }: { deposit: DepositRow }) {
  // R6 deposit-chip lines 3281-3296: base = paper-3 + ink-3 + rule border;
  // outstanding = warn-soft + warn (transparent border); invoiced/paid =
  // good-soft + good (transparent border). NOT accent-soft for invoiced
  // (that was CC's drift). Per Designer content audit Concern 4.
  const { depositStatus, depositInvoiceId, depositAmount } = deposit;
  const label = (() => {
    switch (depositStatus) {
      case "due":
        return depositAmount
          ? `$${Number(depositAmount).toLocaleString()} deposit due`
          : "Deposit due";
      case "invoiced":
        return depositInvoiceId
          ? `Deposit invoiced · ${depositInvoiceId}`
          : "Deposit invoiced";
      case "paid":
        return depositInvoiceId
          ? `Deposit paid · ${depositInvoiceId}`
          : "Deposit paid";
      case "reconciled":
        return "Deposit reconciled";
      default:
        return "";
    }
  })();
  const cls = (() => {
    switch (depositStatus) {
      case "due":
        return "border-transparent bg-warn-soft text-warn";
      case "invoiced":
        return "border-transparent bg-good-soft text-good";
      case "paid":
        return "border-transparent bg-good-soft text-good";
      case "reconciled":
        return "border-rule bg-paper-3 text-ink-3";
      default:
        return "border-rule bg-paper-3 text-ink-3";
    }
  })();
  return (
    <span
      className={`r6-deposit-chip inline-flex items-center gap-[5px] rounded-full border font-mono uppercase ${cls}`}
      style={{
        padding: "3px 7px",
        fontSize: "9.5px",
        letterSpacing: "0.06em",
      }}
      title={`Deposit status: ${depositStatus}`}
    >
      {label}
    </span>
  );
}
