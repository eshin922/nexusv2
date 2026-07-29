"use client";

// Slice 12 Step 8c-4 — Sales Order sub-tab body, LIVE send.
//
// Base: Pattern 30 port of R9 canonical SalesOrderTab in
// docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:382-606.
// Step 8b built the receipt against fixtures; Step 8c-4 wires the
// send button to markComplete (Step 8c-3) and swaps every stubbed
// placeholder for the real value.
//
// R9 §6 LOAD-BEARING items respected:
//   #1 — Tier choice at capture (customer_accepted_tier_id), tier
//        commitment at the lock (accepted_tier_id, 8c). This tab
//        renders the CARRIED intent as a receipt.
//   #2 — Deliberate handoff: entry from Acceptance advance is an
//        explicit PM click naming the tier ("Review Sales Order ·
//        Tier N →"); no auto-navigation.
//   #3 — Heavy/light asymmetry: the receipt + dark-slab CTA + dark-
//        header modal (SendOrderModal) collectively carry the
//        weight the typed FINALIZE gate used to.
//   #8 (new) — The receipt itself is load-bearing. Full lines, real
//        totals, NetSuite account, three-row ledger.
//   #9 (new) — Failed state IS A TAB, not a modal. Split banner
//        holds both facts (deal closed / order not placed) with
//        equal weight.
//
// Fidelity manifest — Nexus adaptations (flagged per CA):
//   1. Two-reason `disabledReasons` shape (stub gate + below-floor
//      guard) — CD's R9 canon has a single disabled reason. Nexus
//      needs the compound because the Send button is gated by TWO
//      independent conditions (readiness of the writer + tier
//      compliance). Below-floor is the ONLY remaining reason as of
//      8c-4 — stub-gate was retired when the writer went live.
//   2. Persistent-failed-state re-render — R9 canon models the
//      failed state as an in-session response to a Send attempt.
//      Nexus reads netsuite_so_pushes / quote row mirrors so the
//      tab renders the failed variant on a fresh page load after a
//      prior failed attempt (see `soPushMirror` + `latestPush`).
//   3. Cross-attempt error surface (persistedError + inFlightError)
//      — R9 canon shows the error inline once. Nexus preserves the
//      last persisted error across reloads AND surfaces in-flight
//      errors from the current attempt.
//
// Boundary: this tab is PM-INTERNAL (sub-tab 5); reads PM-facing
// props (quoteRollup, hubspot amount from audit_log, real NS state
// from quote-row + preflight). Never routes through the customer-
// view projection.

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CustomerView } from "@/types/quote";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { PreflightResult } from "@/lib/netsuite/sales-order-preflight";
import { markComplete } from "@/app/actions/quotes";
import { AdvanceBar } from "./advance-bar";
import { OrderReceipt } from "./order-receipt";
import type { OrderReceiptFlag, OrderReceiptLine, OrderReceiptOneTime, ReceiptState } from "./order-receipt";
import { SendOrderModal } from "./send-order-modal";
import type { SubTabId } from "./subtabs";

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Reading `?dev=1&so-state=…&so-flags=…` for the state switcher.
// Only active when the umbrella's dev switcher is enabled (which
// itself is server-hard-guarded on VERCEL_ENV !== 'production').
// Production reads see the state derived from real props.
//
// Slice 12 Step 9: `so-failed-at=item_group` URL axis fully
// removed (parser, fixture URLs, dev docs). Flat-lines has one
// failure shape; no discriminator. Probes 5 → 7 reopened the
// grouped-SO path via the priced-member route, but even under
// that path the failure surfaces uniformly through the SO POST
// step. When grouped-SO ships (whichever of routes a/b/c lands),
// its failure discriminator will be rebuilt from that step's
// actual surface — not carried forward from the 8b dev-only
// axis which was a lie by then anyway.
//
// Post-CB round 1 (P0 + P1): dev flags no longer render as literal
// visual overlays. Instead they mutate the underlying real-state
// pointers (effective preflight + effective carried tier) so that
// flag chips, account panel, and Send-disable ALL derive from a
// SINGLE source. Prevents "flag says not-mapped, panel says
// matched" contradictions.
function parseDevAxes(
  showStateSwitcher: boolean,
  params: URLSearchParams | null,
): {
  variant: ReceiptState | null;
  forceBelowFloor: boolean;
  forceUnmatched: boolean;
} {
  if (!showStateSwitcher || !params) {
    return { variant: null, forceBelowFloor: false, forceUnmatched: false };
  }
  const rawState = params.get("so-state");
  const variant: ReceiptState | null =
    rawState === "failed" || rawState === "record" || rawState === "pending"
      ? rawState
      : null;
  const rawFlags = params.get("so-flags");
  const forceBelowFloor = rawFlags === "below_floor" || rawFlags === "both";
  const forceUnmatched = rawFlags === "unmatched" || rawFlags === "both";
  return { variant, forceBelowFloor, forceUnmatched };
}

