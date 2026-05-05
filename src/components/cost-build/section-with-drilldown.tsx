import Link from "next/link";
import { SectionMiniStack } from "./section-mini-stack";

// Slice RI.4 — Section row anatomy per Round 6 Change B (summary-with-
// drill-down architecture). One drawer open at a time per page; drawer
// state stored in URL searchParam (?section=<id>) for deep-linkability +
// page-refresh persistence.
//
// Composition (left to right):
//   - Chevron (expand affordance; rotates when open)
//   - Section name + sublabel (compact metadata: line count + key flags)
//   - Per-tier mini-stack (per Designer audit C-5; reads from
//     quoteRollup costBreakdown — section-specific component values)
//   - Status chip (complete / in_progress / empty)
//   - Owner badge — DEFERRED to RI.4 follow-up (needs per-section owner
//     schema; not in 0019 migration; PR description carries the defer)
//   - Open/Close CTA (mirrors chevron click)
//   - Deposit badge (when section has deposit configured)
//
// Drawer holds the full input form for that section (passed as children).

export type StatusChip = {
  label: string;
  tone: "neutral" | "active" | "complete";
};

export type DepositRow = {
  quoteId: string;
  sectionKind: "packaging" | "production" | "bulk_raw";
  depositPct: string | null;
  depositAmount: string | null;
  depositStatus: "none" | "due" | "invoiced" | "paid" | "reconciled";
  depositInvoiceId: string | null;
};

export function SectionWithDrilldown({
  id,
  name,
  sublabel,
  statusChip,
  tiers,
  quoteId,
  projectId,
  sectionKind,
  deposit,
  isOpen,
  children,
}: {
  id: string;
  name: string;
  sublabel: string;
  statusChip: StatusChip;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  quoteId: string;
  projectId: string;
  sectionKind: "packaging" | "production" | "bulk_raw" | "freight";
  deposit?: DepositRow;
  isOpen: boolean;
  children: React.ReactNode;
}) {
  // Toggle href: when open, clicking ?section=<id> link with the
  // empty section param closes; when closed, opening sets the param.
  const toggleHref = isOpen
    ? `/projects/${projectId}/quotes/${quoteId}/cost-build`
    : `/projects/${projectId}/quotes/${quoteId}/cost-build?section=${id}`;

  return (
    <article className="overflow-hidden rounded border border-rule bg-paper">
      {/* Summary header */}
      <Link
        href={toggleHref}
        scroll={false}
        className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-2 ${
          isOpen ? "border-b border-rule bg-paper-2" : ""
        }`}
      >
        {/* Chevron */}
        <span
          aria-hidden
          className={`text-ink-3 transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>

        {/* Name + sublabel */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg text-ink">{name}</h2>
            <span className="font-mono text-[10px] uppercase tracking-wide text-ink-4">
              {sublabel}
            </span>
          </div>
        </div>

        {/* Per-tier mini-stack — load-bearing per R6 Pushback #1
            (PMs scan section-level cost preview without opening drawer).
            Reads section-specific costBreakdown values from quoteRollup. */}
        <SectionMiniStack tiers={tiers} sectionKind={sectionKind} />

        {/* Status chip */}
        <StatusChipView chip={statusChip} />

        {/* Deposit badge (only when present + non-none status) */}
        {deposit && deposit.depositStatus !== "none" && (
          <DepositBadge deposit={deposit} />
        )}

        {/* Open/Close CTA — mirrors chevron */}
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-3">
          {isOpen ? "Close" : "Open"}
        </span>
      </Link>

      {/* Drawer — only renders content when open */}
      {isOpen && <div className="p-4">{children}</div>}
    </article>
  );
}

function StatusChipView({ chip }: { chip: StatusChip }) {
  const cls = {
    neutral: "border-rule bg-paper-3 text-ink-3",
    active: "border-accent/40 bg-accent-soft text-accent-ink",
    complete: "border-good/40 bg-good-soft text-good",
  }[chip.tone];
  return (
    <span
      className={`rounded border px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {chip.label}
    </span>
  );
}

function DepositBadge({ deposit }: { deposit: DepositRow }) {
  const { depositStatus, depositInvoiceId, depositAmount } = deposit;
  const label = (() => {
    switch (depositStatus) {
      case "due":
        return depositAmount
          ? `$${Number(depositAmount).toLocaleString()} DEPOSIT DUE`
          : "DEPOSIT DUE";
      case "invoiced":
        return depositInvoiceId
          ? `DEPOSIT INVOICED · ${depositInvoiceId}`
          : "DEPOSIT INVOICED";
      case "paid":
        return "DEPOSIT PAID";
      case "reconciled":
        return "DEPOSIT RECONCILED";
      default:
        return "";
    }
  })();
  const cls = {
    due: "border-warn/40 bg-warn-soft text-warn",
    invoiced: "border-accent/40 bg-accent-soft text-accent-ink",
    paid: "border-good/40 bg-good-soft text-good",
    reconciled: "border-rule bg-paper-3 text-ink-3",
  }[depositStatus as "due" | "invoiced" | "paid" | "reconciled"];
  return (
    <span
      className={`rounded border px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide ${cls}`}
      title={`Deposit status: ${depositStatus}`}
    >
      {label}
    </span>
  );
}
