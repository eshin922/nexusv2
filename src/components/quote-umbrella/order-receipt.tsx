"use client";

// Slice 12 Step 8c-4 — Order receipt renderer.
// Pattern 30 port of R9 canonical OrderReceipt
// (docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:216-333).
//
// R9.1-1 design intent: ONE LAYOUT, THREE STATES (pending / failed /
// record). Every element holds its position across the three states;
// only the header stamp + status ledger change. That constancy is
// what makes the tab a receipt PMs read and sign, not a ceremony
// they perform. See docs/r9-designer-notes.md §R9.1-1.
//
// Post-8c-4:
//   - so_flags: real derivation (below_floor from tier margin status,
//     unmatched from netsuite_customer_map). Dev switcher fixtures
//     still available for CB walks.
//   - Failed state: single failure shape. The `failed_at` two-way
//     discriminator (item_group vs so_create) DROPPED — flat-lines
//     have no Item Group creation step (Probe 5/6 closed the
//     grouped-SO REST path). All failures surface through the SO
//     create call; the failed-tab renders the persisted
//     netsuite_so_pushes.error_detail verbatim.
//   - Record state: soId + soCreatedAt sync-populated from quote row
//     mirrors (netsuite_so_id / netsuite_so_tranid / netsuite_pushed_at,
//     freeze-tx step 9). Nullable prop shape KEPT so a hypothetical
//     future async grouped-SO path can slot in without touching the
//     receiver.
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
  /** SO id from NetSuite (display id if present, internal id
   * otherwise). Nullable — populated in record state from the quote
   * row mirror (netsuite_so_tranid ?? netsuite_so_id). Nullable
   * shape preserved so a hypothetical future async grouped-SO path
   * can slot in without touching this component. */
  soId: string | null;
  /** SO created timestamp — from quote row's netsuite_pushed_at
   * (freeze-tx step 9). Same nullable-tolerance rationale as soId. */
  soCreatedAt: Date | null;
  /** NetSuite account resolution from preflight (customer-map
   * lookup). `matched=false` = the HubSpot company has no
   * netsuite_customer_map row; the unmatched flag in so_flags
   * carries the actionable copy. */
  netsuiteCustomer: {
    id: string;
    name: string;
    matched: boolean;
    matchedOn: string | null;
  };
  /** Shipping destination line. NetSuite resolves the actual ship-
   * to from the customer record's default shipping address at SO
   * create time (not on our create payload). We surface a compact
   * reference (customer name + "default address on file in
   * NetSuite") matching how Aisha reads live SOs. Per-quote
   * override lands v1.1+ if needed. */
  shipTo: string;
  /** Firm-settings commercial defaults, snapshotted on quote row
   * per DEC-7. Sent quotes always have these populated. */
  terms: string;
  incoterms: string;
  /** ISO date the customer requested. No schema field yet; renders
   * as "TBC" until a future slice adds one (scheduling / target-
   * ship-date capture is post-v1). */
  requestedShipIso: string | null;
  lines: OrderReceiptLine[];
  oneTime: OrderReceiptOneTime[];
  /** Flag rows rendered between totals and status ledger. Empty
   * array = clean receipt (no blockers). Non-empty = one row per
   * flag; each flag's `.detail` is the actionable copy that names
   * the SKU / customer / admin URL the PM needs to forward. */
  soFlags: OrderReceiptFlag[];
  /** HubSpot side of the two-system ledger — rendered as
   * `✓ done at acceptance` in all three states (per R9.1-1). Amount
   * is the tier turnkey figure 8a pushed. */
  hubspotAmount: number;
  hubspotStageLabel: string;
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
              <span>not created — endpoint rejected the order</span>
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
