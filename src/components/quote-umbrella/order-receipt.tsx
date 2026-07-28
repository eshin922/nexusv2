"use client";

// Slice 12 Step 8b — Order receipt renderer.
// Pattern 30 port of R9 canonical OrderReceipt
// (docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:216-333).
//
// R9.1-1 design intent: ONE LAYOUT, THREE STATES (pending / failed /
// record). Every element holds its position across the three states;
// only the header stamp + status ledger change. That constancy is
// what makes the tab a receipt PMs read and sign, not a ceremony
// they perform. See docs/r9-designer-notes.md §R9.1-1.
//
// CA amendments (Step 8b directive, 2026-07-28):
//   - so_flags: renders BOTH real flags (below_floor / unmatched) +
//     empty. Populated from dev switcher in 8b; from real derivation
//     in 8c (below_floor from tier margin status, unmatched from
//     NetSuite customer match).
//   - Failed state carries a `failed_at: 'item_group' | 'so_create'`
//     discriminator so the split-banner copy can specialize on which
//     half of 8c's two-op push tripped. Populated by dev switcher in
//     8b; wired to real error shape in 8c.
//   - Record state: soId + soCreatedAt read from props (nullable);
//     async-arrival tolerant (8c may write them synchronously OR the
//     HubSpot workflow may land them later — same component).
//
// Pure renderer. No local state. All axes driven by parent (TabSalesOrder).

import type { ReactNode } from "react";

export type ReceiptState = "pending" | "failed" | "record";

export type OrderReceiptFlag = {
  level: "warn" | "bad";
  label: string;
  detail: string;
};

export type OrderReceiptLine = {
  id: string;
  code: string;
  name: string;
  pack: string | null;
  qty: number;
  unit: number;
};

export type OrderReceiptOneTime = {
  id: string;
  label: string;
  sub: string;
  amount: number;
};

export type OrderReceiptProps = {
  state: ReceiptState;
  tierLabel: string;
  tierQty: number;
  customerName: string;
  /** DB quote row's `quote_number` (PM-facing, always populated
   * once quote is sent/accepted). */
  quoteNumber: string | null;
  quoteVersion: number;
  /** Timestamp the acceptance was recorded (DB quote row's
   * accepted_at). Rendered as the "against DPS-N v{N} · accepted
   * DATE" sub-line. */
  acceptedAt: Date | null;
  /** Slice 12 Step 8b — SO id from NetSuite. Nullable; only populated
   * in record state. Async-arrival tolerant per CA amendment 3. */
  soId: string | null;
  /** Slice 12 Step 8b — SO created timestamp. Nullable; only
   * populated in record state. Async-arrival tolerant. */
  soCreatedAt: Date | null;
  /** Slice 12 Step 8b — NetSuite account resolution. Real values
   * flow via 8c's customer-match step; 8b passes stubbed values
   * routed from the fixture. `matched` false raises the unmatched
   * flag in so_flags. */
  netsuiteCustomer: {
    id: string;
    name: string;
    matched: boolean;
    matchedOn: string | null;
  };
  /** Shipping destination — stubbed in 8b (no project.ship_to
   * column). 8c will resolve from a shipping-address source
   * (project field OR HubSpot company shipping address OR
   * dedicated NetSuite entity). */
  shipTo: string;
  /** Firm-settings commercial defaults, snapshotted on quote row
   * per DEC-7. Sent quotes always have these populated. */
  terms: string;
  incoterms: string;
  /** ISO date the customer requested (or "TBC" placeholder in 8b
   * — no schema field yet). 8c may resolve from a scheduling
   * source. */
  requestedShipIso: string | null;
  lines: OrderReceiptLine[];
  oneTime: OrderReceiptOneTime[];
  /** Slice 12 Step 8b CA amendment 1 — must render from populated
   * fixtures in dev-switcher mode. Empty array = clean receipt (no
   * blockers). Non-empty renders the flag rows between totals and
   * status ledger. */
  soFlags: OrderReceiptFlag[];
  /** Slice 12 Step 8b — HubSpot side of the two-system ledger.
   * Rendered as `✓ done at acceptance` in all three states (per
   * R9.1-1). Amount is the tier turnkey figure pushed at 8a. */
  hubspotAmount: number;
  hubspotStageLabel: string;
  /** Slice 12 Step 8b CA amendment 2 — when state='failed', which
   * half of 8c's two-op push tripped. Powers the split-banner copy
   * variant in the parent TabSalesOrder (also passed here so the
   * ledger row can reflect it). */
  failedAt?: "item_group" | "so_create";
  netsuiteStatusOnPush: string;
};

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function shortDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

