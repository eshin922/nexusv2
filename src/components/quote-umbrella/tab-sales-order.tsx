"use client";

// Slice 12 Step 8b — Sales Order sub-tab body (R9.1 SalesOrderTab).
//
// Pattern 30 port of R9 canonical SalesOrderTab in
// docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:382-606.
//
// R9.1-1 design intent: ONE LAYOUT, THREE STATES (pending / failed /
// record). The tab is a RECEIPT the PM reads and signs — not a
// ceremony they perform. Every element holds its position across
// states; only header stamp + status ledger + banners change. That
// constancy is what makes the tab non-redundant (§R9.1-3): weight
// through comprehension beats weight through obstruction.
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
//   #9 (new) — Failed state MUST be a tab, not a modal. Split banner
//        below states both facts (deal closed / order not placed)
//        with equal weight.
//
// Step 8b scope:
//   - Renders all three visual states via a dev-switcher variant axis
//     (?dev=1&so-state=pending|failed|record).
//   - Production reads reach ONLY 'pending' — no writer exists for
//     status='complete' yet (Step 8c wires markComplete).
//   - Send CTA disabled with TWO independent reasons (CA amendment
//     5): (a) 8c stub not yet wired, (b) below-floor tier margin.
//   - Prebuild verifier (scripts/verify/complete-status-writer.ts)
//     enforces the status='complete' write-lock at build time.
//
// Boundary: this tab is PM-INTERNAL (sub-tab 5); reads PM-facing
// props (quoteRollup, hubspot amount from audit_log, etc.). Never
// routes through the customer-view projection.

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CustomerView } from "@/types/quote";
import type { QuotePerTierRollup } from "@/lib/costing";
import { AdvanceBar } from "./advance-bar";
import { OrderReceipt } from "./order-receipt";
import type { OrderReceiptFlag, OrderReceiptLine, OrderReceiptOneTime, ReceiptState } from "./order-receipt";
import { SendOrderModal } from "./send-order-modal";
import type { SubTabId } from "./subtabs";

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Slice 12 Step 8b — R9 canonical NetSuite defaults for the "will be
// created as X" copy on the pending-state ledger. Real value routes
// from firm_settings in 8c (NetSuite subsidiary + status_on_push).
// Hardcoded here matches the R9 data.js prototype value; treat as
// stub-visible until 8c parameterizes.
const NETSUITE_STATUS_ON_PUSH = "Pending Fulfillment";

// R9 data.js `so_flags_examples` — verbatim per Pattern 30. Dev
// switcher picks which pair renders; production derives real flags
// from tier margin status + NetSuite customer match (8c).
const FLAG_EXAMPLES: Record<"below_floor" | "unmatched", OrderReceiptFlag> = {
  below_floor: {
    level: "bad",
    label: "Tier below margin floor",
    detail:
      "Selected tier is below the firm's margin floor — admin override required before the order can be sent.",
  },
  unmatched: {
    level: "warn",
    label: "NetSuite customer unconfirmed",
    detail:
      "No exact NetSuite account match — confirm the mapping before sending, or the order lands on a new account.",
  },
};

// Reading `?dev=1&so-state=…&so-flags=…&so-failed-at=…` for the state
// switcher. Only active when the umbrella's dev switcher is enabled
// AND the browser is on the /quote route. Production reads see
// state='pending' + no flags.
function parseDevAxes(
  showStateSwitcher: boolean,
  params: URLSearchParams | null,
): {
  variant: ReceiptState;
  flagVariant: "none" | "below_floor" | "unmatched" | "both";
  failedAt: "item_group" | "so_create";
} {
  if (!showStateSwitcher || !params) {
    return { variant: "pending", flagVariant: "none", failedAt: "so_create" };
  }
  const rawState = params.get("so-state");
  const variant: ReceiptState =
    rawState === "failed" || rawState === "record" ? rawState : "pending";
  const rawFlags = params.get("so-flags");
  const flagVariant: "none" | "below_floor" | "unmatched" | "both" =
    rawFlags === "below_floor" || rawFlags === "unmatched" || rawFlags === "both"
      ? rawFlags
      : "none";
  const rawFailed = params.get("so-failed-at");
  const failedAt: "item_group" | "so_create" =
    rawFailed === "item_group" ? "item_group" : "so_create";
  return { variant, flagVariant, failedAt };
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
  showStateSwitcher: boolean;
  onGo: (id: SubTabId) => void;
};