export type TabSalesOrderProps = {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  quoteVersionNumber: number;
  quoteNumberDb: string | null;
  quoteAcceptedAt: Date | null;
  /** Slice 12 Step 8a carry — the tier the customer named at
   * acceptance. Powers the CARRIED tier block; sub-tab 5 renders
   * the receipt against this tier by default. */
  customerAcceptedTierIdDb: string | null;
  quoteRollup: QuotePerTierRollup[];
  /** Slice 12 Step 8b — the target-stage label resolved in 8a for
   * the "Now · HubSpot" system card copy; reused here on the status
   * ledger's HubSpot row. */
  hubspotAcceptStageLabel: string;
  /** Slice 12 Step 8b — the amount 8a pushed to HubSpot at
   * acceptance. Reads from audit_log's quote_accepted diff_json.
   * Currently threaded from page.tsx via a lookup helper. */
  hubspotPushedAmount: number | null;
  /** Slice 12 Step 8c-4 — firm_settings.netsuite_so_status_on_create
   * effective value (e.g. "Pending Fulfillment"). Was hardcoded in
   * this file pre-8c-4; server-resolved so the receipt + confirm
   * modal reflect the firm's real configuration. */
  netsuiteStatusOnPush: string;
  /** Slice 12 Step 8c-4 — pre-flight state (customer-map resolution,
   * ship-to line, latest netsuite_so_pushes row). Null when the
   * quote status is neither accepted nor complete (tab is
   * un-reachable in that state). */
  salesOrderPreflight: PreflightResult | null;
  /** Slice 12 Step 8c-4 — quote row mirror of the last SO push.
   * pushStatus 'succeeded' → record variant; 'failed' → failed
   * variant. */
  soPushMirror: {
    soId: string | null;
    soTranid: string | null;
    pushedAt: Date | null;
    pushStatus: string | null;
    pushError: string | null;
  };
  showStateSwitcher: boolean;
  onGo: (id: SubTabId) => void;
};