export function OrderReceipt({
  state,
  tierLabel,
  tierQty,
  customerName,
  quoteNumber,
  quoteVersion,
  acceptedAt,
  soId,
  soCreatedAt,
  netsuiteCustomer,
  shipTo,
  terms,
  incoterms,
  requestedShipIso,
  lines,
  oneTime,
  soFlags,
  hubspotAmount,
  hubspotStageLabel,
  failedAt,
  netsuiteStatusOnPush,
}: OrderReceiptProps): ReactNode {
  const placed = state === "record";
  const failed = state === "failed";
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const oneTimeTotal = oneTime.reduce((a, o) => a + o.amount, 0);
  const total = subtotal + oneTimeTotal;
  const units = lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="r9-so">
      <div className="r9-so-head">
        <div className="who">
          <div className="t">{customerName}</div>
          <div className="s">
            {tierLabel} · {tierQty.toLocaleString()} units per SKU ·{" "}
            {units.toLocaleString()} units total
            <br />
            against {quoteNumber ?? "(quote)"} v{quoteVersion} · accepted{" "}
            {shortDate(acceptedAt)}
          </div>
        </div>
        <div className="stamp">
          {placed && soId ? (
            <div className="n">{soId}</div>
          ) : (
            <div className="n pending">no order number yet</div>
          )}
          <div className="d">
            {placed && soCreatedAt
              ? "created " + shortDateTime(soCreatedAt)
              : "NetSuite Sales Order"}
          </div>
        </div>
      </div>

      <div className="r9-so-meta">
        <div className="cell">
          <div className="k">NetSuite account</div>
          <div className="v">
            <strong>{netsuiteCustomer.name}</strong>
            <br />
            <span className="mono">{netsuiteCustomer.id}</span>
            {netsuiteCustomer.matched && <span className="ok">✓ matched</span>}
          </div>
        </div>
        <div className="cell">
          <div className="k">Ship to</div>
          <div className="v">{shipTo}</div>
        </div>
        <div className="cell">
          <div className="k">Terms</div>
          <div className="v">
            {terms}
            <br />
            <span className="mono">{incoterms}</span>
          </div>
        </div>
        <div className="cell">
          <div className="k">Requested ship</div>
          <div className="v">
            {requestedShipIso ? shortDate(requestedShipIso) : "TBC"}
          </div>
        </div>
      </div>

      <div className="r9-so-lines">
        <div className="r9-so-lrow head">
          <span>Item</span>
          <span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>Unit</span>
          <span style={{ textAlign: "right" }}>Extended</span>
        </div>
        {lines.map((l) => (
          <div className="r9-so-lrow" key={l.id}>
            <span className="desc">
              <span className="n">{l.name}</span>
              <span className="m">
                <span className="code">{l.code}</span>
                {l.pack && (
                  <>
                    {" "}
                    · {l.pack}
                  </>
                )}
              </span>
            </span>
            <span className="num qty">{l.qty.toLocaleString()}</span>
            <span className="num unit">{usd(l.unit, 2)}</span>
            <span className="num ext">{usd(l.qty * l.unit)}</span>
          </div>
        ))}
        {oneTime.map((o) => (
          <div className="r9-so-lrow onetime" key={o.id}>
            <span className="desc">
              <span className="n">{o.label}</span>
              <span className="s">{o.sub}</span>
            </span>
            <span className="num qty">1</span>
            <span className="num unit">—</span>
            <span className="num ext">{usd(o.amount)}</span>
          </div>
        ))}
      </div>

      <div className="r9-so-totals">
        <div className="r9-so-trow">
          <span className="k">Product subtotal</span>
          <span className="v">{usd(subtotal)}</span>
        </div>
        <div className="r9-so-trow">
          <span className="k">One-time charges</span>
          <span className="v">{usd(oneTimeTotal)}</span>
        </div>
        <div className="r9-so-trow grand">
          <span className="k">Order total</span>
          <span className="v">{usd(total)}</span>
        </div>
      </div>

      {soFlags.map((f) => (
        <div
          className={"r9-so-flag " + f.level}
          key={f.label}
          data-testid={`so-flag-${f.level}`}
        >
          <span className="g">{f.level === "bad" ? "✕" : "!"}</span>
          <span>
            <span className="t">{f.label}</span>
            <span className="s">{f.detail}</span>
          </span>
        </div>
      ))}

      <div className="r9-so-status">
        <div className="r9-so-srow done">
          <span className="icon">✓</span>
          <span className="lbl">
            <strong>HubSpot</strong> — deal set to {hubspotStageLabel} at{" "}
            {usd(hubspotAmount)}
          </span>
          <span className="val">done at acceptance</span>
        </div>
        <div
          className={
            "r9-so-srow " + (placed ? "done" : failed ? "fail" : "")
          }
        >
          <span className="icon">
            {placed ? "✓" : failed ? "!" : "·"}
          </span>
          <span className="lbl">
            <strong>NetSuite</strong> — Sales Order{" "}
            {placed && soId ? (
              <span>
                {soId} created · {netsuiteStatusOnPush}
              </span>
            ) : failed ? (
              <span>
                {failedAt === "item_group"
                  ? "not created — Item Group creation rejected"
                  : "not created — endpoint rejected the order"}
              </span>
            ) : (
              <span>will be created as {netsuiteStatusOnPush}</span>
            )}
          </span>
          <span className="val">
            {placed ? "created" : failed ? "failed" : "not yet"}
          </span>
        </div>
        <div className={"r9-so-srow " + (placed ? "done" : "")}>
          <span className="icon">{placed ? "✓" : "·"}</span>
          <span className="lbl">
            <strong>Quote</strong> —{" "}
            {placed
              ? "locked as the canonical record"
              : "stays reversible until the order is sent"}
          </span>
          <span className="val">{placed ? "locked" : "not yet"}</span>
        </div>
      </div>
    </div>
  );
}