export function TabSalesOrder({
  view,
  quoteId: _quoteId,
  quoteStatus,
  quoteVersionNumber,
  quoteNumberDb,
  quoteAcceptedAt,
  customerAcceptedTierIdDb,
  quoteRollup,
  hubspotAcceptStageLabel,
  hubspotPushedAmount,
  showStateSwitcher,
  onGo,
}: TabSalesOrderProps) {
  const [modal, setModal] = useState(false);
  const searchParams = useSearchParams();
  const { variant, flagVariant, failedAt } = parseDevAxes(
    showStateSwitcher,
    searchParams,
  );

  // Slice 12 Step 8b — this tab is only meaningfully reachable when
  // quote.status === 'accepted'. For draft/sent quotes, subtab-strip
  // marks it upcoming/disabled; but if a PM lands here via a stale
  // URL, render a minimal upcoming-state placeholder that says why.
  // Complete state — 8c writes status='complete' + the umbrella
  // renders read-only globally; this branch is unreachable in 8b.
  const isAccepted = quoteStatus === "accepted";
  const isComplete = quoteStatus === "complete";

  // Resolve the carried tier (customer_accepted_tier_id or fallback
  // to first available). All the receipt renders against this tier.
  const carriedTier =
    (customerAcceptedTierIdDb
      ? quoteRollup.find((t) => t.tierId === customerAcceptedTierIdDb)
      : undefined) ?? quoteRollup[0];

  // Derive product lines from the customer view. Leaves only; tier
  // prices indexed by tier order. Skip lines with null tierPrice
  // (unpriced SKU at this tier — surface as a receipt-time gap, but
  // for 8b render as a placeholder; real gap-detection is 8c).
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

  // Derive one-time charges from the customer view's serviceFees.
  // R9 receipt fixture treats them as a flat list; matches CD's
  // canonical structure. If a firm ever exposes per-SKU service
  // fees (scope='sku'), those STILL render here as one-time entries
  // (the receipt is order-level; SKU-scoping is a display nuance
  // that lives inside the labels).
  const oneTime: OrderReceiptOneTime[] = view.serviceFees.map((sf) => ({
    id: sf.id,
    label: sf.label,
    sub: sf.sub,
    amount: sf.amount,
  }));

  // Derive so_flags per CA amendment 1:
  //   - Real derivation (production): below_floor from carriedTier
  //     margin status; unmatched from netsuiteCustomer.matched
  //     (stubbed in 8b — always true today).
  //   - Dev switcher: override to walk the canonical fixture states.
  const realFlags: OrderReceiptFlag[] = [];
  if (carriedTier?.blendedMarginStatus === "BELOW_FLOOR") {
    realFlags.push(FLAG_EXAMPLES.below_floor);
  }
  const soFlags: OrderReceiptFlag[] =
    flagVariant === "below_floor"
      ? [FLAG_EXAMPLES.below_floor]
      : flagVariant === "unmatched"
        ? [FLAG_EXAMPLES.unmatched]
        : flagVariant === "both"
          ? [FLAG_EXAMPLES.below_floor, FLAG_EXAMPLES.unmatched]
          : realFlags;

  // Slice 12 Step 8b — HubSpot amount for the ledger row. When
  // page.tsx couldn't resolve the amount from audit_log, fall back
  // to the carriedTier's totalRevenue (structurally the same figure
  // 8a pushed — see the amount-derivation trace in PR #147).
  const hsAmountEffective = hubspotPushedAmount ?? carriedTier?.totalRevenue ?? 0;

  // NetSuite stubs (real values arrive in 8c via customer resolver)
  const nsCustomerStub = {
    id: "not-resolved-yet",
    name: view.customer.name ?? "—",
    matched: false,
    matchedOn: null,
  };
  const shipToStub =
    "TBC — resolved from HubSpot company shipping address in Step 8c";

  const total =
    lines.reduce((a, l) => a + l.qty * l.unit, 0) +
    oneTime.reduce((a, o) => a + o.amount, 0);

  // Two independent disable reasons per CA amendment 5.
  const stubDisabled = true; // 8b: markComplete not yet wired
  const belowFloorDisabled = carriedTier?.blendedMarginStatus === "BELOW_FLOOR";
  const disabledReasons: string[] = [];
  if (stubDisabled) {
    disabledReasons.push(
      "NetSuite integration wires in Step 8c — receipt is walkable, send is not.",
    );
  }
  if (belowFloorDisabled) {
    disabledReasons.push(
      "Selected tier is below the firm's margin floor — admin override required.",
    );
  }
  const sendDisabled = stubDisabled || belowFloorDisabled;
  const disabledReason = disabledReasons.join(" ");

  // ─── Not-yet-accepted or complete states ────────────────────
  if (isComplete) {
    // Step 8b never lands here — no writer sets status='complete'
    // (prebuild verifier enforces). Defensive placeholder in case a
    // future path bypasses (would fail the verifier first).
    return (
      <div className="r9-wrap">
        <p className="eyebrow">Sub-tab 5 · Sales Order · complete</p>
        <p className="r8-sub">
          This quote is complete. The umbrella is read-only. Full record
          view lands with Step 8c.
        </p>
      </div>
    );
  }

  if (!isAccepted) {
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

  // ─── Accepted state — the receipt ───────────────────────────
  const placed = variant === "record";
  const failed = variant === "failed";
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
              what didn't happen. Deliberately not a full-bleed
              red — half the screen is still good news. */}
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
                <div className="t">
                  {failedAt === "item_group"
                    ? "The Item Group wasn't created"
                    : "The order was not placed"}
                </div>
                <div className="s">
                  {failedAt === "item_group"
                    ? "The NetSuite Item Group creation was rejected before the Sales Order could be built. The quote is still accepted and still reversible — retry when ready."
                    : "No Sales Order exists in NetSuite. The quote is still accepted and still reversible — retry when ready."}
                </div>
                <div className="err">
                  {/* Step 8b: stubbed error surface. Step 8c wires
                      real failures.netsuite from a persisted error
                      row (per CA amendment 2 — the failure needs a
                      tab, not a modal, so the PM never loses "what
                      still needs doing"). */}
                  Step 8c wires the real NetSuite error detail here ·{" "}
                  {failedAt === "item_group"
                    ? "will discriminate Item Group vs SO create failure"
                    : "endpoint-level error surfaces here"}
                </div>
                <div className="acts">
                  <button
                    className="btn sm"
                    onClick={() => setModal(true)}
                    disabled={sendDisabled}
                  >
                    Retry send
                  </button>
                </div>
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
            soId={placed ? "SO-STUB-8B" : null}
            soCreatedAt={placed ? new Date() : null}
            netsuiteCustomer={nsCustomerStub}
            shipTo={shipToStub}
            terms={view.quote.paymentTerms ?? "—"}
            incoterms={view.quote.incoterms ?? "—"}
            requestedShipIso={null}
            lines={lines}
            oneTime={oneTime}
            soFlags={soFlags}
            hubspotAmount={hsAmountEffective}
            hubspotStageLabel={hubspotAcceptStageLabel}
            failedAt={failed ? failedAt : undefined}
            netsuiteStatusOnPush={NETSUITE_STATUS_ON_PUSH}
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

          {/* Step 8b — R9 override disclosure (§6 LOAD-BEARING #7 —
              "override behind a disclosure that names the
              contradiction"). Not wired for tier-change in 8b since
              accepted_tier_id is 8c's write. Placeholder so the
              affordance surface is visible; disabled with an
              explicit "Step 8c wires the override write path" note. */}
          {!placed && (
            <div className="r9-override">
              <div
                className="mono muted"
                style={{ fontSize: 11, padding: "10px 12px", color: "var(--ink-3)" }}
              >
                Order a different tier than the one they accepted · Step 8c
                wires the override write path (writes accepted_tier_id ≠
                customer_accepted_tier_id; logs the divergence to the audit
                trail).
              </div>
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
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.55,
                }}
              >
                The order is irreversible in the PM&apos;s hands. An admin
                can unlock the quote with a reason; the Sales Order must be
                cancelled in NetSuite separately.
              </p>
              <button className="btn sm ghost" disabled>
                Request unlock (admin) — Step 8c
              </button>
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
        <AdvanceBar
          weight="heavy"
          back={{ label: "Acceptance", onClick: () => onGo("accepted") }}
          mid={
            <span>
              {carriedTier.label} · {usd(total)} · {nsCustomerStub.id}
            </span>
          }
          caption={
            belowFloorDisabled
              ? "Blocked — below floor, admin override required"
              : "Irreversible — creates a Sales Order in NetSuite"
          }
          label={failed ? "Retry — send order to NetSuite" : "Send order to NetSuite"}
          disabled={sendDisabled}
          onAdvance={sendDisabled ? undefined : () => setModal(true)}
        />
      )}

      {modal && (
        <SendOrderModal
          customerName={view.customer.name ?? "the customer"}
          tierLabel={carriedTier.label}
          netsuiteCustomerId={nsCustomerStub.id}
          netsuiteStatusOnPush={NETSUITE_STATUS_ON_PUSH}
          totalAmount={total}
          productLineCount={lines.length}
          oneTimeCount={oneTime.length}
          disabled={sendDisabled}
          disabledReason={disabledReason || undefined}
          onClose={() => setModal(false)}
          onConfirm={() => {
            // Step 8b: onConfirm is inert — sendDisabled is always
            // true in production, so this branch is unreachable via
            // real state. Dev switcher can force the modal open by
            // rendering variants; the confirm still no-ops. Step 8c
            // wires markComplete here.
            setModal(false);
          }}
        />
      )}
    </div>
  );
}
