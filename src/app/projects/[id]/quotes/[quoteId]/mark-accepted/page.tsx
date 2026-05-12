import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { MarkAcceptedHost, type MarkAcceptedSubState } from "@/components/mark-accepted/mark-accepted-host";
import type { TierCardData } from "@/components/mark-accepted/tier-card";
import type { FlaggedLine } from "@/components/mark-accepted/mark-accepted-both-gates";

// Slice RI.6 — Mark-Accepted page.
// Visual shell + state-switcher (dev/non-prod). Most behavioral
// commitments deferred to Slice 12 (Mark-Accepted action, gates,
// override workflow, snapshot logic, HubSpot writeback).
// See brief §3.8.

const VALID_SUBSTATES: ReadonlyArray<MarkAcceptedSubState> = [
  "good",
  "awaitingMark",
  "bothGates",
  "pending",
  "locked",
];

function statusToSubState(
  s: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR",
  isAccepted: boolean,
  hasCustomerAcceptance: boolean,
): MarkAcceptedSubState {
  if (isAccepted) return "locked";
  if (s === "BELOW_FLOOR") return "bothGates";
  // Slice RI.7 — customer signal recorded but no override gate to clear
  // → awaitingMark (PM finalizes with affirmation chip). Below-target
  // is still sendable so it falls into awaitingMark when applicable.
  if (hasCustomerAcceptance) return "awaitingMark";
  return "good";
}

export default async function MarkAcceptedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{ dev?: string; state?: string }>;
}) {
  const { id: projectId, quoteId } = await params;
  const { dev, state } = await searchParams;

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    return (
      <main style={{ padding: "32px 24px" }}>
        <h1>Mark-Accepted unavailable</h1>
        <p style={{ color: "var(--bad)" }}>{bundle.error.message}</p>
      </main>
    );
  }

  const summary = bundle.data.costing.quoteSummary;
  const firmFloor = bundle.data.firmSettings.floorMarginPct;
  const effectiveTarget = summary.effectiveTargetMarginPct;

  // TODO(Slice 9.5): when the validation engine ships, replace this
  // inline derivation with engine output. Engine emits structured rows
  // with the firing rule (BLENDED_BELOW_FLOOR / MARGIN_BELOW_FLOOR / ...)
  // attached, so the `rule` field stops being a hardcoded literal.
  // Until then: any per-(SKU, tier) cell whose marginStatus is
  // BELOW_FLOOR shows up here.
  const flaggedLines: FlaggedLine[] = [];
  for (const sku of bundle.data.costing.skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const pt of sku.perTier) {
      if (pt.marginStatus === "BELOW_FLOOR") {
        const tier = bundle.data.costing.tiers.find(
          (t) => t.tierId === pt.tierId,
        );
        flaggedLines.push({
          sku: sku.skuLabel,
          tier: tier?.label ?? "—",
          marginPct: pt.marginPct * 100,
          rule: "MARGIN_BELOW_FLOOR",
        });
      }
    }
  }

  // Build TierCardData per tier — qty + per-tier blended unit price + total.
  const tierData: TierCardData[] = bundle.data.costing.quoteRollup.map((qr) => {
    const unitPrice = qr.qty > 0 ? qr.totalRevenue / qr.qty : 0;
    const cls: TierCardData["status"] =
      qr.blendedMarginStatus === "GOOD"
        ? "good"
        : qr.blendedMarginStatus === "BELOW_TARGET"
          ? "warn"
          : "bad";
    return {
      id: qr.tierId,
      label: qr.label,
      qty: qr.qty,
      unitPrice,
      total: qr.totalRevenue,
      marginPct: qr.blendedMarginPct * 100,
      status: cls,
    };
  });

  // Recommended tier: middle tier as placeholder. Slice 11/12 wires real flag.
  if (tierData.length > 0) {
    const recIdx = Math.floor(tierData.length / 2);
    tierData[recIdx] = { ...tierData[recIdx], recommended: true };
  }

  const blendedPct = summary.blendedMarginPct * 100;
  const isAccepted = quote.scenarioStatus === "accepted";

  // Slice RI.7 — customer-acceptance context (CR-SM DEC-1 + DEC-6).
  // Drives awaitingMark sub-state + the affirmation chip when present.
  const customerAcceptance =
    quote.customerAcceptedAt && quote.customerAcceptedTierId
      ? (() => {
          const tier = tierData.find(
            (t) => t.id === quote.customerAcceptedTierId,
          );
          return tier
            ? {
                tierId: tier.id,
                tierLabel: tier.label,
                recordedAt: quote.customerAcceptedAt!,
              }
            : null;
        })()
      : null;

  // Sub-state resolution: explicit ?state= override (dev), else derived.
  let initialSubState = statusToSubState(
    summary.blendedMarginStatus,
    isAccepted,
    customerAcceptance !== null,
  );
  if (state && (VALID_SUBSTATES as ReadonlyArray<string>).includes(state)) {
    initialSubState = state as MarkAcceptedSubState;
  }

  const showStateSwitcher =
    dev === "1" || process.env.NODE_ENV !== "production";

  // Real quote_number when sent+; falls back to scenario·version
  // label for drafts (Mark-Accepted page generally won't render for
  // drafts, but the header copy stays valid).
  const quoteNumberLabel =
    quote.quoteNumber ?? `${quote.scenarioLabel} · v${quote.versionNumber}`;

  return (
    <>
      {/* F-7 (Slice RI.8 step 7): breadcrumb adopts mono-caption
          register via .r2-eyebrow — same shape as Quote page,
          consistent across customer-facing surface family. */}
      <p
        className="r2-eyebrow"
        style={{ padding: "16px 24px 0" }}
      >
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}`}
          style={{ color: "var(--ink-3)" }}
        >
          ← Setup
        </Link>
        {" · "}
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}/pricing`}
          style={{ color: "var(--ink-3)" }}
        >
          Pricing
        </Link>
        {" · "}
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}/quote`}
          style={{ color: "var(--ink-3)" }}
        >
          Quote
        </Link>
        {" · Mark accepted"}
      </p>
      <MarkAcceptedHost
        initialSubState={initialSubState}
        blendedMarginPct={blendedPct}
        status={summary.blendedMarginStatus}
        targetPct={effectiveTarget}
        floorPct={firmFloor}
        tiers={tierData}
        customerName={project.clientName ?? "(customer pending)"}
        quoteNumber={quoteNumberLabel}
        flaggedLines={flaggedLines}
        activeSiblings={[]}
        customerAcceptance={customerAcceptance}
        showStateSwitcher={showStateSwitcher}
      />
    </>
  );
}