export function TabSalesOrder({
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  quoteNumberDb,
  quoteAcceptedAt,
  customerAcceptedTierIdDb,
  quoteRollup,
  hubspotAcceptStageLabel,
  hubspotPushedAmount,
  netsuiteStatusOnPush,
  salesOrderPreflight,
  soPushMirror,
  showStateSwitcher,
  onGo,
}: TabSalesOrderProps) {
  const router = useRouter();
  const [modal, setModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [inFlightError, setInFlightError] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const searchParams = useSearchParams();
  const { variant: devVariant, forceBelowFloor, forceUnmatched } = parseDevAxes(
    showStateSwitcher,
    searchParams,
  );

  const isAccepted = quoteStatus === "accepted";
  const isComplete = quoteStatus === "complete";

  // ── Real state derivation ─────────────────────────────────────
  // Variant priority: quote status is authoritative. When status is
  // 'complete' → record; when a failed push exists and status is
  // still 'accepted' → failed; otherwise pending. Dev switcher
  // overrides all three (hard-guarded via showStateSwitcher).
  const hasFailedPush = soPushMirror.pushStatus === "failed" && !isComplete;
  const realVariant: ReceiptState = isComplete
    ? "record"
    : hasFailedPush
      ? "failed"
      : "pending";
  const variant: ReceiptState = devVariant ?? realVariant;

  // Resolve the carried tier (customer_accepted_tier_id or fallback
  // to first available). All the receipt renders against this tier.
  const realCarriedTier =
    (customerAcceptedTierIdDb
      ? quoteRollup.find((t) => t.tierId === customerAcceptedTierIdDb)
      : undefined) ?? quoteRollup[0];

  // ── Dev-switcher synthetic overrides (P0 + P1 fix, post-CB) ──
  // Apply the ?so-flags= URL axis by MUTATING the effective pointers
  // that downstream derivations read from. Flags render naturally,
  // account panel reflects the same state, Send-disable fires the
  // same way. No parallel "visual override" path — one source, no
  // contradictions.
  const carriedTier =
    forceBelowFloor && realCarriedTier
      ? {
          ...realCarriedTier,
          blendedMarginStatus: "BELOW_FLOOR" as const,
        }
      : realCarriedTier;
  const effectivePreflight: PreflightResult | null =
    forceUnmatched && salesOrderPreflight
      ? {
          ...salesOrderPreflight,
          netsuiteCustomer: salesOrderPreflight.netsuiteCustomer
            ? {
                id: "—",
                name:
                  salesOrderPreflight.netsuiteCustomer.name ??
                  salesOrderPreflight.hubspotCompanyName ??
                  "—",
                matched: false,
                matchedOn: null,
              }
            : null,
          shipToLine: salesOrderPreflight.hubspotCompanyName
            ? `${salesOrderPreflight.hubspotCompanyName} · address resolves at send`
            : "Ship-to resolves when the customer is mapped",
        }
      : salesOrderPreflight;

  // Derive product lines from the customer view. Leaves only; tier
  // prices indexed by tier order. Skip lines with null tierPrice
  // (unpriced SKU at this tier — surface as a receipt-time gap,
  // rendered as a "line unpriced" flag below).
  const tierIdx = useMemo(() => {
    if (!carriedTier) return -1;
    return view.tiers.findIndex((t) => t.id === carriedTier.tierId);
  }, [view.tiers, carriedTier]);

  const lines: OrderReceiptLine[] = useMemo(() => {
    if (tierIdx < 0 || !carriedTier) return [];
    return view.skus
      .map((s, i): OrderReceiptLine | null => {
        const unit = s.tierPrices[tierIdx];
        if (unit == null) return null;
        return {
          id: `sku-${i}`,
          code: s.label,
          name: s.name,
          pack: s.pack,
          qty: carriedTier.qty,
          unit,
        };
      })
      .filter((l): l is OrderReceiptLine => l !== null);
  }, [view.skus, tierIdx, carriedTier]);

  const oneTime: OrderReceiptOneTime[] = view.serviceFees.map((sf) => ({
    id: sf.id,
    label: sf.label,
    sub: sf.sub,
    amount: sf.amount,
  }));

  // ── Real flag derivation ─────────────────────────────────────
  // R9 §6 LOAD-BEARING #9 — the flags are what make the receipt
  // actionable. Below-floor and unmatched-customer both surface here
  // BEFORE the PM can send, with copy actionable enough that they
  // can forward it and get help without a follow-up question.
  const realFlags: OrderReceiptFlag[] = [];

  // Below-floor: the accepted tier's blended margin is under the
  // firm's margin floor. UI must NOT imply a process that doesn't
  // exist — admin override is v1.1+, so this is a plain block.
  if (carriedTier?.blendedMarginStatus === "BELOW_FLOOR") {
    realFlags.push({
      level: "bad",
      label: "Blocked — tier is below the margin floor",
      detail: `${carriedTier.label} lands at ${(
        carriedTier.blendedMarginPct * 100
      ).toFixed(1)}% blended margin — under the firm's floor. Cannot send this order. Roll back the acceptance and re-open the quote to fix the underlying pricing, or record the customer on a different tier that clears the floor.`,
    });
  }

  // Unmatched customer: the HubSpot company has no netsuite_customer_map
  // entry. Admin adds one at /admin/netsuite-customer-map. Name the
  // company so the PM can forward this message directly.
  if (
    effectivePreflight &&
    effectivePreflight.hasHubspotCompany &&
    effectivePreflight.netsuiteCustomer &&
    !effectivePreflight.netsuiteCustomer.matched
  ) {
    const displayName =
      effectivePreflight.hubspotCompanyName ??
      effectivePreflight.netsuiteCustomer.name;
    realFlags.push({
      level: "bad",
      label: "NetSuite customer not mapped",
      detail: `${displayName} has no NetSuite customer mapping yet. An admin can add one at /admin/netsuite-customer-map. Cannot send this order until the mapping is in place.`,
    });
  }

  // Deal cache missing / no HubSpot company — rarer, but must not
  // slip through as "pending, will resolve at send"; block the send
  // and say what's wrong.
  if (effectivePreflight && !effectivePreflight.hasHubspotCompany) {
    realFlags.push({
      level: "bad",
      label: "HubSpot company not resolved",
      detail:
        "This project's HubSpot deal has no cached company association. Refresh HubSpot on the project page (Project Detail → Refresh) and retry.",
    });
  }

  // Slice 12 Step 8b — CB P0 divergence flag between HubSpot-last-
  // pushed amount and current tier totalRevenue. Preserved verbatim
  // from 8b (still relevant post-Revise-and-re-accept on the SAME
  // tier when costs shifted between accepts).
  const divergenceFlags: OrderReceiptFlag[] = [];
  if (
    hubspotPushedAmount !== null &&
    carriedTier &&
    Math.abs(hubspotPushedAmount - carriedTier.totalRevenue) > 0.01
  ) {
    divergenceFlags.push({
      level: "warn",
      label: "HubSpot amount out of sync",
      detail: `HubSpot shows $${hubspotPushedAmount.toFixed(2)} · this order will send $${carriedTier.totalRevenue.toFixed(2)} · the amount will re-sync when the order is sent.`,
    });
  }

  // realFlags now covers both real production state AND dev-switcher-
  // forced state — because the dev switcher mutated the underlying
  // effectivePreflight + carriedTier pointers upstream. No separate
  // DEV_* fixture constants; no parallel visual override. One source.
  const soFlags: OrderReceiptFlag[] = [...realFlags, ...divergenceFlags];

  // ── NetSuite customer panel — same source as the flags above ──
  const netsuiteCustomerForReceipt = effectivePreflight?.netsuiteCustomer
    ? {
        id: effectivePreflight.netsuiteCustomer.id,
        name: effectivePreflight.netsuiteCustomer.name,
        matched: effectivePreflight.netsuiteCustomer.matched,
        matchedOn: effectivePreflight.netsuiteCustomer.matched
          ? "customer_map"
          : null,
      }
    : {
        id: "—",
        name: view.customer.name ?? "—",
        matched: false,
        matchedOn: null,
      };

  const shipToLine =
    effectivePreflight?.shipToLine ??
    "Ship-to resolves when the customer is mapped";

  // ── HubSpot amount for the ledger row (unchanged from 8b) ─────
  const hsAmountEffective = hubspotPushedAmount ?? carriedTier?.totalRevenue ?? 0;

  const total =
    lines.reduce((a, l) => a + l.qty * l.unit, 0) +
    oneTime.reduce((a, o) => a + o.amount, 0);

  // ── Send-blocking derivation ─────────────────────────────────
  // Post-8c-4: markComplete is LIVE. The only remaining structural
  // block is below-floor (admin override is v1.1+ per CA Q4). Every
  // other blocker (unmatched customer, unresolved SKU, missing
  // business segment) is surfaced through markComplete's own guards
  // — the tab reveals them as flags OR the failed-tab error copy
  // after a Send attempt. Fidelity manifest note #1 above.
  const belowFloorDisabled =
    carriedTier?.blendedMarginStatus === "BELOW_FLOOR";
  const unmappedCustomerDisabled = Boolean(
    effectivePreflight?.hasHubspotCompany &&
      effectivePreflight.netsuiteCustomer &&
      !effectivePreflight.netsuiteCustomer.matched,
  );
  const noHubspotCompanyDisabled = Boolean(
    effectivePreflight && !effectivePreflight.hasHubspotCompany,
  );

  const disabledReasons: string[] = [];
  if (belowFloorDisabled) {
    disabledReasons.push(
      "Blocked — the accepted tier is below the firm's margin floor.",
    );
  }
  if (unmappedCustomerDisabled) {
    disabledReasons.push(
      "Blocked — HubSpot company is not mapped to a NetSuite customer.",
    );
  }
  if (noHubspotCompanyDisabled) {
    disabledReasons.push(
      "Blocked — this project has no cached HubSpot company association.",
    );
  }
  const sendDisabled =
    belowFloorDisabled || unmappedCustomerDisabled || noHubspotCompanyDisabled;
  const disabledReason = disabledReasons.join(" ");

  // ── Send handler ─────────────────────────────────────────────
  function onConfirm() {
    setInFlightError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const result = await markComplete(fd);
      if (result.ok) {
        // Success: refresh so page.tsx re-reads quote.status='complete'
        // and the record variant renders with real soId/soCreatedAt.
        // Modal will unmount when the parent re-renders (variant flip).
        router.refresh();
        setModal(false);
      } else {
        // Failure: keep the modal open so the PM sees the error next
        // to what they were about to send. router.refresh() surfaces
        // the persisted netsuite_so_pushes row for the failed variant
        // on any subsequent navigation. Modal's cancel button
        // dismisses back to the failed-tab.
        setInFlightError(result.error.message);
        router.refresh();
      }
    });
  }

  // ── Not-yet-accepted state ───────────────────────────────────
  if (!isAccepted && !isComplete) {
    return (
      <div className="r9-wrap">
        <p className="eyebrow">Sub-tab 5 · Sales Order · awaiting acceptance</p>
        <h1 className="r8-h1">Record acceptance first</h1>
        <p className="r8-sub">
          The Sales Order is prepared from the tier the customer named at
          acceptance. Record that in the previous tab, then come back to
          review the order and send it.
        </p>
        <AdvanceBar
          weight="light"
          back={{ label: "Acceptance", onClick: () => onGo("accepted") }}
          mid={<span>quote state · {quoteStatus}</span>}
          caption="Advance available once acceptance is recorded"
          label="Send order to NetSuite"
          disabled
        />
      </div>
    );
  }

  if (!carriedTier) {
    return (
      <div className="r9-wrap">
        <p className="eyebrow">Sub-tab 5 · Sales Order</p>
        <h1 className="r8-h1">Missing tier data</h1>
        <p className="r8-sub">
          Cannot render the order — no tier rollup found. Check that
          quote tiers + cost data are populated.
        </p>
      </div>
    );
  }

  // ── Accepted / complete / failed states — the receipt ────────
  const placed = variant === "record";
  const failed = variant === "failed";

  // Which error to render in the failed tab's split-banner error
  // slot. Priority: in-flight error from this session's attempt >
  // persisted error from the quote row mirror > persisted error
  // from the preflight (netsuite_so_pushes.errorDetail). Copy
  // arrives verbatim from markComplete's error messages (already
  // actionable per CA discipline: names the SKU, names the
  // customer, names the admin URL where relevant).
  const persistedError =
    soPushMirror.pushError ??
    salesOrderPreflight?.latestPush?.errorDetail ??
    null;
  const failureDetail = inFlightError ?? persistedError;
  const failureCompletedAt =
    salesOrderPreflight?.latestPush?.completedAt ?? null;

  const headingText = placed
    ? "Order placed"
    : failed
      ? "The order didn't reach NetSuite"
      : `Send ${view.customer.name ?? "the customer"}'s order to NetSuite`;
  const lede = placed
    ? "This is the canonical record of what was agreed and what was ordered. The quote and every sub-tab are read-only."
    : failed
      ? "Two things are true at once — read both before you retry."
      : "Everything below goes to NetSuite exactly as shown. Read it, then send.";

  return (
    <div className="r9-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">
            Sub-tab 5 · Sales Order ·{" "}
            {placed ? "record" : failed ? "push failed" : "pending"}
          </p>
          <h1 className="r8-h1">{headingText}</h1>
          <p className="r8-sub">{lede}</p>

          {/* R9 §R9.1-1 + §6 LOAD-BEARING #9 — failed state renders
              as a full-width tab-level SPLIT BANNER (not a modal).
              Left green half: what's still true. Right red half:
              what didn't happen + the specific error. Copy is not a
              placeholder — it's the persisted error from
              netsuite_so_pushes, verbatim from markComplete's guard
              chain. */}
          {failed && (
            <div className="r9-so-split">
              <div className="half held">
                <div className="k">
                  <span>✓</span> still true
                </div>
                <div className="t">The customer accepted</div>
                <div className="s">
                  {view.customer.name ?? "The customer"} accepted{" "}
                  {quoteNumberDb ?? "(quote)"} v{quoteVersionNumber} at{" "}
                  {carriedTier.label}, and the HubSpot deal is{" "}
                  <strong>{hubspotAcceptStageLabel}</strong> at{" "}
                  {usd(hsAmountEffective)}. Nothing about the acceptance is
                  undone, and you don&apos;t need to re-record it.
                </div>
              </div>
              <div className="half lost">
                <div className="k">
                  <span>✕</span> did not happen
                </div>
                <div className="t">The order was not placed</div>
                <div className="s">
                  No Sales Order exists in NetSuite. The quote is still
                  accepted and still reversible — retry when ready.
                  {failureCompletedAt && (
                    <>
                      {" "}Last attempt{" "}
                      {failureCompletedAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: false,
                      })}
                      .
                    </>
                  )}
                </div>
                {failureDetail && (
                  <div className="err" data-testid="so-failed-error-detail">
                    {failureDetail}
                  </div>
                )}
                {/* Slice 12 Step 9 CD audit Item 2 — the in-box
                    "Retry send" button was removed per CD amendment.
                    The split banner explains; the advance bar acts
                    (its own "Retry — send order to NetSuite" label
                    carries the retry affordance and correctly
                    reflects the send-blocked state via disabled).
                    "Copy error" replaces it — always enabled when
                    an error string exists, EVEN in a blocked below-
                    floor state (a PM who can't send still needs to
                    forward the error to whoever can unblock it). */}
                {failureDetail && (
                  <div className="acts">
                    <button
                      className="btn sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(failureDetail);
                          setErrorCopied(true);
                          setTimeout(() => setErrorCopied(false), 2000);
                        } catch {
                          // Clipboard API failed (denied permission /
                          // insecure context) — leave the button
                          // enabled; PM can still select-copy from
                          // the .err block above. Silent failure per
                          // "don't confuse the PM with unactionable
                          // browser-permission errors."
                        }
                      }}
                      data-testid="so-failed-copy-error"
                    >
                      {errorCopied ? "Copied ✓" : "Copy error"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <OrderReceipt
            state={variant}
            tierLabel={carriedTier.label}
            tierQty={carriedTier.qty}
            customerName={view.customer.name ?? "—"}
            quoteNumber={quoteNumberDb}
            quoteVersion={quoteVersionNumber}
            acceptedAt={quoteAcceptedAt}
            /* Real record shape reads from soPushMirror. Dev-forced
               record variant (against an unsent quote) falls back to
               a plausible-shaped stub so CD / CB walks see the real
               visual weight — "no order number yet" would misread as
               a bug per CB round 1 P5. */
            soId={
              placed
                ? (soPushMirror.soTranid ??
                    soPushMirror.soId ??
                    (devVariant === "record" ? "SO-DEV-STUB" : null))
                : null
            }
            soCreatedAt={
              placed
                ? (soPushMirror.pushedAt ??
                    (devVariant === "record" ? new Date() : null))
                : null
            }
            netsuiteCustomer={netsuiteCustomerForReceipt}
            shipTo={shipToLine}
            terms={view.quote.paymentTerms ?? "—"}
            incoterms={view.quote.incoterms ?? "—"}
            requestedShipIso={null}
            lines={lines}
            oneTime={oneTime}
            soFlags={soFlags}
            hubspotAmount={hsAmountEffective}
            hubspotStageLabel={hubspotAcceptStageLabel}
            netsuiteStatusOnPush={netsuiteStatusOnPush}
          />

          {!placed && (
            <div className="r9-prov" style={{ marginTop: 12 }}>
              <span>◆</span>
              <span>
                Tier carried from acceptance — {carriedTier.label},{" "}
                {carriedTier.qty.toLocaleString()} units. Recorded{" "}
                {quoteAcceptedAt
                  ? quoteAcceptedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
                .
              </span>
            </div>
          )}
        </div>

        <div className="r8-side">
          {!placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                All tiers · compliance
              </p>
              {quoteRollup.map((t) => (
                <div
                  key={t.tierId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 10,
                    padding: "7px 0",
                    borderTop: "1px solid var(--rule)",
                    opacity: t.tierId === carriedTier.tierId ? 1 : 0.62,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: "var(--ink-2)",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {t.label} · {t.qty.toLocaleString()}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                    <span style={{ color: "var(--ink-3)" }}>
                      {usd(t.totalRevenue)} ·{" "}
                    </span>
                    <span
                      style={{
                        color:
                          t.blendedMarginStatus === "GOOD"
                            ? "var(--good)"
                            : t.blendedMarginStatus === "BELOW_TARGET"
                              ? "var(--warn)"
                              : "var(--bad)",
                      }}
                    >
                      {(t.blendedMarginPct * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
              <p
                className="mono"
                style={{
                  fontSize: 9.5,
                  color: "var(--ink-4)",
                  letterSpacing: "0.04em",
                  marginTop: 9,
                }}
              >
                Read-only, from Pricing
              </p>
            </div>
          )}

          {!placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>
                Still reversible — until you send
              </p>
              <ul
                style={{
                  margin: 0,
                  padding: "0 0 0 18px",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.7,
                }}
              >
                <li>Roll back the acceptance</li>
                <li>Revise into a new version</li>
              </ul>
              <button
                className="btn sm ghost"
                style={{ marginTop: 10, width: "100%" }}
                onClick={() => onGo("accepted")}
              >
                ← Back to acceptance
              </button>
            </div>
          )}

          {placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>
                What&apos;s next
              </p>
              <ul
                style={{
                  margin: 0,
                  padding: "0 0 0 18px",
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.7,
                }}
              >
                <li>Production schedule from the SO</li>
                <li>
                  Project moves to <code>in-production</code>
                </li>
                <li>Deposit invoice on PO confirmation</li>
              </ul>
            </div>
          )}
          {placed && (
            <div className="r8-card">
              <p className="eyebrow" style={{ marginBottom: 8 }}>
                If something&apos;s wrong
              </p>
              <p
                style={{
                  margin: "0 0 0",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.55,
                }}
              >
                The order is irreversible in the PM&apos;s hands. Cancel it
                in NetSuite; edits after the Sales Order lives in NetSuite,
                not here.
              </p>
            </div>
          )}
        </div>
      </div>

      {placed ? (
        <div className="r8-advance">
          <div className="mid">
            quote state · complete · umbrella read-only
          </div>
          <div className="fwd">
            <span className="cap">
              No advance — this is the end of the lifecycle
            </span>
          </div>
        </div>
      ) : (
        // Q11 re-walk fix (R2) — hide the AdvanceBar entirely while
        // the confirm modal is open. Pre-fix: modal was portaled
        // (Q11 lift) but the sticky-positioned AdvanceBar in the tab
        // body stayed fully opaque underneath the scrim → two live-
        // looking Send buttons visible during the irreversible
        // confirmation. Simplest correct fix: don't render the bar
        // during modal-open. The Cancel button in the modal closes
        // it; the bar comes back.
        !modal && (
          <>
            {/* Slice 12 Step 8b · CB P1 fix — visible disabled-reason
                surface directly adjacent to the CTA. Aggregates every
                active reason (below-floor, unmapped customer, no
                HubSpot company). PM reads this BEFORE hovering or
                clicking the disabled Send button. */}
            {sendDisabled && disabledReason && (
              <div
                role="status"
                aria-live="polite"
                data-testid="send-disabled-reason"
                style={{
                  margin: "14px 0 0",
                  padding: "10px 14px",
                  background: "var(--warn-soft)",
                  border: "1px dashed var(--warn)",
                  borderRadius: 6,
                  fontSize: 12.5,
                  color: "var(--warn-ink, var(--ink-2))",
                  lineHeight: 1.55,
                }}
              >
                <strong
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    marginRight: 8,
                  }}
                >
                  Send is disabled
                </strong>
                {disabledReason}
              </div>
            )}
            <AdvanceBar
              weight="heavy"
              back={{ label: "Acceptance", onClick: () => onGo("accepted") }}
              mid={
                <span>
                  {carriedTier.label} · {usd(total)} ·{" "}
                  {netsuiteCustomerForReceipt.id}
                </span>
              }
              caption={
                sendDisabled
                  ? belowFloorDisabled
                    ? "Blocked — tier is below the margin floor"
                    : "Send is blocked — see reason above"
                  : "Irreversible — creates a Sales Order in NetSuite"
              }
              /* CB round 1 P1 — the label + disabled state have to
                 match. Prior version left the button reading "Send
                 order to NetSuite" even when disabled, so it looked
                 enabled next to a red banner saying it wouldn't send.
                 Label now flips to a blocked-state string; CSS
                 strengthens .r8-adv-btn.heavy:disabled to actually
                 look un-pressable on the dark slab. */
              label={
                isPending
                  ? "Sending…"
                  : sendDisabled
                    ? "Blocked — cannot send"
                    : failed
                      ? "Retry — send order to NetSuite"
                      : "Send order to NetSuite"
              }
              disabled={sendDisabled || isPending}
              onAdvance={
                sendDisabled || isPending ? undefined : () => setModal(true)
              }
            />
          </>
        )
      )}

      {/* Q11 — SendOrderModal is now portal-backed via <Modal>.
          Rendered unconditionally; `open` controls visibility so the
          Modal's Escape + scrim-click + mount lifecycle work cleanly.
          Prior conditional-render pattern forced the modal to own
          its own scrim div (inline, not portaled) — CB flagged
          "two live Send buttons visible at once." */}
      <SendOrderModal
        open={modal}
        customerName={view.customer.name ?? "the customer"}
        tierLabel={carriedTier.label}
        netsuiteCustomerId={netsuiteCustomerForReceipt.id}
        netsuiteStatusOnPush={netsuiteStatusOnPush}
        totalAmount={total}
        productLineCount={lines.length}
        oneTimeCount={oneTime.length}
        disabled={sendDisabled}
        disabledReason={disabledReason || undefined}
        sending={isPending}
        inFlightError={inFlightError}
        onClose={() => {
          if (isPending) return;
          setModal(false);
          setInFlightError(null);
        }}
        onConfirm={onConfirm}
      />
    </div>
  );
}
