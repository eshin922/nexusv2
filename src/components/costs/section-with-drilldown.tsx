"use client";

import { useRef } from "react";
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
  // Slice RI.8 Option 2 — section mini-stack reads MARKED-UP per-
  // component primitives so it matches cost-stack rows + drilldown
  // TOTAL across the three display surfaces. Math layer is the
  // single source of truth; no display-layer approximations.
  const b = rollup.costBreakdown;
  switch (sectionKind) {
    case "packaging":
      return b.packagingMarkupSum;
    case "production":
      // Production section bundles raw bulk + production service
      // fees (matches breakdown.production cost-side folding).
      return b.productionMarkupSum;
    case "freight":
      // Section header sums container + D+T marked-up contributions;
      // Freight section is the single input surface for both. Cost-
      // stack splits the two visually into FRT + D+T rows.
      return b.freightContainerMarkupSum + b.dutyAndTariffMarkupSum;
    case "bulk_raw":
      // RAW row deferred (UX_BACKLOG: companion restoration with the
      // dps_sources mode primitives).
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

  // Slice 11.5.1 MIG-8 instrumentation — consumer render log. Strip
  // after MIG-8 PASS. Compares quoteRollup ref + content across
  // renders; if STORE NOTIFY fires (see provider) but this log
  // doesn't, the React subscription wiring is the break (different
  // store identity between provider and useStore).
  const renderCountRef = useRef(0);
  const prevRollupRef = useRef(quoteRollup);
  renderCountRef.current += 1;
  // eslint-disable-next-line no-console
  console.log(
    `[rt-consumer] SectionCard render #${renderCountRef.current} id=${id} rollupRefChanged=${prevRollupRef.current !== quoteRollup} rollup.length=${quoteRollup.length} rollup[0].totalCost=${quoteRollup[0]?.totalCost ?? "n/a"}`,
  );
  prevRollupRef.current = quoteRollup;

  const handleToggle = () => {
    setOpenId(isOpen ? null : id);
  };

  // Canonical .r6-section rules (6styles.css L324-329) provide paper bg
  // + 1px rule border + 12px radius + overflow hidden. .r6-section.open
  // descendant rules drive the row bg-shift + bottom rule (L340-343).
  // .r6-section-row rules (L331-338) provide the 32/1fr/auto×4 grid +
  // 16px gap + 16/22 padding + cursor + 80ms transition; :hover bg
  // shift (L339). Chevron rotation handled by .r6-section.open .chev
  // (L350). Class register matches canonical verbatim.
  return (
    <article className={`r6-section${isOpen ? " open" : ""}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="r6-section-row"
        style={{
          width: "100%",
          textAlign: "left",
          border: "none",
          outline: "none",
          font: "inherit",
          color: "inherit",
        }}
        aria-expanded={isOpen}
        aria-controls={`section-${id}-drawer`}
      >
        <span aria-hidden className="chev">
          ›
        </span>

        {/* Head — canonical .head provides flex column + 3px gap;
            .head .name supplies display 18/500/-0.005em ink; .head
            .meta supplies mono 11 ink-3 / 0.04em letter-spacing. */}
        <div className="head" style={{ minWidth: 0 }}>
          <div className="name">{name}</div>
          <div
            className="meta"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sublabel}
          </div>
          {(indicatorChip || (deposit && deposit.depositStatus !== "none")) && (
            <div className="r6-badges" style={{ marginTop: 4 }}>
              {indicatorChip && <IndicatorChip chip={indicatorChip} />}
              {deposit && deposit.depositStatus !== "none" && (
                <DepositChip deposit={deposit} />
              )}
            </div>
          )}
        </div>

        <StatusChipView chip={statusChip} />

        <Owner initials={ownerInitials} name={ownerName} lineCount={lineCount} />

        {/* Mini-stack — canonical .mini-stack provides flex + 12px gap
            + mono 10.5; .tier-mini flex column right-aligned with 2px
            gap; .tier-mini .lbl 9/0.08em uppercase ink-4 + .tier-mini
            .val 12 ink-3; .tier-mini.active .val ink + 500; .val.empty
            ink-4 italic 10.5. Per-unit = costBreakdown / tier.qty
            (PMs negotiate at per-unit). */}
        <div className="mini-stack">
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
                className={`tier-mini${isActive ? " active" : ""}`}
                title={`${t.label}${t.qty !== null ? ` · ${t.qty.toLocaleString()} units` : ""}`}
              >
                <span className="lbl">{t.label}</span>
                <span className={`val${isEmpty ? " empty" : ""}`}>
                  {isEmpty ? "—" : fmtPerUnit(perUnit)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Open/Close cta — canonical .open-cta sets mono 10.5 / 0.05em
            uppercase; .r6-section.open .open-cta shifts to accent-ink. */}
        <span className="open-cta">
          {isOpen ? "Close ↑" : "Open ↓"}
        </span>
      </button>

      {/* Drawer — canonical .r6-drawer provides paper-2 bg + 18/22/22
          padding (L415-418). Hidden when closed (CSS toggle preserved
          for perf). */}
      <div
        id={`section-${id}-drawer`}
        className={isOpen ? "r6-drawer" : "hidden"}
        role="region"
      >
        {children}
      </div>
    </article>
  );
}

// Canonical .status-chip rules (6styles.css L364-374) provide mono 10
// / 0.06em / 3-8 padding / pill radius / paper-3 bg / ink-3 / 1px rule
// border / uppercase / inline-flex / 5px gap. Modifier classes (empty
// / in_progress / complete) shift bg + color per kind. No inline.
function StatusChipView({ chip }: { chip: StatusChip }) {
  const dot =
    chip.kind === "complete" ? "●" : chip.kind === "in_progress" ? "◐" : "○";
  return (
    <span className={`status-chip ${chip.kind}`}>
      <span aria-hidden style={{ fontSize: "9px" }}>
        {dot}
      </span>
      {chip.kind.replace("_", " ")}
    </span>
  );
}

// Canonical .owner rules (6styles.css L376-387) provide flex + 6px gap
// + mono 10.5 / 0.04em ink-3; .owner .av is 22×22 paper-3 / 1px rule /
// 50% radius / mono 9.5 ink-2 600. No inline.
function Owner({
  initials,
  name,
  lineCount,
}: {
  initials?: string;
  name?: string;
  lineCount?: number;
}) {
  const hasOwner = !!initials && !!name;
  return (
    <div className="owner">
      <span aria-hidden className="av">
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

// Canonical .r6-badge rules (6styles.css L822-831) provide inline-flex
// + 4px gap + mono 10 / 0.05em / 2-7 padding / pill radius / paper-3 +
// ink-3 + 1px rule base; .warn / .good / .accent variant shifts bg +
// color (transparent border for soft variants). Slice RI.8 Option A
// hotfix — generic indicator chip for surfacing "why em-dash" semantic
// context next to the sublabel.
function IndicatorChip({
  chip,
}: {
  chip: { label: string; tone: "warn" | "neutral" | "accent" };
}) {
  const variant =
    chip.tone === "warn" ? "warn" : chip.tone === "accent" ? "accent" : "";
  return (
    <span
      className={`r6-badge${variant ? ` ${variant}` : ""}`}
      title={chip.label}
    >
      {chip.label}
    </span>
  );
}

// Canonical .r6-badge with warn/good/neutral variant per status. R6
// source content-audit Concern 4: due → warn, invoiced/paid → good,
// reconciled/base → neutral (paper-3 + ink-3 + rule).
function DepositChip({ deposit }: { deposit: DepositRow }) {
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
  const variant =
    depositStatus === "due"
      ? "warn"
      : depositStatus === "invoiced" || depositStatus === "paid"
        ? "good"
        : "";
  return (
    <span
      className={`r6-badge${variant ? ` ${variant}` : ""}`}
      title={`Deposit status: ${depositStatus}`}
    >
      {label}
    </span>
  );
}
