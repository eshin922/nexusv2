import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quoteTiers, quotes } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import type { QuoteMarginStatus } from "@/lib/costing";
import { MarkAcceptedHost, type MarkAcceptedSubState } from "@/components/mark-accepted/mark-accepted-host";
import { Eyebrow } from "@/components/nav/eyebrow";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { NavShell } from "@/components/nav/nav-shell";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
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
  s: QuoteMarginStatus,
  isAccepted: boolean,
  hasCustomerAcceptance: boolean,
): MarkAcceptedSubState {
  if (isAccepted) return "locked";
  // UNAVAILABLE deliberately does NOT open the below-floor gate. A quote with
  // no revenue has not breached the floor; it has not been measured against
  // it. The verdict strip renders the absence, and the workflow proceeds
  // through the ordinary path rather than demanding an override for a
  // violation that was never established.
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
  // 2026-06-17 prod-hang Vercel-side instrumentation. Critical
  // because Slice 12's Mark-Accepted writeback flow depends on
  // this page rendering reliably (per CA scope discussion).
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const { dev, state } = await searchParams;
  const tag = quoteId.slice(0, 8);
  console.log(`[mark-accepted:${tag}] start memory=${heapMb()}MB`);

  try {
  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "mark_accepted",
  });
  console.log(
    `[mark-accepted:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`,
  );

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();
  console.log(
    `[mark-accepted:${tag}] post-meta ${elapsed()} memory=${heapMb()}MB`,
  );

  const bundle = await getCostingBundle(quoteId);
  console.log(
    `[mark-accepted:${tag}] post-bundle ${elapsed()} memory=${heapMb()}MB`,
  );
  if (!bundle.ok) {
    console.log(
      `[mark-accepted:${tag}] pre-render(error) ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <NavShell
        surfaceKey="mark_accepted"
        projectId={projectId}
        quoteId={quoteId}
        activeScenarioLabel={quote.scenarioLabel}
      >
      <main style={{ padding: "32px 24px" }}>
        <h1>Mark-Accepted unavailable</h1>
        <p style={{ color: "var(--bad)" }}>{bundle.error.message}</p>
      </main>
      </NavShell>
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
          // Non-null by the BELOW_FLOOR branch above — a band is only assigned
          // to a margin that exists — written so the compiler agrees rather
          // than being told.
          marginPct: (pt.marginPct ?? 0) * 100,
          rule: "MARGIN_BELOW_FLOOR",
        });
      }
    }
  }

  // Build TierCardData per tier — qty + per-tier blended unit price + total.
  const tierData: TierCardData[] = bundle.data.costing.quoteRollup.map((qr) => {
    const unitPrice = qr.qty > 0 ? qr.totalRevenue / qr.qty : 0;
    // UNAVAILABLE takes the neutral class rather than the `bad` else-branch —
    // a tier with no revenue has not failed the floor, it has not been priced.
    const cls: TierCardData["status"] =
      qr.blendedMarginStatus === "GOOD"
        ? "good"
        : qr.blendedMarginStatus === "BELOW_TARGET"
          ? "warn"
          : qr.blendedMarginStatus === "UNAVAILABLE"
            ? "none"
            : "bad"; // BELOW_FLOOR and COST_WITHOUT_REVENUE
    return {
      id: qr.tierId,
      label: qr.label,
      qty: qr.qty,
      unitPrice,
      total: qr.totalRevenue,
      marginPct:
        qr.blendedMarginPct === null ? null : qr.blendedMarginPct * 100,
      status: cls,
    };
  });

  // The recommended tier, as recorded — and NOT invented when there is none.
  //
  // A legacy fallback used to default to the middle tier
  // (`Math.floor(tierData.length / 2)`) "so Mark-Accepted always surfaces a
  // recommendation". It always surfaced one; it just was not the firm's. This
  // is the same fabrication Item 1 removed from the customer PDF, which had
  // defaulted to index 0 — position is not a recommendation, and a quote with
  // none has none.
  //
  // Its comment also told the reader to override "via the ★ toggle on Setup",
  // which no longer exists: the recommendation is set on Pricing, where the
  // three figures that depend on it are. A fallback whose escape hatch has
  // moved is a fallback nobody can get out of.
  const tierRecommendedRows = await db
    .select({ id: quoteTiers.id, recommended: quoteTiers.recommended })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quote.id));
  const recommendedTierId =
    tierRecommendedRows.find((t) => t.recommended)?.id ?? null;
  if (recommendedTierId) {
    const idx = tierData.findIndex((t) => t.id === recommendedTierId);
    if (idx !== -1) {
      tierData[idx] = { ...tierData[idx], recommended: true };
    }
  }

  // Null stays null through the unit conversion. `null * 100` is 0 in
  // JavaScript, which is exactly the fabrication this correction removes.
  const blendedPct =
    summary.blendedMarginPct === null ? null : summary.blendedMarginPct * 100;
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

  // Slice RI.9 § 3.3 — banner state for Mark-Accepted.
  //   - terminal (post-acceptance): explicit "Terminal — return via
  //     Home or rail" copy, no CTA.
  //   - default (pre-acceptance): "Confirm acceptance →" CTA (same
  //     primary action). Banner reinforces the primary; cluster keeps
  //     the primary button.
  //   - Override-gated states render the banner with gated styling
  //     (handled at sub-state level if needed); v1 default = default.
  // Reuses `isAccepted` from the sub-state derivation above.
  const bannerState: "default" | "terminal" = isAccepted
    ? "terminal"
    : "default";
  console.log(
    `[mark-accepted:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`,
  );
  return (
    <NavShell
      surfaceKey="mark_accepted"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
      {/* Slice RI.9 § 3.1 — Eyebrow per R7a canon. Replaces RI.8 F-7
          breadcrumb-style backlink chain. Mark-Accepted has
          rail.visible=true so inner rail is the where-am-I anchor;
          eyebrow carries surface context. */}
      <div style={{ padding: "16px 24px 0" }}>
        <Eyebrow
          segments={[
            project.clientName ?? project.dealName,
            quote.scenarioLabel,
            `v${quote.versionNumber}`,
            "Mark accepted",
          ]}
        />
      </div>
      {/* Slice RI.9 § 3.3 — banner. Terminal state when accepted
          (explicit silence per R7a); default pre-acceptance points
          at primary CTA. */}
      <div style={{ padding: "12px 24px 0" }}>
        <YourNextMoveBanner
          state={bannerState}
          label={
            bannerState === "default"
              ? SURFACE_META.mark_accepted.nextMove?.label
              : undefined
          }
          // Mark-Accepted's primary fires from within the host's
          // sub-state components — the banner CTA links to the
          // same surface (self) for now; sub-state components own
          // the actual confirm action via accept-confirm-modal.
          // UX_BACKLOG: wire banner CTA to open the confirm modal
          // directly once Mark-Accepted refactor lands.
          href={resolveSurfaceHref("mark_accepted", project.id, quote.id)}
        />
      </div>
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
    </NavShell>
  );
  } catch (e) {
    console.error(
      `[mark-accepted:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`,
      e,
    );
    throw e;
  }
}
